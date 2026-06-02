// ─── Módulo Escola (painel interno) ──────────────────────────────────────────
// Painel para a equipe interna gerenciar demandas enviadas pela Vanda.
//
// ⚠️ ISOLAMENTO OBRIGATÓRIO:
//   - Não chama syncOSToFinance.
//   - Não cria entradas em erp:finance:* ou erp:os:*.
//   - Dados ficam exclusivamente em erp:escola:* e erp:evento_escola:*.
//
// Funcionalidades:
//   - Listagem com filtros (status, urgência, escola).
//   - KPIs (total, aguardando, em execução, concluídas).
//   - Detalhe da demanda + timeline + ações (Assumir, Concluir, Cancelar).
//
// Próximas fases (não implementadas aqui):
//   - Notificação automática à Vanda (push/email) em mudança de status.
//   - Exportação de relatórios semanais/mensais.

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  listarTodasDemandas,
  listarTimeline,
  assumirDemanda,
  concluirDemanda,
  cancelarDemanda,
  calcularMetricas,
  URGENCIA,
  URGENCIA_OPCOES,
  STATUS_ESCOLA,
} from "../lib/escola.js";
import { formatDate } from "../utils.js";
// Notificação fire-and-forget — falhas de email não travam transição local.
import { notifyEscolaEvent } from "../supabase.js";

// Mesmos labels usados no portal externo — mantemos consistência visual.
const STATUS_LABEL = {
  aguardando: { label: "Aguardando", color: "bg-yellow-500" },
  em_execucao: { label: "Em execução", color: "bg-blue-500" },
  concluido: { label: "Concluído", color: "bg-green-500" },
  cancelado: { label: "Cancelado", color: "bg-gray-500" },
};

