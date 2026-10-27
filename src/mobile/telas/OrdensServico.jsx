// ─── Ordens de Serviço — lista e detalhe (celular) ───────────────────────────
// Lista em cartões (número, status, cliente, serviço, técnico, valor), abas
// Ativas/Revisão/Histórico e filtros em chips. O detalhe mostra o andamento,
// contato do cliente, endereço, fotos e o botão que avança o status.
// A revisão da OS finalizada pelo técnico continua no ERP completo (Regra 4).

import { useMemo, useState } from "react";
import { useMobile } from "../contexto.js";
import { Avatar, Badge, Busca, Chips, Fab, Icone, Seg, Titulo, Vazio, linkMapa, linkTelefone, linkWhatsApp } from "../ui.jsx";
import {
  FLUXO_OS, visualStatusOS, passoFluxoOS, proximoStatusOS, diaAgendadoOS, rotuloDia, resumoOS, filtrarOS,
  contagemAbasOS, nomesEquipe, resumoServicoOS, primeiroNome,
} from "../dados.js";
import { formatCurrency, toISODate } from "../../utils.js";

const CHIPS = [
  { id: "todos", label: "Todas" },
  { id: "hoje", label: "Hoje" },
  { id: "semana", label: "Esta semana" },
  { id: "semTecnico", label: "Sem técnico" },
];
const POR_PAGINA = 40;

// O técnico só enxerga as próprias OS (mesma regra do ProcessModule). Na casca
// mobile ele nem entra (tem o TecnicoMobileApp), mas a regra fica aqui por segurança.
function osVisiveis(lista, user) {
  if (user?.role !== "tecnico") return lista;
  return lista.filter((os) => (os.tecnicos || []).some((t) => t.id === user.id) || os.tecnicoId === user.id);
}

export function ListaOS() {
  const { user, dados, abrirOS, abrirForm, abrirCompleto, podeGerenciar, pendingProposals } = useMobile();
  const [aba, setAba] = useState("ativas");
  const [chip, setChip] = useState("todos");
  const [busca, setBusca] = useState("");
  const [limite, setLimite] = useState(POR_PAGINA);
  const hoje = toISODate(new Date());

  const todas = useMemo(() => osVisiveis(dados.os, user), [dados.os, user]);
  const resumo = useMemo(() => resumoOS(todas), [todas]);
  const contagem = useMemo(() => contagemAbasOS(todas), [todas]);
  const lista = useMemo(() => filtrarOS(todas, { aba, chip, busca, hoje }), [todas, aba, chip, busca, hoje]);

  const sub = `${resumo.abertas} ${resumo.abertas === 1 ? "aberta" : "abertas"} · ${resumo.andamento} em andamento agora`;

  return (
    <div className="fm-screen">
      <Titulo titulo="Ordens de Serviço" sub={sub} />

      <div className="grid3">
        <Stat n={resumo.pendentes} cor="var(--warn)" rotulo="Aguardando" onClick={() => { setAba("ativas"); setChip("todos"); }} />
        <Stat n={resumo.andamento} cor="var(--info)" rotulo="Em execução" onClick={() => { setAba("ativas"); setChip("todos"); }} />
        <Stat n={resumo.revisao} cor="var(--org)" rotulo="Em revisão" onClick={() => setAba("revisao")} />
      </div>

      {pendingProposals > 0 && podeGerenciar && (
        <button type="button" className="fm-card pad row fm-tap" style={{ textAlign: "left", color: "var(--t1)", borderColor: "rgba(249,115,22,.35)", background: "var(--orgbg)" }}
          onClick={() => abrirCompleto("processos")}>
          <span className="fm-ic-box tone-org"><Icone nome="ia" size={18} stroke={1.6} /></span>
          <div className="grow">
            <div style={{ fontSize: 14, fontWeight: 700 }}>{pendingProposals} {pendingProposals === 1 ? "proposta de OS da IA" : "propostas de OS da IA"}</div>
            <div style={{ fontSize: 12.5, color: "var(--t2)" }}>Aguardando aprovação</div>
          </div>
          <Icone nome="seta" size={18} />
        </button>
      )}

      <Busca valor={busca} onChange={(v) => { setBusca(v); setLimite(POR_PAGINA); }} placeholder="Buscar OS, cliente ou técnico…" />

      <Seg valor={aba} onChange={(v) => { setAba(v); setLimite(POR_PAGINA); }} opcoes={[
        { id: "ativas", label: `Ativas · ${contagem.ativas}` },
        { id: "revisao", label: `Revisão · ${contagem.revisao}` },
        { id: "historico", label: "Histórico" },
      ]} />

      {aba === "ativas" && <Chips opcoes={CHIPS} valor={chip} onChange={setChip} soft />}

      <div className="stack" style={{ gap: 10 }}>
        {lista.length === 0 && (
          <Vazio>
            {busca ? "Nenhuma OS encontrada para essa busca." : aba === "revisao" ? "Nenhuma OS aguardando revisão." : "Nenhuma OS por aqui."}
          </Vazio>
        )}
        {lista.slice(0, limite).map((os) => <CartaoOS key={os.id} os={os} hoje={hoje} onClick={() => abrirOS(os.id)} />)}
        {lista.length > limite && (
          <button type="button" className="fm-btn ghost" onClick={() => setLimite((l) => l + POR_PAGINA)}>
            Mostrar mais ({lista.length - limite})
          </button>
        )}
      </div>

      {podeGerenciar && <Fab rotulo="Nova OS" onClick={() => abrirForm("novaOs")} />}
    </div>
  );
}

