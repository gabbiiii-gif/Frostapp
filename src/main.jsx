import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'
import { initNative, hideSplash } from './platform.js'

// Boot nativo (Capacitor): StatusBar + garante splash escondida. No-op no web.
// Splash desabilitada via capacitor.config + manifest, mas chamamos hide por seguranca.
initNative().finally(() => { hideSplash(); });

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
