// ─── Agenda — celular ────────────────────────────────────────────────────────
// Agendamentos + OS numa lista só, com visão Dia (faixa da semana), Semana
// (lista agrupada) e Mês (grade com pontinhos). Toque na OS abre o detalhe;
// toque no agendamento abre as ações (confirmar, concluir, cancelar, contato).

import { useMemo, useState } from "react";
import { useMobile } from "../contexto.js";
import { Acoes, Badge, Fab, Icone, Seg, Titulo, Vazio, linkTelefone, linkWhatsApp } from "../ui.jsx";
import { itensAgenda, itensDoDia, diasComItens, semanaDe, gradeMes, rotuloDia, somarDias, nomeMes, dataLocal } from "../dados.js";
import { toISODate } from "../../utils.js";

const COR_BARRA = { info: "var(--brand)", cyan: "var(--cyan)", warn: "var(--warn)", org: "var(--org)", ok: "var(--ok)", bad: "var(--bad)", mute: "var(--t3)" };
const DIAS_GRADE = ["S", "T", "Q", "Q", "S", "S", "D"];

export default function Agenda() {
  const { dados, db, addToast, recarregar, abrirOS, abrirForm, podeGerenciar } = useMobile();
  const hoje = toISODate(new Date());
  const [visao, setVisao] = useState("dia");
  const [dia, setDia] = useState(hoje);
  const [acoes, setAcoes] = useState(null);

  const itens = useMemo(() => itensAgenda(dados.os, dados.agendamentos), [dados.os, dados.agendamentos]);
  const comItens = useMemo(() => diasComItens(itens), [itens]);
  const semana = semanaDe(dia);
  const ref = dataLocal(dia);
  const tituloMes = `${nomeMes(ref.getMonth()).replace(/^./, (c) => c.toUpperCase())} ${ref.getFullYear()}`;

  const mudarStatus = (ag, status, rotulo) => {
    db.set("erp:schedule:" + ag.id, { ...ag, status, updatedAt: new Date().toISOString() });
    addToast(`Agendamento ${rotulo}.`, "success");
    recarregar();
  };

  const tocarItem = (i) => {
    if (i.origem === "os") { abrirOS(i.osId); return; }
    setAcoes(i);
  };

  const passo = visao === "mes" ? null : 7;
  const navegarPeriodo = (dir) => {
    if (visao === "mes") {
      const d = new Date(ref.getFullYear(), ref.getMonth() + dir, 1);
      setDia(toISODate(d));
    } else setDia(somarDias(dia, dir * passo));
  };

  return (
    <div className="fm-screen">
      <Titulo titulo="Agenda" sub={`${tituloMes} · agendamentos + OS`}>
        <Seg sm valor={visao} onChange={setVisao} opcoes={[{ id: "dia", label: "Dia" }, { id: "semana", label: "Sem" }, { id: "mes", label: "Mês" }]} />
      </Titulo>

      <div className="row" style={{ gap: 4 }}>
        <button type="button" className="fm-iconbtn" style={{ width: 32, marginLeft: -8 }} onClick={() => navegarPeriodo(-1)} aria-label="Anterior">
          <Icone nome="voltar" size={18} />
        </button>
        {visao === "mes" ? (
          <div className="grow" style={{ textAlign: "center", fontWeight: 700 }}>{tituloMes}</div>
        ) : (
          <div className="grow" style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}>
            {semana.map((d) => {
              const sel = d.iso === dia;
              const fds = d.curto === "SÁB" || d.curto === "DOM";
              return (
                <button key={d.iso} type="button" onClick={() => setDia(d.iso)}
                  style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4, padding: "8px 0", borderRadius: 12, border: 0, cursor: "pointer",
                    background: sel ? "var(--brand)" : "transparent", color: sel ? "#fff" : fds ? "var(--t3)" : "var(--t2)",
                    outline: d.iso === hoje && !sel ? "1px solid var(--bb)" : "none" }}>
                  <span style={{ fontSize: 10.5, fontWeight: 600 }}>{d.curto}</span>
                  <span style={{ fontSize: 16, fontWeight: sel ? 700 : 600 }}>{d.numero}</span>
                  <span style={{ width: 5, height: 5, borderRadius: "50%", background: comItens.has(d.iso) ? (sel ? "#fff" : "var(--brand)") : "transparent" }} />
                </button>
              );
            })}
          </div>
        )}
        <button type="button" className="fm-iconbtn" style={{ width: 32, marginRight: -8 }} onClick={() => navegarPeriodo(1)} aria-label="Próximo">
          <Icone nome="seta" size={18} />
        </button>
      </div>

      {dia !== hoje && (
        <button type="button" className="fm-link" style={{ alignSelf: "center", marginTop: -8 }} onClick={() => setDia(hoje)}>Voltar para hoje</button>
      )}

      {visao === "mes" && (
        <div className="fm-card" style={{ padding: 10 }}>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, fontSize: 10.5, fontWeight: 700, color: "var(--t3)", textAlign: "center", marginBottom: 4 }}>
            {DIAS_GRADE.map((d, i) => <span key={i}>{d}</span>)}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2 }}>
            {gradeMes(ref.getFullYear(), ref.getMonth()).map((iso, i) => {
              if (!iso) return <span key={i} />;
              const sel = iso === dia;
              return (
                <button key={iso} type="button" onClick={() => setDia(iso)}
                  style={{ height: 42, border: 0, borderRadius: 10, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 3,
                    background: sel ? "var(--brand)" : "transparent", color: sel ? "#fff" : iso === hoje ? "var(--tb)" : "var(--t1)", fontWeight: iso === hoje || sel ? 700 : 500, fontSize: 14 }}>
                  {dataLocal(iso).getDate()}
                  <span style={{ width: 4, height: 4, borderRadius: "50%", background: comItens.has(iso) ? (sel ? "#fff" : "var(--brand)") : "transparent" }} />
                </button>
              );
            })}
          </div>
        </div>
      )}

      {visao === "semana" ? (
        semana.map((d) => {
          const doDia = itensDoDia(itens, d.iso);
          if (doDia.length === 0) return null;
          return <Grupo key={d.iso} titulo={rotuloDia(d.iso, hoje)} itens={doDia} onTocar={tocarItem} />;
        }).filter(Boolean).concat(
          semana.every((d) => itensDoDia(itens, d.iso).length === 0) ? [<Vazio key="v">Semana livre — nada agendado.</Vazio>] : [],
        )
      ) : (
        <>
          <Grupo titulo={`${rotuloDia(dia, hoje)}${dia === hoje ? `, ${dataLocal(dia).getDate()} de ${nomeMes(ref.getMonth())}` : ""}`}
            itens={itensDoDia(itens, dia)} onTocar={tocarItem} vazio="Nada agendado neste dia." />
          {visao === "dia" && itensDoDia(itens, somarDias(dia, 1)).length > 0 && (
            <Grupo titulo={rotuloDia(somarDias(dia, 1), hoje)} itens={itensDoDia(itens, somarDias(dia, 1))} onTocar={tocarItem} />
          )}
        </>
      )}

      {podeGerenciar && <Fab rotulo="Agendar" onClick={() => abrirForm("agendar", { dia: dia >= hoje ? dia : hoje })} />}

      {acoes && (() => {
        const ag = acoes.ref;
        const cli = dados.clientes.find((c) => c.id === ag.clienteId);
        return (
          <Acoes titulo={acoes.cliente} sub={`${rotuloDia(acoes.dia, hoje)} · ${acoes.inicio}${acoes.fim ? "–" + acoes.fim : ""} · ${acoes.sub}`} onFechar={() => setAcoes(null)}
            acoes={[
              podeGerenciar && ag.status !== "confirmado" && { rotulo: "Confirmar", icone: "check", onClick: () => mudarStatus(ag, "confirmado", "confirmado") },
              podeGerenciar && { rotulo: "Marcar como concluído", icone: "pago", onClick: () => mudarStatus(ag, "concluido", "concluído") },
              cli?.telefone && { rotulo: "Ligar para o cliente", icone: "telefone", href: linkTelefone(cli.telefone) },
              cli?.telefone && { rotulo: "WhatsApp", icone: "whatsapp", href: linkWhatsApp(cli.telefone) },
              podeGerenciar && { rotulo: "Cancelar agendamento", icone: "fechar", perigo: true, onClick: () => { if (window.confirm("Cancelar este agendamento?")) mudarStatus(ag, "cancelado", "cancelado"); } },
            ]} />
        );
      })()}
    </div>
  );
}

