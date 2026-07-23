import { describe, it, expect } from 'vitest';
import { computePaymentState } from './pagamentos.js';

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