function Stat({ n, rotulo, cor, onClick }) {
  return (
    <button type="button" className="fm-stat fm-tap" onClick={onClick}>
      <div className="n" style={{ color: cor }}>{n}</div>
      <div className="l">{rotulo}</div>
    </button>
  );
}

function CartaoOS({ os, hoje, onClick }) {
  const vis = visualStatusOS(os.status);
  const equipe = nomesEquipe(os);
  const dia = diaAgendadoOS(os);
  const quando = dia ? `${rotuloDia(dia, hoje).replace("Hoje", "hoje").replace("Amanhã", "amanhã")}${os.horaAgendada ? " " + os.horaAgendada : ""}` : "sem data";
  return (
    <button type="button" className="fm-card pad fm-tap" onClick={onClick}
      style={{ textAlign: "left", color: "var(--t1)", display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
      <div className="between" style={{ alignItems: "center", width: "100%" }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: "var(--t3)", letterSpacing: ".04em" }}>{os.numero || "OS"}</span>
        <Badge tom={vis.tom}>{vis.label}</Badge>
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, lineHeight: 1.2 }}>{os.clienteNome || "—"}</div>
      <div style={{ fontSize: 13, color: "var(--t2)" }} className="ell">{resumoServicoOS(os)}</div>
      <div className="between" style={{ alignItems: "center", paddingTop: 10, borderTop: "1px solid var(--b1)", width: "100%" }}>
        <div className="row min0" style={{ gap: 6, fontSize: 12.5, color: "var(--t3)" }}>
          {equipe ? (
            <Avatar nome={equipe} tom="mute" size={22} />
          ) : (
            <span style={{ width: 22, height: 22, borderRadius: "50%", border: "1px dashed var(--b2)", flex: "none" }} />
          )}
          <span className="ell">{equipe ? primeiroNome(equipe.split(",")[0]) : "Sem técnico"} · {quando}</span>
        </div>
        <div style={{ fontSize: 15, fontWeight: 700, flex: "none" }}>{formatCurrency(os.valor)}</div>
      </div>
    </button>
  );
}

// ─── Detalhe da OS ───────────────────────────────────────────────────────────
const ROTULO_PASSO = ["Aguardando", "Deslocamento", "Execução", "Finalizado"];
const ACAO_STATUS = {
  em_deslocamento: "Técnico a caminho",
  em_execucao: "Iniciar execução",
  finalizado: "Finalizar serviço",
};

