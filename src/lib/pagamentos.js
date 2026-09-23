// src/lib/pagamentos.js
// Lógica pura de pagamento parcial de um lançamento financeiro (erp:finance:).
// Calcula quanto foi pago, o saldo devedor e o status derivado, de forma
// retrocompatível com lançamentos antigos (que só tinham `status` + `valor`).

// Um lançamento vencido é aquele cujo `vencimento` (data ISO, opcional) já
// passou — comparado pelo fim do dia do vencimento, para não marcar como
// atrasado no próprio dia do prazo.
function isOverdue(entry, today) {
  if (!entry?.vencimento) return false;
  const v = new Date(entry.vencimento);
  if (Number.isNaN(v.getTime())) return false;
  v.setHours(23, 59, 59, 999);
  return v.getTime() < new Date(today).getTime();
}

// Retorna { total, valorPago, saldo, status }.
// status ∈ 'pago' | 'parcial' | 'pendente' | 'atrasado' | 'cancelado'.
export function computePaymentState(entry, today = new Date()) {
  const total = Number(entry?.valor) || 0;
  const pagamentos = Array.isArray(entry?.pagamentos) ? entry.pagamentos : [];

  let valorPago;
  if (pagamentos.length > 0) {
    valorPago = pagamentos.reduce((s, p) => s + (Number(p?.valor) || 0), 0);
  } else {
    // Retrocompat: sem lista de pagamentos, deriva do status legado.
    valorPago = entry?.status === 'pago' ? total : 0;
  }
  const saldo = Math.max(0, total - valorPago);

  let status;
  if (entry?.status === 'cancelado') {
    status = 'cancelado';
  } else if (saldo <= 0.005) { // tolerância a centavo de arredondamento
    status = 'pago';
  } else if (isOverdue(entry, today)) {
    status = 'atrasado';
  } else if (valorPago > 0) {
    status = 'parcial';
  } else {
    status = 'pendente';
  }

  return { total, valorPago, saldo, status };
}

// Totais do módulo Financeiro. Dois recortes de propósito:
// - REALIZADO (receita/despesa paga, saldo em caixa) e contagem de cancelados
//   seguem o período escolhido na tela — é o fluxo daquele intervalo;
// - PIPELINE (a receber, a pagar, vencidos) é estado atual: todo saldo em aberto
//   entra, não importa a data do lançamento. Uma conta vencida há 50 dias não
//   deixa de ser dívida por estar fora dos últimos 30 dias.
// `dentroDoPeriodo(t)` diz se o lançamento está no período (padrão: todos).
// Cancelado nunca entra em soma; "em andamento" entra inteiro no pipeline.
export function totaisFinanceiro(lancamentos, dentroDoPeriodo = () => true, today = new Date()) {
  const acc = {
    receitaPaga: 0, receitaPendente: 0, receitaEmAndamento: 0, receitaAtrasada: 0,
    despesaPaga: 0, despesaPendente: 0, despesaEmAndamento: 0, despesaAtrasada: 0,
    canceladosCount: 0,
  };
  for (const t of lancamentos || []) {
    const isReceita = t?.tipo === 'receita';
    const noPeriodo = dentroDoPeriodo(t);
    if (t?.status === 'cancelado') {
      if (noPeriodo) acc.canceladosCount += 1;
      continue;
    }
    if (t?.status === 'em_andamento') {
      const v = Number(t.valor) || 0;
      if (isReceita) acc.receitaEmAndamento += v; else acc.despesaEmAndamento += v;
      continue;
    }
    const { valorPago, saldo, status } = computePaymentState(t, today);
    // Realizado = pagamentos efetivos (inclui parciais), só dentro do período.
    if (noPeriodo) {
      if (isReceita) acc.receitaPaga += valorPago; else acc.despesaPaga += valorPago;
    }
    // Saldo em aberto vai para pendente ou atrasado (conforme vencimento).
    if (saldo > 0) {
      if (status === 'atrasado') {
        if (isReceita) acc.receitaAtrasada += saldo; else acc.despesaAtrasada += saldo;
      } else {
        if (isReceita) acc.receitaPendente += saldo; else acc.despesaPendente += saldo;
      }
    }
  }
  // Saldo realizado (em caixa): receita paga - despesa paga
  acc.saldoRealizado = acc.receitaPaga - acc.despesaPaga;
  // A receber / a pagar (pipeline): pendente + em andamento
  acc.aReceber = acc.receitaPendente + acc.receitaEmAndamento;
  acc.aPagar = acc.despesaPendente + acc.despesaEmAndamento;
  // Previsão de saldo: tudo que não foi cancelado nem está atrasado
  acc.saldoPrevisto = (acc.receitaPaga + acc.aReceber) - (acc.despesaPaga + acc.aPagar);
  return acc;
}
