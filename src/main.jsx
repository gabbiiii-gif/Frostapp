import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initNative, hideSplash } from './platform.js'
import { isDemoMode } from './demo.js'
import { primeiraAberturaDoDia, tempoRestanteAbertura } from './lib/abertura.js'

// Boot nativo (Capacitor): StatusBar + garante splash escondida. No-op no web.
// Splash desabilitada via capacitor.config + manifest, mas chamamos hide por seguranca.
initNative().finally(() => { hideSplash(); });

// ─── Abertura do dia ─────────────────────────────────────────────────────────
// Na 1ª abertura do dia, o splash estático do index.html (#splash-inicial) sobe
// para CIMA do app (classe fr-abertura) e fica ~1,2 s; nas outras, segue atrás e
// sai no primeiro paint (bloco no fim do arquivo). Decidido ANTES do render: o
// React monta a tela por baixo do logo, sem piscar o login. A demo fica de fora:
// ela não grava nada no localStorage do visitante (src/demo.js).
const aberturaDoDia = (() => {
  if (!document.getElementById('splash-inicial') || isDemoMode()) return false;
  try { return primeiraAberturaDoDia(window.localStorage); } catch { return false; }
})();
if (aberturaDoDia) document.getElementById('splash-inicial').classList.add('fr-abertura');

// ─── Error Boundary — captura erros de renderização do React ─────────────────
// Exibe fallback em pt-BR em vez de uma tela branca quando ocorre um erro
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    if (import.meta.env.DEV) {
      console.error("[FrostERP] Erro capturado pelo ErrorBoundary:", error, info);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center",
          background: "#0f172a", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif",
          flexDirection: "column", gap: "16px", padding: "24px", textAlign: "center",
        }}>
          <div style={{ fontSize: "48px" }}>❄️</div>
          <h1 style={{ fontSize: "24px", fontWeight: "bold", color: "#fff" }}>
            Ocorreu um erro inesperado
          </h1>
          <p style={{ color: "#94a3b8", maxWidth: "400px" }}>
            O FrostERP encontrou um problema. Por favor, recarregue a página para continuar.
          </p>
          {import.meta.env.DEV && this.state.error && (
            <pre style={{
              background: "#1e293b", padding: "12px 16px", borderRadius: "8px",
              fontSize: "12px", color: "#f87171", maxWidth: "600px", overflow: "auto",
              border: "1px solid #334155", textAlign: "left",
            }}>
              {this.state.error.toString()}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              background: "#2563eb", color: "#fff", border: "none", padding: "10px 24px",
              borderRadius: "8px", fontSize: "14px", cursor: "pointer", fontWeight: "500",
            }}
          >
            Recarregar
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>,
)

// ─── Splash estático do index.html (#splash-inicial) ─────────────────────────
// Ele é pintado antes do JS e fica ATRÁS do app (z-index -1): o React já montou
// por cima. Só pode sair depois que o navegador registrou a pintura dele. Se
// sair antes, o Chrome descarta o wordmark como candidato a LCP (elemento
// removido antes da confirmação da pintura) e o LCP vira um texto do login
// ~1 s depois. O evento "first-contentful-paint" só chega depois dessa
// confirmação. Então: remove no FCP e, por segurança, em no máximo 3 s
// (navegadores sem Paint Timing, aba em segundo plano).
function removerSplashInicial() {
  document.getElementById('splash-inicial')?.remove()
}

if (aberturaDoDia) {
  // Abertura do dia: 1,2 s contados de quando o logo foi PINTADO (FCP). Com o
  // app instalado ele pinta em ~0,1 s e o login fica pronto em ~0,3 s, então o
  // logo segura ~1 s a mais; na 1ª instalação o JS já demora mais que isso e
  // não há espera extra. Dois quadros antes do fade garantem que o React já
  // pintou a tela por baixo. O wordmark continua sendo o LCP (sai bem depois do FCP).
  let pintouEm = performance.now()
  try {
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]
    if (fcp) pintouEm = fcp.startTime
  } catch { /* sem Paint Timing: conta a partir de agora */ }
  setTimeout(() => {
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const el = document.getElementById('splash-inicial')
      if (!el) return
      el.addEventListener('transitionend', removerSplashInicial, { once: true })
      el.classList.add('fr-saindo')
      // Sem transição (movimento reduzido) o transitionend não dispara.
      setTimeout(removerSplashInicial, 500)
    }))
  }, tempoRestanteAbertura(pintouEm, performance.now()))
  // Teto: nunca prender a tela, aconteça o que acontecer.
  setTimeout(removerSplashInicial, 4000)
} else {
  setTimeout(removerSplashInicial, 3000)
  try {
    if (performance.getEntriesByName('first-contentful-paint').length) {
      requestAnimationFrame(removerSplashInicial)
    } else {
      const obs = new PerformanceObserver((lista) => {
        if (lista.getEntriesByName('first-contentful-paint').length) {
          obs.disconnect()
          requestAnimationFrame(removerSplashInicial)
        }
      })
      obs.observe({ type: 'paint', buffered: true })
    }
  } catch {
    // Sem PerformanceObserver: fica o timer de 3 s acima.
  }
}
