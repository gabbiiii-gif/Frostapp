// ─── Primitivos visuais do FrostERP Mobile ───────────────────────────────────
// Componentes pequenos reaproveitados pelas telas e formulários do celular.
// Os ícones são os traços finos do design (estilo FrostIcons minimal).

import { useEffect } from "react";
import { iniciais } from "./dados.js";

// Traços dos ícones (viewBox 24×24, stroke = currentColor).
const ICONES = {
  menu: <path d="M4 7h16M4 12h16M4 17h10" />,
  sol: <><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M2 12h2M20 12h2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>,
  lua: <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />,
  sino: <><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M10.3 21h3.4" /></>,
  dashboard: <><rect x="3" y="3" width="8" height="8" /><rect x="13" y="3" width="8" height="8" /><rect x="3" y="13" width="8" height="8" /><rect x="13" y="13" width="8" height="8" /></>,
  os: <><rect x="5" y="3" width="14" height="18" /><path d="M8 3v3h8V3M8 11h8M8 15h5" /></>,
  osDoc: <><rect x="5" y="3" width="14" height="18" /><path d="M8 11h8M8 15h5" /></>,
  agenda: <><rect x="3" y="4" width="18" height="18" /><path d="M3 10h18M8 2v4M16 2v4" /></>,
  financeiro: <path d="M3 18l4.5-6 3.5 3 4.5-7H21M21 8v2" />,
  clientes: <><circle cx="9" cy="7" r="3.5" /><path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1M15.5 4a3 3 0 0 1 0 6" /></>,
  estoque: <path d="M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10" />,
  ia: <path d="M20 11.2a7.3 7.3 0 0 1-7.3 7.3H8l-4 3 1.1-4.1A7.3 7.3 0 1 1 20 11.2z" />,
  posvenda: <path d="M12 19.5s-6-4-7.9-7.7C2.6 9.4 3.6 6.9 6 6.2c1.6-.5 3.2.1 4.2 1.4l.8 1 .8-1c1-1.3 2.6-1.9 4.2-1.4 2.4.7 3.4 3.2 1.9 5.6C18 15.5 12 19.5 12 19.5z" />,
  lembrete: <><circle cx="12" cy="13.5" r="6.8" /><path d="M12 13.5V10M12 13.5l2.8 1.7M5 6.5L7.8 4M19 6.5L16.2 4" /></>,
  folha: <><path d="M6.5 3.2h6.5L17.8 7.4V20a.8.8 0 0 1-.8.8H6.5a.8.8 0 0 1-.8-.8V4a.8.8 0 0 1 .8-.8zM13 3.2V7.4h4.6" /><circle cx="11.7" cy="15" r="2.8" /><path d="M11.7 13v4" /></>,
  relatorios: <><rect x="3" y="3" width="18" height="18" /><path d="M7 8v10M11 11v7M15 6v12" /></>,
  config: <><path d="M4 6h16M4 12h16M4 18h16" /><circle cx="9" cy="6" r="2" fill="var(--raised)" /><circle cx="15" cy="12" r="2" fill="var(--raised)" /><circle cx="10" cy="18" r="2" fill="var(--raised)" /></>,
  ponto: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  mais: <><circle cx="5" cy="12" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="19" cy="12" r="1.6" /></>,
  busca: <><circle cx="10.5" cy="10.5" r="6.5" /><path d="M15.5 15.5L21 21" /></>,
  voltar: <path d="M15 5l-7 7 7 7" />,
  seta: <path d="M9 5l7 7-7 7" />,
  fechar: <path d="M6 6l12 12M18 6L6 18" />,
  mais1: <path d="M12 5v14M5 12h14" />,
  check: <path d="M5 13l4 4L19 7" />,
  telefone: <path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2" />,
  whatsapp: <path d="M20 11.2a7.3 7.3 0 0 1-7.3 7.3H8l-4 3 1.1-4.1A7.3 7.3 0 1 1 20 11.2z" />,
  camera: <><path d="M4 8h3l2-3h6l2 3h3v11H4z" /><circle cx="12" cy="13" r="3.5" /></>,
  sobe: <path d="M12 19V5M5 12l7-7 7 7" />,
  desce: <path d="M12 5v14M5 12l7 7 7-7" />,
  relogio: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
  sair: <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9" />,
  mapa: <><path d="M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21z" /><circle cx="12" cy="9.5" r="2.5" /></>,
  editar: <path d="M4 20h4L19 9l-4-4L4 16zM13.5 6.5l4 4" />,
  pago: <><circle cx="12" cy="12" r="8.5" /><path d="M8 12.5l2.8 2.8L16.5 9.5" /></>,
  desktop: <><rect x="3" y="4" width="18" height="12" /><path d="M8 20h8M12 16v4" /></>,
  chevron: <path d="M6 9l6 6 6-6" />,
};

export function Icone({ nome, size = 20, stroke = 1.5, className, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={stroke}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className} style={style}>
      {ICONES[nome] || ICONES.osDoc}
    </svg>
  );
}

export function Badge({ tom = "info", children, sm = false }) {
  return <span className={`fm-badge tone-${tom}${sm ? " sm" : ""}`}>{children}</span>;
}

export function Avatar({ nome, tom = "brand", size = 40, style }) {
  return (
    <span className={`fm-avatar-sm tone-${tom}`} style={{ width: size, height: size, fontSize: size < 32 ? 10 : 13, ...style }}>
      {iniciais(nome)}
    </span>
  );
}

