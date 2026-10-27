---
title: Financeiro
type: module
updated: 2026-10-27
sources: []
related:
  - ../decisions/011-carga-pos-login.md
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

Em todo `loadTransactions` (abertura do módulo e depois de cada salvar/excluir):
1. Lista OS com `status ∈ {finalizado, concluido}` e lê `erp:finance:` **uma vez**
2. Roda `syncOSToFinance(os, financeAll)` para cada uma (idempotente)

Garante que app aberto antes da integração viva ainda popule transações retroativamente. **Não bypassar** — qualquer fluxo de finalização de OS deve produzir transação via `syncOSToFinance`.

**Só grava o que mudou (2026-10-27).** `recAtualizadoPelaOS` (`src/utils.js`, testado) devolve `null`
quando o REC já reflete a OS. Antes o backfill regravava os ~70 RECs a cada abertura, com `updatedAt`
novo: 70 upserts + 70 auditorias + 70 eventos Realtime por abertura — 24,8 mil auditorias "finance update"
de maio a outubro, o que deixava a carga pós-login lenta ([[../decisions/011-carga-pos-login]]).
Regras: descrição/categoria sempre acompanham a OS; REC **pago** mantém valor e data; OS sem
`dataConclusao` mantém a data já gravada (antes virava "agora" a cada abertura).

## Totais (núcleo do módulo)

Calculado por `totaisFinanceiro` (`src/lib/pagamentos.js`, coberto por Vitest). Separa **dinheiro
realizado** vs **pipeline** vs **atrasado**, com dois recortes de tempo (2026-09-23):

- **Realizado** (`receitaPaga`, `despesaPaga`, `saldoRealizado`) e `canceladosCount` seguem o
  período escolhido na tela.
- **Pipeline** (`aReceber`, `aPagar`, `*Atrasada`) é estado atual: todo saldo em aberto entra, seja
  qual for a data do lançamento. Uma conta vencida há 50 dias não deixa de ser dívida por estar fora
  dos últimos 30. Mesma lógica dos cards de estado atual do [Dashboard](./dashboard.md).
- Os dois recortes respeitam os demais filtros (tipo, status, categoria, busca).
- Com período diferente de "Tudo", um item em aberto antigo conta no card do pipeline mas não aparece
  na tabela. O cabeçalho do pipeline avisa: "em aberto hoje, independe do período".


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

- `periodo`: **local ao módulo**, padrão **Tudo**, barra "Período:" visível na linha de filtros. Recorta por `data` via `filterByDate`
- `filterType` (all|receita|despesa)
- `filterStatus`
- `filterCategory` (set dinâmico das categorias usadas)
- `search` (descrição, categoria, número)

## Atalhos

- `markAsPaid(row)` — muda status pra `pago` + grava `dataPagamento` direto da tabela.

## Categorias

- `CATEGORIES_RECEITA` e `CATEGORIES_DESPESA` (App.jsx ~151-173) — listas fixas em pt-BR. Custom categories surgem via uso.

## Lacunas

> Até 2026-09-23 a lista e **todos** os totais usavam o `dateFilter` global do App (padrão 30 dias),
> cujo seletor só aparece no Dashboard. Lançamento com mais de 30 dias sumia da tabela e de "A
> receber"/"Vencidos" sem nada na tela indicando o corte. Na demo, uma receita pendente lançada há 60
> dias e vencida há 50 não aparecia. A tela de OS tinha o mesmo problema
> ([process](./process.md#filtros--view)).

- [a expandir] Relatório imprimível — código entre 4100-4380 aprox
- [a expandir] Integração com PIX (formaPagamento) — não validada