export default function EscolaModule({ user, addToast, db, reloadData }) {
  // Apenas admin/gerente/tecnico chegam aqui (gating de role em hasPermission).
  // cliente_escola é desviado para EscolaPortalVanda no render principal.
  const canManage = useMemo(
    () => user?.role === "admin" || user?.role === "gerente" || user?.role === "tecnico",
    [user]
  );

  // ─── Estado e dados ───
  const [tick, setTick] = useState(0);
  const [filtroStatus, setFiltroStatus] = useState("");
  const [filtroUrgencia, setFiltroUrgencia] = useState("");
  const [buscaEscola, setBuscaEscola] = useState("");

  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Lista filtrada (recalcula a cada tick ou mudança de filtros).
  const demandas = useMemo(() => {
    if (!db) return [];
    return listarTodasDemandas(db, {
      status: filtroStatus || undefined,
      urgencia: filtroUrgencia || undefined,
      escola: buscaEscola || undefined,
    });
  }, [db, filtroStatus, filtroUrgencia, buscaEscola, tick]);

  // KPIs sempre sobre o total (não filtrado) para uma visão consistente da semana.
  const metricasGlobais = useMemo(() => {
    if (!db) return null;
    return calcularMetricas(listarTodasDemandas(db));
  }, [db, tick]);

  // ─── Modal detalhe ───
  const [demandaDetalheId, setDemandaDetalheId] = useState(null);
  const demandaDetalhe = useMemo(() => {
    if (!demandaDetalheId || !db) return null;
    return db.get(demandaDetalheId);
  }, [demandaDetalheId, db, tick]);
  const timeline = useMemo(() => {
    if (!demandaDetalheId || !db) return [];
    return listarTimeline(db, demandaDetalheId);
  }, [demandaDetalheId, db, tick]);

  // ─── Ações ───
  const [actionLoading, setActionLoading] = useState(false);
  const [observacao, setObservacao] = useState("");
  const [motivoCancelamento, setMotivoCancelamento] = useState("");

  const handleAssumir = useCallback(async () => {
    if (!demandaDetalhe) return;
    setActionLoading(true);
    try {
      assumirDemanda(db, demandaDetalhe.id, user);
      addToast?.({ type: "success", message: "Demanda assumida — agora em execução." });
      refresh();
      reloadData?.();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao assumir." });
    } finally {
      setActionLoading(false);
    }
  }, [demandaDetalhe, db, user, addToast, refresh, reloadData]);

  const handleConcluir = useCallback(async () => {
    if (!demandaDetalhe) return;
    setActionLoading(true);
    try {
      const atualizada = concluirDemanda(db, demandaDetalhe.id, user, observacao.trim());
      addToast?.({ type: "success", message: `Demanda concluída — ${demandaDetalhe.escola_nome}` });
      // Notifica a Vanda por email (fire-and-forget) com data/hora de conclusão.
      if (user?.companyId) {
        notifyEscolaEvent(user.companyId, "concluida", atualizada).catch((err) => {
          console.warn("notifyEscolaEvent(concluida) falhou:", err?.message);
        });
      }
      setObservacao("");
      refresh();
      reloadData?.();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao concluir." });
    } finally {
      setActionLoading(false);
    }
  }, [demandaDetalhe, db, user, observacao, addToast, refresh, reloadData]);

  const handleCancelar = useCallback(async () => {
    if (!demandaDetalhe) return;
    if (!motivoCancelamento.trim()) {
      addToast?.({ type: "error", message: "Informe um motivo para o cancelamento." });
      return;
    }
    setActionLoading(true);
    try {
      const atualizada = cancelarDemanda(db, demandaDetalhe.id, user, motivoCancelamento.trim());
      addToast?.({ type: "info", message: "Demanda cancelada." });
      // Notifica a Vanda com o motivo do cancelamento.
      if (user?.companyId) {
        notifyEscolaEvent(user.companyId, "cancelada", atualizada).catch((err) => {
          console.warn("notifyEscolaEvent(cancelada) falhou:", err?.message);
        });
      }
      setMotivoCancelamento("");
      refresh();
      reloadData?.();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao cancelar." });
    } finally {
      setActionLoading(false);
    }
  }, [demandaDetalhe, db, user, motivoCancelamento, addToast, refresh, reloadData]);

  // Limpa estados auxiliares ao trocar de demanda selecionada.
  useEffect(() => {
    setObservacao("");
    setMotivoCancelamento("");
  }, [demandaDetalheId]);

  // ─── Render ───
  if (!canManage) {
    return (
      <div className="rounded-2xl border border-yellow-500/40 bg-yellow-500/10 p-6 text-yellow-100">
        Acesso restrito.
      </div>
    );
  }

  // Eu (responsável atual) — usado para decidir ações disponíveis no modal.
  const ehResponsavel = demandaDetalhe?.responsavel_id === user?.id;
  const ehAdmin = user?.role === "admin" || user?.role === "gerente";

  return (
    <div className="space-y-6">
      <header className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-white">Escola — Demandas (Vanda)</h1>
          <p className="text-sm text-gray-400 mt-1">
            Módulo isolado das OS comuns e do financeiro. Apenas gestão das demandas
            enviadas pela cliente Vanda.
          </p>
        </div>
      </header>

      {/* KPIs */}
      {metricasGlobais && (
        <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <KpiCard label="Total" value={metricasGlobais.total} accent="from-gray-500/20 to-gray-500/5" />
          <KpiCard label="Aguardando" value={metricasGlobais.aguardando} accent="from-yellow-500/20 to-yellow-500/5" />
          <KpiCard label="Em execução" value={metricasGlobais.em_execucao} accent="from-blue-500/20 to-blue-500/5" />
          <KpiCard label="Concluídas" value={metricasGlobais.concluidas} accent="from-green-500/20 to-green-500/5" />
        </section>
      )}

      {/* Filtros */}
      <section className="rounded-2xl border border-gray-700 bg-gray-800/40 backdrop-blur p-3 sm:p-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[180px]">
          <label htmlFor="filtro-busca" className="block text-[11px] font-semibold text-gray-400 mb-1">Buscar escola</label>
          <input
            id="filtro-busca"
            type="search"
            value={buscaEscola}
            onChange={(e) => setBuscaEscola(e.target.value)}
            className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            placeholder="Ex: Vila Nova"
          />
        </div>
        <div>
          <label htmlFor="filtro-status" className="block text-[11px] font-semibold text-gray-400 mb-1">Status</label>
          <select
            id="filtro-status"
            value={filtroStatus}
            onChange={(e) => setFiltroStatus(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Todos</option>
            {STATUS_ESCOLA.map((s) => (
              <option key={s} value={s}>{STATUS_LABEL[s]?.label || s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="filtro-urgencia" className="block text-[11px] font-semibold text-gray-400 mb-1">Urgência</label>
          <select
            id="filtro-urgencia"
            value={filtroUrgencia}
            onChange={(e) => setFiltroUrgencia(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="">Todas</option>
            {URGENCIA_OPCOES.map((u) => (
              <option key={u} value={u}>{URGENCIA[u].label}</option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={() => { setFiltroStatus(""); setFiltroUrgencia(""); setBuscaEscola(""); }}
          className="text-xs text-gray-400 hover:text-white px-2 py-1"
        >
          Limpar
        </button>
      </section>

      {/* Lista */}
      {demandas.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-800/30 p-10 text-center">
          <p className="text-gray-400">Nenhuma demanda encontrada com esses filtros.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/70 text-gray-300">
              <tr>
                <th className="text-left px-3 py-2 font-semibold">Escola</th>
                <th className="text-left px-3 py-2 font-semibold">Urgência</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Responsável</th>
                <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Solicitado em</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {demandas.map((d) => (
                <tr
                  key={d.id}
                  className="border-t border-gray-700 hover:bg-gray-800/40 cursor-pointer"
                  onClick={() => setDemandaDetalheId(d.id)}
                >
                  <td className="px-3 py-2">
                    <div className="font-semibold text-white truncate max-w-[280px]">{d.escola_nome}</div>
                    <div className="text-xs text-gray-400 truncate max-w-[280px]">{d.descricao}</div>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${URGENCIA[d.urgencia]?.color || "bg-gray-500"}`}>
                      {URGENCIA[d.urgencia]?.label || d.urgencia}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${STATUS_LABEL[d.status]?.color || "bg-gray-500"}`}>
                      {STATUS_LABEL[d.status]?.label || d.status}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-gray-300 hidden md:table-cell">{d.responsavel_nome || "—"}</td>
                  <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">{formatDate(d.data_solicitacao)}</td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setDemandaDetalheId(d.id); }}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      Detalhes →
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Modal detalhe */}
      {demandaDetalhe && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          onClick={(e) => { if (e.target === e.currentTarget) setDemandaDetalheId(null); }}
        >
          <div className="w-full sm:max-w-2xl bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-700 flex items-start justify-between sticky top-0 bg-gray-900 z-10">
              <div>
                <h3 className="text-base font-bold text-white">{demandaDetalhe.escola_nome}</h3>
                <p className="text-xs text-gray-400 mt-0.5">
                  Solicitado por <strong>{demandaDetalhe.solicitante_nome || "Vanda"}</strong> em {formatDate(demandaDetalhe.data_solicitacao)}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDemandaDetalheId(null)}
                className="text-gray-400 hover:text-white"
                aria-label="Fechar"
              >✕</button>
            </div>

            <div className="p-5 space-y-5">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${STATUS_LABEL[demandaDetalhe.status]?.color || "bg-gray-500"}`}>
                  {STATUS_LABEL[demandaDetalhe.status]?.label || demandaDetalhe.status}
                </span>
                <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${URGENCIA[demandaDetalhe.urgencia]?.color || "bg-gray-500"}`}>
                  Urgência: {URGENCIA[demandaDetalhe.urgencia]?.label || demandaDetalhe.urgencia}
                </span>
                {demandaDetalhe.responsavel_nome && (
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-gray-700 text-gray-200">
                    Resp.: {demandaDetalhe.responsavel_nome}
                  </span>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Descrição</h4>
                <p className="text-sm text-gray-200 whitespace-pre-line">{demandaDetalhe.descricao}</p>
              </div>

              {demandaDetalhe.observacao_conclusao && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Observação de conclusão</h4>
                  <p className="text-sm text-gray-200 whitespace-pre-line">{demandaDetalhe.observacao_conclusao}</p>
                </div>
              )}

              {demandaDetalhe.motivo_cancelamento && (
                <div>
                  <h4 className="text-xs font-semibold text-red-300 uppercase tracking-wide mb-1">Motivo do cancelamento</h4>
                  <p className="text-sm text-gray-200 whitespace-pre-line">{demandaDetalhe.motivo_cancelamento}</p>
                </div>
              )}

              {/* Timeline */}
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Linha do tempo</h4>
                <ol className="space-y-1.5">
                  {timeline.map((e) => (
                    <li key={e.id} className="text-xs text-gray-300 flex items-start gap-2">
                      <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-400 mt-1.5 shrink-0" aria-hidden="true" />
                      <span className="flex-1">
                        <strong className="text-gray-100">{labelEvento(e.evento)}</strong>
                        {e.payload?.ator_nome && <> por <em className="not-italic text-gray-200">{e.payload.ator_nome}</em></>}
                        {" — "}
                        <span className="text-gray-400">{formatDate(e.created_at)}</span>
                        {e.payload?.obs && (
                          <div className="mt-0.5 text-gray-400">"{e.payload.obs}"</div>
                        )}
                      </span>
                    </li>
                  ))}
                </ol>
              </div>

              {/* Ações */}
              <div className="border-t border-gray-800 pt-4 space-y-3">
                {/* Assumir */}
                {demandaDetalhe.status === "aguardando" && (
                  <button
                    type="button"
                    onClick={handleAssumir}
                    disabled={actionLoading}
                    className="w-full px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
                  >
                    {actionLoading ? "Processando…" : "Assumir demanda"}
                  </button>
                )}

                {/* Concluir (apenas responsável ou admin) */}
                {demandaDetalhe.status === "em_execucao" && (ehResponsavel || ehAdmin) && (
                  <div className="space-y-2">
                    <label htmlFor="obs-conclusao" className="block text-xs font-semibold text-gray-300">
                      Observação de conclusão (opcional)
                    </label>
                    <textarea
                      id="obs-conclusao"
                      rows={2}
                      value={observacao}
                      onChange={(e) => setObservacao(e.target.value)}
                      className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-green-500 resize-none"
                      placeholder="Ex: Filtro trocado, sistema testado e funcionando."
                    />
                    <button
                      type="button"
                      onClick={handleConcluir}
                      disabled={actionLoading}
                      className="w-full px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-50"
                    >
                      {actionLoading ? "Processando…" : "Marcar como concluído"}
                    </button>
                  </div>
                )}

                {/* Cancelar (apenas admin/gerente) */}
                {ehAdmin && (demandaDetalhe.status === "aguardando" || demandaDetalhe.status === "em_execucao") && (
                  <details className="rounded-lg border border-gray-700 bg-gray-800/40">
                    <summary className="cursor-pointer px-3 py-2 text-xs text-gray-400 hover:text-white">
                      Cancelar demanda
                    </summary>
                    <div className="p-3 space-y-2">
                      <label htmlFor="motivo-cancel" className="block text-xs font-semibold text-gray-300">
                        Motivo do cancelamento <span className="text-red-400">*</span>
                      </label>
                      <textarea
                        id="motivo-cancel"
                        rows={2}
                        value={motivoCancelamento}
                        onChange={(e) => setMotivoCancelamento(e.target.value)}
                        className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-red-500 resize-none"
                      />
                      <button
                        type="button"
                        onClick={handleCancelar}
                        disabled={actionLoading || !motivoCancelamento.trim()}
                        className="w-full px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Confirmar cancelamento
                      </button>
                    </div>
                  </details>
                )}

                {/* Estado terminal */}
                {demandaDetalhe.status === "concluido" && (
                  <div className="rounded-lg border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-200">
                    Demanda concluída em {formatDate(demandaDetalhe.concluido_em)}.
                  </div>
                )}
                {demandaDetalhe.status === "cancelado" && (
                  <div className="rounded-lg border border-gray-500/30 bg-gray-500/10 px-3 py-2 text-sm text-gray-300">
                    Demanda cancelada.
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Componentes auxiliares ──────────────────────────────────────────────────

function KpiCard({ label, value, accent }) {
  return (
    <div className={`rounded-2xl border border-gray-700 bg-gradient-to-br ${accent} p-4`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-2xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}

// Mapeia o "evento" salvo em erp:evento_escola para um rótulo amigável.
function labelEvento(evento) {
  switch (evento) {
    case "criada": return "Demanda criada";
    case "em_execucao": return "Demanda assumida";
    case "concluido": return "Demanda concluída";
    case "cancelado": return "Demanda cancelada";
    case "aguardando": return "Demanda reaberta";
    default: return evento;
  }
}
