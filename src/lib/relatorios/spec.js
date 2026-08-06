// ReportSpec — o formato único de consulta do módulo Relatórios.
// Builder, modo Pergunta (IA) e "relatório salvo" produzem e consomem o MESMO
// objeto. Nada roda no engine sem passar por validarSpec: é aqui que a saída da
// IA é conferida contra o registry antes de virar cálculo.

import { getDataset, getCampo, AGREGACOES, OPERADORES } from "./datasets.js";

const LIMITE_PADRAO = 500;
const LIMITE_MAXIMO = 5000;
const TIPOS_GRAFICO = ["barra", "linha", "pizza", "area"];

// "YYYY-MM-DD" no fuso LOCAL — mesma escolha do toISODate do App.jsx: à noite no
// Brasil (UTC-3) o UTC já virou o dia seguinte e o período sairia deslocado.
function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function primeiroEUltimoDiaDoMes(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const primeiro = new Date(d.getFullYear(), d.getMonth(), 1);
  // Dia 0 do mês seguinte = último dia do mês atual (cobre fevereiro bissexto).
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de: iso(primeiro), ate: iso(ultimo) };
}

export function specVazio(datasetId, hoje = new Date()) {
  const ds = getDataset(datasetId);
  if (!ds) return null;
  const { de, ate } = primeiroEUltimoDiaDoMes(hoje);
  return {
    fonte: ds.id,
    periodo: { campo: ds.campoData, de, ate },
    filtros: [],
    agrupamento: [],
    metricas: [{ agregacao: "contagem" }],
    ordenacao: null,
    limite: LIMITE_PADRAO,
    grafico: null,
  };
}

export function colunaMetrica(metrica) {
  if (!metrica || !metrica.agregacao) return "";
  if (!metrica.campo) return metrica.agregacao;
  return `${metrica.campo}_${metrica.agregacao}`;
}

function labelAgregacao(id) {
  return (AGREGACOES.find((a) => a.id === id) || {}).label || id;
}

function fmtData(s) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("-");
  return d ? `${d}/${m}/${y}` : String(s);
}

