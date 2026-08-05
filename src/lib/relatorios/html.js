// Documento imprimível do relatório. Mesmo padrão dos documentos de OS/orçamento:
// HTML autocontido, aberto em janela nova, com barra de ações que o app liga por
// fora (a CSP proíbe script dentro do documento). O CSS é duplicado de propósito:
// _docStyles vive no App.jsx e importá-lo daqui criaria import circular, já que o
// App.jsx importa os módulos.

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtCelula(valor, tipo) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "number" && isFinite(valor)) {
    if (tipo === "moeda") {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
    }
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: Number.isInteger(valor) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(valor);
  }
  return esc(valor);
}

const ESTILOS = `
  * { box-sizing: border-box; }
  body { margin:0; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#111; background:#f3f4f6; padding-top:44px; }
  main.page { background:#fff; width:794px; max-width:100%; margin:16px auto; padding:32px; }
  header.doc { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1d4ed8; padding-bottom:12px; margin-bottom:20px; gap:16px; }
  header.doc img { max-height:56px; }
  .empresa { font-size:12px; color:#4b5563; line-height:1.5; }
  .empresa strong { display:block; font-size:16px; color:#111; }
  h1 { font-size:20px; margin:0 0 4px; color:#1d4ed8; }
  .resumo { font-size:12px; color:#4b5563; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { padding:8px 10px; border-bottom:1px solid #e5e7eb; text-align:left; }
  th { background:#f3f4f6; font-weight:600; }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight:700; border-top:2px solid #1d4ed8; background:#f9fafb; }
  .aviso { background:#fef3c7; border:1px solid #f59e0b; color:#92400e; padding:8px 12px; font-size:12px; margin-bottom:12px; border-radius:6px; }
  .vazio { text-align:center; color:#6b7280; padding:40px 0; font-size:13px; }
  footer.doc { margin-top:24px; font-size:10px; color:#9ca3af; text-align:center; }
  .actionbar { position:fixed; top:0; left:0; right:0; background:#111827; padding:8px; display:flex; gap:8px; justify-content:center; }
  .actionbar button { padding:6px 14px; font-size:13px; border:0; border-radius:6px; background:#2563eb; color:#fff; cursor:pointer; }
  .actionbar button:disabled { opacity:.6; cursor:default; }
  @media print {
    .actionbar { display:none !important; }
    body { background:#fff; padding-top:0; }
    main.page { margin:0; width:auto; padding:0; }
  }
`;

// Monta o documento completo. `empresa` aceita { nome, cnpj, telefone, endereco, logo }
// e qualquer campo pode faltar — o cabeçalho se adapta.
export function relatorioHTML({
  nome = "Relatório",
  resumo = "",
  colunas = [],
  linhas = [],
  totais = {},
  truncado = false,
  empresa = {},
  geradoEm = new Date(),
} = {}) {
  const carimbo = (geradoEm instanceof Date ? geradoEm : new Date(geradoEm)).toLocaleString("pt-BR");
  const alinhaNum = (tipo) => (tipo === "moeda" || tipo === "numero" ? ' class="num"' : "");

  const cabecalho = colunas.map((c) => `<th${alinhaNum(c.tipo)}>${esc(c.label)}</th>`).join("");
  const corpo = linhas.map((l) => (
    `<tr>${colunas.map((c) => `<td${alinhaNum(c.tipo)}>${fmtCelula(l[c.id], c.tipo)}</td>`).join("")}</tr>`
  )).join("");

  const temTotais = linhas.length > 0 && Object.keys(totais).length > 0;
  const rodapeTabela = temTotais
    ? `<tr class="total">${colunas.map((c, i) => (
        i === 0 ? "<td>TOTAL</td>" : `<td${alinhaNum(c.tipo)}>${fmtCelula(totais[c.id], c.tipo)}</td>`
      )).join("")}</tr>`
    : "";

  const tabela = linhas.length === 0
    ? '<p class="vazio">Nenhum registro encontrado para os critérios escolhidos.</p>'
    : `<table><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}${rodapeTabela}</tbody></table>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(nome)}</title>
<style>${ESTILOS}</style>
</head>
<body>
  <div class="actionbar" role="toolbar" aria-label="Ações do documento">
    <button id="btn-pdf" type="button" aria-label="Baixar arquivo PDF">Baixar PDF</button>
    <button id="btn-print" type="button" aria-label="Imprimir documento">Imprimir</button>
    <button id="btn-close" type="button" aria-label="Fechar janela">Fechar</button>
  </div>
  <main class="page">
    <header class="doc">
      <div class="empresa">
        <strong>${esc(empresa.nome || "FrostERP")}</strong>
        ${empresa.cnpj ? `CNPJ: ${esc(empresa.cnpj)}<br/>` : ""}
        ${empresa.telefone ? `${esc(empresa.telefone)}<br/>` : ""}
        ${empresa.endereco ? esc(empresa.endereco) : ""}
      </div>
      ${empresa.logo ? `<img src="${esc(empresa.logo)}" alt="Logo da empresa" />` : ""}
    </header>
    <h1>${esc(nome)}</h1>
    <p class="resumo">${esc(resumo)}</p>
    ${truncado ? '<p class="aviso">Resultado parcial: o limite de 50.000 registros foi atingido. Estreite o período para obter um número exato.</p>' : ""}
    ${tabela}
    <footer class="doc">Gerado pelo FrostERP em ${esc(carimbo)}</footer>
  </main>
</body>
</html>`;
}
