// Fechamento mensal — o retrato congelado de um mês encerrado.
//
// Por que existe: o Dashboard mostra o mês CORRENTE e, na virada, zera. Sem
// nenhum registro, o que aconteceu em julho some da tela no dia 1º de agosto e
// só dá pra reconstruir garimpando OS e lançamentos um a um. O fechamento grava
// o resumo do mês fechado numa chave própria (`erp:fechamento:<AAAA-MM>`), que
// nasce imutável e vira fonte consultável no módulo Relatórios.
//
// Módulo PURO de propósito (nada de DB, window ou Supabase aqui): é o que
// permite testar as regras de fronteira de mês em Vitest. Quem persiste é
// `ensureFechamentoMensal` em App.jsx.

import {
  STATUS_OS_CONCLUIDAS,
  STATUS_OS_ENCERRADAS_SEM_SERVICO,
} from "../constants.js";

// Versão do formato do snapshot. Se o conteúdo mudar de forma incompatível,
// suba aqui — fechamentos antigos continuam legíveis pelo número que carregam.
export const FECHAMENTO_VERSAO = 1;

// Quantos meses para trás vale a pena varrer ao procurar buracos. Cobre a
// primeira execução numa base com histórico sem varrer a idade do universo.
export const FECHAMENTO_MESES_RETROATIVOS = 24;

// "2026-07" a partir de um Date (fuso local, igual ao resto do app).
export function chaveMes(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Primeiro instante e último instante de um mês "AAAA-MM", no fuso local.
// Julho de 2026 → 01/07 00:00:00.000 até 31/07 23:59:59.999. O fim é calculado
// como "dia 0 do mês seguinte", que é o último dia real — evita a armadilha de
// assumir 30/31 dias e de fevereiro bissexto.
export function limitesDoMes(mes) {
  const [ano, m] = String(mes).split("-").map(Number);
  const inicio = new Date(ano, m - 1, 1, 0, 0, 0, 0);
  const fim = new Date(ano, m, 0, 23, 59, 59, 999);
  return { inicio, fim };
}

// O mês já terminou por completo em relação a `agora`?
// Só mês encerrado vira fechamento — snapshot de mês em curso mentiria.
export function mesEncerrado(mes, agora) {
  return limitesDoMes(mes).fim.getTime() < agora.getTime();
}

// Lista os meses que ainda precisam de fechamento: todos os encerrados dentro
// da janela retroativa que ainda não têm registro. Do mais antigo pro mais novo.
export function mesesAFechar(agora, jaFechados = [], meses = FECHAMENTO_MESES_RETROATIVOS) {
  const existentes = new Set(jaFechados);
  const pendentes = [];
  for (let i = meses; i >= 1; i--) {
    const d = new Date(agora.getFullYear(), agora.getMonth() - i, 1);
    const mes = chaveMes(d);
    if (!existentes.has(mes) && mesEncerrado(mes, agora)) pendentes.push(mes);
  }
  return pendentes;
}

// Um registro cai dentro do mês? Data ausente ou inválida = fora.
function dentroDoMes(valor, inicio, fim) {
  if (!valor) return false;
  const t = new Date(valor).getTime();
  return Number.isFinite(t) && t >= inicio.getTime() && t <= fim.getTime();
}

function soma(lista, campo = "valor") {
  return lista.reduce((acc, r) => acc + (Number(r?.[campo]) || 0), 0);
}

// Agrupa somando por chave, devolvendo objeto simples {chave: total}.
function totalPor(lista, chave, campoValor = "valor") {
  const out = {};
  lista.forEach((r) => {
    const k = String(r?.[chave] || "—");
    out[k] = (out[k] || 0) + (Number(r?.[campoValor]) || 0);
  });
  return out;
}

function contarPor(lista, chave) {
  const out = {};
  lista.forEach((r) => {
    const k = String(r?.[chave] || "—");
    out[k] = (out[k] || 0) + 1;
  });
  return out;
}

// Monta o snapshot de um mês. `agora` entra só como carimbo de geração.
//
// Regra de atribuição: OS conta em "abertas" pelo mês da ABERTURA e em
// "concluídas" pelo mês da CONCLUSÃO. Uma OS aberta em junho e finalizada em
// julho é abertura de junho e produção de julho — é assim que o dono lê o mês.
export function montarFechamento({
  mes,
  serviceOrders = [],
  transactions = [],
  clients = [],
  agora = new Date(),
}) {
  const { inicio, fim } = limitesDoMes(mes);

  const abertas = serviceOrders.filter((os) => dentroDoMes(os?.dataAbertura, inicio, fim));
  const concluidas = serviceOrders.filter(
    (os) => STATUS_OS_CONCLUIDAS.includes(os?.status) && dentroDoMes(os?.dataConclusao, inicio, fim),
  );
  // Encerradas sem serviço: contam pelo mês de abertura, já que cancelamento
  // não grava data própria.
  const semServico = abertas.filter((os) => STATUS_OS_ENCERRADAS_SEM_SERVICO.includes(os?.status));

  const lancamentos = transactions.filter((t) => dentroDoMes(t?.data, inicio, fim));
  const pagas = lancamentos.filter((t) => t?.status === "pago");
  const receitas = pagas.filter((t) => t?.tipo === "receita");
  const despesas = pagas.filter((t) => t?.tipo === "despesa");
  const aReceber = lancamentos.filter((t) => t?.tipo === "receita" && t?.status !== "pago");

  const receitaTotal = soma(receitas);
  const despesaTotal = soma(despesas);
  const valorConcluidas = soma(concluidas);

  const porTecnico = contarPor(
    concluidas.filter((os) => String(os?.tecnicoNome || "").trim()),
    "tecnicoNome",
  );

  return {
    // id/mes iguais: a chave do kv_store é `erp:fechamento:<mes>`.
    id: mes,
    mes,
    versao: FECHAMENTO_VERSAO,
    inicio: inicio.toISOString(),
    fim: fim.toISOString(),
    // `data` existe pro registry de Relatórios ter um campo de data padrão
    // para filtrar período (campoData). Aponta pro 1º dia do mês fechado.
    data: inicio.toISOString(),
    geradoEm: agora.toISOString(),

    osAbertas: abertas.length,
    osConcluidas: concluidas.length,
    osCanceladas: semServico.length,
    osPorStatus: contarPor(abertas, "status"),
    valorConcluidas,
    ticketMedio: concluidas.length ? valorConcluidas / concluidas.length : 0,

    receita: receitaTotal,
    despesas: despesaTotal,
    saldo: receitaTotal - despesaTotal,
    aReceber: soma(aReceber),
    receitaPorCategoria: totalPor(receitas, "categoria"),
    despesaPorCategoria: totalPor(despesas, "categoria"),

    clientesNovos: clients.filter((c) => dentroDoMes(c?.createdAt, inicio, fim)).length,
    concluidasPorTecnico: porTecnico,
    tecnicoDestaque:
      Object.entries(porTecnico).sort((a, b) => b[1] - a[1])[0]?.[0] || "",
  };
}

// Um mês sem nenhum movimento não merece registro — arquivo cheio de meses
// zerados só atrapalha quem consulta depois.
export function fechamentoTemMovimento(f) {
  if (!f) return false;
  return (
    (f.osAbertas || 0) > 0 ||
    (f.osConcluidas || 0) > 0 ||
    (f.receita || 0) > 0 ||
    (f.despesas || 0) > 0 ||
    (f.clientesNovos || 0) > 0
  );
}
