// Engine de relatórios — puro. Recebe arrays já carregados pelo módulo e devolve
// o resultado agregado. NÃO conhece window.storage, DB nem React: é o que
// permite testá-lo direto no Vitest e trocar a origem dos dados no futuro.

import { getDataset, getCampo, AGREGACOES } from "./datasets.js";
import { colunaMetrica } from "./spec.js";

// Teto de registros lidos por execução. Estourar não é erro: o resultado volta
// com truncado=true e a UI pede um período mais estreito. Renderizar um número
// errado em silêncio seria pior.
export const LIMITE_REGISTROS = 50000;

// Data em "YYYY-MM-DD" local, aceitando "2026-03-05" e ISO com hora.
function dataLocalISO(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function filtrarPorPeriodo(itens, campo, de, ate) {
  if (!campo || !de || !ate) return itens || [];
  return (itens || []).filter((item) => {
    const d = dataLocalISO(item?.[campo]);
    if (!d) return false;
    return d >= de && d <= ate;
  });
}

function vazio(v) {
  return v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0);
}

// Converte para algo comparável de acordo com o tipo declarado no registry.
export function valorComparavel(v, tipo) {
  if (tipo === "numero" || tipo === "moeda") {
    // Number(null) e Number("") valem 0 — sem esta guarda um campo vazio
    // viraria zero de verdade e matcharia filtros de comparação. A app
    // escreve `null` para inputs numéricos limpos, então é um caso real.
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  if (tipo === "data") return dataLocalISO(v);
  return v === null || v === undefined ? "" : String(v);
}

function comparaFiltro(valorItem, filtro, tipo) {
  const { op, valor } = filtro;
  if (op === "vazio") return vazio(valorItem);
  if (op === "nao_vazio") return !vazio(valorItem);

  const a = valorComparavel(valorItem, tipo);

  if (op === "em") {
    const lista = (Array.isArray(valor) ? valor : [valor]).map((x) => valorComparavel(x, tipo));
    return lista.includes(a);
  }
  if (op === "entre") {
    // Se valor não for array de 2 elementos, retorna [null, null] que match ninguém.
    // Isso é seguro: um range incompleto/inválido é melhor que um range aberto.
    const [ini, fim] = Array.isArray(valor) ? valor : [null, null];
    const vi = valorComparavel(ini, tipo);
    const vf = valorComparavel(fim, tipo);
    if (a === null || vi === null || vf === null) return false;
    return a >= vi && a <= vf;
  }

  const b = valorComparavel(valor, tipo);
  if (op === "igual") return a === b;
  if (op === "diferente") return a !== b;
  if (op === "contem") return String(a).toLowerCase().includes(String(b).toLowerCase());
  if (a === null || b === null) return false;
  if (op === "maior") return a > b;
  if (op === "menor") return a < b;
  return true;
}

// E lógico entre todos os filtros — é o comportamento que o usuário espera ao
// empilhar condições no builder ("finalizadas E acima de R$200").
export function aplicarFiltros(itens, filtros, datasetId) {
  if (!Array.isArray(filtros) || filtros.length === 0) return itens || [];
  return (itens || []).filter((item) => filtros.every((f) => {
    const campo = getCampo(datasetId, f.campo);
    if (!campo) return true; // campo desconhecido já foi barrado em validarSpec
    return comparaFiltro(item?.[f.campo], f, campo.tipo);
  }));
}

// ─── Agrupamento e agregação ────────────────────────────────────────────────

// Índice id → registro. Referência é resolvida por lookup em Map, não por
// varredura por linha: sem isso, agrupar OS por técnico vira O(n*m).
export function indexarPorId(itens) {
  const m = new Map();
  for (const it of itens || []) {
    if (it && it.id !== undefined && it.id !== null) m.set(String(it.id), it);
  }
  return m;
}

// Nome legível de um registro referenciado. Cobre as entidades da v1: pessoas,
// clientes e produtos usam `nome`; agenda usa `titulo`; OS usa o número.
function rotuloRef(registro, fallback) {
  if (!registro) return fallback;
  return registro.nome || registro.razaoSocial || registro.titulo ||
    (registro.numero ? `#${registro.numero}` : null) || fallback;
}

// Valores "vazios" (null, undefined, "") NÃO entram nas agregações numéricas.
// Number(null) é 0, então sem esta limpeza um campo em branco entraria como
// zero de verdade: puxaria a média para baixo e viraria um mínimo falso.
function numerosValidos(valores) {
  const out = [];
  for (const v of valores) {
    if (v === null || v === undefined || v === "") continue;
    const n = Number(v);
    if (isFinite(n)) out.push(n);
  }
  return out;
}

function agregar(valores, agregacao) {
  if (agregacao === "contagem") return valores.length;
  if (agregacao === "contagem_distinta") {
    return new Set(valores.filter((v) => v !== null && v !== undefined && v !== "")).size;
  }
  const nums = numerosValidos(valores);
  if (nums.length === 0) return 0;
  if (agregacao === "soma") return nums.reduce((a, b) => a + b, 0);
  if (agregacao === "media") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agregacao === "minimo") return Math.min(...nums);
  if (agregacao === "maximo") return Math.max(...nums);
  return 0;
}

