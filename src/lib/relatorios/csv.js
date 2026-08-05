// Exportação CSV no dialeto que o Excel pt-BR abre sem perguntar nada:
// separador ";", vírgula decimal e BOM UTF-8. CSV "padrão" (vírgula + ponto)
// abre como uma coluna só e com acento quebrado nas máquinas dos clientes.

const SEP = ";";
const EOL = "\r\n";

function ehNumero(v) {
  return typeof v === "number" && isFinite(v);
}

function formatarCelula(valor, tipo) {
  if (valor === null || valor === undefined) return "";
  if (ehNumero(valor)) {
    // Moeda sempre com 2 casas; número só ganha casas se realmente tiver.
    const casas = tipo === "moeda" || !Number.isInteger(valor) ? 2 : 0;
    return valor.toFixed(casas).replace(".", ",");
  }
  return String(valor);
}

// Campo entra entre aspas se contiver separador, aspas ou quebra de linha.
// Aspas internas são duplicadas — regra do RFC 4180.
function escapar(texto) {
  const s = String(texto);
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function paraCSV({ colunas = [], linhas = [], totais = {} } = {}, { incluirTotais = true } = {}) {
  const out = [];
  out.push(colunas.map((c) => escapar(c.label)).join(SEP));
  for (const linha of linhas) {
    out.push(colunas.map((c) => escapar(formatarCelula(linha[c.id], c.tipo))).join(SEP));
  }
  const temTotais = incluirTotais && Object.keys(totais).length > 0 && linhas.length > 0;
  if (temTotais) {
    out.push(colunas.map((c, i) => (
      i === 0 ? "TOTAL" : escapar(formatarCelula(totais[c.id], c.tipo))
    )).join(SEP));
  }
  // BOM na frente: sem ele o Excel no Windows lê o arquivo como ANSI e todo
  // acento vira caractere estranho.
  return "\uFEFF" + out.join(EOL) + EOL;
}

function slug(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")   // remove os acentos separados pelo NFD
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nomeArquivoCSV(nomeRelatorio, data = new Date()) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${slug(nomeRelatorio) || "relatorio"}-${y}-${m}-${d}.csv`;
}

// Base64 de texto UTF-8. btoa() sozinho estoura em acento ("ç", "ã"), por isso
// o texto passa pelo TextEncoder antes. Usado no envio por WhatsApp.
export function paraBase64(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

// Dispara o download no browser. Fora do escopo de teste (depende de DOM/Blob).
export function baixarCSV(nomeArquivo, conteudo) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
