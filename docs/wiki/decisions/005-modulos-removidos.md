---
title: ADR 005 — Módulos removidos (Inventory, Invoice, PDV, Webdesk, Banking, MessageCenter)
type: decision
updated: 2026-05-10
status: aceita
sources: []
related:
  - ../modules/cadastro.md
  - ../concepts/document-generators.md
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx
---

# ADR 005 — Módulos removidos

## Contexto

Versões anteriores tinham 11+ módulos no sidebar. Hoje (2026-05-10) o `navItems` lista 6: Dashboard, Processos, Agenda, Financeiro, Cadastro, Configurações. CLAUDE.md anterior listava módulos que não existem mais e foi corrigido nessa data.

## Decisão

**Removidos do sidebar e do código** os seguintes módulos:

| Módulo removido | Substituído por | Razão |
|---|---|---|
| `InventoryModule` | Tab "Estoque" e "Movimentações" dentro de `CadastroModule` | UX: usuário já estava em Cadastro pra gerenciar produtos; estoque é CRUD do mesmo dado |
| `InvoiceModule` | `generateOrcamentoHTML` / `generateOSHTML` / `generateReciboHTML` (ver [document-generators](../concepts/document-generators.md)) | NF-e fora do escopo; orçamento/recibo são imprimíveis HTML, não precisam de "módulo" |
| `PDVModule` | — (sem substituto) | Caso de uso não validado com cliente; complexidade alta vs demanda |
| `WebdeskModule` | — | Mesmo: protótipo abandonado |
| `BankingModule` | — | Idem |
| `MessageCenter` | Toasts in-app + Realtime do `subscribeToChanges` | Centro de mensagens persistente não foi usado; toasts cobrem 95% |
| `NotificacaoModule` | Idem (Realtime + toasts) | — |
| `TransferenciaModule` | — | Sem demanda |

## Razões pra consolidar

- **Cada módulo no sidebar é peso cognitivo** pro usuário (admin abre 6 itens, não 11)
- **Funcionalidade duplicada**: Inventory e Cadastro mexiam nos mesmos `erp:product:*` / `erp:stock:*`
- **Manutenção**: módulo abandonado vira código morto que confunde quem lê

## Trade-offs aceitos

- **Prefixos órfãos em `SCOPED_PREFIXES`**: `erp:webdesk:`, `erp:invoice:`, `erp:pdv:`, `erp:banking:`, `erp:transferencia:`, `erp:notificacao:`, `erp:inventory:` ainda estão na lista (App.jsx:367). **Deliberado**: defesa caso algum write antigo apareça (ex: import de backup velho). Custo: lista visualmente "suja". Limpeza condicionada a confirmar que nenhum tenant tem dados desses prefixos.
- **`InventoryModule` extraction work em `constants.js`**: ainda há referências cruzadas. CLAUDE.md menciona "in-flight extraction".
- **Sem caminho de volta fácil**: se `BankingModule` voltar a fazer sentido, terá que ser re-implementado — código antigo está fora do repo.

## Regras de não-regressão

- Antes de criar um "módulo novo", verificar se cabe em Cadastro (CRUD) ou em document generators (impressão).
- Não reintroduzir nomes removidos. Se a feature precisa voltar, dar nome novo que reflete o problema atual, não o módulo histórico.
- Cliente pedindo "PDV/banco/webdesk" → entender o que ele realmente quer. Provavelmente é uma feature pequena dentro de Process ou Finance.

## Quando rever

- Cliente pagando explicitamente por um módulo removido
- Múltiplos clientes pedindo a mesma feature consolidada
- Limpeza de `SCOPED_PREFIXES`: condicionada a auditoria garantindo zero registros nos prefixos órfãos em todos os tenants

## Histórico

- Pré-2026-05-10: CLAUDE.md listava 11 módulos (defasado)
- 2026-05-10: lint do CLAUDE.md detectou e corrigiu pra 6 (ver `log.md` entry "lint | CLAUDE.md vs. App.jsx")