export function DetalheOS({ osId }) {
  const { dados, db, api, user, addToast, recarregar, fecharOS, abrirCompleto, podeGerenciar } = useMobile();
  const os = dados.os.find((o) => o.id === osId);
  const [salvando, setSalvando] = useState(false);

  if (!os) {
    return (
      <div className="fm-sheet" role="dialog" aria-modal="true">
        <CabecalhoDetalhe onVoltar={fecharOS} />
        <Vazio>Esta OS não existe mais (pode ter sido excluída em outro aparelho).</Vazio>
      </div>
    );
  }

  const vis = visualStatusOS(os.status);
  const passo = passoFluxoOS(os.status);
  const proximo = proximoStatusOS(os.status);
  const emRevisao = os.status === "aguardando_finalizacao";
  const cliente = dados.clientes.find((c) => c.id === os.clienteId);
  const telefone = cliente?.telefone || "";
  const equipe = nomesEquipe(os);
  const dia = diaAgendadoOS(os);
  const servicos = Array.isArray(os.servicos) && os.servicos.length > 0 ? os.servicos : null;
  const fotos = Array.isArray(os.fotos) ? os.fotos.filter((f) => typeof f === "string") : [];
  const encerrada = ["finalizado", "concluido", "cancelado", "nao_autorizada"].includes(os.status);

  // Mesma regra do changeStatus do ProcessModule: finalizar grava a data de
  // conclusão, gera a receita no Financeiro e agenda o pós-venda.
  const avancar = () => {
    if (!proximo || salvando) return;
    if (proximo === "finalizado" && !window.confirm(`Finalizar a ${os.numero}?\n\nA receita de ${formatCurrency(os.valor)} vai para o Financeiro.`)) return;
    setSalvando(true);
    const atualizada = { ...os, status: proximo, updatedAt: new Date().toISOString() };
    if (proximo === "finalizado") atualizada.dataConclusao = new Date().toISOString();
    db.set("erp:os:" + atualizada.id, atualizada);
    if (proximo === "finalizado") {
      api.syncOSToFinance(atualizada);
      api.scheduleOSPosVenda(atualizada);
    }
    addToast(`${os.numero} → ${visualStatusOS(proximo).label}`, "success");
    recarregar();
    setSalvando(false);
  };

  const linhas = [
    ["Serviço", os.tipo || "—"],
    ["Equipamento", [os.equipamentoModelo, os.equipamentoCapacidade].filter(Boolean).join(" · ") || "—"],
    ["Técnico", equipe || "Sem técnico"],
    ["Agendado", dia ? `${rotuloDia(dia)}${os.horaAgendada ? " · " + os.horaAgendada : ""}` : "—"],
  ];

  return (
    <div className="fm-sheet" role="dialog" aria-modal="true" aria-label={`OS ${os.numero}`}>
      <CabecalhoDetalhe onVoltar={fecharOS} />
      <div className="scroll-y" style={{ flex: 1, minHeight: 0, padding: "4px 16px calc(var(--safe-bottom) + 24px)", display: "flex", flexDirection: "column", gap: 16 }}>
        <div className="between" style={{ alignItems: "flex-start", gap: 12 }}>
          <div className="min0">
            <div style={{ fontSize: 12, fontWeight: 700, color: "var(--t3)", letterSpacing: ".04em" }}>{os.numero}</div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: "-.02em", lineHeight: 1.15, marginTop: 2 }}>{os.clienteNome || "—"}</div>
          </div>
          <Badge tom={vis.tom}>{vis.label}</Badge>
        </div>

        {!["cancelado", "nao_autorizada"].includes(os.status) && (
          <div className="fm-card" style={{ display: "flex", alignItems: "center", padding: "14px 10px" }}>
            {FLUXO_OS.map((st, i) => {
              const feito = i < passo || (i === passo && i === 3 && !emRevisao);
              const atual = i === passo && !feito;
              const cor = feito ? "var(--ok)" : atual ? (emRevisao ? "var(--org)" : "var(--tb)") : "var(--t3)";
              return (
                <div key={st} style={{ display: "contents" }}>
                  {i > 0 && <div style={{ height: 2, flex: 1, marginBottom: 18, background: i <= passo ? (feito || i < passo ? "var(--ok)" : "var(--brand)") : "var(--b2)" }} />}
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6, fontSize: 10.5, fontWeight: atual ? 700 : 600, color: cor }}>
                    {feito ? (
                      <span style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--ok)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
                        <Icone nome="check" size={12} stroke={3} />
                      </span>
                    ) : atual ? (
                      <span style={{ width: 22, height: 22, borderRadius: "50%", background: emRevisao ? "var(--org)" : "var(--brand)", boxShadow: `0 0 0 4px ${emRevisao ? "var(--orgbg)" : "var(--infobg)"}` }} />
                    ) : (
                      <span style={{ width: 22, height: 22, borderRadius: "50%", border: "2px solid var(--b2)" }} />
                    )}
                    {i === 3 && emRevisao ? "Revisão" : ROTULO_PASSO[i]}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <div className="fm-list">
          {linhas.map(([k, v]) => (
            <div key={k} className="between" style={{ padding: "12px 14px", borderBottom: "1px solid var(--b1)", fontSize: 14, alignItems: "center" }}>
              <span style={{ color: "var(--t3)", flex: "none" }}>{k}</span>
              <span style={{ fontWeight: 600, textAlign: "right" }} className="min0">{v}</span>
            </div>
          ))}
          {servicos && servicos.length > 1 && servicos.map((s, i) => (
            <div key={i} className="between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--b1)", fontSize: 13 }}>
              <span style={{ color: "var(--t2)" }} className="min0">{s.tipo}{s.descricao ? ` · ${s.descricao}` : ""}</span>
              <span style={{ fontWeight: 600, flex: "none" }}>{formatCurrency((Number(s.valor) || 0) * (Number(s.quantidade) || 1))}</span>
            </div>
          ))}
          <div className="between" style={{ padding: "12px 14px", fontSize: 14, alignItems: "center" }}>
            <span style={{ color: "var(--t3)" }}>Valor</span>
            <span style={{ fontWeight: 700, fontSize: 16 }}>{formatCurrency(os.valor)}</span>
          </div>
        </div>

        {telefone && (
          <div className="grid2">
            <a href={linkTelefone(telefone)} className="fm-btn" style={{ minHeight: 46, borderRadius: 12, color: "var(--t1)" }}>
              <Icone nome="telefone" size={18} />Ligar
            </a>
            <a href={linkWhatsApp(telefone)} target="_blank" rel="noreferrer" className="fm-btn" style={{ minHeight: 46, borderRadius: 12, color: "var(--t1)" }}>
              <Icone nome="whatsapp" size={18} />WhatsApp
            </a>
          </div>
        )}

        {os.endereco && (
          <div className="fm-card pad stack" style={{ gap: 10 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Endereço</div>
            <div style={{ fontSize: 14, color: "var(--t2)", lineHeight: 1.45 }}>{os.endereco}</div>
            <a href={linkMapa(os.endereco)} target="_blank" rel="noreferrer" style={{ fontSize: 13, fontWeight: 600 }}>Abrir no mapa →</a>
          </div>
        )}

        {(os.descricao || os.observacoes) && (
          <div className="fm-card pad stack" style={{ gap: 8 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>Descrição</div>
            <div style={{ fontSize: 14, color: "var(--t2)", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{os.observacoes || os.descricao}</div>
          </div>
        )}

        {fotos.length > 0 && (
          <div className="fm-card pad stack" style={{ gap: 10 }}>
            <div className="between"><div style={{ fontSize: 15, fontWeight: 700 }}>Fotos do serviço</div><span style={{ fontSize: 12.5, color: "var(--t3)" }}>{fotos.length}</span></div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
              {fotos.slice(0, 9).map((url) => (
                <a key={url} href={url} target="_blank" rel="noreferrer" style={{ aspectRatio: "1", borderRadius: 10, overflow: "hidden", background: "var(--hover)", display: "block" }}>
                  <img src={url} alt="Foto do serviço" loading="lazy" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                </a>
              ))}
            </div>
          </div>
        )}

        <div className="stack" style={{ gap: 8, paddingTop: 4 }}>
          {podeGerenciar && proximo && (
            <button type="button" className="fm-btn primary" disabled={salvando} onClick={avancar}>
              {ACAO_STATUS[proximo] || visualStatusOS(proximo).label}
            </button>
          )}
          {emRevisao && (user?.role === "admin" || user?.role === "gerente") && (
            <button type="button" className="fm-btn primary" onClick={() => { addToast(`Abra a aba Revisão e revise a ${os.numero}.`, "info"); abrirCompleto("processos"); }}>
              Revisar e aprovar
            </button>
          )}
          {podeGerenciar && !encerrada && (
            <button type="button" className="fm-btn ghost" onClick={() => { addToast(`Toque na ${os.numero} para editar.`, "info"); abrirCompleto("processos"); }}>
              Editar OS (modo completo)
            </button>
          )}
          {encerrada && podeGerenciar && (
            <button type="button" className="fm-btn ghost" onClick={() => abrirCompleto("processos")}>
              Documentos e recibo (modo completo)
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function CabecalhoDetalhe({ onVoltar }) {
  return (
    <div className="fm-sheet-head" style={{ borderBottom: 0 }}>
      <button type="button" className="fm-iconbtn" style={{ marginLeft: -10, color: "var(--t1)" }} onClick={onVoltar} aria-label="Voltar">
        <Icone nome="voltar" size={22} stroke={1.6} />
      </button>
      <span style={{ fontSize: 13, color: "var(--t3)" }}>Ordens de Serviço</span>
    </div>
  );
}