function Grupo({ titulo, itens, onTocar, vazio }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="between">
        <h2 className="fm-h2">{titulo}</h2>
        <span style={{ fontSize: 12.5, color: "var(--t3)" }}>{itens.length} {itens.length === 1 ? "item" : "itens"}</span>
      </div>
      {itens.length === 0 && vazio ? <div className="fm-card pad" style={{ fontSize: 13.5, color: "var(--t3)" }}>{vazio}</div> : null}
      {itens.map((i) => (
        <button key={i.id} type="button" className="fm-card fm-tap" onClick={() => onTocar(i)}
          style={{ textAlign: "left", display: "flex", gap: 12, padding: "12px 14px 12px 0", color: "var(--t1)", overflow: "hidden", width: "100%" }}>
          <div style={{ width: 4, borderRadius: "0 3px 3px 0", background: i.semTecnico ? "var(--bad)" : COR_BARRA[i.tom] || "var(--brand)", flex: "none" }} />
          <div style={{ width: 48, flex: "none", lineHeight: 1.2 }}>
            <div style={{ fontSize: 13.5, fontWeight: 700 }}>{i.inicio || "—"}</div>
            <div style={{ fontSize: 11, color: "var(--t3)" }}>{i.fim}</div>
          </div>
          <div className="grow">
            <div className="fm-li-t ell">{i.cliente}</div>
            <div className="ell" style={{ fontSize: 12.5, color: i.semTecnico ? "var(--bad)" : "var(--t3)", fontWeight: i.semTecnico ? 600 : 400 }}>
              {i.sub}{i.semTecnico ? " · sem técnico" : ""}
            </div>
          </div>
          <span style={{ alignSelf: "center" }}>
            <Badge sm tom={i.origem === "os" ? "info" : "warn"}>{i.origem === "os" ? "OS" : "Agenda"}</Badge>
          </span>
        </button>
      ))}
    </div>
  );
}
