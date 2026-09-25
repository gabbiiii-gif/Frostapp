// Aurora em WebGL (lib OGL, shader baseado em react-bits).
//
// NÃO importe este arquivo direto: ele é carregado sob demanda por `src/Aurora.jsx`
// (React.lazy), só depois do primeiro paint e só em aparelhos com GPU de verdade.
// Assim a lib `ogl` fica fora do chunk principal.
//
// Por que o loop é "econômico" (diagnóstico PageSpeed 2026-09-24: ~30 s de trabalho
// na thread principal e TBT de ~6 s por causa do loop infinito a 60 fps):
//   - teto de ~30 fps, sem antialias, dpr 1 e sem depth buffer;
//   - nada é alocado por quadro (cores convertidas só quando a prop muda);
//   - pausa fora da tela (IntersectionObserver) e com a aba oculta;
//   - duração limitada: anima ~12 s, desacelera nos últimos ~3 s e PARA
//     (cancela o rAF). O último quadro fica congelado no canvas.
import { Renderer, Program, Mesh, Color, Triangle } from 'ogl';
import { useEffect, useLayoutEffect, useRef } from 'react';

const VERT = `#version 300 es
in vec2 position;
void main() {
  gl_Position = vec4(position, 0.0, 1.0);
}
`;

const FRAG = `#version 300 es
precision highp float;

uniform float uTime;
uniform float uAmplitude;
uniform vec3 uColorStops[3];
uniform vec2 uResolution;
uniform float uBlend;

out vec4 fragColor;

vec3 permute(vec3 x) {
  return mod(((x * 34.0) + 1.0) * x, 289.0);
}

float snoise(vec2 v){
  const vec4 C = vec4(
      0.211324865405187, 0.366025403784439,
      -0.577350269189626, 0.024390243902439
  );
  vec2 i  = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz;
  x12.xy -= i1;
  i = mod(i, 289.0);

  vec3 p = permute(
      permute(i.y + vec3(0.0, i1.y, 1.0))
    + i.x + vec3(0.0, i1.x, 1.0)
  );

  vec3 m = max(
      0.5 - vec3(
          dot(x0, x0),
          dot(x12.xy, x12.xy),
          dot(x12.zw, x12.zw)
      ),
      0.0
  );
  m = m * m;
  m = m * m;

  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0*a0 + h*h);

  vec3 g;
  g.x  = a0.x  * x0.x  + h.x  * x0.y;
  g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}

struct ColorStop {
  vec3 color;
  float position;
};

#define COLOR_RAMP(colors, factor, finalColor) {              \\
  int index = 0;                                            \\
  for (int i = 0; i < 2; i++) {                               \\
     ColorStop currentColor = colors[i];                    \\
     bool isInBetween = currentColor.position <= factor;    \\
     index = int(mix(float(index), float(i), float(isInBetween))); \\
  }                                                         \\
  ColorStop currentColor = colors[index];                   \\
  ColorStop nextColor = colors[index + 1];                  \\
  float range = nextColor.position - currentColor.position; \\
  float lerpFactor = (factor - currentColor.position) / range; \\
  finalColor = mix(currentColor.color, nextColor.color, lerpFactor); \\
}

void main() {
  vec2 uv = gl_FragCoord.xy / uResolution;

  ColorStop colors[3];
  colors[0] = ColorStop(uColorStops[0], 0.0);
  colors[1] = ColorStop(uColorStops[1], 0.5);
  colors[2] = ColorStop(uColorStops[2], 1.0);

  vec3 rampColor;
  COLOR_RAMP(colors, uv.x, rampColor);

  float height = snoise(vec2(uv.x * 2.0 + uTime * 0.1, uTime * 0.25)) * 0.5 * uAmplitude;
  height = exp(height);
  height = (uv.y * 2.0 - height + 0.2);
  float intensity = 0.6 * height;

  float midPoint = 0.20;
  float auroraAlpha = smoothstep(midPoint - uBlend * 0.5, midPoint + uBlend * 0.5, intensity);

  vec3 auroraColor = intensity * rampColor;

  fragColor = vec4(auroraColor * auroraAlpha, auroraAlpha);
}
`;

const CORES_PADRAO = ['#5227FF', '#7cff67', '#5227FF'];

// ─── Orçamento da animação ──────────────────────────────────────────────────
// O tempo conta só enquanto a aurora está visível e animando (pausas não gastam).
const DURACAO_TOTAL_MS = 12000;
const INICIO_DESACELERACAO_MS = 9000;
// Teto de ~30 fps. A folga de 4 ms absorve o jitter do rAF: em tela de 60 Hz um
// quadro chega com 33,2 ms e seria pulado por 0,1 ms, derrubando para 20 fps.
const INTERVALO_MIN_QUADRO_MS = 1000 / 30 - 4;
// Limita o passo de tempo após travadas (evita "pulo" visível da aurora).
const PASSO_MAX_S = 0.1;