// Controle segmentado (abas internas da tela).
export function Seg({ opcoes, valor, onChange, sm = false }) {
  return (
    <div className={`fm-seg${sm ? " sm" : ""}`} role="tablist">
      {opcoes.map((o) => (
        <button key={o.id} type="button" role="tab" aria-selected={valor === o.id}
          className={valor === o.id ? "on" : ""} onClick={() => onChange(o.id)}>
          {o.label}
          {o.badge ? <span className="fm-count">{o.badge}</span> : null}
        </button>
      ))}
    </div>
  );
}

// Fileira de chips roláveis (filtros).
export function Chips({ opcoes, valor, onChange, soft = false }) {
  return (
    <div className="scroll-x">
      {opcoes.map((o) => (
        <button key={o.id} type="button" className={`fm-chip${soft ? " soft" : ""}${valor === o.id ? " on" : ""}`}
          onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Busca({ valor, onChange, placeholder }) {
  return (
    <label className="fm-search">
      <Icone nome="busca" size={18} />
      <input type="search" value={valor} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        aria-label={placeholder} enterKeyHint="search" />
      {valor ? (
        <button type="button" className="fm-iconbtn" style={{ width: 32, height: 32, marginRight: -8 }} onClick={() => onChange("")} aria-label="Limpar busca">
          <Icone nome="fechar" size={16} />
        </button>
      ) : null}
    </label>
  );
}

export function Interruptor({ ligado, onChange, rotulo }) {
  return (
    <button type="button" role="switch" aria-checked={!!ligado} aria-label={rotulo}
      className={`fm-switch${ligado ? " on" : ""}`} onClick={() => onChange(!ligado)} />
  );
}

// Botão flutuante da ação principal da tela. O espaçador reserva a altura para
// o último cartão não ficar escondido atrás dele.
export function Fab({ rotulo, onClick }) {
  return (
    <>
      <div className="fm-fab-space" />
      <button type="button" className="fm-fab" onClick={onClick}>
        <Icone nome="mais1" size={20} stroke={2} />
        {rotulo}
      </button>
    </>
  );
}

export function Titulo({ titulo, sub, children }) {
  return (
    <div className="between" style={{ alignItems: "flex-end" }}>
      <div className="min0">
        <h1 className="fm-h1">{titulo}</h1>
        {sub ? <div className="fm-h1-sub">{sub}</div> : null}
      </div>
      {children}
    </div>
  );
}

export function Vazio({ children }) {
  return <div className="fm-empty">{children}</div>;
}

// Formulário em tela cheia (Nova OS, Novo lançamento…). Fecha com o botão de
// voltar do Android/navegador também (ver useVoltar no MobileApp).
export function Folha({ titulo, sub, extra, onFechar, rodape, children, topo = false }) {
  return (
    <div className={`fm-sheet${topo ? " top" : ""}`} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="fm-sheet-head">
        <button type="button" className="fm-iconbtn" style={{ marginLeft: -10, color: "var(--t1)" }} onClick={onFechar} aria-label="Fechar">
          <Icone nome="fechar" size={22} stroke={1.6} />
        </button>
        <div className="grow" style={{ lineHeight: 1.15 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>{titulo}</div>
          {sub ? <div style={{ fontSize: 12, color: "var(--t3)" }}>{sub}</div> : null}
        </div>
        {extra}
      </div>
      {children}
      {rodape ? <div className="fm-sheet-foot">{rodape}</div> : null}
    </div>
  );
}

// Folha de ações que sobe do rodapé (toque longo/curto em item de lista).
export function Acoes({ titulo, sub, acoes, onFechar }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === "Escape") onFechar(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onFechar]);
  return (
    <div className="fm-actions" onClick={onFechar} role="dialog" aria-modal="true" aria-label={titulo}>
      <div className="fm-actions-panel" onClick={(e) => e.stopPropagation()}>
        <div className="fm-actions-grip" />
        {titulo ? (
          <div style={{ padding: "0 12px 10px" }}>
            <div style={{ fontSize: 16, fontWeight: 700 }} className="ell">{titulo}</div>
            {sub ? <div style={{ fontSize: 13, color: "var(--t3)", marginTop: 2 }}>{sub}</div> : null}
          </div>
        ) : null}
        <div className="scroll-y">
          {acoes.filter(Boolean).map((a) => (
            a.href ? (
              <a key={a.rotulo} className={`fm-actions-item${a.perigo ? " danger" : ""}`} href={a.href}
                target={a.href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" onClick={onFechar}>
                <Icone nome={a.icone} size={20} />{a.rotulo}
              </a>
            ) : (
              <button key={a.rotulo} type="button" className={`fm-actions-item${a.perigo ? " danger" : ""}`}
                onClick={() => { onFechar(); a.onClick(); }}>
                <Icone nome={a.icone} size={20} />{a.rotulo}
              </button>
            )
          ))}
        </div>
      </div>
    </div>
  );
}

// Link de WhatsApp a partir de um telefone brasileiro (com ou sem DDI).
export function linkWhatsApp(telefone, texto = "") {
  const dig = String(telefone || "").replace(/\D/g, "");
  if (!dig) return null;
  const num = dig.length <= 11 ? "55" + dig : dig;
  return `https://wa.me/${num}${texto ? "?text=" + encodeURIComponent(texto) : ""}`;
}

export function linkTelefone(telefone) {
  const dig = String(telefone || "").replace(/\D/g, "");
  return dig ? `tel:${dig}` : null;
}

export function linkMapa(endereco) {
  return endereco ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(endereco)}` : null;
}
