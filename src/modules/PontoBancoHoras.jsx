// ─── Banco de Horas — Fase D ─────────────────────────────────────────────────
// Componente reutilizável usado tanto pelo funcionário (visão própria) quanto
// pelo admin/gerente (visão da equipe).
//
// Funcionalidades:
//   - Filtro de período (default: mês atual)
//   - Tabela diária: data, dia da semana, trabalhado, esperado, saldo, status
//   - Gráfico Recharts (BarChart) — saldo diário
//   - KPIs: saldo total, dias trabalhados, faltas, créditos
//   - Para admin: combobox de funcionário + modal de config de jornada
//   - Para self: jornada read-only
//   - Exportação PDF (via openHTMLDoc) e CSV
//
// Dados de domínio em src/lib/banco-horas.js (puro, testado).

import { useState, useMemo, useCallback, useEffect } from "react";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine,
} from "recharts";
import {
  calcularSaldoPeriodo,
  totalSaldo,
  contarPorStatus,
  getJornada,
  setJornada,
  periodoMes,
  JORNADA_DEFAULT,
} from "../lib/banco-horas.js";
import { formatMinutos } from "../lib/ponto.js";
import { formatDate } from "../utils.js";

// ─── Status → cor/label (alinhado ao STATUS_MAP do app) ─────────────────────
const STATUS_INFO = {
  ok:            { label: "OK",         color: "bg-green-500",  hex: "#10b981" },
  credito:       { label: "Crédito",    color: "bg-blue-500",   hex: "#3b82f6" },
  debito:        { label: "Débito",     color: "bg-orange-500", hex: "#f59e0b" },
  falta:         { label: "Falta",      color: "bg-red-500",    hex: "#ef4444" },
  folga:         { label: "Folga",      color: "bg-gray-500",   hex: "#6b7280" },
  feriado_extra: { label: "Extra",      color: "bg-purple-500", hex: "#8b5cf6" },
  atestado:      { label: "Atestado",   color: "bg-cyan-500",   hex: "#06b6d4" },
};