// Fator de velocidade em função do tempo já animado: 1 até 9 s, depois cai de
// 1 → 0 em curva cosseno até 12 s. Como o tempo do shader é INTEGRADO
// (simTime += dt · velocidade · fator), a desaceleração é contínua, sem salto.
function fatorVelocidade(decorridoMs) {
  if (decorridoMs <= INICIO_DESACELERACAO_MS) return 1;
  if (decorridoMs >= DURACAO_TOTAL_MS) return 0;
  const p = (decorridoMs - INICIO_DESACELERACAO_MS) / (DURACAO_TOTAL_MS - INICIO_DESACELERACAO_MS);
  return 0.5 * (1 + Math.cos(Math.PI * p));
}

// Converte os 3 colorStops (hex) para RGB 0..1 escrevendo direto no array do
// uniform. Chamado só na montagem e quando a prop muda — nunca por quadro.
function preencherCores(destino, colorStops) {
  const lista = Array.isArray(colorStops) && colorStops.length ? colorStops : CORES_PADRAO;
  for (let i = 0; i < 3; i++) {
    const c = new Color(lista[Math.min(i, lista.length - 1)]);
    destino[i * 3] = c.r;
    destino[i * 3 + 1] = c.g;
    destino[i * 3 + 2] = c.b;
  }
}

