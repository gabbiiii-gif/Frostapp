---
title: Fluxo OS — criação → técnico → aprovação admin
type: flow
updated: 2026-05-10
sources: []
related:
  - ../modules/process.md
  - ../modules/tecnico-mobile.md
  - ../modules/finance.md
  - ../concepts/role-permissions.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/App.jsx#ProcessModule
  - src/App.jsx#TecnicoMobileApp
  - src/App.jsx#TecnicoOSDetail
  - src/App.jsx#syncOSToFinance
  - src/supabase.js#subscribeToChanges
  - src/supabase.js#uploadFotoOS
---

# OS Técnico → Aprovação

Fluxo end-to-end de uma Ordem de Serviço, do cadastro pelo admin até virar entrada financeira. Toca 4 atores (admin/gerente, técnico, Supabase, finance) e é a regra de negócio mais importante do app (CLAUDE.md Regra 4).

## Atores

- **Admin/Gerente** — cria OS no `ProcessModule`, atribui técnico, revisa após finalização
- **Técnico** (`role=tecnico`) — vive no `TecnicoMobileApp`, sem sidebar do ERP
- **Supabase Realtime** — propaga atribuição/finalização entre devices
- **Finance** — recebe entrada via `syncOSToFinance` quando OS vira `finalizado`

## Status da OS

```
aguardando → em_andamento → aguardando_finalizacao → finalizado
                                ↑                         │
                                │                    syncOSToFinance
                       (técnico marca "finalizar")
```

Outros: `cancelado`, `aguardando_pecas` (pode acontecer entre `em_andamento` e `aguardando_finalizacao`).

## Etapas

### 1. Criação (admin/gerente, ERP)

- `ProcessModule` → "Nova OS"
- Campos: cliente, equipamento (marca/modelo/série/tipo), defeito relatado, técnico responsável, prazo, peças previstas, serviços previstos
- Persiste `erp:os:<id>` via `DB.set` → audit + sync Supabase
- Status inicial: `aguardando`

### 2. Atribuição → técnico recebe (Realtime)

- `tecnico_id` no payload da OS
- `TecnicoMobileApp` está subscrito a `subscribeToChanges` filtrando `company_id`
- Realtime `INSERT/UPDATE` em `erp:os:*` com `tecnico_id === currentUser.id` → re-render mostra OS nova
- Técnico vê card na lista "Minhas OS"

### 3. Chegada (técnico, mobile)

- Botão "Marcar chegada" em `TecnicoOSDetail`
- Grava `os.tecnico.chegada = new Date().toISOString()` + `status = "em_andamento"`
- `DB.set` → audit `update` + sync

### 4. Execução (técnico, mobile)

- Preenche descrição detalhada do serviço executado
- Upload de fotos via `uploadFotoOS(file, osId)` → bucket Supabase Storage `os-fotos`
- URL pública adicionada a `os.tecnico.fotos: string[]`

### 5. Finalização (técnico, mobile)

- Botão "Finalizar"
- Grava `os.tecnico.saida = new Date().toISOString()` + `status = "aguardando_finalizacao"`
- **Não** vira `finalizado` direto — espera revisão admin

### 6. Revisão (admin/gerente, ERP)

- `ProcessModule` filtro "Aguardando finalização" mostra OS prontas pra revisar
- Admin valida: descrição completa, fotos presentes, serviços/peças corretos, valor total
- Pode editar valores, adicionar peças extras, ajustar serviços
- Aprova → `status = "finalizado"`

### 7. Backfill financeiro

- Hook ao salvar `finalizado`: `syncOSToFinance(os)`
- Cria `erp:finance:<id>` com `tipo: "receita"`, `valor: os.valorTotal`, `descricao: "OS #${numero} — ${cliente}"`, `status: pendente|pago` conforme pagamento
- Idempotente: marker em `os.financeBackfilled` ou checagem por `os_id` na entry de finance pra não duplicar
- Audit `create` em `erp:finance:`

### 8. Documentos (qualquer momento após criação)

- Orçamento (botão na OS) → `generateOrcamentoHTML` → `openHTMLDoc`
- OS impressa → `generateOSHTML`
- Recibo (após `finalizado` + pago) → `generateReciboHTML`

## Gates de permissão

| Etapa | Quem pode |
|---|---|
| Criar OS | admin, gerente, atendente (perm `os`) |
| Atribuir técnico | admin, gerente |
| Marcar chegada/finalizar | técnico atribuído (próprio) |
| Aprovar `finalizado` | admin, gerente |
| Editar OS após `finalizado` | admin (gerente bloqueado) |
| Ver `ProductivityReport` | admin, gerente |

## Realtime — caminhos críticos

| Evento | Origem | Consumidor |
|---|---|---|
| Admin atribui OS a técnico | ERP write | `TecnicoMobileApp` re-renderiza lista |
| Técnico finaliza | mobile write | ERP `ProcessModule` mostra em "aguardando finalização" |
| Admin aprova | ERP write | mobile remove da lista (não é mais "minha OS pendente") |

Channel = `kv_store_${companyId}`. Troca de empresa → unsub.

## Armadilhas

- **Técnico não pode editar OS finalizada** — UI esconde botões mas backend não bloqueia. `DB.set` ainda funciona se chamado direto. Lacuna: validação no `DB.set` (ou hook).
- **Foto upload falha → OS sem evidência**: `uploadFotoOS` retry não automático. Técnico precisa re-uploadar manual. Documentar UX.
- **`syncOSToFinance` rodando 2x**: bug histórico. Hoje protegido por marker, mas mexer no fluxo de aprovação requer cuidado.
- **OS cancelada após aprovada**: não estorna entrada financeira automaticamente. Admin precisa deletar manual em Finance.
- **Permissão `os` ≠ ver OS de qualquer técnico**: `atendente` com `os` vê todas. Se quiser scope "só minhas", aplicar `customPermissions` específico (não existe gate granular hoje).
- **Realtime eco**: write local + Realtime volta com mesmo valor → no-op em geral, mas pode causar re-render desnecessário. Não é bug.

## Lacunas

- [a expandir] Tratamento de OS sem técnico atribuído (orfã) — visível em qual lista?
- [a expandir] Fluxo de "aguardando peças" — quem altera, quem destrava
- [a expandir] Edição concorrente (admin edita OS enquanto técnico está finalizando) — last-write-wins?
- [a expandir] Diff real entre `generateOrcamentoHTML` e `generateOSHTML` no contexto desse fluxo
