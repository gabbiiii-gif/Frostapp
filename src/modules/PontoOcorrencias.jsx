// ─── Ocorrências do ponto — Fase E ───────────────────────────────────────────
// Duas visões num mesmo componente, alternadas pela prop isAdminView:
//
//   Funcionário (isAdminView=false):
//     - Lista as próprias ocorrências (mais recentes primeiro)
//     - Botão "+ Nova ocorrência" → modal de envio
//     - Upload de documento via supabase.storage (bucket ponto-docs)
//     - Vê status (pendente/aprovado/rejeitado) + observação do admin
//
//   Admin/gerente (isAdminView=true):
//     - Lista todas as ocorrências da empresa (filtros: status, tipo, func)
//     - Tab "Pendentes" destacada com badge
//     - Modal detalhe → preview do anexo (link signed url) +
//       botões Aprovar / Rejeitar / Reabrir com campo de observação
//
// Persistência: erp:ocorrencia:* via DB (auto-sincroniza com Supabase
// kv_store por SCOPED_PREFIXES, já configurado em App.jsx).
// Anexos: bucket ponto-docs (RLS por company — ver migration 2026_06_02).

import { useState, useMemo, useEffect, useCallback } from "react";
import {
  TIPOS_OCORRENCIA,
  STATUS_OCORRENCIA,
  criarOcorrencia,
  decidirOcorrencia,
  reabrirOcorrencia,
  listarPorFuncionario,
  listarTodas,
} from "../lib/ocorrencias.js";
import { uploadOcorrenciaDoc, getOcorrenciaDocUrl } from "../supabase.js";
import { formatDate, toISODate } from "../utils.js";

// Labels e cores para badges.
const STATUS_INFO = {
  pendente:  { label: "Pendente",  color: "bg-yellow-500" },
  aprovado:  { label: "Aprovado",  color: "bg-green-500" },
  rejeitado: { label: "Rejeitado", color: "bg-red-500" },
};

