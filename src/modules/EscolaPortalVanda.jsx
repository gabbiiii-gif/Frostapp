// ─── Portal Externo da Vanda ─────────────────────────────────────────────────
// Shell completamente isolado do ERP. Apenas a role `cliente_escola` chega aqui
// (via render branch em App.jsx). Não há sidebar, não há acesso a outros módulos.
//
// Funcionalidades:
//   - Criar nova solicitação (escola, descrição, urgência) — data_solicitacao
//     é gravada automaticamente como timestamp atual (conforme spec).
//   - Listar e acompanhar status das próprias solicitações.
//   - Filtro rápido por status.
//
// Persistência: erp:escola:<uuid> no kv_store via DB.set (passado por props).
// Recebe `db` para manter este componente desacoplado de App.jsx (testável).

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  criarDemanda,
  listarDemandasUsuario,
  URGENCIA,
  URGENCIA_OPCOES,
} from "../lib/escola.js";
import { formatDate } from "../utils.js";
// notifyEscolaEvent: fire-and-forget. Falhas de email NÃO travam a criação
// da demanda no client — kv_store já gravou e sync ao Supabase já rodou.
import { notifyEscolaEvent } from "../supabase.js";

// Labels exibidos para o usuário externo. Mantemos PT-BR (regra do projeto).
const STATUS_LABEL = {
  aguardando: { label: "Aguardando atendimento", color: "bg-yellow-500" },
  em_execucao: { label: "Em execução", color: "bg-blue-500" },
  concluido: { label: "Concluído", color: "bg-green-500" },
  cancelado: { label: "Cancelado", color: "bg-gray-500" },
};

