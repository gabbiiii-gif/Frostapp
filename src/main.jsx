import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

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