function labelMetrica(dsId, metrica) {
  const ag = AGREGACOES.find((a) => a.id === metrica.agregacao);
  if (!metrica.campo) return ag?.label || metrica.agregacao;
  const campo = getCampo(dsId, metrica.campo);
  return `${ag?.label || metrica.agregacao} de ${campo?.label || metrica.campo}`;
}

// Separador interno das chaves de grupo. Caractere improvável em dado real —
// se aparecer num valor, o split devolveria colunas trocadas.
const SEP_GRUPO = "␟";

// Executa um ReportSpec JÁ VALIDADO por validarSpec. `dados` é a lista da fonte
// principal; `refs` traz as listas das fontes referenciadas, indexadas por id de
// dataset (ex.: { funcionarios: [...] }).
export function executarRelatorio(spec, { dados = [], refs = {} } = {}) {
  const ds = getDataset(spec?.fonte);
  if (!ds) return { colunas: [], linhas: [], totais: {}, lidos: 0, truncado: false };

  // 1) Recorte por período antes de qualquer coisa — é o que segura a memória.
  const noPeriodo = filtrarPorPeriodo(dados, spec.periodo?.campo, spec.periodo?.de, spec.periodo?.ate);
  // 2) Filtros do usuário.
  const filtrados = aplicarFiltros(noPeriodo, spec.filtros, ds.id);
  // 3) Teto de leitura: não é erro, mas o resultado avisa que está parcial.
  const truncado = filtrados.length > LIMITE_REGISTROS;
  const usados = truncado ? filtrados.slice(0, LIMITE_REGISTROS) : filtrados;

  const agrupamento = Array.isArray(spec.agrupamento) ? spec.agrupamento : [];
  const metricas = Array.isArray(spec.metricas) ? spec.metricas : [];

  // Índices só das fontes de referência realmente usadas no agrupamento.
  const indices = {};
  for (const campoId of agrupamento) {
    const campo = getCampo(ds.id, campoId);
    if (campo?.tipo === "referencia") indices[campoId] = indexarPorId(refs[campo.ref]);
  }

  const colunas = [
    ...agrupamento.map((g) => {
      const campo = getCampo(ds.id, g);
      return {
        id: g,
        label: campo?.label || g,
        // Referência vira texto na saída: o que aparece é o nome, não o id.
        tipo: campo?.tipo === "referencia" ? "texto" : (campo?.tipo || "texto"),
      };
    }),
    ...metricas.map((m) => ({
      id: colunaMetrica(m),
      label: labelMetrica(ds.id, m),
      tipo: m.agregacao === "contagem" || m.agregacao === "contagem_distinta"
        ? "numero"
        : (getCampo(ds.id, m.campo)?.tipo || "numero"),
    })),
  ];

  // Rótulo de um campo de agrupamento, já com a referência resolvida.
  const rotuloDe = (item, campoId) => {
    const bruto = item?.[campoId];
    const idx = indices[campoId];
    const rotulo = idx ? rotuloRef(idx.get(String(bruto)), bruto || "—") : bruto;
    return rotulo === "" || rotulo === null || rotulo === undefined ? "—" : String(rotulo);
  };

  // Agrupa guardando os rótulos junto da chave — evita depender de split para
  // remontar as colunas, que quebraria se o separador aparecesse no dado.
  const grupos = new Map();
  for (const item of usados) {
    const rotulos = agrupamento.map((g) => rotuloDe(item, g));
    const chave = agrupamento.length ? rotulos.join(SEP_GRUPO) : "__total__";
    if (!grupos.has(chave)) grupos.set(chave, { rotulos, itens: [] });
    grupos.get(chave).itens.push(item);
  }

  let linhas = [];
  for (const { rotulos, itens } of grupos.values()) {
    const linha = {};
    agrupamento.forEach((g, i) => { linha[g] = rotulos[i]; });
    for (const m of metricas) {
      const valores = m.campo ? itens.map((it) => it?.[m.campo]) : itens;
      linha[colunaMetrica(m)] = agregar(valores, m.agregacao);
    }
    linhas.push(linha);
  }

  if (spec.ordenacao) {
    const { campo, direcao } = spec.ordenacao;
    const sinal = direcao === "asc" ? 1 : -1;
    linhas.sort((a, b) => {
      const va = a[campo]; const vb = b[campo];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sinal;
      return String(va).localeCompare(String(vb), "pt-BR") * sinal;
    });
  }

  if (spec.limite && linhas.length > spec.limite) linhas = linhas.slice(0, spec.limite);

  // Totais saem de TODOS os registros usados, não das linhas exibidas — cortar
  // por limite não pode alterar o total do rodapé.
  const totais = {};
  for (const m of metricas) {
    const valores = m.campo ? usados.map((it) => it?.[m.campo]) : usados;
    totais[colunaMetrica(m)] = agregar(valores, m.agregacao);
  }

  return { colunas, linhas, totais, lidos: dados.length, truncado };
}
