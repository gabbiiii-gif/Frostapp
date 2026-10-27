// ─── Rede de segurança da casca mobile ───────────────────────────────────────
// Se a casca do celular quebrar (ou o chunk não baixar), em vez de tela branca
// aparece a opção de tentar de novo ou voltar para o layout clássico — que é o
// layout antigo, sempre disponível. Fica fora do chunk do MobileApp porque
// precisa existir mesmo quando o chunk falha.

import { Component } from "react";

export default class ErroMobile extends Component {
  constructor(props) {
    super(props);
    this.state = { erro: null };
  }

  static getDerivedStateFromError(erro) {
    return { erro };
  }

  componentDidCatch(erro, info) {
    console.error("[ErroMobile]", erro, info?.componentStack);
  }

  render() {
    if (!this.state.erro) return this.props.children;
    return (
      <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 14, padding: 24, textAlign: "center", background: "#0f172a", color: "#f1f5f9", fontFamily: "'DM Sans', system-ui, sans-serif" }}>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Não foi possível abrir o app</div>
        <div style={{ fontSize: 14, color: "#cbd5e1", maxWidth: 320, lineHeight: 1.5 }}>
          Seus dados estão salvos. Tente de novo ou use o layout clássico.
        </div>
        <button type="button" onClick={() => this.setState({ erro: null })}
          style={{ height: 48, padding: "0 20px", borderRadius: 14, border: 0, background: "#1B8FE8", color: "#fff", fontWeight: 700, fontSize: 15, width: "100%", maxWidth: 320 }}>
          Tentar novamente
        </button>
        <button type="button" onClick={this.props.onClassico}
          style={{ height: 48, padding: "0 20px", borderRadius: 14, border: "1px solid rgba(148,163,184,.3)", background: "transparent", color: "#cbd5e1", fontWeight: 600, fontSize: 14, width: "100%", maxWidth: 320 }}>
          Usar layout clássico
        </button>
        <details style={{ fontSize: 12, color: "#8a9bb3", maxWidth: 320 }}>
          <summary>Detalhes técnicos</summary>
          <pre style={{ whiteSpace: "pre-wrap", textAlign: "left" }}>{String(this.state.erro?.message || this.state.erro)}</pre>
        </details>
      </div>
    );
  }
}
