// Componente Aurora - fundo do login, do login master e do hero do Dashboard.
//
// Wrapper leve: NÃO importa `ogl`. Sempre pinta de imediato um gradiente CSS que
// aproxima a aurora (custo ~zero) e só depois, se o aparelho aguentar, troca por
// cima com fade para a versão WebGL (`src/AuroraGL.jsx`, carregada com React.lazy
// em chunk separado).
//
// Motivo (PageSpeed 2026-09-24): o shader em tela cheia num rAF infinito a 60 fps
// gerava ~30 s de trabalho na thread principal e TBT de ~6 s — no servidor do
// Lighthouse não há GPU (SwiftShader), então cada quadro virava CPU pura.
//
// A versão WebGL só entra se TODAS valerem:
//   - `prefers-reduced-motion` não é `reduce`;
//   - `navigator.connection.saveData` não está ligado;
//   - há WebGL2 acelerado por hardware (sem SwiftShader/llvmpipe/renderer de software);
//   - o primeiro paint já aconteceu (requestIdleCallback, com fallback setTimeout).
import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';

// Se o chunk falhar (offline, deploy novo com hash trocado), fica só o gradiente.
const AuroraGL = lazy(() =>
  import('./AuroraGL.jsx').catch(() => ({ default: () => null }))
);

const CORES_PADRAO = ['#5227FF', '#7cff67', '#5227FF'];
const DURACAO_FADE = '1s';
const RE_RENDERER_SOFTWARE = /swiftshader|llvmpipe|software|basic render/i;

// ─── Detecção de GPU (uma vez por carregamento, cache em nível de módulo) ───
// null = ainda não testado; true/false = resultado.
let gpuRapidaCache = null;

function temGpuRapida() {
  if (gpuRapidaCache !== null) return gpuRapidaCache;
  gpuRapidaCache = false;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    // failIfMajorPerformanceCaveat: o navegador devolve null quando o contexto
    // seria renderizado por software (ex.: SwiftShader no Lighthouse/headless).
    const opcoes = { failIfMajorPerformanceCaveat: true };
    const gl2 = canvas.getContext('webgl2', opcoes);
    // O fallback "webgl" só serve pra ler o renderer: o shader da aurora é
    // GLSL ES 3.00 e não compila em WebGL1, então sem WebGL2 fica o gradiente.
    const gl = gl2 || canvas.getContext('webgl', opcoes);
    if (!gl) return gpuRapidaCache;

    // Chrome/Safari mascaram gl.RENDERER ("WebKit WebGL"); aí consulta a extensão
    // de debug. O Firefox já devolve o renderer real (e avisa se pedir a extensão).
    let nomeRenderer = String(gl.getParameter(gl.RENDERER) || '');
    if (!nomeRenderer || /^webkit webgl$/i.test(nomeRenderer)) {
      const info = gl.getExtension('WEBGL_debug_renderer_info');
      if (info) nomeRenderer = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || nomeRenderer);
    }

    gpuRapidaCache = Boolean(gl2) && !RE_RENDERER_SOFTWARE.test(nomeRenderer);
    // Libera o contexto de teste na hora (o navegador limita contextos ativos).
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch {
    gpuRapidaCache = false;
  }
  return gpuRapidaCache;
}

// Checagens baratas de preferência do usuário (sem tocar em WebGL).
function preferenciasPermitemAnimar() {
  if (typeof window === 'undefined') return false;
  try {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false;
  } catch {
    // matchMedia indisponível: segue para as outras checagens
  }
  if (navigator.connection?.saveData === true) return false;
  return true;
}

function smoothstep(e0, e1, x) {
  if (e1 <= e0) return x < e0 ? 0 : 1;
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}

