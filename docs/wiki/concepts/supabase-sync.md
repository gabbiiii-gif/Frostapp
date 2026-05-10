---
title: Supabase Sync (auth, kv_store, RLS, Realtime, Storage)
type: concept
updated: 2026-05-10
sources: []
related:
  - ./db-layer.md
  - ../modules/tecnico-mobile.md
  - ../modules/settings.md
code_refs:
  - src/supabase.js
  - src/App.jsx#ensureAutoBackup
  - api/calendar.js
---

# Supabase Sync

`src/supabase.js` é a camada de cloud. Auth via Supabase Auth, dados em `public.kv_store` (RLS por `company_id`), Realtime, Storage (`os-fotos`), Edge Functions (`migrate-login`, `admin-create-user`).

**Sem `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY`** → cliente é `null`, app roda 100% local. Logs no console marcam status.

## Configuração

```js
createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
})
```

Sessão persiste em localStorage; após signIn JWT vai em todas as requests; RLS no Postgres aplica isolamento.

## Auth

### `signInWithFallback(email, password)`

1. Tenta `supabase.auth.signInWithPassword` (usuários já migrados)
2. Falha → chama Edge Function `migrate-login` (valida hash PBKDF2 legado, cria em `auth.users`)
3. Retenta signIn
4. Erros traduzidos pra mensagens pt-BR (`user_not_found`, `invalid_password`)

### `_afterAuth(session)`

Carrega `company_members`:
```sql
SELECT user_id, company_id, role, is_super_admin, legacy_user_id,
       custom_permissions, status, nome, avatar
FROM company_members
WHERE user_id = <session.user.id>
```

- Sem vínculo → `"Usuário sem vínculo com empresa. Contate o administrador."`
- `status != "ativo"` → signOut + `"Usuário inativo."`
- Sucesso → `setCurrentMember(member)` (cache em `frost_session_member`)

### `ensureMemberLoaded()`

Restaura `_currentMember` após reload (sessão persiste mas member state cai com a aba).

### `signOutSupabase()` / `adminCreateUser({...})`

Logout limpa member + signOut. `adminCreateUser` chama Edge Function `admin-create-user` autenticada com Bearer do admin (cria membro vinculado à mesma company).

## kv_store + sync

Tabela:
```
public.kv_store(key text, value jsonb, company_id uuid, updated_at timestamptz)
PRIMARY KEY (key)  -- onConflict: 'key'
```

RLS exige `company_id` em toda mutação.

### `syncToSupabase(key, value)` — chamada por `DB.set`

- Skipa se sem cliente, se `isSensitive(key)`, se sem `companyId`
- `sanitizeForSync(key, value)` strip de campos sensíveis
- `upsert({key, value, company_id, updated_at})` com `onConflict: 'key'`
- Fire-and-forget (não bloqueia DB local)

### `deleteFromSupabase(key)` — chamada por `DB.delete`

`.delete().eq('key', key).eq('company_id', companyId)` — duplo eq evita deletar key de outra empresa por engano.

### `hydrateFromSupabase()` — chamada no login

Supabase é **fonte de verdade**:
1. SELECT * WHERE company_id = atual
2. Lista keys `erp:*` locais que **não estão** no remoto → remove (exceto sensitive, `erp:seeded`, `erp:lastBackup`)
3. Sobrescreve local com remoto (skipa sensitive — não apaga password do device)

### `uploadAllToSupabase()` — usado em backup/restore

Upserta em batches de 500. Usa `sanitizeForSync`.

## Sensitivity / sanitization

### `SENSITIVE_PREFIXES` (chaves nunca sincronizadas)

```
erp:autoBackup:  — backups locais (não duplica no kv_store)
master:user:     — master mode é local-only por design de segurança
```

> Comentário no código (line 25-30): `master:user:*` precisa ser local porque grava poder cross-tenant. Admin de empresa que injetasse `master:user:hack` no kv_store viraria super-admin. **TODO** documentado: mover criação/auth de master pra Edge Function com claim JWT `is_super_admin`.

### `USER_SECRET_FIELDS` (sanitizados em `erp:user:*` antes de subir)

```
password, sessionTokenHash, twoFactorSecret, twoFactorBackupCodes
```

Permite sync de metadados de user (nome, email, role, status) cross-device sem expor credenciais.

## Realtime

### `subscribeToChanges(onDataChanged)`

```js
supabase.channel(`kv_store_${companyId}`)
  .on('postgres_changes', {
    event: '*', schema: 'public', table: 'kv_store',
    filter: `company_id=eq.${companyId}`
  }, payload => {
    INSERT/UPDATE → window.storage.setItem
    DELETE        → window.storage.removeItem
    onDataChanged({ eventType, key }) → consumer faz sync incremental
  })
  .subscribe()
```

Retorna `unsub` (`removeChannel`).

**Consumidor principal**: [`TecnicoMobileApp`](../modules/tecnico-mobile.md) — re-render quando ERP atribui nova OS.

## Storage (bucket `os-fotos`)

Bucket **público**. Path: `<osId>/<ts>_<random>.<ext>`.

### `uploadFotoOS(file, osId)`

`upsert: false`, `cacheControl: '3600'`, retorna `publicUrl`.

### `deleteFotoOS(publicUrl)`

Extrai path do URL via marker `/os-fotos/`, chama `storage.remove([path])`.

Regra obrigatória (CLAUDE.md Regra 4): qualquer feature de OS preserva esse fluxo.

## Edge Functions referenciadas

- `migrate-login` — valida hash PBKDF2 legado + cria em auth.users
- `admin-create-user` — admin cria membro novo vinculado à company

Não estão no repo (vivem no projeto Supabase). Mudar contrato → atualizar ambos.

## Order of ops no boot

```
ensureMemberLoaded → setCurrentMember → setActiveCompanyId/User
  → ensureCompanyMigration → migrateLegacyConfigOnce
  → hydrateFromSupabase   ← Supabase é source of truth
  → ensureAutoBackup      ← cria snapshot semanal se devido
  → subscribeToChanges    ← Realtime liga
```

## Padrões / armadilhas

- **Fire-and-forget**: `syncToSupabase` não bloqueia. Falha → log warn + dado fica só local; próximo `uploadAllToSupabase` recupera.
- **Race entre Realtime e write local**: Realtime sobrescreve local com `setItem`. Se write local acabou de acontecer e o eco volta via Realtime → no-op (mesmo valor).
- **Escopo do channel = companyId**: troca de empresa → unsub + nova `subscribeToChanges`.
- **`isSensitive` é por chave inteira; `sanitizeForSync` é por campo dentro do valor.** Não confundir.

## Lacunas

- [a expandir] Schema completo de `company_members` e `kv_store` (RLS policies)
- [a expandir] Tratamento de conflito quando 2 abas escrevem mesmo key (`onConflict: 'key'` resolve no DB, mas qual ganha?)
- [a expandir] Edge Functions: input/output exato
