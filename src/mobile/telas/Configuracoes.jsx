// ─── Configurações — celular ─────────────────────────────────────────────────
// Perfil, preferências do aparelho (tema, notificações) e atalhos para as
// configurações da empresa. As telas de empresa/usuários/segurança abrem o
// SettingsModule do desktop em "modo completo" — mesma lógica, sem duplicar.

import { useState } from "react";
import { useMobile } from "../contexto.js";
import { Icone, Interruptor } from "../ui.jsx";
import { iniciais } from "../dados.js";

const ROTULO_PAPEL = { admin: "ADMIN", gerente: "GERENTE", atendente: "ATENDENTE", tecnico: "TÉCNICO" };

function estadoNotificacao() {
  try {
    if (typeof Notification === "undefined") return "indisponivel";
    return Notification.permission; // granted | denied | default
  } catch {
    return "indisponivel";
  }
}

export default function Configuracoes() {
  const { user, empresa, theme, alternarTema, abrirCompleto, onLogout, onLayoutClassico, api, addToast } = useMobile();
  const [notif, setNotif] = useState(estadoNotificacao);

  const pedirNotificacoes = async () => {
    if (notif === "granted") return;
    if (notif === "denied") {
      addToast("As notificações estão bloqueadas. Libere nas configurações do navegador/aparelho.", "warning");
      return;
    }
    const ok = await api.pedirNotificacoes();
    setNotif(estadoNotificacao());
    addToast(ok ? "Notificações ativadas neste aparelho." : "Notificações não foram ativadas.", ok ? "success" : "info");
  };

  const rotuloNotif = { granted: "Ativas", denied: "Bloqueadas", default: "Ativar", indisponivel: "Indisponível" }[notif];
  const completo = () => abrirCompleto("config");

  return (
    <div className="fm-screen">
      <button type="button" className="fm-card fm-tap row" style={{ padding: 16, borderRadius: 16, textAlign: "left", color: "var(--t1)", gap: 14 }} onClick={completo}>
        <span style={{ width: 56, height: 56, borderRadius: "50%", background: "var(--brand)", color: "#fff", fontSize: 22, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", flex: "none" }}>
          {iniciais(user?.nome).slice(0, 1)}
        </span>
        <div className="grow">
          <div className="ell" style={{ fontSize: 17, fontWeight: 700 }}>{user?.nome}</div>
          <div className="ell" style={{ fontSize: 13, color: "var(--t2)" }}>{user?.email}</div>
          <div className="ell" style={{ fontSize: 11.5, fontWeight: 700, color: "var(--tb)", marginTop: 4 }}>
            {ROTULO_PAPEL[user?.role] || user?.role}{empresa?.nome ? ` · ${empresa.nome}` : ""}
          </div>
        </div>
        <Icone nome="seta" size={18} style={{ color: "var(--t3)" }} />
      </button>

      <div className="fm-label">Preferências</div>
      <div className="fm-list">
        <div className="fm-li" style={{ minHeight: 52, cursor: "default" }}>
          <span className="grow" style={{ fontSize: 15 }}>Tema escuro</span>
          <Interruptor ligado={theme === "dark"} onChange={alternarTema} rotulo="Tema escuro" />
        </div>
        <button type="button" className="fm-li" style={{ minHeight: 52 }} onClick={pedirNotificacoes}>
          <span className="grow" style={{ fontSize: 15 }}>Notificações neste aparelho</span>
          <span style={{ fontSize: 12, fontWeight: 700, padding: "3px 8px", borderRadius: 999 }}
            className={notif === "granted" ? "tone-ok" : notif === "denied" ? "tone-bad" : "tone-brand"}>
            {rotuloNotif}
          </span>
        </button>
        <Linha rotulo="Biometria, 2FA e senha" onClick={completo} />
      </div>

      <div className="fm-label">Empresa</div>
      <div className="fm-list">
        <Linha rotulo="Dados da empresa" detalhe="CNPJ, logo, PIX" onClick={completo} />
        <Linha rotulo="Usuários e permissões" onClick={completo} />
        <Linha rotulo="WhatsApp / IA" onClick={completo} />
        <Linha rotulo="Backup e auditoria" onClick={completo} />
      </div>

      <button type="button" className="fm-btn" onClick={completo}>
        <Icone nome="desktop" size={18} />Todas as configurações
      </button>
      {onLayoutClassico && (
        <button type="button" className="fm-btn ghost" onClick={onLayoutClassico}>Usar layout clássico neste aparelho</button>
      )}
      <button type="button" className="fm-btn danger" onClick={onLogout}>Sair da conta</button>
      <div style={{ textAlign: "center", fontSize: 11.5, color: "var(--t3)" }}>FrostERP v1.0.0 · app.frosterp.com.br</div>
    </div>
  );
}

function Linha({ rotulo, detalhe, onClick }) {
  return (
    <button type="button" className="fm-li" style={{ minHeight: 52 }} onClick={onClick}>
      <span className="grow" style={{ fontSize: 15 }}>{rotulo}</span>
      {detalhe && <span style={{ fontSize: 13, color: "var(--t3)" }}>{detalhe}</span>}
      <Icone nome="seta" size={16} style={{ color: "var(--t3)" }} />
    </button>
  );
}