export default function EscolaPortalVanda({ user, onLogout, addToast, db }) {
  const nomeExibicao = useMemo(() => user?.nome || user?.email || "Vanda", [user]);

  // ─── Estado da listagem ───
  const [demandas, setDemandas] = useState([]);
  const [filtroStatus, setFiltroStatus] = useState("todos");
  const [refreshTick, setRefreshTick] = useState(0);

  // Recarrega lista quando user muda, formulário envia, ou Realtime dispara.
  useEffect(() => {
    if (!user?.id || !db) return;
    setDemandas(listarDemandasUsuario(db, user.id));
  }, [user, db, refreshTick]);

  const demandasFiltradas = useMemo(() => {
    if (filtroStatus === "todos") return demandas;
    return demandas.filter((d) => d.status === filtroStatus);
  }, [demandas, filtroStatus]);

  // ─── Modal de criação ───
  const [showForm, setShowForm] = useState(false);
  const [formEscola, setFormEscola] = useState("");
  const [formDescricao, setFormDescricao] = useState("");
  const [formUrgencia, setFormUrgencia] = useState("medio");
  const [enviando, setEnviando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  const resetForm = useCallback(() => {
    setFormEscola("");
    setFormDescricao("");
    setFormUrgencia("medio");
    setErroForm("");
  }, []);

  const handleAbrirForm = useCallback(() => {
    resetForm();
    setShowForm(true);
  }, [resetForm]);

  const handleEnviar = useCallback(async (e) => {
    e?.preventDefault();
    setErroForm("");
    if (!formEscola.trim()) { setErroForm("Informe o nome da escola."); return; }
    if (!formDescricao.trim()) { setErroForm("Descreva o que precisa ser feito."); return; }
    setEnviando(true);
    try {
      const nova = criarDemanda(db, {
        escola_nome: formEscola,
        descricao: formDescricao,
        urgencia: formUrgencia,
        solicitante_id: user.id,
        solicitante_nome: user.nome || user.email || "Vanda",
      });
      addToast?.({
        type: "success",
        message: `Solicitação recebida — ${nova.escola_nome}`,
      });
      // Dispara emails (equipe interna + confirmação para a Vanda). Não bloqueia
      // a UI: erros ficam apenas no console — kv_store já persistiu a demanda.
      if (user.companyId) {
        notifyEscolaEvent(user.companyId, "criada", nova).catch((err) => {
          console.warn("notifyEscolaEvent(criada) falhou:", err?.message);
        });
      }
      setShowForm(false);
      resetForm();
      setRefreshTick((t) => t + 1);
    } catch (err) {
      setErroForm(err?.message || "Erro ao enviar solicitação.");
    } finally {
      setEnviando(false);
    }
  }, [db, user, formEscola, formDescricao, formUrgencia, addToast, resetForm]);

  // ─── Render ───
  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-gray-900 to-blue-950 text-gray-100 font-['DM_Sans']">
      <header className="border-b border-gray-700 bg-gray-900/70 backdrop-blur sticky top-0 z-10">
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/frosterp-snowflake.svg" alt="" className="h-8 w-8" onError={(e) => { e.target.style.display = "none"; }} />
            <div>
              <h1 className="text-lg font-bold text-white leading-tight">Portal Escolas</h1>
              <p className="text-xs text-gray-400">Olá, {nomeExibicao}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onLogout}
            className="text-xs px-3 py-1.5 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white transition"
          >
            Sair
          </button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6 sm:py-8 space-y-6">
        {/* Bloco CTA — nova solicitação */}
        <section className="rounded-2xl border border-blue-500/30 bg-gradient-to-br from-blue-500/10 to-blue-600/5 backdrop-blur p-5 sm:p-6 flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-bold text-white">Nova solicitação</h2>
            <p className="text-sm text-gray-300 mt-1">
              Envie uma nova demanda para nossa equipe atender.
            </p>
          </div>
          <button
            type="button"
            onClick={handleAbrirForm}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-900/40 transition"
          >
            + Nova Solicitação
          </button>
        </section>

        {/* Lista de solicitações */}
        <section>
          <div className="flex items-center justify-between gap-3 flex-wrap mb-4">
            <h2 className="text-base font-semibold text-white">
              Minhas solicitações <span className="text-gray-400 font-normal">({demandasFiltradas.length})</span>
            </h2>
            <select
              value={filtroStatus}
              onChange={(e) => setFiltroStatus(e.target.value)}
              className="text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-1.5 text-gray-200 focus:outline-none focus:border-blue-500"
              aria-label="Filtrar por status"
            >
              <option value="todos">Todos os status</option>
              <option value="aguardando">Aguardando</option>
              <option value="em_execucao">Em execução</option>
              <option value="concluido">Concluído</option>
              <option value="cancelado">Cancelado</option>
            </select>
          </div>

          {demandasFiltradas.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-800/30 p-10 text-center">
              <p className="text-gray-400">Nenhuma solicitação por aqui ainda.</p>
            </div>
          ) : (
            <ul className="space-y-3">
              {demandasFiltradas.map((d) => (
                <li
                  key={d.id}
                  className="rounded-xl border border-gray-700 bg-gray-800/50 backdrop-blur p-4 hover:border-gray-500 transition"
                >
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-white font-semibold truncate">{d.escola_nome}</h3>
                      <p className="text-sm text-gray-300 mt-1 line-clamp-3 whitespace-pre-line">{d.descricao}</p>
                    </div>
                    <div className="flex flex-col items-end gap-1.5 shrink-0">
                      <span className={`inline-flex items-center text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${STATUS_LABEL[d.status]?.color || "bg-gray-500"}`}>
                        {STATUS_LABEL[d.status]?.label || d.status}
                      </span>
                      <span className={`inline-flex items-center text-[10px] font-semibold px-2 py-0.5 rounded-full text-white ${URGENCIA[d.urgencia]?.color || "bg-gray-500"}`}>
                        {URGENCIA[d.urgencia]?.label || d.urgencia}
                      </span>
                    </div>
                  </div>
                  <div className="mt-3 flex items-center gap-4 text-[11px] text-gray-400 flex-wrap">
                    <span>Solicitado em <strong className="text-gray-300">{formatDate(d.data_solicitacao)}</strong></span>
                    {d.responsavel_nome && <span>Responsável: <strong className="text-gray-300">{d.responsavel_nome}</strong></span>}
                    {d.concluido_em && <span>Concluído em <strong className="text-gray-300">{formatDate(d.concluido_em)}</strong></span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>

      {/* Modal — Nova solicitação */}
      {showForm && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dlg-nova-demanda-titulo"
          onClick={(e) => { if (e.target === e.currentTarget) setShowForm(false); }}
        >
          <div className="w-full sm:max-w-lg bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
            <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900">
              <h3 id="dlg-nova-demanda-titulo" className="text-base font-bold text-white">Nova solicitação</h3>
              <button
                type="button"
                onClick={() => setShowForm(false)}
                className="text-gray-400 hover:text-white"
                aria-label="Fechar"
              >✕</button>
            </div>

            <form onSubmit={handleEnviar} className="p-5 space-y-4">
              <div>
                <label htmlFor="dem-escola" className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Nome da escola <span className="text-red-400">*</span>
                </label>
                <input
                  id="dem-escola"
                  type="text"
                  required
                  value={formEscola}
                  onChange={(e) => setFormEscola(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
                  placeholder="Ex: EMEF Vila Nova"
                  autoFocus
                />
              </div>

              <div>
                <label htmlFor="dem-desc" className="block text-xs font-semibold text-gray-300 mb-1.5">
                  O que precisa ser feito <span className="text-red-400">*</span>
                </label>
                <textarea
                  id="dem-desc"
                  required
                  rows={5}
                  value={formDescricao}
                  onChange={(e) => setFormDescricao(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500 resize-none"
                  placeholder="Descreva o serviço necessário com o máximo de detalhes."
                />
              </div>

              <fieldset>
                <legend className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Nível de urgência <span className="text-red-400">*</span>
                </legend>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {URGENCIA_OPCOES.map((u) => (
                    <label
                      key={u}
                      className={`flex items-center justify-center text-xs font-semibold py-2 rounded-lg cursor-pointer border transition ${
                        formUrgencia === u
                          ? "border-blue-500 bg-blue-500/15 text-white"
                          : "border-gray-700 bg-gray-800 text-gray-300 hover:border-gray-500"
                      }`}
                    >
                      <input
                        type="radio"
                        name="urgencia"
                        value={u}
                        checked={formUrgencia === u}
                        onChange={(e) => setFormUrgencia(e.target.value)}
                        className="sr-only"
                      />
                      <span className={`inline-block w-2 h-2 rounded-full mr-2 ${URGENCIA[u].color}`} aria-hidden="true" />
                      {URGENCIA[u].label}
                    </label>
                  ))}
                </div>
              </fieldset>

              <div className="text-[11px] text-gray-500">
                Data de solicitação será registrada automaticamente no envio.
              </div>

              {erroForm && (
                <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
                  {erroForm}
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-800">
                <button
                  type="button"
                  onClick={() => setShowForm(false)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-300 hover:text-white"
                  disabled={enviando}
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={enviando}
                  className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {enviando ? "Enviando…" : "Enviar"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
