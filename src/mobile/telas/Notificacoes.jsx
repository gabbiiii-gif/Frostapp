// ─── Notificações — celular ──────────────────────────────────────────────────
// Lista o mesmo motor de alertas do sino do desktop (OS de hoje/amanhã, OS em
// revisão, contas vencendo/atrasadas, OS paradas, conversas da IA). Agrupa por
// prioridade; toque leva ao módulo, "Dispensar" some com o alerta em todos os
// aparelhos (erp:notifDismissed sincroniza).

import { useMobile } from "../contexto.js";
import { Icone, Titulo, Vazio } from "../ui.jsx";
import { visualNotificacao } from "../dados.js";

// Módulo da notificação → tela do celular
const DESTINO = { processos: "os", financeiro: "financeiro", ia: "ia", agenda: "agenda", cadastro: "clientes" };
const GRUPOS = [
  { id: "danger", titulo: "Prioridade" },
  { id: "warning", titulo: "Atenção" },
  { id: "info", titulo: "Para acompanhar" },
];

export default function Notificacoes() {
  const { notifications, dismissNotif, navegar } = useMobile();

  const dispensarTodas = () => notifications.forEach((n) => dismissNotif(n.id));

  return (
    <div className="fm-screen">
      <Titulo titulo="Notificações" sub={notifications.length === 0 ? "Tudo em dia" : `${notifications.length} ${notifications.length === 1 ? "alerta" : "alertas"}`}>
        {notifications.length > 0 && (
          <button type="button" className="fm-link" style={{ fontSize: 13, padding: "8px 0" }} onClick={dispensarTodas}>Dispensar todas</button>
        )}
      </Titulo>

      {notifications.length === 0 && <Vazio>Nenhum alerta agora. Quando uma OS precisar de você ou uma conta vencer, aparece aqui.</Vazio>}

      {GRUPOS.map((g) => {
        const itens = notifications.filter((n) => (n.type || "info") === g.id);
        if (itens.length === 0) return null;
        return (
          <div key={g.id} className="stack" style={{ gap: 8 }}>
            <div className="fm-label">{g.titulo}</div>
            {itens.map((n) => {
              const vis = visualNotificacao(n);
              const [titulo, ...resto] = String(n.message || "").split(" — ");
              return (
                <div key={n.id} className="fm-card" style={{ display: "flex", gap: 12, padding: 14, borderColor: g.id === "info" ? "var(--b1)" : "var(--bb)" }}>
                  <span className={`fm-ic-box tone-${vis.tom}`}><Icone nome={vis.icone} size={18} stroke={1.6} /></span>
                  <button type="button" className="grow" onClick={() => navegar(DESTINO[n.module] || "dash")}
                    style={{ textAlign: "left", border: 0, background: "transparent", padding: 0, color: "var(--t1)", cursor: "pointer" }}>
                    <div style={{ fontSize: 14.5, fontWeight: 700, lineHeight: 1.3 }}>{titulo}</div>
                    {resto.length > 0 && <div style={{ fontSize: 13, color: "var(--t2)", marginTop: 2, lineHeight: 1.4 }}>{resto.join(" — ")}</div>}
                  </button>
                  <button type="button" className="fm-iconbtn" style={{ width: 36, height: 36, margin: "-6px -8px 0 0", color: "var(--t3)" }}
                    onClick={() => dismissNotif(n.id)} aria-label="Dispensar">
                    <Icone nome="fechar" size={16} />
                  </button>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
