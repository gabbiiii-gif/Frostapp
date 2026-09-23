---
title: Financeiro
type: module
updated: 2026-09-23
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

- `dateFilter` (do header) via `filterByDate(items, "data", dateFilter)`. ⚠️ O seletor só aparece no Dashboard, ver Lacunas
- `filterType` (all|receita|despesa)
- `filterStatus`
- `filterCategory` (set dinâmico das categorias usadas)
- `search` (descrição, categoria, número)

## Atalhos

- `markAsPaid(row)` — muda status pra `pago` + grava `dataPagamento` direto da tabela.

## Categorias

- `CATEGORIES_RECEITA` e `CATEGORIES_DESPESA` (App.jsx ~151-173) — listas fixas em pt-BR. Custom categories surgem via uso.

## Lacunas

- ⚠️ **Período invisível (confirmado em 2026-09-23).** A lista e os totais usam o `dateFilter`
  global do App (padrão **30 dias**), mas a barra de período só é renderizada no Dashboard.
  Lançamento com `data` de mais de 30 dias não aparece e também não entra em "A receber" nem em
  "Atrasado". Na demo, uma receita pendente lançada há 60 dias e vencida há 50 não aparece. Contorno
  atual: mudar o período no Dashboard, porque o estado é compartilhado na sessão. A tela de OS teve o
  mesmo problema e ganhou período próprio e visível ([process](./process.md#filtros--view)). Aqui a
  escolha do padrão (Tudo ou mês corrente) é de produto, porque muda os números exibidos. O
  "Atrasado" provavelmente deveria ignorar o período, como os cards de estado atual do
  [Dashboard](./dashboard.md) `[a confirmar com o usuário]`.
- [a expandir] Relatório imprimível — código entre 4100-4380 aprox
- [a expandir] Integração com PIX (formaPagamento) — não validada