// Valida um ReportSpec inteiro contra o registry e devolve a versão normalizada.
// Regras "duras" (fonte, campo, tipo, período, métrica) viram erro e barram a
// execução. Regras "moles" (gráfico ou ordenação inconsistente) são descartadas
// silenciosamente — não vale travar o relatório inteiro por causa do gráfico.
export function validarSpec(specEntrada) {
  const erros = [];
  const spec = specEntrada && typeof specEntrada === "object" ? { ...specEntrada } : null;
  if (!spec) return { ok: false, erros: ["Consulta vazia."], spec: null };

  const ds = getDataset(spec.fonte);
  if (!ds) {
    return { ok: false, erros: [`Fonte de dados desconhecida: "${spec.fonte}".`], spec: null };
  }

  // ─── Período (obrigatório) ───
  const p = spec.periodo;
  if (!p || !p.de || !p.ate) {
    erros.push("Período é obrigatório (data inicial e final).");
  } else {
    // Só cai back para o campo padrão se p.campo estiver ausente. Se for um string
    // desconhecido, é um erro (igual aos outros campos).
    const campoP = p.campo ? getCampo(ds.id, p.campo) : getCampo(ds.id, ds.campoData);
    if (!campoP || campoP.tipo !== "data") {
      erros.push(`Campo de data inválido no período: "${p.campo}".`);
    } else {
      spec.periodo = { campo: campoP.id, de: String(p.de), ate: String(p.ate) };
      if (spec.periodo.de > spec.periodo.ate) {
        erros.push("A data inicial do período é maior que a final.");
      }
    }
  }

  // ─── Filtros ───
  const filtros = Array.isArray(spec.filtros) ? spec.filtros : [];
  spec.filtros = [];
  for (const f of filtros) {
    const campo = getCampo(ds.id, f?.campo);
    if (!campo) { erros.push(`Campo de filtro inexistente em ${ds.label}: "${f?.campo}".`); continue; }
    const op = OPERADORES.find((o) => o.id === f.op);
    if (!op) { erros.push(`Operador de filtro desconhecido: "${f.op}".`); continue; }
    if (!op.tipos.includes(campo.tipo)) {
      erros.push(`Operador "${f.op}" não vale para o campo ${campo.label} (${campo.tipo}).`);
      continue;
    }
    spec.filtros.push({ campo: campo.id, op: op.id, valor: f.valor ?? null });
  }

  // ─── Agrupamento ───
  const agrupamento = Array.isArray(spec.agrupamento) ? spec.agrupamento : [];
  spec.agrupamento = [];
  for (const g of agrupamento) {
    const campo = getCampo(ds.id, g);
    if (!campo) { erros.push(`Campo de agrupamento inexistente: "${g}".`); continue; }
    spec.agrupamento.push(campo.id);
  }

  // ─── Métricas ───
  const metricas = Array.isArray(spec.metricas) ? spec.metricas : [];
  spec.metricas = [];
  for (const m of metricas) {
    const ag = AGREGACOES.find((a) => a.id === m?.agregacao);
    if (!ag) { erros.push(`Agregação desconhecida: "${m?.agregacao}".`); continue; }
    if (ag.id === "contagem") { spec.metricas.push({ agregacao: "contagem" }); continue; }
    const campo = getCampo(ds.id, m.campo);
    if (!campo) { erros.push(`Campo de métrica inexistente: "${m.campo}".`); continue; }
    if (!ag.tipos.includes(campo.tipo)) {
      erros.push(`Não dá para calcular ${ag.label.toLowerCase()} ("${ag.id}") sobre ${campo.label} (${campo.tipo}).`);
      continue;
    }
    spec.metricas.push({ campo: campo.id, agregacao: ag.id });
  }
  if (spec.metricas.length === 0) erros.push("Escolha ao menos uma métrica.");

  // ─── Limite ───
  const lim = Number(spec.limite);
  spec.limite = !isFinite(lim) || lim <= 0 ? LIMITE_PADRAO : Math.min(Math.floor(lim), LIMITE_MAXIMO);

  // Colunas que o resultado vai ter — base para validar ordenação e gráfico.
  const colunasResultado = [...spec.agrupamento, ...spec.metricas.map(colunaMetrica)];

  // ─── Ordenação (regra mole) ───
  if (spec.ordenacao && colunasResultado.includes(spec.ordenacao.campo)) {
    spec.ordenacao = {
      campo: spec.ordenacao.campo,
      direcao: spec.ordenacao.direcao === "asc" ? "asc" : "desc",
    };
  } else {
    spec.ordenacao = null;
  }

  // ─── Gráfico (regra mole) ───
  const g = spec.grafico;
  const serieOk = g && Array.isArray(g.series) && g.series.length > 0
    && g.series.every((s) => colunasResultado.includes(s));
  if (g && TIPOS_GRAFICO.includes(g.tipo) && spec.agrupamento.includes(g.eixoX) && serieOk) {
    spec.grafico = { tipo: g.tipo, eixoX: g.eixoX, series: [...g.series] };
  } else {
    spec.grafico = null;
  }

  return { ok: erros.length === 0, erros, spec: erros.length === 0 ? spec : null };
}

// Frase única em pt-BR descrevendo o que o relatório faz. Usada no cabeçalho do
// documento impresso, no card do relatório salvo e na confirmação do modo Pergunta.
export function resumoSpec(spec) {
  const ds = getDataset(spec?.fonte);
  if (!ds) return "Consulta inválida.";
  const partes = [ds.label];
  if (spec.periodo) partes.push(`${fmtData(spec.periodo.de)} a ${fmtData(spec.periodo.ate)}`);
  for (const f of spec.filtros || []) {
    const campo = getCampo(ds.id, f.campo);
    const op = OPERADORES.find((o) => o.id === f.op);
    const valor = Array.isArray(f.valor) ? f.valor.join(", ") : (f.valor ?? "");
    partes.push(`${campo?.label || f.campo} ${op?.label || f.op} ${valor}`.trim());
  }
  if ((spec.agrupamento || []).length) {
    partes.push("agrupado por " + spec.agrupamento
      .map((g) => getCampo(ds.id, g)?.label || g).join(" e "));
  }
  const mets = (spec.metricas || []).map((m) => (
    m.campo ? `${labelAgregacao(m.agregacao)} de ${getCampo(ds.id, m.campo)?.label || m.campo}`
            : labelAgregacao(m.agregacao)
  ));
  if (mets.length) partes.push(mets.join(", "));
  return partes.join(" · ");
}
