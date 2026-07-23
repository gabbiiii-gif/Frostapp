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
