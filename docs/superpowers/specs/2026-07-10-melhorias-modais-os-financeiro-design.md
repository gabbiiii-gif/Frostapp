# Design — Melhorias: Modais, OS com quantidade, Financeiro (fornecedor + despesas fixas/parceladas)

**Data:** 2026-07-10
**Autor:** Claude (aprovado pelo usuário)

## Contexto

FrostERP é um app React single-file (`src/App.jsx`, ~14k linhas). Quatro melhorias solicitadas pelo cliente, todas tocando módulos existentes. Sem router, dados em `window.storage` via camada `DB` (company-scoped), sync opcional Supabase.

## 1. Modais não fecham ao clicar fora

**Problema:** componente `Modal` central (`src/App.jsx` — função `Modal`) fecha ao clicar no backdrop (`onClick` em `e.target === e.currentTarget`), perdendo todos os dados do formulário.

**Solução:** remover o `onClose()` do clique no backdrop. Fechamento passa a ocorrer só por: botão **X** do cabeçalho, botões **Cancelar**, ou após **salvar**. Tecla **Esc** é mantida (ação deliberada de teclado, não clique acidental).

**Impacto:** corrige todos os forms que usam `<Modal>` de uma vez (OS, Transação, Cliente, Funcionário, Fornecedor, Produto, Estoque, Serviço, Agenda).

## 2. Quantidade por serviço na OS

**Modelo:** cada item em `os.servicos[]` ganha campo `quantidade` (padrão 1). O campo `valor` passa a ser **valor unitário**; subtotal da linha = `valor × quantidade`. Retrocompatível: OS antigas sem `quantidade` assumem 1, então `valor × 1 = valor` (sem mudança de total).

**UI (form OS):** card de serviço ganha campo **Qtd** e exibe **subtotal da linha**.

**Cálculos atualizados:**
- `valorTotalForm` (subtotal reativo do form) → `valor × qtd`.
- `handleSave`: `servicosLimpos` grava `quantidade`; `totalServicos` → `valor × qtd`.
- `openEdit`: lê `quantidade` (default 1).

**Documentos HTML:** `generateOrcamentoHTML` e `generateOSHTML` — tabela de serviços passa a exibir Qtd + Valor unit. + Subtotal.

## 3. Fornecedor na despesa (Financeiro)

Form de transação ganha campo **Fornecedor**, exibido só quando `tipo === "despesa"`, populado da lista `erp:supplier:` (Cadastro) + opção "— Nenhum —". Grava `fornecedorId` + `fornecedorNome`. Exibido na tabela do Financeiro.

## 4. Despesas fixas mensais e parceladas

Quando `tipo === "despesa"`, seletor **Modo**: `avulsa` | `parcelada` | `fixa`.

- **Avulsa:** 1 transação (comportamento atual).
- **Parcelada:** campo Nº de parcelas (≥2). Valor informado = **total**; gera N despesas mensais a partir do vencimento (`data`), valor = `total ÷ N` com a **última parcela absorvendo o resto** do arredondamento. Descrição recebe sufixo "(i/N)". Agrupadas por `parcelamentoId`.
- **Fixa mensal (recorrente):** salva template em `erp:despesa_recorrente:<id>` com `{descricao, fornecedorId, fornecedorNome, valor, diaVencimento, categoria, formaPagamento, ativo, mesInicio, mesesGerados[]}`. A função `materializeRecurringExpenses()` roda ao abrir o Financeiro (junto ao backfill de OS já existente em `loadTransactions`) e cria as despesas dos meses ainda não gerados, do mês de início até o mês atual. **Idempotente e à prova de exclusão**: rastreia `mesesGerados[]` (formato `YYYY-MM`), então excluir uma instância materializada não a ressuscita, e reabrir o Financeiro não duplica.
- **Gestão:** painel "Despesas fixas recorrentes" no Financeiro para ativar/desativar/excluir templates (necessário para parar uma recorrência).

## Helpers puros + testes (convenção do repo)

Em `src/utils.js` com Vitest:
- `splitParcelas(total, n)` → array de N valores em centavos-corretos, última absorve o resto.
- `mesesAMaterializar(mesInicio, mesAtual, mesesGerados)` → lista de `YYYY-MM` a criar.
- `addMonthsISO(dateISO, n)` / helper de vencimento mensal preservando o dia.

## Fora de escopo (YAGNI)

- Cron/backend real (Opção B) — descartado; materialização client-side cobre o caso de uso.
- Edição em lote de parcelas já geradas (cada uma é transação normal, editável/excluível individual).

## Deploy

Repo ainda não é git. Ao final: `git init` em `Frostapp-main/`, remote `github.com/gabbiiii-gif/Frostapp.git`, commit e push. Confirmar antes de qualquer operação destrutiva.
