// Engine de relatórios — puro. Recebe arrays já carregados pelo módulo e devolve
// o resultado agregado. NÃO conhece window.storage, DB nem React: é o que
// permite testá-lo direto no Vitest e trocar a origem dos dados no futuro.

import { getCampo } from "./datasets.js";

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
