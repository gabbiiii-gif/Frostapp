---
title: Financeiro
type: module
updated: 2026-05-10
sources: []
related:
  - ../concepts/db-layer.md
  - ./process.md
  - ./dashboard.md
code_refs:
  - src/App.jsx#FinanceModule
  - src/App.jsx#syncOSToFinance
  - src/App.jsx:3844
  - src/App.jsx:982
---

# Financeiro (FinanceModule)

CRUD de receitas/despesas com totais por status. Sidebar id: `financeiro`.

## Store

- `erp:finance:<id>` — uma transação por chave.

Schema da transação: `{id, numero, descricao, valor, tipo (receita|despesa), categoria, data, status (pendente|em_andamento|pago|atrasado|cancelado), formaPagamento, observacoes, osId?, createdAt, updatedAt?, dataPagamento?}`.

`numero` é gerado por `getNextNumber(prefix, items)` — prefixo `REC` para receita, `DESP` para despesa.

## Backfill OS → Finance

Em todo `loadTransactions`:
1. Lista OS com `status ∈ {finalizado, concluido}`
2. Roda `syncOSToFinance(os)` (idempotente — line 982)

Garante que app aberto antes da integração viva ainda popule transações retroativamente. **Não bypassar** — qualquer fluxo de finalização de OS deve produzir transação via `syncOSToFinance`.

## Totais (núcleo do módulo)

Acumulador `totals` separa **dinheiro realizado** vs **pipeline** vs **atrasado**:

| Campo | Definição |
|---|---|
| `receitaPaga` / `despesaPaga` | status=`pago` |
| `receitaPendente` / `despesaPendente` | status=`pendente` |
| `receitaEmAndamento` / `despesaEmAndamento` | status=`em_andamento` |
| `receitaAtrasada` / `despesaAtrasada` | status=`atrasado` |
| `saldoRealizado` | receitaPaga − despesaPaga |
| `aReceber` | pendente + em_andamento (receitas) |
| `aPagar` | pendente + em_andamento (despesas) |
| `saldoPrevisto` | (paga + aReceber) − (paga + aPagar) |
| `canceladosCount` | informativo, **nunca** entra em soma |

## Filtros

- `dateFilter` (do header) via `filterByDate(items, "data", dateFilter)`
- `filterType` (all|receita|despesa)
- `filterStatus`
- `filterCategory` (set dinâmico das categorias usadas)
- `search` (descrição, categoria, número)

## Atalhos

- `markAsPaid(row)` — muda status pra `pago` + grava `dataPagamento` direto da tabela.

## Categorias

- `CATEGORIES_RECEITA` e `CATEGORIES_DESPESA` (App.jsx ~151-173) — listas fixas em pt-BR. Custom categories surgem via uso.

## Lacunas

- [a expandir] Relatório imprimível — código entre 4100-4380 aprox
- [a expandir] Integração com PIX (formaPagamento) — não validada
