// ─── Lógica pura do app mobile (FrostERP Mobile) ────────────────────────────
// Derivações usadas pelas telas do celular: status → tom de cor, agenda
// unificada (OS + agendamentos), resumo de OS, estoque baixo, agrupamento do
// Financeiro e horários livres. Sem JSX e sem acesso ao DB — as telas passam as
// listas já lidas. Coberto por src/mobile/dados.test.js.

import { toISODate, filterByDate, osTecnicos, osTemTecnico } from "../utils.js";
import { computePaymentState, totaisFinanceiro } from "../lib/pagamentos.js";
import {
  STATUS_OS_EM_ANDAMENTO,
  STATUS_OS_PENDENTES,
  STATUS_OS_EM_REVISAO,
  STATUS_OS_CONCLUIDAS,
  STATUS_OS_ENCERRADAS_SEM_SERVICO,
} from "../constants.js";

// ─── Status da OS → rótulo curto + tom (classe de cor do design) ─────────────
// Tons: info (azul), cyan, warn (amarelo), org (laranja), ok (verde), bad, mute.
const STATUS_OS_VISUAL = {
  aguardando: { label: "Aguardando", tom: "warn" },
  pendente: { label: "Pendente", tom: "warn" },
  agendado: { label: "Agendado", tom: "cyan" },
  confirmado: { label: "Confirmado", tom: "info" },
  em_deslocamento: { label: "Em deslocamento", tom: "cyan" },
  em_execucao: { label: "Em execução", tom: "info" },
  em_servico: { label: "Em serviço", tom: "info" },
  em_andamento: { label: "Em andamento", tom: "info" },
  aguardando_finalizacao: { label: "Em revisão", tom: "org" },
  finalizado: { label: "Finalizado", tom: "ok" },
  concluido: { label: "Concluído", tom: "ok" },
  cancelado: { label: "Cancelado", tom: "bad" },
  nao_autorizada: { label: "Não autorizada", tom: "bad" },
};

export function visualStatusOS(status) {
  return STATUS_OS_VISUAL[status] || { label: status || "—", tom: "mute" };
}

// Fluxo linear que o admin avança pelo celular (igual ao STATUS_FLOW do
// ProcessModule). "aguardando_finalizacao" fica fora: a revisão do técnico
// passa pela tela de revisão do ERP (Regra 4 do CLAUDE.md).
export const FLUXO_OS = ["aguardando", "em_deslocamento", "em_execucao", "finalizado"];

// Posição da OS no stepper do detalhe (0..3). Status fora do fluxo caem no passo
// mais próximo: pendentes → 0, em andamento → 2, revisão/concluída → 3.
export function passoFluxoOS(status) {
  const i = FLUXO_OS.indexOf(status);
  if (i >= 0) return i;
  if (STATUS_OS_PENDENTES.includes(status)) return 0;
  if (status === "em_servico" || status === "em_andamento") return 2;
  if (STATUS_OS_EM_REVISAO.includes(status) || STATUS_OS_CONCLUIDAS.includes(status)) return 3;
  return 0;
}

// Próximo status do fluxo ou null (já finalizada, em revisão, cancelada…).
export function proximoStatusOS(status) {
  if (STATUS_OS_EM_REVISAO.includes(status)) return null;
  if (STATUS_OS_CONCLUIDAS.includes(status) || STATUS_OS_ENCERRADAS_SEM_SERVICO.includes(status)) return null;
  const passo = passoFluxoOS(status);
  return FLUXO_OS[passo + 1] || null;
}

// ─── Datas ───────────────────────────────────────────────────────────────────
// dataAgendada é gravada como "AAAA-MM-DDT00:00:00.000Z" a partir do dia local
// escolhido; o slice preserva esse dia (new Date() deslocaria 3 h para trás).
export function diaAgendadoOS(os) {
  // dataPrevista: OS antigas/seed usam esse campo (o sino do desktop também lê).
  const d = os?.dataAgendada || os?.dataPrevista;
  if (!d) return null;
  return String(d).slice(0, 10);
}

const DIAS_SEMANA = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
const DIAS_CURTOS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SÁB"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const MESES_CURTOS = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export function saudacao(agora = new Date()) {
  const h = agora.getHours();
  if (h < 12) return "Bom dia";
  if (h < 18) return "Boa tarde";
  return "Boa noite";
}

