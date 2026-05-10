---
title: Cadastros (CadastroModule)
type: module
updated: 2026-05-10
sources: []
related:
  - ./process.md
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx#CadastroModule
  - src/App.jsx:7328
  - src/App.jsx:7289
---

# Cadastros (CadastroModule)

Sidebar id: `cadastro`. Módulo multi-tab que absorveu o antigo InventoryModule (estoque vive aqui).

## Tabs (`activeTab`)

| Tab | Store | Schema-chave |
|---|---|---|
| `clientes` | `erp:client:` | nome, tipo (pf/pj), cpf/cnpj, telefone, email, endereço completo, observações, status |
| `funcionarios` | `erp:employee:` | nome, cpf, rg, telefone, email, cargo, salário, dataAdmissao, status, endereço completo |
| `fornecedores` | `erp:supplier:` | EMPTY_SUPPLIER_FORM (App.jsx:7299) |
| `produtos` | `erp:product:` | EMPTY_PRODUCT_FORM (App.jsx:7306) |
| `estoque` | `erp:stock:` + `erp:stockMov:` | EMPTY_STOCK_FORM (7313); movimentações entrada/saída/ajuste |
| `servicos` | `erp:service:` | EMPTY_SERVICE_FORM (7321) |

## Constantes do domínio (App.jsx:7289-7295)

- `PRODUTO_CATEGORIAS` — Peça, Equipamento, Gás Refrigerante, Acessório, Ferramenta, Consumível, Outro
- `PRODUTO_UNIDADES` — UN, PC, CX, KG, G, L, ML, M, M², M³, PAR
- `FORNECEDOR_CATEGORIAS` — Peças, Equipamentos, Gás Refrigerante, Ferramentas, Serviços, Frete, Outros
- `SERVICO_CATEGORIAS` — Manutenção, Instalação, Limpeza, Solda, Recarga de Gás, Inspeção, Projeto, Outros
- `SERVICO_UNIDADES` — Serviço, Hora, Visita, Diária, M²
- `STOCK_MOV_TIPOS` — entrada, saida, ajuste

## Movimentação de estoque

Modal dedicado (`movModal` state). Cria entrada em `erp:stockMov:` + atualiza saldo em `erp:stock:`. Forma: `{tipo, quantidade, motivo, data}`.

OS finalizada com peças vinculadas (`produtoId+stockId`) gera saída automática — ver [Process](./process.md).

## Detail view

`detailView` + `detailTab` (`dados | ...`) — drill-in na entidade selecionada.

## Index O(1)

`productsById` (Map) evita lookup quadrático ao enriquecer estoques com dados do produto.

## Filtros

`search` global por aba — busca em nome, CPF, CNPJ, telefone, código, categoria etc (varia por aba). Sempre normaliza dígitos com `.replace(/\D/g, '')` antes de comparar documentos/telefones.

## reloadData

Prop callback do App pai — disparado após CRUD pra outros módulos rehidratarem suas listas (Process, Schedule consomem clientes/funcionários).

## Lacunas

- [a expandir] Tabs `produtos`/`estoque`/`servicos` — fluxo completo de CRUD entre 8000-9400 não documentado em detalhe
- [a expandir] `detailTab` outras abas além de `dados`
