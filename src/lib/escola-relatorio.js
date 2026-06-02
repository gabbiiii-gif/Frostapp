// ─── Geração de relatórios do módulo Escola ──────────────────────────────────
// Funções puras: recebem `demandas` e métricas, devolvem strings prontas
// (HTML imprimível ou CSV). Separadas em arquivo próprio porque escola.js
// já está coeso em domínio (CRUD + transições + métricas raw) e relatório
// é uma camada de apresentação.
//
// Usadas pelo modal "Relatórios" do EscolaModule.

import { URGENCIA, calcularMetricas, filtrarPorPeriodo } from "./escola.js";

const STATUS_LABEL = {
  aguardando: "Aguardando",
  em_execucao: "Em execução",
  concluido: "Concluído",
  cancelado: "Cancelado",
};

// Formata data ISO → DD/MM/YYYY (sem timezone shift).
function fmtDate(iso) {
  if (!iso) return "—";
  const s = String(iso).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split("-");
    return `${d}/${m}/${y}`;
  }
  return new Date(iso).toLocaleDateString("pt-BR");
}

// Formata horas decimais → "Xh YYmin" ou "—".
function fmtHoras(h) {
  if (h == null || isNaN(h)) return "—";
  const inteiras = Math.floor(h);
  const min = Math.round((h - inteiras) * 60);
  if (inteiras === 0) return `${min}min`;
  if (min === 0) return `${inteiras}h`;
  return `${inteiras}h ${min}min`;
}

// Determina período "Semanal" (últimos 7 dias) ou "Mensal" (último mês)
// a partir do tamanho do intervalo. Apenas para o título do relatório.
function inferirTipoPeriodo(ini, fim) {
  const diff = (new Date(fim) - new Date(ini)) / (1000 * 60 * 60 * 24);
  if (diff <= 8) return "Semanal";
  if (diff <= 32) return "Mensal";
  return "Personalizado";
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])
  );
}

// ─── Helpers expostos ────────────────────────────────────────────────────────

// Calcula métricas filtradas pelo período (e opcionalmente por escola).
export function montarRelatorio(demandas, ini, fim, escolaFiltro = "") {
  let filtradas = filtrarPorPeriodo(demandas, ini, fim);
  if (escolaFiltro && escolaFiltro.trim()) {
    const q = escolaFiltro.trim().toLowerCase();
    filtradas = filtradas.filter((d) => (d.escola_nome || "").toLowerCase().includes(q));
  }
  const metricas = calcularMetricas(filtradas);
  return { demandas: filtradas, metricas, ini, fim, escolaFiltro: escolaFiltro || null };
}

// HTML imprimível (abre via window.open + window.print — padrão FrostERP).
export function gerarHtmlRelatorio(relatorio, empresaNome = "FrostERP") {
  const { demandas, metricas, ini, fim, escolaFiltro } = relatorio;
  const tipo = inferirTipoPeriodo(ini, fim);
  const periodoLabel = `${fmtDate(ini)} a ${fmtDate(fim)}`;

  // Tabela de demandas
  const rows = demandas
    .slice()
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at))
    .map((d) => `
      <tr>
        <td>${escapeHtml(d.escola_nome)}</td>
        <td>${URGENCIA[d.urgencia]?.label || d.urgencia}</td>
        <td>${STATUS_LABEL[d.status] || d.status}</td>
        <td>${escapeHtml(d.responsavel_nome || "—")}</td>
        <td>${fmtDate(d.data_solicitacao)}</td>
        <td>${fmtDate(d.concluido_em)}</td>
      </tr>
    `).join("");

  // Distribuição por urgência
  const urgRows = Object.entries(metricas.por_urgencia || {})
    .map(([k, v]) => `<tr><td>${URGENCIA[k]?.label || k}</td><td style="text-align:right;">${v}</td></tr>`)
    .join("");

  // Top 10 escolas
  const escolasTop = Object.entries(metricas.por_escola || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([k, v]) => `<tr><td>${escapeHtml(k)}</td><td style="text-align:right;">${v}</td></tr>`)
    .join("");

  const taxa = (metricas.taxa_conclusao * 100).toFixed(1);

  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8" />
