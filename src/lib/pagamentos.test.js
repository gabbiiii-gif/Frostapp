import { describe, it, expect } from 'vitest';
import { computePaymentState, totaisFinanceiro } from './pagamentos.js';

const HOJE = new Date('2026-07-22T12:00:00.000Z');

describe('computePaymentState', () => {
  it('legado pago sem pagamentos → quitado', () => {
    const r = computePaymentState({ valor: 100, status: 'pago' }, HOJE);
    expect(r).toMatchObject({ total: 100, valorPago: 100, saldo: 0, status: 'pago' });
  });
  it('legado pendente sem pagamentos, sem vencimento → pendente', () => {
    const r = computePaymentState({ valor: 100, status: 'pendente' }, HOJE);
    expect(r).toMatchObject({ valorPago: 0, saldo: 100, status: 'pendente' });
  });
  it('parcial (50 de 100) sem vencimento → parcial', () => {
    const r = computePaymentState({ valor: 100, status: 'pendente', pagamentos: [{ valor: 50 }] }, HOJE);
    expect(r).toMatchObject({ valorPago: 50, saldo: 50, status: 'parcial' });
  });
  it('parcial com vencimento no passado → atrasado', () => {
    const r = computePaymentState({ valor: 100, pagamentos: [{ valor: 30 }], vencimento: '2026-07-01' }, HOJE);
    expect(r.status).toBe('atrasado');
    expect(r.saldo).toBe(70);
  });
  it('pagamentos quitam o total → pago', () => {
    const r = computePaymentState({ valor: 100, pagamentos: [{ valor: 60 }, { valor: 40 }] }, HOJE);
    expect(r).toMatchObject({ valorPago: 100, saldo: 0, status: 'pago' });
  });
  it('pendente com vencimento no passado → atrasado', () => {
    const r = computePaymentState({ valor: 100, vencimento: '2026-07-01' }, HOJE);
    expect(r.status).toBe('atrasado');
  });
  it('vencimento no futuro → não atrasa', () => {
    const r = computePaymentState({ valor: 100, pagamentos: [{ valor: 10 }], vencimento: '2026-08-30' }, HOJE);
    expect(r.status).toBe('parcial');
  });
  it('cancelado permanece cancelado', () => {
    const r = computePaymentState({ valor: 100, status: 'cancelado' }, HOJE);
    expect(r.status).toBe('cancelado');
  });
});

describe('totaisFinanceiro', () => {
  const noMes = (t) => t.data >= '2026-07-01';
  const L = [
    { id: 'r1', tipo: 'receita', valor: 300, status: 'pago', data: '2026-07-10' },
    { id: 'r2', tipo: 'receita', valor: 200, status: 'pendente', data: '2026-07-15' },
    // Lançada há meses e vencida: fora do período, mas é dívida em aberto hoje
    { id: 'r3', tipo: 'receita', valor: 999, status: 'pendente', data: '2026-05-01', vencimento: '2026-05-10' },
    { id: 'r4', tipo: 'receita', valor: 100, status: 'pago', data: '2026-05-02' },
    { id: 'r5', tipo: 'receita', valor: 80, status: 'em_andamento', data: '2026-04-01' },
    { id: 'd1', tipo: 'despesa', valor: 50, status: 'pago', data: '2026-07-05' },
    { id: 'd2', tipo: 'despesa', valor: 70, status: 'pendente', data: '2026-06-01', vencimento: '2026-06-10' },
    { id: 'c1', tipo: 'receita', valor: 40, status: 'cancelado', data: '2026-07-01' },
    { id: 'c2', tipo: 'receita', valor: 40, status: 'cancelado', data: '2026-03-01' },
  ];

  it('realizado segue o período; pipeline e vencidos ignoram', () => {
    const t = totaisFinanceiro(L, noMes, HOJE);
    expect(t.receitaPaga).toBe(300);            // r4 (pago em maio) fica fora
    expect(t.despesaPaga).toBe(50);
    expect(t.saldoRealizado).toBe(250);
    expect(t.receitaAtrasada).toBe(999);        // r3 entra mesmo fora do período
    expect(t.despesaAtrasada).toBe(70);
    expect(t.aReceber).toBe(200 + 80);          // r2 pendente + r5 em andamento antigo
    expect(t.aPagar).toBe(0);
    expect(t.canceladosCount).toBe(1);          // só o cancelado do período
    expect(t.saldoPrevisto).toBe((300 + 280) - (50 + 0));
  });

  it('sem predicado de período conta tudo', () => {
    const t = totaisFinanceiro(L, undefined, HOJE);
    expect(t.receitaPaga).toBe(400);
    expect(t.canceladosCount).toBe(2);
    expect(t.receitaAtrasada).toBe(999);
  });

  it('pagamento parcial antigo: pago fica fora do período, saldo continua no pipeline', () => {
    const t = totaisFinanceiro(
      [{ tipo: 'receita', valor: 100, data: '2026-05-01', pagamentos: [{ valor: 30 }] }],
      noMes, HOJE,
    );
    expect(t.receitaPaga).toBe(0);
    expect(t.receitaPendente).toBe(70);
  });

  it('lista vazia ou ausente zera tudo', () => {
    expect(totaisFinanceiro([], noMes, HOJE)).toMatchObject({ aReceber: 0, saldoPrevisto: 0, canceladosCount: 0 });
    expect(totaisFinanceiro(undefined, noMes, HOJE).saldoRealizado).toBe(0);
  });
});