// ─── Fundo estático (gradiente CSS) ─────────────────────────────────────────
// Aproxima o shader com o ruído zerado. Com t = distância a partir do topo (0..1):
//   intensidade I(t) = 0.6 · (2·(1 − t) − 1 + 0.2) = 0.72 − 1.2·t
//   alpha a(t)       = smoothstep(0.2 − blend/2, 0.2 + blend/2, I)
//   cor              = rampa horizontal(colorStops) · I   (pré-multiplicada por a)
// Em CSS: camada preta com alpha (1 − I) por cima da rampa → rampa·I; e uma
// mask-image vertical com alpha a(t). Resultado: faixa luminosa no topo que some
// para baixo, como a aurora.
function montarFundoEstatico(colorStops, blend) {
  const lista = Array.isArray(colorStops) && colorStops.length ? colorStops : CORES_PADRAO;
  const cor = (i) => lista[Math.min(i, lista.length - 1)];
  const b = Number.isFinite(blend) ? blend : 0.5;
  const borda0 = 0.2 - b / 2;
  const borda1 = 0.2 + b / 2;
  // Até onde a faixa aparece (alpha zera quando I < borda0).
  const tFim = Math.min(1, Math.max(0.05, (0.72 - borda0) / 1.2));

  const escurecer = [];
  const mascara = [];
  const PASSOS = 8;
  for (let k = 0; k <= PASSOS; k++) {
    const t = (tFim * k) / PASSOS;
    const intensidade = 0.72 - 1.2 * t;
    const alpha = smoothstep(borda0, borda1, intensidade);
    const pos = `${(t * 100).toFixed(1)}%`;
    escurecer.push(`rgba(0,0,0,${(1 - Math.min(1, Math.max(0, intensidade))).toFixed(3)}) ${pos}`);
    mascara.push(`rgba(0,0,0,${alpha.toFixed(3)}) ${pos}`);
  }

  const gradMascara = `linear-gradient(to bottom, ${mascara.join(', ')})`;
  return {
    backgroundImage:
      `linear-gradient(to bottom, ${escurecer.join(', ')}), ` +
      `linear-gradient(to right, ${cor(0)} 0%, ${cor(1)} 50%, ${cor(2)} 100%)`,
    WebkitMaskImage: gradMascara,
    maskImage: gradMascara,
  };
}

// Se o AuroraGL quebrar em runtime, some com ele sem derrubar a tela de login.
class LimiteErroAurora extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: false };
  }

  static getDerivedStateFromError() {
    return { erro: true };
  }

  componentDidCatch() {
    this.props.onErro?.();
  }

  render() {
    return this.state.erro ? null : this.props.children;
  }
}

const estiloCamada = { position: 'absolute', inset: 0, width: '100%', height: '100%' };

export default function Aurora({ colorStops = CORES_PADRAO, amplitude = 1.0, blend = 0.5, speed = 1.0 }) {
  // usarGL: monta o AuroraGL (dispara o download do chunk). glPronto: primeiro
  // quadro desenhado → cruza o fade gradiente ↔ canvas.
  const [usarGL, setUsarGL] = useState(false);
  const [glPronto, setGlPronto] = useState(false);

  // Decide se vale ligar o WebGL — só depois do primeiro paint, em tempo ocioso,
  // pra não competir com o LCP/TBT do login.
  useEffect(() => {
    if (!preferenciasPermitemAnimar()) return undefined;
    let cancelado = false;
    const liberar = () => {
      if (!cancelado && temGpuRapida()) setUsarGL(true);
    };
    if (typeof window.requestIdleCallback === 'function') {
      const id = window.requestIdleCallback(liberar, { timeout: 1500 });
      return () => {
        cancelado = true;
        window.cancelIdleCallback?.(id);
      };
    }
    const id = window.setTimeout(liberar, 300);
    return () => {
      cancelado = true;
      window.clearTimeout(id);
    };
  }, []);

  const aoFicarPronto = useCallback(() => setGlPronto(true), []);
  // Falha (chunk, contexto perdido, shader): volta ao gradiente e desmonta o GL.
  const aoFalhar = useCallback(() => {
    setGlPronto(false);
    setUsarGL(false);
  }, []);

  const chaveCores = Array.isArray(colorStops) ? colorStops.join('|') : '';
  const fundoEstatico = useMemo(
    () => montarFundoEstatico(chaveCores ? chaveCores.split('|') : CORES_PADRAO, blend),
    [chaveCores, blend]
  );

  return (
    <div aria-hidden="true" style={estiloCamada}>
      <div
        style={{
          ...estiloCamada,
          ...fundoEstatico,
          opacity: glPronto ? 0 : 1,
          transition: `opacity ${DURACAO_FADE} ease`,
        }}
      />
      {usarGL && (
        <div
          style={{
            ...estiloCamada,
            opacity: glPronto ? 1 : 0,
            transition: `opacity ${DURACAO_FADE} ease`,
          }}
        >
          <LimiteErroAurora onErro={aoFalhar}>
            <Suspense fallback={null}>
              <AuroraGL
                colorStops={colorStops}
                amplitude={amplitude}
                blend={blend}
                speed={speed}
                onPronto={aoFicarPronto}
                onFalha={aoFalhar}
              />
            </Suspense>
          </LimiteErroAurora>
        </div>
      )}
    </div>
  );
}
