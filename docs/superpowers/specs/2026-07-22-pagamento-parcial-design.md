# Design — Pagamento parcial com saldo (Financeiro)

**Data:** 2026-07-22
**Escopo:** Mudança #2. Pagamentos parciais flexíveis num a-receber, com saldo devedor e vencimento opcional.

## Decisões (brainstorm)
- **Pagamentos parciais flexíveis + saldo:** um lançamento acumula vários pagamentos; sistema calcula saldo.
- **Vencido → só marca "Atrasado" + mostra** (sem envio automático).
- **Registrar no Financeiro** (funciona pra qualquer OS, inclusive antigas).
- **Vencimento sempre opcional.**

## Modelo
Lançamento `erp:finance:` ganha:
- `pagamentos: [{ id, valor, data, forma }]` — parciais, cada um com forma (pix/dinheiro/…).
- `vencimento` (ISO date, opcional) — prazo do saldo restante.

Derivados (função pura, não armazenados): `valorPago = Σ pagamentos`, `saldo = valor − valorPago`.

Status derivado (`computePaymentState`):
- `cancelado` se `status==='cancelado'`.
- `pago` se `saldo ≤ 0`.
- senão, se `vencimento` passou → `atrasado`.
- senão `parcial` (se algo pago) ou `pendente` (nada pago).

**Retrocompat:** entradas legadas sem `pagamentos` derivam de `status` (pago→valorPago=total; senão 0).

## UI (FinanceModule)
- Coluna de status reflete `pago/parcial/pendente/atrasado` (atrasado destacado).
- Mostra saldo/vencimento nas receitas com saldo.
- Botão **"Registrar pagamento"** (substitui/complementa "Marcar como pago"): modal com valor (default=saldo), forma, data → adiciona a `pagamentos`. Quando saldo zera, vira `pago`.
- Campo **vencimento** editável no lançamento (form de edição).
- Totais: `valorPago` conta como realizado; `saldo` como a-receber; atrasado destacado.

## Testes
`src/lib/pagamentos.js` (`computePaymentState`) coberto por `src/lib/pagamentos.test.js` (TDD): legado pago/pendente, parcial, parcial+vencido, quitado, pendente+vencido, cancelado.

## Fora de escopo
Cobrança automática (WhatsApp), parcelamento fixo (Nx), relatório de inadimplência dedicado.
