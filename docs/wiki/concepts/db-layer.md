---
title: DB Layer (window.storage + multi-tenant + audit)
type: concept
updated: 2026-05-10
sources: []
related:
  - ./supabase-sync.md
  - ./role-permissions.md
  - ../modules/settings.md
code_refs:
  - src/App.jsx:365-650
  - src/App.jsx#DB
  - src/App.jsx#recordAudit
  - src/App.jsx#ensureAutoBackup
  - src/App.jsx#migrateLegacyConfigOnce
---

# DB Layer

API única pra persistência: `DB.get / set / delete / list / listAll`. Chave-valor, JSON-serializado em `window.storage` (localStorage ou polyfill em memória). Por baixo: scope multi-tenant + audit + sync Supabase.

## Pipeline de uma escrita (`DB.set`)

```
DB.set(key, value)
  ├── rewriteSingletonKey(key)        # erp:config → erp:config:cmp_xyz
  ├── shouldAudit? → lê valor anterior (pra distinguir create/update)
  ├── isScopedKey + objeto? → injeta `companyId` no payload
  ├── window.storage.setItem(realKey, JSON)
  ├── syncToSupabase(realKey, value)  # ver supabase-sync
  └── shouldAudit? → recordAudit(action, key, value, prev)
```

`DB.delete` segue o mesmo pipeline (lê prev se auditado, remove local + remoto, registra audit "delete").

## Read paths

- `DB.get(key)` — passa por `rewriteSingletonKey` (singleton scoping transparente)
- `DB.list(prefix)` — itera `window.storage.length`, filtra por `prefix`. **Filtra por `companyId` ativa** quando prefixo é scoped.
- `DB.listAll(prefix)` — bypassa filtro de company. **Só MasterApp usa** (cross-tenant).

Registros sem `companyId` são tratados como **legados** e ficam visíveis em qualquer tenant ativo (até serem taggados).

## Multi-tenant scope

### `SCOPED_PREFIXES` (App.jsx:367)

Prefixos que pertencem a uma empresa. Lista atual:
```
erp:client:, erp:employee:, erp:os:, erp:schedule:, erp:finance:,
erp:user:, erp:webdesk:, erp:invoice:, erp:pdv:, erp:banking:,
erp:transferencia:, erp:notificacao:, erp:transaction:,
erp:inventory:, erp:product:, erp:supplier:, erp:stock:,
erp:stockMov:, erp:service:, erp:audit:, erp:autoBackup:
```

> Nota: prefixos de módulos removidos (`webdesk`, `invoice`, `pdv`, `banking`, `transferencia`, `notificacao`, `inventory`) ainda estão na lista. Não-bloqueante (filtro silencioso), mas candidato a limpeza.

### `SCOPED_SINGLETONS` (App.jsx:411)

Chaves singleton (não-listas) que precisam scoping: `erp:config`, `erp:calendarFeedToken`, `erp:lastBackup`, `erp:autoBackupMeta`.

`rewriteSingletonKey(key)` apenda `:<companyId>` quando há tenant ativo. **Bug histórico que motivou:** `erp:config` global → dados da Empresa A vazavam pra Empresa B.

### Estado global

```
__activeUser    — setActiveUser/getActiveUser (autoria do audit)
__activeCompanyId — setActiveCompanyId/getActiveCompanyId (scope de leitura/escrita)
```

Setados no login. Sem company ativa: `master:*` ou pré-login → audit é skipado, sync também.

### Migration legados

`migrateLegacyConfigOnce(companyId)` (App.jsx:420):
- Marker `erp:legacySingletonsClaimedBy` (idempotente)
- Move `erp:config`, `erp:calendarFeedToken`, etc. para `erp:<key>:<companyId>` da **primeira empresa que logar**
- Empresas criadas depois iniciam com singletons em branco
- Best-effort (try/catch silencioso)

`ensureCompanyMigration()` (App.jsx:656) cria company padrão `cmp_default` a partir de `erp:config` se não houver company. Idempotente.

## Audit trail

### `AUDITED_PREFIXES` (App.jsx:504)

```
erp:os:, erp:client:, erp:employee:, erp:finance:, erp:user:
```

### `shouldAudit(key)`

Skipa silenciosamente: `erp:audit:*` (evita loop), `master:*` (master não loga), `erp:autoBackup*`.

### `recordAudit(action, key, value, prev)` (App.jsx:521)

- `action` ∈ `create | update | delete`
- Pula se sem `__activeCompanyId` (master ou pré-login)
- `summarizeRecord(prefix, value)` faz redaction:
  - `erp:os:` → `OS <numero> — <clienteNome>`
  - `erp:client:`/`erp:employee:` → `nome`
  - `erp:user:` → `nome <email>` (sem password)
  - `erp:finance:` → `<tipo> R$<valor> — <descricao>`
- Entry: `{id, ts, action, entity, entityId, summary, userId, userNome, companyId}`
- Salva em `erp:audit:<id>` + sync Supabase
- Lido pelo [`CompanyAuditPanel`](../modules/settings.md) (admin only)

**Não bypassar `DB.set/delete`** ao mexer em entidades auditadas — write direto em `window.storage` não produz audit.

## Auto-backup

`ensureAutoBackup(companyId)` (App.jsx:448):
- Disparado em login + restore de sessão
- Throttle: 7 dias (1 semana) entre snapshots por empresa
- Mantém últimas 4 (descarta mais antigas via `erp:autoBackup:` cleanup)
- **Strip de credenciais**: `password`, `sessionTokenHash` removidos dos users no snapshot
- Snapshot inclui: clients, employees, services (OS), schedule, finance, users, config
- Meta em `erp:autoBackupMeta` ({lastTs, lastId})

## Padrões / armadilhas

- **Sempre via `DB.*`**: bypass quebra audit, scope, sync
- **Não confiar em ordem de keys** em `window.storage` — sempre filtra por prefix
- **`isScopedKey(prefix)`** vs **`isScopedKey(key)`**: ambos funcionam (prefix é literal, key começa com prefix)
- **`companyId` injetado só em objetos** — arrays e primitivos passam puros
- Erros silenciosos em todo lugar (try/catch retorna `null`/`false`/`[]`) — DB **nunca** lança. Trade-off: robustez vs detecção de bug

## Lacunas

- [a expandir] Como `__activeCompanyId` é setado/limpo no fluxo master vs erp
- [a expandir] Race conditions entre realtime sync (chega) + write local (sai) — supabase-sync trata?