export default function AuroraGL({
  colorStops = CORES_PADRAO,
  amplitude = 1.0,
  blend = 0.5,
  speed = 1.0,
  onPronto,
  onFalha,
}) {
  const ctnDom = useRef(null);
  // Props e callbacks lidos pelo loop sem recriar o contexto WebGL a cada render.
  const propsRef = useRef({ colorStops, amplitude, blend, speed });
  const callbacksRef = useRef({ onPronto, onFalha });
  // Ponte para o efeito de props: atualiza uniforms/redesenha no contexto vivo.
  const apiRef = useRef(null);

  useLayoutEffect(() => {
    propsRef.current = { colorStops, amplitude, blend, speed };
    callbacksRef.current = { onPronto, onFalha };
  });

  // Montagem: cria o contexto WebGL uma vez e controla o loop limitado.
  useEffect(() => {
    const ctn = ctnDom.current;
    if (!ctn) return;

    let renderer;
    try {
      renderer = new Renderer({
        alpha: true,
        premultipliedAlpha: true,
        // Triângulo em tela cheia: MSAA não tem aresta pra suavizar, só custa.
        antialias: false,
        // Sem depth buffer: um único triângulo, sem teste de profundidade útil.
        depth: false,
        // Explícito (já é o default do OGL): nada de canvas 2x/3x em telas retina.
        dpr: 1,
        // Fundo decorativo: não precisa acordar a GPU dedicada em notebooks híbridos.
        powerPreference: 'low-power',
      });
    } catch {
      // Sem contexto WebGL2 (o Renderer do OGL lança quando getContext volta null).
      callbacksRef.current.onFalha?.();
      return;
    }
    const gl = renderer.gl;
    const canvas = gl.canvas;
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    canvas.style.backgroundColor = 'transparent';
    canvas.style.display = 'block';

    const geometry = new Triangle(gl);
    if (geometry.attributes.uv) {
      delete geometry.attributes.uv;
    }

    // Buffers dos uniforms reaproveitados — mutados no lugar, sem alocar por quadro.
    // ATENÇÃO: precisam ser Array comum, não Float32Array. O OGL resolve o uniform
    // `uColorStops[0]` com Array.isArray(value); com typed array ele descarta o
    // uniform ("has not been supplied") e as cores ficam zeradas → aurora preta.
    const cores = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    preencherCores(cores, propsRef.current.colorStops);
    const resolucao = [ctn.offsetWidth, ctn.offsetHeight];

    const program = new Program(gl, {
      vertex: VERT,
      fragment: FRAG,
      uniforms: {
        uTime: { value: 0 },
        uAmplitude: { value: propsRef.current.amplitude ?? 1.0 },
        uColorStops: { value: cores },
        uResolution: { value: resolucao },
        uBlend: { value: propsRef.current.blend ?? 0.5 },
      },
    });

    // O shader é GLSL ES 3.00: se não linkar (ex.: só WebGL1), o canvas ficaria
    // vazio. Avisa o wrapper para manter o gradiente estático.
    if (!gl.getProgramParameter(program.program, gl.LINK_STATUS)) {
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      callbacksRef.current.onFalha?.();
      return;
    }

    const mesh = new Mesh(gl, { geometry, program });
    renderer.setSize(ctn.offsetWidth, ctn.offsetHeight);
    ctn.appendChild(canvas);

    // ─── Estado do loop ───────────────────────────────────────────────────
    let rafId = 0;
    let quadroUnicoId = 0;
    let rodando = false;       // loop rAF ativo
    let terminou = false;      // orçamento de 12 s esgotado (ou contexto perdido)
    let naTela = true;         // IntersectionObserver
    let ultimoT = -1;          // timestamp do último quadro desenhado (-1 = recém-retomado)
    let decorridoMs = 0;       // tempo de animação efetivamente exibido
    let avisouPronto = false;
    // Mesmo ponto de partida do componente original (uTime = segundos desde a
    // navegação × speed), pra aurora começar com a "cara" de sempre.
    let simTime = (performance.now() / 1000) * (propsRef.current.speed ?? 1.0);

    const desenhar = () => {
      const p = propsRef.current;
      program.uniforms.uTime.value = simTime;
      program.uniforms.uAmplitude.value = p.amplitude ?? 1.0;
      program.uniforms.uBlend.value = p.blend ?? 0.5;
      renderer.render({ scene: mesh });
      if (!avisouPronto) {
        avisouPronto = true;
        callbacksRef.current.onPronto?.();
      }
    };

    const podeAnimar = () => naTela && !document.hidden;

    const parar = () => {
      rodando = false;
      if (rafId) cancelAnimationFrame(rafId);
      rafId = 0;
    };

    const quadro = (t) => {
      if (!rodando) return;
      rafId = requestAnimationFrame(quadro);
      // Primeiro quadro após (re)iniciar: só marca o relógio — o canvas já mostra
      // o último quadro desenhado, e assim a pausa não vira um salto de tempo.
      if (ultimoT < 0) {
        ultimoT = t;
        return;
      }
      const delta = t - ultimoT;
      if (delta < INTERVALO_MIN_QUADRO_MS) return; // teto de ~30 fps
      ultimoT = t;

      const dt = Math.min(delta / 1000, PASSO_MAX_S);
      simTime += dt * (propsRef.current.speed ?? 1.0) * fatorVelocidade(decorridoMs);
      decorridoMs += dt * 1000;
      desenhar();

      // Fim do orçamento: último quadro já desenhado, encerra o rAF de vez.
      if (decorridoMs >= DURACAO_TOTAL_MS) {
        terminou = true;
        parar();
      }
    };

    const iniciar = () => {
      if (rodando || terminou || !podeAnimar()) return;
      rodando = true;
      ultimoT = -1;
      rafId = requestAnimationFrame(quadro);
    };

    // Um único quadro fora do loop (prop mudou com a animação parada/pausada).
    const pedirQuadroUnico = () => {
      if (rodando || quadroUnicoId) return; // o loop já vai desenhar
      quadroUnicoId = requestAnimationFrame(() => {
        quadroUnicoId = 0;
        desenhar();
      });
    };

    // Resize: mudar o tamanho do canvas o limpa, então redesenha UM quadro na hora
    // (síncrono, antes do paint) — sem reiniciar o loop nem gastar orçamento.
    const resize = () => {
      const w = ctn.offsetWidth;
      const h = ctn.offsetHeight;
      if (w === renderer.width && h === renderer.height) return;
      renderer.setSize(w, h);
      resolucao[0] = w;
      resolucao[1] = h;
      desenhar();
    };

    let ro = null;
    if (typeof ResizeObserver === 'function') {
      ro = new ResizeObserver(resize);
      ro.observe(ctn);
    } else {
      window.addEventListener('resize', resize);
    }

    let io = null;
    if (typeof IntersectionObserver === 'function') {
      io = new IntersectionObserver((entries) => {
        naTela = entries[entries.length - 1].isIntersecting;
        if (naTela) iniciar();
        else parar();
      });
      io.observe(ctn);
    }

    const aoMudarVisibilidade = () => {
      if (document.hidden) parar();
      else iniciar();
    };
    document.addEventListener('visibilitychange', aoMudarVisibilidade);

    // Contexto perdido (GPU resetou, limite de contextos do navegador…): o canvas
    // fica em branco — devolve a vez ao gradiente estático do wrapper.
    const aoPerderContexto = () => {
      terminou = true;
      parar();
      callbacksRef.current.onFalha?.();
    };
    canvas.addEventListener('webglcontextlost', aoPerderContexto);

    apiRef.current = {
      // Chamado quando colorStops/amplitude/blend mudam (ex.: troca de tema no login).
      aplicarProps() {
        preencherCores(cores, propsRef.current.colorStops);
        pedirQuadroUnico();
      },
    };

    // Primeiro quadro síncrono (o wrapper faz o fade-in a partir dele) e início do loop.
    desenhar();
    iniciar();

    return () => {
      apiRef.current = null;
      parar();
      if (quadroUnicoId) cancelAnimationFrame(quadroUnicoId);
      ro?.disconnect();
      io?.disconnect();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', aoMudarVisibilidade);
      // Remove antes do loseContext para não disparar onFalha na desmontagem.
      canvas.removeEventListener('webglcontextlost', aoPerderContexto);
      if (canvas.parentNode === ctn) {
        ctn.removeChild(canvas);
      }
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    };
  }, []);

  // Props visuais mudaram: reconverte as cores (só aqui, nunca no loop) e, se a
  // animação já parou, redesenha um quadro para refletir a mudança.
  const chaveCores = Array.isArray(colorStops) ? colorStops.join('|') : '';
  useEffect(() => {
    apiRef.current?.aplicarProps();
  }, [chaveCores, amplitude, blend]);

  return <div ref={ctnDom} style={{ width: '100%', height: '100%', position: 'absolute', inset: 0 }} />;
}