// "Terça, 27 de outubro · 14:12"
export function dataLonga(agora = new Date()) {
  const hh = String(agora.getHours()).padStart(2, "0");
  const mm = String(agora.getMinutes()).padStart(2, "0");
  return `${DIAS_SEMANA[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]} · ${hh}:${mm}`;
}

export function nomeMes(mesIndex) {
  return MESES[mesIndex] || "";
}

// "AAAA-MM-DD" → Date local (meia-noite)
export function dataLocal(iso) {
  return new Date(String(iso).slice(0, 10) + "T00:00:00");
}

export function somarDias(iso, n) {
  const d = dataLocal(iso);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

// Rótulo de dia relativo: "Hoje", "Amanhã", "Ontem" ou "qui, 29/10".
export function rotuloDia(iso, hoje = toISODate(new Date())) {
  if (iso === hoje) return "Hoje";
  if (iso === somarDias(hoje, 1)) return "Amanhã";
  if (iso === somarDias(hoje, -1)) return "Ontem";
  const d = dataLocal(iso);
  return `${DIAS_CURTOS[d.getDay()].toLowerCase()}, ${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Semana (segunda a domingo) que contém o dia informado.
export function semanaDe(iso) {
  const d = dataLocal(iso);
  const deslocamento = (d.getDay() + 6) % 7; // segunda = 0
  const segunda = somarDias(iso, -deslocamento);
  return Array.from({ length: 7 }, (_, i) => {
    const dia = somarDias(segunda, i);
    const dd = dataLocal(dia);
    return { iso: dia, curto: DIAS_CURTOS[dd.getDay()], numero: dd.getDate() };
  });
}

// Grade do mês (semanas começando na segunda). Dias de fora do mês = null.
export function gradeMes(ano, mes) {
  const primeiro = new Date(ano, mes, 1);
  const vazios = (primeiro.getDay() + 6) % 7;
  const total = new Date(ano, mes + 1, 0).getDate();
  const celulas = [];
  for (let i = 0; i < vazios; i++) celulas.push(null);
  for (let d = 1; d <= total; d++) celulas.push(toISODate(new Date(ano, mes, d)));
  while (celulas.length % 7 !== 0) celulas.push(null);
  return celulas;
}

export function diaEMesCurto(iso) {
  const d = dataLocal(iso);
  return { dia: String(d.getDate()).padStart(2, "0"), mes: MESES_CURTOS[d.getMonth()] };
}

// "AAAA-MM-DD" → "DD/MM/AAAA"
export function isoParaBR(iso) {
  if (!iso) return "";
  const [a, m, d] = String(iso).slice(0, 10).split("-");
  return `${d}/${m}/${a}`;
}

// Tempo relativo curto para notificações e conversas: "há 12 min", "há 3 h", "ontem".
export function tempoRelativo(dataISO, agora = new Date()) {
  if (!dataISO) return "";
  const diff = agora - new Date(dataISO);
  if (Number.isNaN(diff)) return "";
  const min = Math.floor(diff / 60000);
  if (min < 1) return "agora";
  if (min < 60) return `há ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `há ${h} h`;
  const dias = Math.floor(h / 24);
  if (dias === 1) return "ontem";
  return `há ${dias} dias`;
}

// Nomes da equipe ("Ana, Beto") ou "" quando não há técnico. Diferente de
// osTecnicoNomes (utils.js), que devolve "—" para exibir em tabela.
export function nomesEquipe(os) {
  return osTecnicos(os).map((t) => t.nome).filter(Boolean).join(", ");
}

// ─── Texto ───────────────────────────────────────────────────────────────────
export function iniciais(nome) {
  const partes = String(nome || "").trim().split(/\s+/).filter((p) => /^[\p{L}\d]/u.test(p));
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 2).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

export function normalizar(txt) {
  return String(txt || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

// Busca tolerante a acento em vários campos; dígitos casam com telefone/CPF formatado.
export function casaBusca(termo, ...campos) {
  const t = normalizar(termo).trim();
  if (!t) return true;
  const soDigitos = t.replace(/\D/g, "");
  return campos.some((c) => {
    if (c == null) return false;
    if (normalizar(c).includes(t)) return true;
    return soDigitos.length >= 3 && String(c).replace(/\D/g, "").includes(soDigitos);
  });
}

// Linha de serviço da OS: "Manutenção · Split 12.000 BTUs"
export function resumoServicoOS(os) {
  const s = Array.isArray(os?.servicos) && os.servicos.length > 0 ? os.servicos[0] : null;
  const tipo = os?.tipo || s?.tipo || "Serviço";
  const equip = [s?.equipamentoModelo || os?.equipamentoModelo, s?.equipamentoCapacidade || os?.equipamentoCapacidade]
    .filter(Boolean)
    .join(" ");
  return equip ? `${tipo} · ${equip}` : tipo;
}

// ─── Agenda unificada (OS + agendamentos) ────────────────────────────────────
// Mesmo critério do ScheduleModule: OS cancelada sai; OS sem data agendada usa a
// data de abertura. Diferença: no celular a OS mostra a horaAgendada real.
function horaMais(hhmm, minutos) {
  const [h, m] = String(hhmm || "09:00").split(":").map((n) => parseInt(n, 10) || 0);
  const total = Math.min(23 * 60 + 59, h * 60 + m + minutos);
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
}

export function itensAgenda(osList, agendamentos) {
  const itens = [];
  for (const os of osList || []) {
    if (!os || STATUS_OS_ENCERRADAS_SEM_SERVICO.includes(os.status)) continue;
    let dia = diaAgendadoOS(os);
    let inicio = os.horaAgendada || "";
    if (!dia) {
      if (!os.dataAbertura) continue;
      const d = new Date(os.dataAbertura);
      dia = toISODate(d);
      inicio = inicio || `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
    }
    const tecnicos = nomesEquipe(os);
    const vis = visualStatusOS(os.status);
    itens.push({
      id: "os-" + os.id,
      origem: "os",
      osId: os.id,
      dia,
      inicio,
      fim: inicio ? horaMais(inicio, 60) : "",
      cliente: os.clienteNome || "—",
      sub: [os.numero, os.tipo, tecnicos].filter(Boolean).join(" · "),
      semTecnico: !tecnicos,
      status: os.status,
      tom: vis.tom,
      ref: os,
    });
  }
  for (const a of agendamentos || []) {
    if (!a || a.status === "cancelado" || !a.data) continue;
    const dia = String(a.data).slice(0, 10);
    const inicio = String(a.data).includes("T") ? String(a.data).slice(11, 16) : "";
    const fim = a.dataFim && String(a.dataFim).includes("T") ? String(a.dataFim).slice(11, 16) : "";
    const tecnicos = nomesEquipe(a);
    itens.push({
      id: "ag-" + a.id,
      origem: "agenda",
      dia,
      inicio,
      fim,
      cliente: a.clienteNome || a.titulo || "—",
      sub: [a.tipo, tecnicos].filter(Boolean).join(" · "),
      semTecnico: !tecnicos,
      status: a.status,
      tom: "warn",
      ref: a,
    });
  }
  return itens.sort((x, y) => (x.dia + (x.inicio || "99")).localeCompare(y.dia + (y.inicio || "99")));
}

export function itensDoDia(itens, dia) {
  return (itens || []).filter((i) => i.dia === dia);
}

// Dias (ISO) que têm pelo menos um item — alimenta os pontinhos do calendário.
export function diasComItens(itens) {
  return new Set((itens || []).map((i) => i.dia));
}

// ─── Horários para o formulário "Agendar" ────────────────────────────────────
// Faixa padrão de 08:00 a 18:00 de hora em hora. Um horário fica ocupado quando
// o técnico escolhido já tem item que cruza aquela hora (mesma regra de conflito
// do ScheduleModule: intervalos que se sobrepõem).
export const HORARIOS_PADRAO = ["08:00", "09:00", "10:00", "11:00", "13:00", "14:00", "15:00", "16:00", "17:00", "18:00"];

function emMinutos(hhmm) {
  const [h, m] = String(hhmm || "0:0").split(":").map((n) => parseInt(n, 10) || 0);
  return h * 60 + m;
}

export function horariosDoDia(itens, dia, tecnicoId, duracaoMin = 60) {
  const doTecnico = (itens || []).filter(
    (i) => i.dia === dia && i.inicio && tecnicoId && osTemTecnico(i.ref, tecnicoId),
  );
  return HORARIOS_PADRAO.map((hora) => {
    const ini = emMinutos(hora);
    const fim = ini + duracaoMin;
    const ocupado = doTecnico.some((i) => {
      const a = emMinutos(i.inicio);
      const b = i.fim ? emMinutos(i.fim) : a + 60;
      return ini < b && fim > a;
    });
    return { hora, ocupado };
  });
}

export function cargaDoTecnico(itens, dia, tecnicoId) {
  return (itens || []).filter((i) => i.dia === dia && tecnicoId && osTemTecnico(i.ref, tecnicoId)).length;
}

// ─── Ordens de Serviço ───────────────────────────────────────────────────────
export function resumoOS(osList) {
  const r = { pendentes: 0, andamento: 0, revisao: 0, concluidas: 0, abertas: 0, semTecnico: 0 };
  for (const os of osList || []) {
    const s = os?.status;
    if (STATUS_OS_PENDENTES.includes(s)) r.pendentes++;
    else if (STATUS_OS_EM_ANDAMENTO.includes(s)) r.andamento++;
    else if (STATUS_OS_EM_REVISAO.includes(s)) r.revisao++;
    else if (STATUS_OS_CONCLUIDAS.includes(s)) r.concluidas++;
    const aberta = STATUS_OS_PENDENTES.includes(s) || STATUS_OS_EM_ANDAMENTO.includes(s) || STATUS_OS_EM_REVISAO.includes(s);
    if (aberta) {
      r.abertas++;
      if (!nomesEquipe(os) && STATUS_OS_PENDENTES.includes(s)) r.semTecnico++;
    }
  }
  return r;
}

// Abas da lista: ativas (pendentes + em andamento), revisao, historico (encerradas).
export function abaDaOS(os) {
  const s = os?.status;
  if (STATUS_OS_EM_REVISAO.includes(s)) return "revisao";
  if (STATUS_OS_CONCLUIDAS.includes(s) || STATUS_OS_ENCERRADAS_SEM_SERVICO.includes(s)) return "historico";
  return "ativas";
}

// Filtros rápidos (chips): todos | hoje | semana | semTecnico
export function filtrarOS(osList, { aba = "ativas", busca = "", chip = "todos", hoje = toISODate(new Date()) } = {}) {
  const semana = new Set(semanaDe(hoje).map((d) => d.iso));
  const lista = (osList || []).filter((os) => {
    if (abaDaOS(os) !== aba) return false;
    const dia = diaAgendadoOS(os);
    if (chip === "hoje" && dia !== hoje) return false;
    if (chip === "semana" && !semana.has(dia)) return false;
    if (chip === "semTecnico" && nomesEquipe(os)) return false;
    return casaBusca(busca, os.numero, os.clienteNome, os.tipo, nomesEquipe(os));
  });
  // Ativas: as agendadas mais cedo primeiro (o que vem a seguir no dia).
  // Revisão/histórico: mais recentes primeiro.
  if (aba === "ativas") {
    return lista.sort((a, b) => {
      const ka = (diaAgendadoOS(a) || "9999") + (a.horaAgendada || "99");
      const kb = (diaAgendadoOS(b) || "9999") + (b.horaAgendada || "99");
      return ka.localeCompare(kb);
    });
  }
  const ref = (os) => os.dataConclusao || os.updatedAt || os.dataAbertura || "";
  return lista.sort((a, b) => String(ref(b)).localeCompare(String(ref(a))));
}

// Quantas OS estão em cada aba (para os rótulos "Ativas · 9").
export function contagemAbasOS(osList) {
  const c = { ativas: 0, revisao: 0, historico: 0 };
  for (const os of osList || []) c[abaDaOS(os)]++;
  return c;
}

// ─── Dashboard ───────────────────────────────────────────────────────────────
// Períodos do Dashboard mobile → chaves do filterByDate (utils.js).
export const PERIODOS_DASH = [
  { id: "hoje", label: "Hoje" },
  { id: "7dias", label: "7 dias" },
  { id: "30dias", label: "30 dias" },
  { id: "90dias", label: "90 dias" },
];

export function rotuloPeriodo(id) {
  return { hoje: "hoje", "7dias": "7 dias", "30dias": "30 dias", "90dias": "90 dias" }[id] || id;
}

// KPIs de OS do período: abertas (por data de abertura), concluídas (por data
// de conclusão), em andamento agora e aguardando início (estado atual).
export function kpisOS(osList, periodo) {
  const filtro = { period: periodo };
  const lista = osList || [];
  const abertas = filterByDate(lista, "dataAbertura", filtro).filter(
    (os) => !STATUS_OS_ENCERRADAS_SEM_SERVICO.includes(os.status),
  ).length;
  const concluidas = filterByDate(
    lista.filter((os) => STATUS_OS_CONCLUIDAS.includes(os.status) && os.dataConclusao),
    "dataConclusao",
    filtro,
  ).length;
  const r = resumoOS(lista);
  return { abertas, concluidas, andamento: r.andamento, pendentes: r.pendentes, revisao: r.revisao };
}

// Concluídas por semana do mês corrente (semanas de segunda a domingo).
// Ex.: outubro/2026 → 1–4, 5–11, 12–18, 19–25, 26–31.
export function concluidasPorSemana(osList, hoje = new Date()) {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const total = new Date(ano, mes + 1, 0).getDate();
  const semanas = [];
  let atual = null;
  for (let d = 1; d <= total; d++) {
    const dt = new Date(ano, mes, d);
    if (!atual || dt.getDay() === 1) {
      atual = { ini: d, fim: d, n: 0 };
      semanas.push(atual);
    }
    atual.fim = d;
  }
  for (const os of osList || []) {
    if (!STATUS_OS_CONCLUIDAS.includes(os?.status) || !os.dataConclusao) continue;
    const dt = new Date(os.dataConclusao);
    if (dt.getFullYear() !== ano || dt.getMonth() !== mes) continue;
    const s = semanas.find((w) => dt.getDate() >= w.ini && dt.getDate() <= w.fim);
    if (s) s.n++;
  }
  const dia = hoje.getDate();
  return semanas.map((w) => ({
    label: w.ini === w.fim ? String(w.ini) : `${w.ini}–${w.fim}`,
    n: w.n,
    atual: dia >= w.ini && dia <= w.fim,
  }));
}

// ─── Estoque ─────────────────────────────────────────────────────────────────
// Junta produto (erp:product:) com o saldo (erp:stock:). Produto sem estoque
// cadastrado aparece com saldo null (não entra no alerta de mínimo).
export function produtosComEstoque(produtos, estoques) {
  const porProduto = new Map();
  for (const s of estoques || []) if (s?.produtoId) porProduto.set(s.produtoId, s);
  return (produtos || [])
    .filter((p) => p && p.status !== "inativo")
    .map((p) => {
      const stk = porProduto.get(p.id) || null;
      const saldo = stk ? Number(stk.saldo) || 0 : null;
      const minimo = stk ? Number(stk.estoqueMinimo) || 0 : 0;
      return { produto: p, estoque: stk, saldo, minimo, nivel: nivelEstoque(saldo, minimo) };
    })
    .sort((a, b) => {
      const ordem = { bad: 0, warn: 1, ok: 2, sem: 3 };
      return ordem[a.nivel] - ordem[b.nivel] || String(a.produto.nome).localeCompare(String(b.produto.nome));
    });
}

// bad: zerado ou até 1/3 do mínimo · warn: abaixo/igual ao mínimo · ok · sem (sem estoque cadastrado)
export function nivelEstoque(saldo, minimo) {
  if (saldo == null) return "sem";
  if (minimo <= 0) return saldo <= 0 ? "warn" : "ok";
  if (saldo <= 0 || saldo * 3 <= minimo) return "bad";
  if (saldo <= minimo) return "warn";
  return "ok";
}

export function estoqueBaixo(produtos, estoques) {
  return produtosComEstoque(produtos, estoques).filter((i) => i.nivel === "bad" || (i.nivel === "warn" && i.minimo > 0));
}

export function valorEmEstoque(itens) {
  return (itens || []).reduce((acc, i) => acc + (i.saldo > 0 ? i.saldo * (Number(i.produto.precoCusto) || 0) : 0), 0);
}

// ─── Financeiro ──────────────────────────────────────────────────────────────
// Resumo do período (realizado) + pipeline atual, pela mesma regra do módulo
// Financeiro do desktop (totaisFinanceiro em src/lib/pagamentos.js).
export function resumoFinanceiro(lancamentos, periodo, hoje = new Date()) {
  const noPeriodo = new Set(filterByDate(lancamentos || [], "data", { period: periodo }));
  const t = totaisFinanceiro(lancamentos || [], (l) => noPeriodo.has(l), hoje);
  let qtdReceber = 0;
  let qtdPagar = 0;
  let vencReceber = 0;
  let vencPagar = 0;
  for (const l of lancamentos || []) {
    if (!l || l.status === "cancelado") continue;
    const { status, saldo } = computePaymentState(l, hoje);
    if (saldo <= 0) continue;
    if (status === "atrasado") {
      if (l.tipo === "receita") vencReceber++; else vencPagar++;
    } else if (l.tipo === "receita") qtdReceber++;
    else qtdPagar++;
  }
  return {
    receitaPaga: t.receitaPaga,
    despesaPaga: t.despesaPaga,
    saldo: t.saldoRealizado,
    aReceber: t.aReceber,
    aPagar: t.aPagar,
    vencidos: t.receitaAtrasada + t.despesaAtrasada,
    qtdReceber,
    qtdPagar,
    vencReceber,
    vencPagar,
  };
}

// Data de referência do lançamento: vencimento (quando há) ou data.
export function diaDoLancamento(l) {
  return String(l?.vencimento || l?.data || "").slice(0, 10);
}

export function diasDeAtraso(l, hoje = toISODate(new Date())) {
  const venc = diaDoLancamento(l);
  if (!venc) return 0;
  return Math.max(0, Math.round((dataLocal(hoje) - dataLocal(venc)) / 86400000));
}

// Grupos da lista do Financeiro, na ordem de prioridade do celular:
// Vencidos → Hoje → Próximos (em aberto) → Pagos recentemente.
// filtro: todos | receber | pagar | vencidos
export function gruposFinanceiro(lancamentos, filtro = "todos", hoje = new Date(), limitePagos = 15) {
  const hojeIso = toISODate(hoje);
  const grupos = { vencidos: [], hoje: [], proximos: [], pagos: [] };
  for (const l of lancamentos || []) {
    if (!l || l.status === "cancelado") continue;
    if (filtro === "receber" && l.tipo !== "receita") continue;
    if (filtro === "pagar" && l.tipo !== "despesa") continue;
    const est = computePaymentState(l, hoje);
    const item = { ...est, lancamento: l, dia: diaDoLancamento(l) };
    if (filtro === "vencidos" && est.status !== "atrasado") continue;
    if (est.status === "atrasado") grupos.vencidos.push(item);
    else if (est.status === "pago") {
      if (filtro === "todos" || filtro === "receber" || filtro === "pagar") grupos.pagos.push(item);
    } else if (item.dia === hojeIso) grupos.hoje.push(item);
    else grupos.proximos.push(item);
  }
  grupos.vencidos.sort((a, b) => a.dia.localeCompare(b.dia));
  grupos.hoje.sort((a, b) => b.saldo - a.saldo);
  grupos.proximos.sort((a, b) => a.dia.localeCompare(b.dia));
  const refPago = (i) => String(i.lancamento.dataPagamento || i.lancamento.updatedAt || i.lancamento.data || "");
  grupos.pagos.sort((a, b) => refPago(b).localeCompare(refPago(a)));
  grupos.pagos = grupos.pagos.slice(0, limitePagos);
  return [
    { id: "vencidos", titulo: "Vencidos", itens: grupos.vencidos },
    { id: "hoje", titulo: "Hoje", itens: grupos.hoje },
    { id: "proximos", titulo: "Em aberto", itens: grupos.proximos },
    { id: "pagos", titulo: "Pagos recentemente", itens: grupos.pagos },
  ].filter((g) => g.itens.length > 0);
}

// ─── Notificações ────────────────────────────────────────────────────────────
// As notificações vêm do motor do App (computedNotifications). Aqui só o
// visual: tom e ícone por módulo/tipo.
export function visualNotificacao(n) {
  const icone = { processos: "os", financeiro: "financeiro", ia: "ia", cadastro: "estoque", agenda: "agenda" }[n?.module] || "sino";
  const tom = n?.type === "danger" ? "bad" : n?.type === "warning" ? "warn" : "info";
  return { icone, tom };
}

// ─── Entrada de valores ──────────────────────────────────────────────────────
// "R$ 1.234,56" | "1234,56" | "1234.56" | "650" → número. Vazio/inválido → 0.
export function lerValor(txt) {
  let s = String(txt ?? "").replace(/[^\d,.-]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  else if ((s.match(/\./g) || []).length > 1) s = s.replace(/\./g, "");
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : 0;
}