<title>Relatório Escola ${tipo} — ${escapeHtml(empresaNome)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", sans-serif; max-width: 920px; margin: 24px auto; padding: 0 16px; color: #111; }
  h1 { color: #1e40af; margin-bottom: 2px; }
  h2 { color: #374151; margin-top: 24px; font-size: 15px; border-bottom: 1px solid #e5e7eb; padding-bottom: 4px; }
  .meta { color: #6b7280; font-size: 13px; }
  .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin-top: 16px; }
  .kpi { background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 8px; padding: 10px; }
  .kpi-label { font-size: 11px; color: #6b7280; text-transform: uppercase; }
  .kpi-val { font-size: 20px; font-weight: bold; color: #111; margin-top: 4px; }
  table { width: 100%; border-collapse: collapse; margin-top: 12px; font-size: 13px; }
  th, td { padding: 6px 8px; border-bottom: 1px solid #e5e7eb; text-align: left; }
  th { background: #f3f4f6; }
  .footer { margin-top: 28px; color: #9ca3af; font-size: 11px; text-align: center; }
  @media print { body { margin: 0; } .no-print { display: none; } }
</style>
</head><body>
  <h1>Relatório Escola — ${tipo}</h1>
  <div class="meta">
    ${escapeHtml(empresaNome)} · ${periodoLabel}
    ${escolaFiltro ? ` · Filtro: ${escapeHtml(escolaFiltro)}` : ""}
  </div>

  <div class="kpis">
    <div class="kpi"><div class="kpi-label">Total</div><div class="kpi-val">${metricas.total}</div></div>
    <div class="kpi"><div class="kpi-label">Concluídas</div><div class="kpi-val">${metricas.concluidas}</div></div>
    <div class="kpi"><div class="kpi-label">Em execução</div><div class="kpi-val">${metricas.em_execucao}</div></div>
    <div class="kpi"><div class="kpi-label">Aguardando</div><div class="kpi-val">${metricas.aguardando}</div></div>
  </div>

  <div class="kpis" style="grid-template-columns: repeat(3, 1fr); margin-top: 8px;">
    <div class="kpi"><div class="kpi-label">Taxa de conclusão</div><div class="kpi-val">${taxa}%</div></div>
    <div class="kpi"><div class="kpi-label">Tempo médio de resposta</div><div class="kpi-val">${fmtHoras(metricas.tempo_medio_resposta_h)}</div></div>
    <div class="kpi"><div class="kpi-label">Tempo médio de atendimento</div><div class="kpi-val">${fmtHoras(metricas.tempo_medio_atendimento_h)}</div></div>
  </div>

  <h2>Distribuição por urgência</h2>
  <table>
    <thead><tr><th>Urgência</th><th style="text-align:right;">Demandas</th></tr></thead>
    <tbody>${urgRows || '<tr><td colspan="2" style="color:#9ca3af;">Sem dados</td></tr>'}</tbody>
  </table>

  <h2>Top escolas (volume)</h2>
  <table>
    <thead><tr><th>Escola</th><th style="text-align:right;">Demandas</th></tr></thead>
    <tbody>${escolasTop || '<tr><td colspan="2" style="color:#9ca3af;">Sem dados</td></tr>'}</tbody>
  </table>

  <h2>Demandas do período</h2>
  <table>
    <thead><tr><th>Escola</th><th>Urgência</th><th>Status</th><th>Responsável</th><th>Solicitada</th><th>Concluída</th></tr></thead>
    <tbody>${rows || '<tr><td colspan="6" style="color:#9ca3af;">Sem demandas no período.</td></tr>'}</tbody>
  </table>

  <div class="footer">FrostERP — Módulo Escola · gerado em ${fmtDate(new Date().toISOString())}</div>
  <script>setTimeout(() => window.print(), 200);</script>
</body></html>`;
}

// CSV UTF-8 com BOM, separador `;` (Excel pt-BR friendly).
export function gerarCsvRelatorio(relatorio) {
  const { demandas } = relatorio;
  const linhas = [[
    "Escola", "Urgência", "Status", "Responsável",
    "Data solicitação", "Data conclusão", "Descrição",
  ]];
  for (const d of demandas) {
    linhas.push([
      d.escola_nome || "",
      URGENCIA[d.urgencia]?.label || d.urgencia || "",
      STATUS_LABEL[d.status] || d.status || "",
      d.responsavel_nome || "",
      fmtDate(d.data_solicitacao),
      fmtDate(d.concluido_em),
      // Normaliza quebras de linha dentro da descrição para CSV one-cell.
      String(d.descricao || "").replace(/\r?\n/g, " "),
    ]);
  }
  const csv = "﻿" + linhas.map((l) => l.map(csvField).join(";")).join("\r\n");
  return csv;
}

function csvField(v) {
  const s = v == null ? "" : String(v);
  if (s.includes(";") || s.includes('"') || s.includes("\n")) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// Atalhos de período comuns ─────────────────────────────────────────────────

// Últimos 7 dias inclusive hoje.
export function periodoSemana() {
  const fim = new Date();
  const ini = new Date(fim);
  ini.setDate(ini.getDate() - 6);
  return { ini: ini.toISOString().slice(0, 10), fim: fim.toISOString().slice(0, 10) };
}

// Mês corrente (do dia 1 até hoje).
export function periodoMesCorrente() {
  const hoje = new Date();
  const ini = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return {
    ini: ini.toISOString().slice(0, 10),
    fim: hoje.toISOString().slice(0, 10),
  };
}
