---
title: Ordens de Serviço (ProcessModule)
type: module
updated: 2026-08-27
sources: []
related:
  - ./cadastro.md
  - ./schedule.md
  - ./finance.md
  - ./tecnico-mobile.md
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx#ProcessModule
  - src/App.jsx#syncOSToFinance
  - src/App.jsx#ProductivityReport
  - src/App.jsx:5021
  - src/App.jsx:982
  - src/App.jsx:10690
  - src/App.jsx:4385
---

# Ordens de Serviço (ProcessModule)

Coração do app. Sidebar id: `processos`. Cliente, técnico, agendamento, serviços, peças, status, fotos, geração de docs, integração com Finance/Schedule/Tecnico.

## Store

- `erp:os:<id>` — OS completa.

Schema (parcial): `{id, numero, clienteId, clienteNome, endereco, tecnicoId, tecnicoNome, dataAgendada, horaAgendada, dataAbertura, dataConclusao?, descricao, observacoes, status, valorTotal, servicos[], pecas[], fotos[], descricaoTecnico?, tecnico: {chegada?, saida?}}`.

## Catálogos integrados

Carregados de `erp:product:`, `erp:stock:`, `erp:service:` (vindos do [Cadastro](./cadastro.md)). Servem aos pickers da OS:
- Serviço cadastrado → preenche linha de "Serviço"
- Produto cadastrado → preenche linha de "Peça/Material" + valida saldo de estoque
- Indexes `productById`, `stockByProductId` evitam lookup O(N×M)

## Fluxo de status

```
STATUS_FLOW = ["aguardando", "em_deslocamento", "em_execucao", "finalizado"]
```

Sem `faturado` — Finance é alimentado direto por `syncOSToFinance` quando status entra em `finalizado`/`concluido`.

Para OS criadas no ERP, status inicial = `aguardando`.

## Servicos[] e Pecas[]

OS pode ter **múltiplos serviços**, cada um com seu equipamento (não é mais um único equipamento na OS). Cada serviço: `{servicoId?, tipo, descricao, valor, equipamentoTipo, equipamentoModelo, equipamentoCapacidade}`.

Peças: `{produtoId?, stockId?, nome, quantidade, valorUnit}`. Quando `produtoId+stockId` preenchidos → **baixa automática no estoque** ao salvar.

`valorTotalForm` = Σ valor servicos + Σ (qtd × valorUnit) pecas. Reativo via useMemo.

## Cadastro rápido de cliente

`quickClientOpen` modal: cliente novo direto da OS sem sair do fluxo. Salva em `erp:client:`, atualiza lista local, auto-seleciona na OS atual, chama `reloadData()` se passado.

## Revisão de OS finalizadas pelo técnico

`reviewing` state: admin/gerente revisa OS com status `aguardando_finalizacao` (vindas do [TecnicoMobile](./tecnico-mobile.md)) e aprova → status vira `finalizado`. Regra obrigatória — ver CLAUDE.md Regra 4.

## Productividade

`ProductivityReport` (line 10690) — modal acessível via `showProdutividade`. Relatório mensal por técnico, **sempre disponível** para admin/gerente (Regra 4).

## Geração de documentos

Botões abrem `generateOrcamentoHTML(os, clients)`, `generateOSHTML(os, clients)`, `generateReciboHTML(os, clients)` → `openHTMLDoc(html)` (App.jsx:4385–4910). Substituiu o antigo InvoiceModule.

## Filtros / view

- `viewMode = lista | (outros)` — ver código
- `filterStatus`, `filterTecnico`, `filterCliente`, `search`
- `dateFilter` do header

## Lacunas

- [a expandir] Upload de fotos (`fotos[]`) → bucket Supabase `os-fotos` — tratado em [tecnico-mobile](./tecnico-mobile.md)
- [a expandir] viewMode != "lista" não documentado

## Equipe de técnicos (atualização 2026-08-27)

Uma OS — e um agendamento — pode ter **mais de um técnico**.

### Modelo

- `os.tecnicos` = `[{ id, nome }]` — a equipe, na ordem de escalação.
- `os.tecnicoId` / `os.tecnicoNome` — continuam existindo e apontam para o
  **primeiro da lista** (o responsável, ★ na interface).

O campo antigo foi mantido de propósito: **não houve migração de dados**. As OS
anteriores, o feed iCal (`api/calendar.js`), o e-mail de OS criada e os
documentos impressos leem o responsável e seguem funcionando. Quem precisa da
equipe inteira usa os helpers.

### Helpers (`src/utils.js`, testados)

| Helper | Para quê |
| --- | --- |
| `osTecnicos(os)` | A equipe normalizada. OS antiga vira lista de um. **Leia sempre por aqui**, nunca do campo direto. |
| `osTecnicoNomes(os)` | `"Ana, Beto"` para tabela, busca e documento |
| `osTemTecnico(os, id, nome)` | Este técnico está escalado? Casa por id e, como rede, por nome |
| `camposTecnicos(equipe)` | Devolve `{ tecnicos, tecnicoId, tecnicoNome }` já sincronizados para gravar |

### Consequências espalhadas

- **App do técnico** (Regra 4): a OS aparece para **todos** os escalados — na
  lista, no gate de "é minha OS" e no push. Antes só o responsável via.
- **Agenda**: o conflito de horário bate se **qualquer** técnico da equipe já
  estiver ocupado, e a mensagem diz quem.
- **Produtividade** (`ProductivityReport`): a OS conta para cada técnico, mas o
  **valor é rateado em partes iguais**. Creditar o total cheio a cada um faria a
  soma da tela passar do faturamento real. O total do cabeçalho conta OS
  distintas, senão o trabalho em dupla contaria duas vezes.
- **`notify-os-created`**: avisa todos os escalados. O helper `equipeTecnicos`
  ali **espelha** `osTecnicos` — se um mudar, o outro precisa mudar junto, senão
  o e-mail lista gente diferente de quem vê a OS.

> A Agenda ganhou equipe também, mas o resto do sistema (dashboard, relatórios)
> ainda lê `tecnicoNome` do agendamento, ou seja, só o responsável.