const DIA_SEMANA = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function PontoBancoHoras({ user, addToast, db, employees, isAdminView }) {
  // ─── Estado: período e funcionário selecionado ───
  const hoje = new Date();
  const mesAtual = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
  const [mes, setMes] = useState(mesAtual);
  // Para self: força o próprio. Para admin: combobox.
  const [funcSelecionado, setFuncSelecionado] = useState(user?.id || "");
  // Bump após salvar jornada — força o useMemo de `jornada` a reler do db.
  // Sem isso, salvar mostrava sucesso mas a tela seguia com o valor antigo.
  const [jornadaTick, setJornadaTick] = useState(0);
  // Ocorrências (placeholder — fase E vai popular). Lista vazia já produz
  // resultados corretos (sem zerar débitos por atestado).
  const ocorrencias = useMemo(() => {
    if (!db || !funcSelecionado) return [];
    return db.list("erp:ocorrencia:")
      .filter((o) => o && o.funcionario_id === funcSelecionado);
  }, [db, funcSelecionado]);

  // ─── Cálculo do período ───
  const periodo = useMemo(() => periodoMes(mes), [mes]);
  const jornada = useMemo(
    () => (db && funcSelecionado ? getJornada(db, funcSelecionado) : JORNADA_DEFAULT),
    [db, funcSelecionado, jornadaTick]
  );

  const saldos = useMemo(() => {
    if (!db || !funcSelecionado) return [];
    return calcularSaldoPeriodo(db, funcSelecionado, periodo.ini, periodo.fim, jornada, ocorrencias);
  }, [db, funcSelecionado, periodo, jornada, ocorrencias]);

  const total = useMemo(() => totalSaldo(saldos), [saldos]);
  const stats = useMemo(() => contarPorStatus(saldos), [saldos]);

  // ─── Dados do gráfico (saldo em horas decimais) ───
  const chartData = useMemo(() => saldos.map((d) => ({
    dia: d.data.slice(8, 10),
    saldo_h: +(d.saldo / 60).toFixed(2),
    fill: STATUS_INFO[d.status]?.hex || "#6b7280",
  })), [saldos]);

  // ─── Modal config jornada (admin) ───
  const [showJornada, setShowJornada] = useState(false);

  // Lista de funcionários disponíveis para o admin selecionar.
  // No FrostERP, employees vem como prop (recebido do App.jsx).
  const funcionariosLista = useMemo(() => {
    const ids = new Set();
    const out = [];
    (employees || []).forEach((e) => {
      if (e?.id && !ids.has(e.id)) { ids.add(e.id); out.push({ id: e.id, nome: e.nome || e.email || e.id }); }
    });
    // Inclui o próprio user se não estiver no employees
    if (user && !ids.has(user.id)) out.unshift({ id: user.id, nome: user.nome || user.email });
    return out;
  }, [employees, user]);

  // Ao trocar de funcionário, mantém período atual.
  // Caso self e funcSelecionado seja diferente do user.id, reset (defesa).
  useEffect(() => {
    if (!isAdminView && user?.id && funcSelecionado !== user.id) {
      setFuncSelecionado(user.id);
    }
  }, [isAdminView, user, funcSelecionado]);

  return (
    <div className="space-y-5">
      <header className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h2 className="text-lg font-bold text-white">Banco de horas</h2>
          <p className="text-xs text-gray-400 mt-0.5">
            Saldo de crédito/débito do período. Tolerância aplicada: {jornada.tolerancia_min || 0} min/dia.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => exportarCSV(saldos, funcSelecionado, mes, addToast)}
            className="text-xs px-3 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white"
          >
            ⬇ CSV
          </button>
          <button
            type="button"
            onClick={() => exportarPDF(saldos, jornada, funcionariosLista.find((f) => f.id === funcSelecionado)?.nome || funcSelecionado, mes, total)}
            className="text-xs px-3 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white"
          >
            ⬇ PDF
          </button>
        </div>
      </header>

      {/* Filtros */}
      <section className="rounded-2xl border border-gray-700 bg-gray-800/40 backdrop-blur p-3 sm:p-4 flex flex-wrap gap-3 items-end">
        <div>
          <label htmlFor="bh-mes" className="block text-[11px] font-semibold text-gray-400 mb-1">Mês</label>
          <input
            id="bh-mes"
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
        {isAdminView && (
          <div className="flex-1 min-w-[180px]">
            <label htmlFor="bh-func" className="block text-[11px] font-semibold text-gray-400 mb-1">Funcionário</label>
            <select
              id="bh-func"
              value={funcSelecionado}
              onChange={(e) => setFuncSelecionado(e.target.value)}
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
            >
              {funcionariosLista.map((f) => (
                <option key={f.id} value={f.id}>{f.nome}</option>
              ))}
            </select>
          </div>
        )}
        {isAdminView && (
          <button
            type="button"
            onClick={() => setShowJornada(true)}
            className="text-xs px-3 py-2 rounded-lg bg-blue-600/80 hover:bg-blue-500 text-white"
          >
            ⚙ Configurar jornada
          </button>
        )}
      </section>

      {/* KPIs */}
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kpi label="Saldo do período" value={formatMinutos(total)} accent={total >= 0 ? "blue" : "orange"} />
        <Kpi label="Dias OK" value={stats.ok + stats.credito} />
        <Kpi label="Faltas" value={stats.falta} accent={stats.falta > 0 ? "red" : "gray"} />
        <Kpi label="Atestados" value={stats.atestado} accent="cyan" />
      </section>

      {/* Gráfico */}
      <section className="rounded-2xl border border-gray-700 bg-gray-800/40 backdrop-blur p-3 sm:p-4">
        <h3 className="text-xs font-semibold text-gray-300 mb-2">Saldo diário (horas)</h3>
        <div style={{ width: "100%", height: 220 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <XAxis dataKey="dia" stroke="#9ca3af" fontSize={10} />
              <YAxis stroke="#9ca3af" fontSize={10} />
              <ReferenceLine y={0} stroke="#4b5563" />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid #374151", borderRadius: 8, fontSize: 12 }}
                labelStyle={{ color: "#fff" }}
                formatter={(v) => [`${v}h`, "Saldo"]}
              />
              <Bar dataKey="saldo_h" radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Tabela */}
      <section className="overflow-x-auto rounded-2xl border border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-800/70 text-gray-300">
            <tr>
              <th className="text-left px-3 py-2 font-semibold">Data</th>
              <th className="text-left px-3 py-2 font-semibold hidden sm:table-cell">Dia</th>
              <th className="text-right px-3 py-2 font-semibold">Trabalhado</th>
              <th className="text-right px-3 py-2 font-semibold hidden md:table-cell">Esperado</th>
              <th className="text-right px-3 py-2 font-semibold">Saldo</th>
              <th className="text-left px-3 py-2 font-semibold">Status</th>
            </tr>
          </thead>
          <tbody>
            {saldos.map((d) => {
              const dow = new Date(d.data + "T12:00:00").getDay();
              const info = STATUS_INFO[d.status] || STATUS_INFO.ok;
              return (
                <tr key={d.data} className="border-t border-gray-700">
                  <td className="px-3 py-2 text-gray-200">{formatDate(d.data)}</td>
                  <td className="px-3 py-2 text-gray-400 hidden sm:table-cell">{DIA_SEMANA[dow]}</td>
                  <td className="px-3 py-2 text-right text-gray-200">{formatMinutos(d.minutos_trabalhados)}</td>
                  <td className="px-3 py-2 text-right text-gray-400 hidden md:table-cell">{formatMinutos(d.minutos_esperados)}</td>
                  <td className={`px-3 py-2 text-right font-semibold ${d.saldo > 0 ? "text-green-300" : d.saldo < 0 ? "text-orange-300" : "text-gray-300"}`}>
                    {d.saldo === 0 ? "—" : (d.saldo > 0 ? "+" : "") + formatMinutos(d.saldo)}
                  </td>
                  <td className="px-3 py-2">
                    <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full text-white ${info.color}`}>
                      {info.label}
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {showJornada && (
        <ConfigJornadaModal
          db={db}
          funcionarioId={funcSelecionado}
          funcionarioNome={funcionariosLista.find((f) => f.id === funcSelecionado)?.nome || ""}
          atual={jornada}
          addToast={addToast}
          onClose={() => setShowJornada(false)}
          onSaved={() => { setShowJornada(false); setJornadaTick((t) => t + 1); }}
        />
      )}
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// ConfigJornadaModal — admin define jornada de um funcionário
// ────────────────────────────────────────────────────────────────────────────
function ConfigJornadaModal({ db, funcionarioId, funcionarioNome, atual, addToast, onClose, onSaved }) {
  const [horasDia, setHorasDia] = useState(atual.horas_dia ?? 8);
  const [horasSemana, setHorasSemana] = useState(atual.horas_semana ?? 44);
  const [diasSemana, setDiasSemana] = useState(new Set(atual.dias_semana || [1, 2, 3, 4, 5]));
  const [tolerancia, setTolerancia] = useState(atual.tolerancia_min ?? 10);
  const [intervalo, setIntervalo] = useState(atual.intervalo_min ?? 60);
  const [horaEntrada, setHoraEntrada] = useState(atual.hora_entrada || "08:00");
  const [horaSaida, setHoraSaida] = useState(atual.hora_saida || "17:00");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const toggleDia = (d) => {
    const novo = new Set(diasSemana);
    if (novo.has(d)) novo.delete(d); else novo.add(d);
    setDiasSemana(novo);
  };

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    setErro("");
    const hd = parseFloat(horasDia);
    if (!(hd > 0 && hd <= 24)) { setErro("Horas/dia inválido."); return; }
    setLoading(true);
    try {
      setJornada(db, funcionarioId, {
        horas_dia: hd,
        horas_semana: parseFloat(horasSemana) || 44,
        dias_semana: Array.from(diasSemana).sort(),
        tolerancia_min: parseInt(tolerancia, 10) || 0,
        intervalo_min: parseInt(intervalo, 10) || 0,
        hora_entrada: horaEntrada,
        hora_saida: horaSaida,
        ativo: true,
      });
      addToast?.({ type: "success", message: "Jornada atualizada." });
      onSaved?.();
    } catch (err) {
      setErro(err?.message || "Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  }, [db, funcionarioId, horasDia, horasSemana, diasSemana, tolerancia, intervalo, horaEntrada, horaSaida, addToast, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Configurar jornada</h3>
            <p className="text-xs text-gray-400 mt-0.5">{funcionarioNome}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field id="jor-h-dia" label="Horas/dia" type="number" step="0.5" min="0" max="24" value={horasDia} onChange={setHorasDia} />
            <Field id="jor-h-sem" label="Horas/semana" type="number" step="1" min="0" max="80" value={horasSemana} onChange={setHorasSemana} />
          </div>

          <fieldset>
            <legend className="block text-xs font-semibold text-gray-300 mb-1.5">Dias úteis</legend>
            <div className="flex gap-1 flex-wrap">
              {DIA_SEMANA.map((label, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => toggleDia(idx)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border ${diasSemana.has(idx) ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-700 text-gray-300 hover:border-gray-500"}`}
                >
                  {label}
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid grid-cols-2 gap-3">
            <Field id="jor-tol" label="Tolerância (min)" type="number" step="1" min="0" max="60" value={tolerancia} onChange={setTolerancia} />
            <Field id="jor-int" label="Intervalo (min)" type="number" step="5" min="0" max="240" value={intervalo} onChange={setIntervalo} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Field id="jor-ent" label="Hora entrada" type="time" value={horaEntrada} onChange={setHoraEntrada} />
            <Field id="jor-sai" label="Hora saída" type="time" value={horaSaida} onChange={setHoraSaida} />
          </div>

          {erro && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erro}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white" disabled={loading}>
              Cancelar
            </button>
            <button type="submit" disabled={loading} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">
              {loading ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Auxiliares ─────────────────────────────────────────────────────────────

function Field({ id, label, type, value, onChange, ...rest }) {
  return (
    <div>
      <label htmlFor={id} className="block text-xs font-semibold text-gray-300 mb-1">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500"
        {...rest}
      />
    </div>
  );
}

function Kpi({ label, value, accent = "gray" }) {
  const accentBg = {
    gray: "from-gray-500/20 to-gray-500/5",
    blue: "from-blue-500/20 to-blue-500/5",
    orange: "from-orange-500/20 to-orange-500/5",
    red: "from-red-500/20 to-red-500/5",
    cyan: "from-cyan-500/20 to-cyan-500/5",
  }[accent] || "from-gray-500/20 to-gray-500/5";
  return (
    <div className={`rounded-2xl border border-gray-700 bg-gradient-to-br ${accentBg} p-4`}>
      <div className="text-[11px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-xl font-bold text-white mt-1">{value}</div>
    </div>
  );
}

// ─── Exportações ────────────────────────────────────────────────────────────

// CSV — UTF-8 com BOM (Excel reconhece acentos).
function exportarCSV(saldos, funcId, mes, addToast) {
  try {
    const linhas = [["Data", "Trabalhado (min)", "Esperado (min)", "Saldo (min)", "Status"]];
    for (const d of saldos) {
      linhas.push([
        d.data,
        d.minutos_trabalhados,
        d.minutos_esperados,
        d.saldo,
        d.status,
      ]);
    }
    const csv = "﻿" + linhas.map((l) => l.map(csvField).join(";")).join("\r\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `banco-horas_${funcId}_${mes}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    addToast?.({ type: "success", message: "CSV exportado." });
  } catch (err) {
    addToast?.({ type: "error", message: err?.message || "Erro ao exportar CSV." });
  }
}

function csvField(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// PDF — abre janela imprimível (mesmo padrão de generateOSHTML do FrostERP).
function exportarPDF(saldos, jornada, funcNome, mes, totalMin) {
  const total = formatMinutosLocal(totalMin);
  const rows = saldos.map((d) => `
    <tr>
      <td>${d.data}</td>
      <td>${formatMinutosLocal(d.minutos_trabalhados)}</td>
      <td>${formatMinutosLocal(d.minutos_esperados)}</td>
      <td style="text-align:right; color:${d.saldo > 0 ? "#15803d" : d.saldo < 0 ? "#b45309" : "#374151"};">
        ${d.saldo === 0 ? "—" : (d.saldo > 0 ? "+" : "") + formatMinutosLocal(d.saldo)}
      </td>
      <td>${d.status}</td>
    </tr>
  `).join("");

  const html = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Banco de horas — ${escapeHtml(funcNome)} — ${mes}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 900px; margin: 24px auto; padding: 0 16px; color: #111; }
  h1 { color: #1e40af; margin-bottom: 4px; }
  .meta { color: #6b7280; font-size: 13px; }
  table { width: 100%; border-collapse: collapse; margin-top: 16px; font-size: 13px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; }
  .total { margin-top: 16px; padding: 12px; background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 6px; font-size: 14px; }
  @media print { body { margin: 0; } }
</style>
</head><body>
  <h1>Banco de horas</h1>
  <div class="meta">
    ${escapeHtml(funcNome)} · ${mes} · Jornada ${jornada.horas_dia}h/dia · Tolerância ${jornada.tolerancia_min} min
  </div>
  <table>
    <thead><tr><th>Data</th><th>Trabalhado</th><th>Esperado</th><th>Saldo</th><th>Status</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="total">
    <strong>Saldo total do período:</strong>
    <span style="color:${totalMin > 0 ? "#15803d" : totalMin < 0 ? "#b91c1c" : "#374151"}; font-weight: bold;">
      ${totalMin === 0 ? "0" : (totalMin > 0 ? "+" : "") + total}
    </span>
  </div>
  <script>window.print();</script>
</body></html>`;

  const w = window.open("", "_blank", "width=900,height=900");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
}

// Versão local de formatMinutos para usar dentro da janela exportada.
function formatMinutosLocal(min) {
  if (min == null || isNaN(min)) return "—";
  const sign = min < 0 ? "-" : "";
  const abs = Math.abs(min);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${sign}${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}
