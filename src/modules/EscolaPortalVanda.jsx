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
  validarOficio,
} from "../lib/escola.js";
import {
  montarRelatorio,
  gerarHtmlRelatorio,
  gerarCsvRelatorio,
  periodoSemana,
  periodoMesCorrente,
} from "../lib/escola-relatorio.js";
import { formatDate } from "../utils.js";
// notifyEscolaEvent: fire-and-forget. Falhas de email NÃO travam a criação
// da demanda no client — kv_store já gravou e sync ao Supabase já rodou.
// uploadEscolaOficio: sobe os anexos opcionais ao bucket escola-oficios.
import { notifyEscolaEvent, uploadEscolaOficio } from "../supabase.js";

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
  const [showRelatorio, setShowRelatorio] = useState(false);

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

  // Ofícios anexados (opcional, múltiplos). Cada item: { file, previewUrl|null, key }.
  const [oficios, setOficios] = useState([]);

  // Revoga object URLs de imagem ao desmontar (evita memory leak).
  useEffect(() => {
    return () => { oficios.forEach((o) => o.previewUrl && URL.revokeObjectURL(o.previewUrl)); };
  }, [oficios]);

  const handleSelecionarOficios = useCallback((e) => {
    const novos = [];
    for (const file of Array.from(e.target.files || [])) {
      const v = validarOficio(file);
      if (!v.ok) { setErroForm(`"${file.name}": ${v.motivo}`); continue; }
      novos.push({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        key: `${file.name}_${file.size}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });
    }
    if (novos.length) setOficios((prev) => [...prev, ...novos]);
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
  }, []);

  const handleRemoverOficio = useCallback((key) => {
    setOficios((prev) => {
      const alvo = prev.find((o) => o.key === key);
      if (alvo?.previewUrl) URL.revokeObjectURL(alvo.previewUrl);
      return prev.filter((o) => o.key !== key);
    });
  }, []);

  const resetForm = useCallback(() => {
    setFormEscola("");
    setFormDescricao("");
    setFormUrgencia("medio");
    setErroForm("");
    setOficios((prev) => {
      prev.forEach((o) => o.previewUrl && URL.revokeObjectURL(o.previewUrl));
      return [];
    });
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
      // Upload dos ofícios (opcional). A demanda já está gravada no kv_store;
      // anexos que falharem (offline/erro) apenas não entram — não travam o fluxo.
      if (oficios.length) {
        const subidos = [];
        for (const o of oficios) {
          const url = await uploadEscolaOficio(o.file, nova.id);
          if (url) subidos.push({ url, nome: o.file.name, tipo: o.file.type, tamanho: o.file.size });
        }
        if (subidos.length) {
          const atual = db.get(nova.id) || nova;
          db.set(nova.id, { ...atual, oficios: subidos, updated_at: new Date().toISOString() });
        }
        if (subidos.length < oficios.length) {
          addToast?.({ type: "info", message: "Alguns anexos não puderam ser enviados." });
        }
      }
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
  }, [db, user, formEscola, formDescricao, formUrgencia, oficios, addToast, resetForm]);

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
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowRelatorio(true)}
              className="px-4 py-2.5 rounded-xl border border-gray-600 hover:border-gray-400 text-gray-200 hover:text-white font-semibold transition"
            >
              📊 Relatórios
            </button>
            <button
              type="button"
              onClick={handleAbrirForm}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-900/40 transition"
            >
              + Nova Solicitação
            </button>
          </div>
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
                    {Array.isArray(d.oficios) && d.oficios.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        📎 {d.oficios.length} anexo{d.oficios.length > 1 ? "s" : ""}
                        {d.oficios.map((of, i) => (
                          <a
                            key={i}
                            href={of.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-blue-300 hover:text-blue-200"
                          >
                            {i + 1}
                          </a>
                        ))}
                      </span>
                    )}
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

              <div>
                <label htmlFor="dem-oficios" className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Ofício (PDF ou imagem) — opcional
                </label>
                <input
                  id="dem-oficios"
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  onChange={handleSelecionarOficios}
                  className="block w-full text-sm text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-semibold hover:file:bg-blue-500 cursor-pointer"
                />
                {oficios.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {oficios.map((o) => (
                      <li key={o.key} className="relative rounded-lg border border-gray-700 bg-gray-800/60 p-2 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => handleRemoverOficio(o.key)}
                          aria-label={`Remover ${o.file.name}`}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs leading-none flex items-center justify-center shadow"
                        >✕</button>
                        {o.previewUrl ? (
                          <img src={o.previewUrl} alt={o.file.name} className="w-full h-20 object-cover rounded" />
                        ) : (
                          <div className="w-full h-20 rounded bg-gray-900/70 flex items-center justify-center text-2xl" aria-hidden="true">📄</div>
                        )}
                        <span className="text-[10px] text-gray-300 truncate" title={o.file.name}>{o.file.name}</span>
                        <span className="text-[10px] text-gray-500">{(o.file.size / 1024).toFixed(0)} KB</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

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

      {showRelatorio && (
        <RelatorioPortalModal
          demandas={demandas}
          empresaNome={user?.companyName || "FrostERP"}
          onClose={() => setShowRelatorio(false)}
          addToast={addToast}
        />
      )}
    </div>
  );
}

// ─── Modal de Relatórios do portal (reusa o lib escola-relatorio.js) ─────────
// Mesma lógica do painel interno, mas no tema escuro do portal. Opera só sobre
// as demandas da própria Vanda (já filtradas por solicitante no componente pai).
function RelatorioPortalModal({ demandas, empresaNome, onClose, addToast }) {
  const semana = periodoSemana();
  const [preset, setPreset] = useState("mes");
  const [ini, setIni] = useState(periodoMesCorrente().ini);
  const [fim, setFim] = useState(periodoMesCorrente().fim);
  const [escolaFiltro, setEscolaFiltro] = useState("");

  const handlePreset = useCallback((p) => {
    setPreset(p);
    if (p === "semana") { setIni(semana.ini); setFim(semana.fim); }
    if (p === "mes") { const m = periodoMesCorrente(); setIni(m.ini); setFim(m.fim); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relatorio = useMemo(
    () => montarRelatorio(demandas, ini, fim, escolaFiltro),
    [demandas, ini, fim, escolaFiltro]
  );

  const handlePDF = useCallback(() => {
    try {
      const html = gerarHtmlRelatorio(relatorio, empresaNome);
      const w = window.open("", "_blank", "width=900,height=900");
      if (!w) { addToast?.({ type: "error", message: "Pop-up bloqueado. Permita pop-ups e tente de novo." }); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao gerar PDF." });
    }
  }, [relatorio, empresaNome, addToast]);

  const handleCSV = useCallback(() => {
    try {
      const csv = gerarCsvRelatorio(relatorio);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `escola_${ini}_a_${fim}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast?.({ type: "success", message: "CSV exportado." });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao exportar CSV." });
    }
  }, [relatorio, ini, fim, addToast]);

  const { metricas } = relatorio;
  const taxa = (metricas.taxa_conclusao * 100).toFixed(1);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dlg-rel-titulo"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-xl bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900">
          <h3 id="dlg-rel-titulo" className="text-base font-bold text-white">Relatórios — Minhas solicitações</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-1 rounded-lg border border-gray-700 bg-gray-800/40 p-1">
            {[
              { id: "semana", label: "Semana" },
              { id: "mes", label: "Mês corrente" },
              { id: "custom", label: "Personalizado" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePreset(p.id)}
                className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded ${preset === p.id ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="prel-ini" className="block text-xs font-semibold text-gray-300 mb-1">Início</label>
              <input
                id="prel-ini"
                type="date"
                value={ini}
                onChange={(e) => { setIni(e.target.value); setPreset("custom"); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label htmlFor="prel-fim" className="block text-xs font-semibold text-gray-300 mb-1">Fim</label>
              <input
                id="prel-fim"
                type="date"
                value={fim}
                onChange={(e) => { setFim(e.target.value); setPreset("custom"); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="prel-escola" className="block text-xs font-semibold text-gray-300 mb-1">Filtrar escola (opcional)</label>
            <input
              id="prel-escola"
              type="search"
              value={escolaFiltro}
              onChange={(e) => setEscolaFiltro(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              placeholder="Ex: Vila Nova"
            />
          </div>

          <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-4">
            <h4 className="text-xs font-semibold text-gray-300 mb-3">Preview do período</h4>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Total</div><div className="text-lg font-bold text-white">{metricas.total}</div></div>
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Concluídas</div><div className="text-lg font-bold text-white">{metricas.concluidas}</div></div>
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Em exec.</div><div className="text-lg font-bold text-white">{metricas.em_execucao}</div></div>
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Aguard.</div><div className="text-lg font-bold text-white">{metricas.aguardando}</div></div>
            </div>
            <div className="mt-3 text-[11px] text-gray-400">
              Taxa de conclusão: <strong className="text-white">{taxa}%</strong>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-800">
            <button
              type="button"
              onClick={handleCSV}
              className="px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-sm"
            >
              ⬇ CSV
            </button>
            <button
              type="button"
              onClick={handlePDF}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
            >
              ⬇ PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