export default function PontoOcorrencias({ user, addToast, db, employees, isAdminView }) {
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((t) => t + 1), []);

  // Filtros (apenas admin)
  const [filtroStatus, setFiltroStatus] = useState(isAdminView ? "pendente" : "");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroFunc, setFiltroFunc] = useState("");

  const lista = useMemo(() => {
    if (!db) return [];
    if (isAdminView) {
      return listarTodas(db, {
        status: filtroStatus || undefined,
        tipo: filtroTipo || undefined,
        funcionarioId: filtroFunc || undefined,
      });
    }
    return listarPorFuncionario(db, user?.id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, isAdminView, user, filtroStatus, filtroTipo, filtroFunc, tick]);

  // ─── Modais ───
  const [showNova, setShowNova] = useState(false);
  const [detalheId, setDetalheId] = useState(null);
  const detalhe = useMemo(() => (detalheId && db ? db.get(detalheId) : null), [detalheId, db, tick]);

  // Map func id → nome (para tabela admin)
  const empById = useMemo(() => {
    const m = new Map();
    (employees || []).forEach((e) => m.set(e.id, e));
    if (db) db.list("erp:user:").forEach((u) => { if (u && !m.has(u.id)) m.set(u.id, u); });
    return m;
  }, [employees, db, tick]);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">
            {isAdminView ? "Ocorrências da equipe" : "Minhas ocorrências"}
          </h2>
          <p className="text-xs text-gray-400 mt-0.5">
            {isAdminView
              ? "Atestados, faltas justificadas e outras justificativas. Atestados aprovados zeram o débito do dia."
              : "Envie justificativas e acompanhe a aprovação."}
          </p>
        </div>
        {!isAdminView && (
          <button
            type="button"
            onClick={() => setShowNova(true)}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
          >
            + Nova ocorrência
          </button>
        )}
      </header>

      {/* Filtros admin */}
      {isAdminView && (
        <section className="rounded-2xl border border-gray-700 bg-gray-800/40 backdrop-blur p-3 sm:p-4 flex flex-wrap gap-3 items-end">
          <div>
            <label htmlFor="oc-fs" className="block text-[11px] font-semibold text-gray-400 mb-1">Status</label>
            <select id="oc-fs" value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
              <option value="">Todos</option>
              {STATUS_OCORRENCIA.map((s) => <option key={s} value={s}>{STATUS_INFO[s]?.label || s}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="oc-ft" className="block text-[11px] font-semibold text-gray-400 mb-1">Tipo</label>
            <select id="oc-ft" value={filtroTipo} onChange={(e) => setFiltroTipo(e.target.value)} className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
              <option value="">Todos</option>
              {Object.entries(TIPOS_OCORRENCIA).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}
            </select>
          </div>
          <div className="flex-1 min-w-[160px]">
            <label htmlFor="oc-ff" className="block text-[11px] font-semibold text-gray-400 mb-1">Funcionário</label>
            <select id="oc-ff" value={filtroFunc} onChange={(e) => setFiltroFunc(e.target.value)} className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white">
              <option value="">Todos</option>
              {(employees || []).map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <button
            type="button"
            onClick={() => { setFiltroStatus(""); setFiltroTipo(""); setFiltroFunc(""); }}
            className="text-xs text-gray-400 hover:text-white px-2 py-1"
          >
            Limpar
          </button>
        </section>
      )}

      {/* Lista */}
      {lista.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-gray-700 bg-gray-800/30 p-10 text-center text-sm text-gray-400">
          Nenhuma ocorrência {isAdminView ? "com esses filtros" : "registrada ainda"}.
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-gray-700">
          <table className="w-full text-sm">
            <thead className="bg-gray-800/70 text-gray-300">
              <tr>
                {isAdminView && <th className="text-left px-3 py-2 font-semibold">Funcionário</th>}
                <th className="text-left px-3 py-2 font-semibold">Tipo</th>
                <th className="text-left px-3 py-2 font-semibold">Dia</th>
                <th className="text-left px-3 py-2 font-semibold hidden md:table-cell">Anexo</th>
                <th className="text-left px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => {
                const tipoMeta = TIPOS_OCORRENCIA[o.tipo];
                const statusMeta = STATUS_INFO[o.status];
                const emp = empById.get(o.funcionario_id);
                return (
                  <tr key={o.id} className="border-t border-gray-700 hover:bg-gray-800/40 cursor-pointer" onClick={() => setDetalheId(o.id)}>
                    {isAdminView && (
                      <td className="px-3 py-2 text-white truncate max-w-[200px]">{emp?.nome || o.funcionario_nome || o.funcionario_id}</td>
                    )}
                    <td className="px-3 py-2 text-gray-200">{tipoMeta?.label || o.tipo}</td>
                    <td className="px-3 py-2 text-gray-300">{formatDate(o.data_ref)}</td>
                    <td className="px-3 py-2 text-gray-400 hidden md:table-cell">
                      {o.documento_nome ? <span title={o.documento_nome}>📎</span> : "—"}
                    </td>
                    <td className="px-3 py-2">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${statusMeta?.color || "bg-gray-500"}`}>
                        {statusMeta?.label || o.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right">
                      <button type="button" onClick={(e) => { e.stopPropagation(); setDetalheId(o.id); }} className="text-xs text-blue-400 hover:text-blue-300">
                        Detalhes →
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Modais */}
      {showNova && (
        <NovaOcorrenciaModal
          user={user}
          db={db}
          addToast={addToast}
          onClose={() => setShowNova(false)}
          onSalvo={() => { setShowNova(false); refresh(); }}
        />
      )}
      {detalhe && (
        <DetalheOcorrenciaModal
          ocorrencia={detalhe}
          user={user}
          db={db}
          isAdminView={isAdminView}
          addToast={addToast}
          empById={empById}
          onClose={() => setDetalheId(null)}
          onAtualizado={() => { refresh(); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// NovaOcorrenciaModal — funcionário cria justificativa
// ────────────────────────────────────────────────────────────────────────────
function NovaOcorrenciaModal({ user, db, addToast, onClose, onSalvo }) {
  const hoje = toISODate(new Date());
  const [tipo, setTipo] = useState("atestado_medico");
  const [dataRef, setDataRef] = useState(hoje);
  const [descricao, setDescricao] = useState("");
  const [arquivo, setArquivo] = useState(null);
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const meta = TIPOS_OCORRENCIA[tipo];

  const handleSubmit = useCallback(async (e) => {
    e?.preventDefault();
    setErro("");
    if (meta.docObrigatorio && !arquivo) {
      setErro(`Anexo obrigatório para ${meta.label.toLowerCase()}.`);
      return;
    }
    setLoading(true);
    try {
      let documento_path = null;
      let documento_nome = null;
      if (arquivo) {
        const up = await uploadOcorrenciaDoc(arquivo, user.companyId, user.id);
        if (!up.ok) {
          setErro(`Falha no upload do anexo: ${up.error}`);
          setLoading(false);
          return;
        }
        documento_path = up.path;
        documento_nome = up.filename || arquivo.name;
      }
      criarOcorrencia(db, {
        funcionario_id: user.id,
        funcionario_nome: user.nome || user.email,
        tipo,
        data_ref: dataRef,
        descricao,
        documento_path,
        documento_nome,
      });
      addToast?.({ type: "success", message: "Ocorrência enviada para aprovação." });
      onSalvo?.();
    } catch (err) {
      setErro(err?.message || "Erro ao salvar ocorrência.");
    } finally {
      setLoading(false);
    }
  }, [meta, arquivo, tipo, dataRef, descricao, db, user, addToast, onSalvo]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Nova ocorrência</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div>
            <label htmlFor="oc-tipo" className="block text-xs font-semibold text-gray-300 mb-1">Tipo <span className="text-red-400">*</span></label>
            <select
              id="oc-tipo"
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              required
            >
              {Object.entries(TIPOS_OCORRENCIA).map(([k, t]) => (
                <option key={k} value={k}>{t.label}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="oc-data" className="block text-xs font-semibold text-gray-300 mb-1">
              Dia ao qual se aplica <span className="text-red-400">*</span>
            </label>
            <input
              id="oc-data"
              type="date"
              value={dataRef}
              onChange={(e) => setDataRef(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
              required
              max={hoje}
            />
          </div>

          <div>
            <label htmlFor="oc-desc" className="block text-xs font-semibold text-gray-300 mb-1">Descrição</label>
            <textarea
              id="oc-desc"
              rows={3}
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white resize-none focus:outline-none focus:border-blue-500"
              placeholder="Detalhes da justificativa."
            />
          </div>

          <div>
            <label htmlFor="oc-anexo" className="block text-xs font-semibold text-gray-300 mb-1">
              Anexo (PDF/imagem) {meta.docObrigatorio && <span className="text-red-400">*</span>}
            </label>
            <input
              id="oc-anexo"
              type="file"
              accept="application/pdf,image/*"
              onChange={(e) => setArquivo(e.target.files?.[0] || null)}
              className="w-full text-sm text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-gray-700 file:text-white hover:file:bg-gray-600 file:cursor-pointer"
            />
            {arquivo && (
              <p className="mt-1 text-[11px] text-gray-400">
                {arquivo.name} ({Math.round(arquivo.size / 1024)} KB)
              </p>
            )}
            {!meta.docObrigatorio && (
              <p className="mt-1 text-[11px] text-gray-500">Opcional para este tipo.</p>
            )}
          </div>

          {erro && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erro}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-800">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">
              {loading ? "Enviando…" : "Enviar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// DetalheOcorrenciaModal — preview + ações (admin) ou consulta (funcionário)
// ────────────────────────────────────────────────────────────────────────────
function DetalheOcorrenciaModal({ ocorrencia, user, db, isAdminView, addToast, empById, onClose, onAtualizado }) {
  const [observacao, setObservacao] = useState("");
  const [loading, setLoading] = useState(false);
  const [signedUrl, setSignedUrl] = useState(null);

  const tipoMeta = TIPOS_OCORRENCIA[ocorrencia.tipo];
  const statusMeta = STATUS_INFO[ocorrencia.status];
  const emp = empById?.get(ocorrencia.funcionario_id);

  // Busca URL assinada do anexo (válida 1h) — Storage RLS valida acesso.
  useEffect(() => {
    let cancelled = false;
    if (!ocorrencia.documento_path) { setSignedUrl(null); return; }
    getOcorrenciaDocUrl(ocorrencia.documento_path)
      .then((u) => { if (!cancelled) setSignedUrl(u); });
    return () => { cancelled = true; };
  }, [ocorrencia.documento_path]);

  const handleDecidir = useCallback(async (action) => {
    setLoading(true);
    try {
      decidirOcorrencia(db, ocorrencia.id, action, user, observacao);
      addToast?.({
        type: action === "aprovado" ? "success" : "info",
        message: `Ocorrência ${action === "aprovado" ? "aprovada" : "rejeitada"}.`,
      });
      onAtualizado?.();
      onClose();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro." });
    } finally {
      setLoading(false);
    }
  }, [db, ocorrencia, user, observacao, addToast, onAtualizado, onClose]);

  const handleReabrir = useCallback(() => {
    setLoading(true);
    try {
      reabrirOcorrencia(db, ocorrencia.id, user);
      addToast?.({ type: "info", message: "Ocorrência reaberta para reanálise." });
      onAtualizado?.();
      onClose();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro." });
    } finally {
      setLoading(false);
    }
  }, [db, ocorrencia, user, addToast, onAtualizado, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-lg bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-700 flex items-start justify-between sticky top-0 bg-gray-900">
          <div>
            <h3 className="text-base font-bold text-white">{tipoMeta?.label || ocorrencia.tipo}</h3>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {emp?.nome || ocorrencia.funcionario_nome || ocorrencia.funcionario_id} · Dia {formatDate(ocorrencia.data_ref)}
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center gap-2">
            <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${statusMeta?.color || "bg-gray-500"}`}>
              {statusMeta?.label || ocorrencia.status}
            </span>
            {ocorrencia.zera_debito && (
              <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-cyan-500 text-white">
                Zera débito do dia
              </span>
            )}
          </div>

          {ocorrencia.descricao && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Descrição</h4>
              <p className="text-sm text-gray-200 whitespace-pre-line">{ocorrencia.descricao}</p>
            </div>
          )}

          {ocorrencia.documento_path && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Anexo</h4>
              {signedUrl ? (
                <a
                  href={signedUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 text-sm text-blue-300 hover:text-blue-200 underline"
                >
                  📎 {ocorrencia.documento_nome || "Abrir documento"}
                </a>
              ) : (
                <p className="text-xs text-gray-500">Gerando link…</p>
              )}
            </div>
          )}

          {ocorrencia.decisao_obs && (
            <div>
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Observação da decisão</h4>
              <p className="text-sm text-gray-200 whitespace-pre-line">{ocorrencia.decisao_obs}</p>
              {ocorrencia.decidido_em && (
                <p className="text-[11px] text-gray-500 mt-1">Decidida em {formatDate(ocorrencia.decidido_em)}</p>
              )}
            </div>
          )}

          {/* Ações */}
          {isAdminView && ocorrencia.status === "pendente" && (
            <div className="border-t border-gray-800 pt-4 space-y-2">
              <label htmlFor="oc-decobs" className="block text-xs font-semibold text-gray-300">Observação (opcional)</label>
              <textarea
                id="oc-decobs"
                rows={2}
                value={observacao}
                onChange={(e) => setObservacao(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white resize-none focus:outline-none focus:border-blue-500"
                placeholder="Observação visível ao funcionário."
              />
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => handleDecidir("rejeitado")}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white font-semibold disabled:opacity-50"
                >
                  Rejeitar
                </button>
                <button
                  type="button"
                  onClick={() => handleDecidir("aprovado")}
                  disabled={loading}
                  className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white font-semibold disabled:opacity-50"
                >
                  Aprovar
                </button>
              </div>
            </div>
          )}

          {/* Admin pode reabrir decisão */}
          {isAdminView && ocorrencia.status !== "pendente" && (
            <div className="border-t border-gray-800 pt-4">
              <button
                type="button"
                onClick={handleReabrir}
                disabled={loading}
                className="w-full px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-sm disabled:opacity-50"
              >
                Reabrir para reanálise
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
