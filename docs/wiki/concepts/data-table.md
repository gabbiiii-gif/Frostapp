---
title: DataTable (componente reutilizado)
type: concept
updated: 2026-05-10
sources: []
related:
  - ../modules/cadastro.md
  - ../modules/process.md
  - ../modules/finance.md
code_refs:
  - src/App.jsx:1571-1750
  - src/App.jsx#DataTable
---

# DataTable

Componente único pra todas as tabelas listáveis do ERP. Usado em Cadastro (várias tabs), OS, Finance, UserManagement, AuditPanel.

## Contrato

```js
<DataTable
  columns={[
    { key, label, sortable?, render?(row), className? },
    ...
  ]}
  rows={[]}
  rowKey={(row) => row.id}    // default: row.id
  perPage={10}                // padrão atual
  emptyMessage?
  actions?(row)               // render coluna de ações inline
  initialSort?: { key, dir: "asc"|"desc" }
/>
```

## Comportamento

- **Sort**: clica header com `sortable: true` → toggle asc/desc/off. Comparação numérica se valor é número, senão `localeCompare` (pt-BR).
- **Pagination**: `perPage=10` default. Footer com `‹ 1 / N ›` + count total. Reset pra página 1 quando `rows` muda de tamanho.
- **Render custom**: `render(row)` opcional. Sem render → `String(row[col.key])`.
- **Acessibilidade**: `<table>` com `<thead>/<tbody>`, headers clicáveis viram `<button>`, `aria-sort` no header ativo.
- **Responsivo**: container com `overflow-x-auto`. Não há modo "card mobile" — tabela larga rola horizontal.

## Padrões / armadilhas

- **`rowKey` precisa ser estável**. Default `row.id` funciona pra entidades persistidas; pra arrays sem ID (linhas calculadas) passar índice **não** é seguro se `rows` muda — vai re-mountar tudo.
- **Sort não persiste entre re-renders se `rows` muda referência** — passe `useMemo` no consumer pra evitar reset.
- **`actions`** é uma coluna implícita à direita — não definir em `columns`.
- **Filtro** não está dentro do DataTable. Consumer filtra `rows` antes de passar (geralmente combinado com `SearchInput` + `DateFilterBar` acima).
- Print: tabela respeita `@media print` do `StyleSheet` global — header/footer escondidos, sem paginação visual (CSS `tr { page-break-inside: avoid }`).

## Quando NÃO usar

- Listas com cards visuais ricos (ex: cards de empresa no `MasterApp`) — usa grid manual.
- Listas mobile do técnico (`TecnicoMobileApp`) — usa lista própria com touch targets grandes.

## Lacunas

- [a expandir] Comportamento de sort em campos `null`/`undefined` (vão pro fim ou início?)
- [a expandir] Não há export CSV built-in — feature pedida várias vezes
