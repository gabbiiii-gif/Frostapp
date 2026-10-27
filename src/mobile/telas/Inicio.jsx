// ─── Início (Dashboard) — celular ────────────────────────────────────────────
// Hierarquia do design: 1 número principal (receita realizada do período), depois
// 4 indicadores de OS, a agenda de hoje, concluídas por semana e estoque baixo.

import { useState } from "react";
import { useMobile } from "../contexto.js";
import { Badge, Chips, Icone } from "../ui.jsx";
import {
  PERIODOS_DASH, rotuloPeriodo, saudacao, dataLonga, primeiroNome, kpisOS, resumoFinanceiro,
  itensAgenda, itensDoDia, concluidasPorSemana, estoqueBaixo, visualStatusOS, nomeMes,
} from "../dados.js";
import { formatCurrency, toISODate } from "../../utils.js";

export default function Inicio() {
  const { user, dados, navegar, abrirOS, podeTela } = useMobile();
  const [periodo, setPeriodo] = useState("30dias");
  const agora = new Date();
  const hoje = toISODate(agora);

  // Sem useMemo manual: o React Compiler memoiza, e as contas são lineares.
  const fin = resumoFinanceiro(dados.lancamentos, periodo);
  const kpi = kpisOS(dados.os, periodo);
  const agendaHoje = itensDoDia(itensAgenda(dados.os, dados.agendamentos), hoje);
  const semanas = concluidasPorSemana(dados.os, agora);
  const baixo = estoqueBaixo(dados.produtos, dados.estoques);

  const verFinanceiro = podeTela("financeiro");
  const maxSemana = Math.max(1, ...semanas.map((s) => s.n));
  const totalMes = semanas.reduce((a, s) => a + s.n, 0);

  return (
    <div className="fm-screen" style={{ gap: 18 }}>
      <div>
        <div style={{ fontSize: 13, color: "var(--t3)" }}>{saudacao(agora)},</div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.1 }}>{primeiroNome(user?.nome) || "bem-vindo"}</div>
        <div style={{ fontSize: 12.5, color: "var(--t3)", marginTop: 4 }}>{dataLonga(agora)}</div>
      </div>

      <Chips opcoes={PERIODOS_DASH} valor={periodo} onChange={setPeriodo} />

      {verFinanceiro && (
        <button type="button" className="fm-hero fm-tap" onClick={() => navegar("financeiro")}>
          <div className="between" style={{ fontSize: 12.5, opacity: 0.9, width: "100%" }}>
            <span>Receita realizada · {rotuloPeriodo(periodo)}</span>
            <span style={{ fontWeight: 600 }}>ver tudo →</span>
          </div>
          <div className="fm-big">{formatCurrency(fin.receitaPaga)}</div>
          <div className="grid2" style={{ width: "100%" }}>
            <div className="glass">
              <div style={{ fontSize: 11, opacity: 0.85 }}>Despesas</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{formatCurrency(fin.despesaPaga)}</div>
            </div>
            <div className="glass">
              <div style={{ fontSize: 11, opacity: 0.85 }}>Saldo</div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>{fin.saldo >= 0 ? "▲" : "▼"} {formatCurrency(Math.abs(fin.saldo))}</div>
            </div>
          </div>
        </button>
      )}

      <div className="grid2" style={{ gap: 10 }}>
        <Kpi n={kpi.abertas} rotulo={`OS abertas · ${rotuloPeriodo(periodo)}`} onClick={() => navegar("os")} />
        <Kpi n={kpi.concluidas} cor="var(--ok)" rotulo={`Concluídas · ${rotuloPeriodo(periodo)}`} onClick={() => navegar("os")} />
        <Kpi n={kpi.andamento} cor="var(--info)" rotulo="Em andamento agora" onClick={() => navegar("os")} />
        <Kpi n={kpi.pendentes} cor="var(--warn)" rotulo="Aguardando início" onClick={() => navegar("os")} />
      </div>

      <div className="stack" style={{ gap: 10 }}>
        <div className="between">
          <h2 className="fm-h2">Hoje</h2>
          <span style={{ fontSize: 12.5, color: "var(--t3)" }}>
            {agendaHoje.length === 0 ? "nada agendado" : `${agendaHoje.length} ${agendaHoje.length === 1 ? "compromisso" : "compromissos"}`}
          </span>
        </div>
        {agendaHoje.length > 0 ? (
          <div className="fm-list">
            {agendaHoje.slice(0, 6).map((i) => {
              const vis = i.origem === "os" ? visualStatusOS(i.status) : { label: "Agenda", tom: "warn" };
              return (
                <button key={i.id} type="button" className="fm-li"
                  onClick={() => (i.origem === "os" ? abrirOS(i.osId) : navegar("agenda"))}>
                  <div style={{ width: 46, flex: "none", fontSize: 13, fontWeight: 700, color: "var(--tb)" }}>{i.inicio || "—"}</div>
                  <div className="grow">
                    <div className="fm-li-t ell">{i.cliente}</div>
                    <div className="fm-li-s ell">{i.sub || "—"}</div>
                  </div>
                  <Badge tom={vis.tom}>{vis.label}</Badge>
                </button>
              );
            })}
            {agendaHoje.length > 6 && podeTela("agenda") && (
              <button type="button" className="fm-li" style={{ justifyContent: "center", minHeight: 48, color: "var(--tb)", fontWeight: 600, fontSize: 13.5 }} onClick={() => navegar("agenda")}>
                Ver os {agendaHoje.length} na agenda →
              </button>
            )}
          </div>
        ) : (
          <div className="fm-card pad" style={{ fontSize: 13.5, color: "var(--t3)" }}>Nenhuma OS ou agendamento para hoje.</div>
        )}
      </div>

      <div className="fm-card pad">
        <div className="between" style={{ marginBottom: 14 }}>
          <h2 className="fm-h2">Concluídas por semana</h2>
          <span style={{ fontSize: 12, color: "var(--t3)" }}>
            {nomeMes(agora.getMonth()).replace(/^./, (c) => c.toUpperCase())} · {totalMes} OS
          </span>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${semanas.length}, 1fr)`, gap: 8, height: 96 }}>
          {semanas.map((s) => (
            <div key={s.label} style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "flex-end", gap: 4, height: "100%" }}>
              <span style={{ fontSize: 11, fontWeight: 700, color: s.atual ? "var(--tb)" : "var(--t2)" }}>{s.n}</span>
              <div style={{ width: "100%", borderRadius: "5px 5px 0 0", height: `${Math.max(4, (s.n / maxSemana) * 100)}%`,
                background: s.atual ? "var(--brand)" : "var(--hover)", transition: "height .4s" }} />
            </div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: `repeat(${semanas.length}, 1fr)`, gap: 8, marginTop: 8, fontSize: 10.5, color: "var(--t3)", textAlign: "center", lineHeight: 1.25 }}>
          {semanas.map((s) => (
            <span key={s.label} style={s.atual ? { color: "var(--tb)", fontWeight: 700 } : undefined}>
              {s.label}{s.atual && <><br />atual</>}
            </span>
          ))}
        </div>
      </div>

      {podeTela("estoque") && baixo.length > 0 && (
        <div className="fm-card pad stack" style={{ gap: 10 }}>
          <div className="between">
            <h2 className="fm-h2">Estoque baixo</h2>
            <button type="button" className="fm-link" onClick={() => navegar("estoque")}>gerenciar →</button>
          </div>
          {baixo.slice(0, 4).map((i) => (
            <div key={i.produto.id} className="between" style={{ alignItems: "center", fontSize: 14 }}>
              <span className="ell grow">{i.produto.nome}</span>
              <span style={{ fontWeight: 700, color: i.nivel === "bad" ? "var(--bad)" : "var(--warn)", flex: "none" }}>
                {i.saldo} {String(i.produto.unidade || "un").toLowerCase()}
              </span>
            </div>
          ))}
          {baixo.length > 4 && <div style={{ fontSize: 12.5, color: "var(--t3)" }}>+ {baixo.length - 4} itens abaixo do mínimo</div>}
        </div>
      )}

      {kpi.revisao > 0 && podeTela("os") && (
        <button type="button" className="fm-card pad row fm-tap" style={{ textAlign: "left", color: "var(--t1)", borderColor: "rgba(249,115,22,.35)", background: "var(--orgbg)" }}
          onClick={() => navegar("os")}>
          <span className="fm-ic-box tone-org"><Icone nome="osDoc" size={18} stroke={1.6} /></span>
          <div className="grow">
            <div style={{ fontSize: 14.5, fontWeight: 700 }}>{kpi.revisao} {kpi.revisao === 1 ? "OS aguarda" : "OS aguardam"} sua revisão</div>
            <div style={{ fontSize: 12.5, color: "var(--t2)" }}>Finalizadas pelo técnico</div>
          </div>
          <Icone nome="seta" size={18} />
        </button>
      )}
    </div>
  );
}

function Kpi({ n, rotulo, cor, onClick }) {
  return (
    <button type="button" className="fm-kpi fm-tap" onClick={onClick}>
      <div className="n" style={cor ? { color: cor } : undefined}>{n}</div>
      <div className="l">{rotulo}</div>
    </button>
  );
}
