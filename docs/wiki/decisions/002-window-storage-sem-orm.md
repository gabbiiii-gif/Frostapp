---
title: ADR 002 — window.storage + DB layer (sem ORM)
type: decision
updated: 2026-05-10
status: aceita
sources: []
related:
  - ../concepts/db-layer.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/App.jsx#DB
---

# ADR 002 — window.storage + DB layer (sem ORM)

## Contexto

App é PWA single-file que precisa funcionar offline. Dados de cliente/OS/finance/agenda precisam persistir local + sincronizar com Supabase quando online.

## Decisão

Camada KV única (`DB.get/set/list/delete`) sobre `window.storage` (localStorage com polyfill in-memory). Valor é JSON. Sem ORM, sem schema explícito, sem Dexie/PouchDB.

## Razões

- **Multi-tenancy via prefix scoping** (`SCOPED_PREFIXES` + `rewriteSingletonKey`) é trivial em KV. Em ORM exigiria coluna `company_id` + middleware em todo query.
- **Sync com Supabase é 1:1**: mesma chave em `kv_store(key, value, company_id)`. Sem mapping objeto↔relação.
- **Schema flexível**: campos novos em entidade = adicionar no objeto. Sem migration de schema local. Trade-off real: schema implícito ⇒ bugs de "campo undefined" possíveis.
- **Audit/sync interceptáveis num lugar só** (pipeline `DB.set`).
- **Tamanho do dataset esperado** (PME): clientes < 10k, OS < 50k, fotos no Storage (não inflam KV). localStorage 5-10MB cobre.

## Trade-offs aceitos

- **Sem queries ricas**: `DB.list(prefix)` itera tudo + filtra em JS. OK até centenas de milhares de keys; não escala pra milhões.
- **Sem índices secundários**: buscar OS por cliente = scan. Hoje aceitável; se virar gargalo, criar índices manuais (`erp:idx:os-by-client:<cid>`).
- **Race entre tabs**: `setItem` é síncrono mas Realtime + write local podem colidir. Last-write-wins via `onConflict: 'key'` no Supabase + Realtime sobrescrevendo local.
- **Quota localStorage**: 5-10MB. Fotos vão pro Storage (`os-fotos`); só URLs ficam em KV. Backup local também (`erp:autoBackup:*`) consome — mantém últimas 4.

## Alternativas consideradas

- **IndexedDB direto / Dexie**: queries ricas, mas API async toca todo o app. Custo > benefício no estado atual.
- **PouchDB + CouchDB sync**: substitui Supabase. Perderia Realtime fácil, RLS, Edge Functions, Storage.
- **Supabase como source of truth + cache local**: app deixa de funcionar offline.

## Regras

- **Sempre via `DB.*`** — bypass quebra audit, scope, sync (CLAUDE.md, repete em [db-layer](../concepts/db-layer.md))
- **Errors silenciosos** (try/catch retorna `null`/`false`/`[]`) — `DB` nunca lança. Mantém UI resiliente; dificulta detectar bugs.
- **Exceção justificada**: `MasterApp` bypassa `DB.set` com `window.storage.setItem` direto porque `__activeCompanyId` é null em sessão master. Documentado em [master-tier](../concepts/master-tier.md).
