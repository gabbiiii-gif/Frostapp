---
title: Master Tier (super-admin multi-tenant)
type: concept
updated: 2026-05-10
sources: []
related:
  - ./role-permissions.md
  - ./db-layer.md
  - ./supabase-sync.md
code_refs:
  - src/App.jsx:2725-2802
  - src/App.jsx:2802
  - src/App.jsx:2889
  - src/App.jsx:3326
  - src/App.jsx:3511
  - src/App.jsx#MasterApp
  - src/App.jsx#MasterLoginScreen
  - src/App.jsx#MasterAuditLog
  - src/supabase.js
---

# Master Tier

Camada **acima** das companies. Super-admin que cria/bloqueia/exclui empresas. Shell separado, login separado, audit log separado. **Não compartilha `ROLE_PERMISSIONS`** com o ERP normal.

## Identidade

- Prefixo: `master:user:` (constante `MASTER_PREFIX`, App.jsx:2725)
- **Local-only** (não sincroniza pro Supabase — ver [supabase-sync](./supabase-sync.md) `SENSITIVE_PREFIXES`)
- Schema do user master:
  ```js
  {
    id, nome, email, password,           // PBKDF2
    twoFactorSecret?,                    // 2FA opcional
    createdAt
  }
  ```

## Acesso

URL com `?master=1` → `App` renderiza `MasterLoginScreen` em vez de `LoginScreen`. Bootstrap: se `master:user:*` vazio → `FirstMasterSetup`.

Após login → `MasterApp`. Sem company ativa (`__activeCompanyId = null`) — master opera **cross-tenant** via `DB.listAll` (bypassa filtro de scope).

## `MasterApp` (App.jsx:2889)

Painel de empresas. Estado:
- `companies` — `DB.listAll("erp:company:")`
- Filter (all/ativa/bloqueada), search por nome/CNPJ/email
- Stats globais: total empresas/ativas/bloqueadas/usuários/OS/clientes

### Ações

| Ação | Função | Audit |
|---|---|---|
| Criar empresa + admin inicial | `handleCreateCompany` | `create_company` |
| Editar dados empresa | `handleSaveEdit` | `update_company` |
| Bloquear / reativar | `toggleAtivo` | `block_company` / `unblock_company` |
| Excluir empresa (cascata) | `handleDelete` | `delete_company` (com `registrosRemovidos`) |

### Criação de empresa

1. Validações: nome obrigatório, admin nome+email+senha (min 8 chars), email regex, conflito de email cross-tenant (`DB.listAll("erp:user:")`)
2. Cria `erp:company:<cmp_id>` com `id, nome, cnpj, telefone, email, logoUrl, maxUsuarios, ativo, criadoEm, criadoPor`
3. Cria admin inicial `erp:user:<id>` com `role: "admin"`, `forcePasswordChange: true`, `isSuperAdmin: true`, `companyId: cmp_id`
4. Audit `create_company`

> **Bypass intencional do `DB.set`**: master grava direto via `window.storage.setItem` + `syncToSupabase` manual. Razão: `DB.set` aplica scope baseado em `__activeCompanyId` ativo — master não tem company ativa. Trade-off: pula `recordAudit` automático, então `writeAudit` master tem que ser explícito.

### Exclusão em cascata (`handleDelete`)

Itera `SCOPED_PREFIXES` → para cada prefix, `DB.listAll(prefix)` → filtra `r.companyId === cid` → `DB.delete(prefix + r.id)`. Conta `registrosRemovidos` pro audit.

> **Atenção**: usa `SCOPED_PREFIXES` literal — se prefixo legado (webdesk, invoice etc) for removido sem migração, dados órfãos ficam. Hoje a lista inclui prefixos de módulos removidos justamente como defesa.

> **Confirmação dupla**: `ConfirmDialog` com `requireType={confirmDelete.nome}` — usuário precisa **digitar** o nome da empresa pra confirmar. Operação irreversível.

## `MasterAuditLog` (App.jsx:3511)

- Lê `master:audit:*` via `DB.listAll`
- Entry: `{id, ts, masterId, masterNome, action, ...payload}`
- Sync via `syncToSupabase` direto (não usa `DB.set` → sem audit recursivo)
- Modal aberto via botão "📜 Auditoria" no header do MasterApp

## Segurança — TODO crítico

`src/supabase.js` linha ~25 (e App.jsx:2714) documenta:

> `master:user:*` precisa ser local porque grava poder cross-tenant. Admin de empresa que injetasse `master:user:hack` no kv_store viraria super-admin. **TODO**: mover criação/auth de master pra Edge Function com claim JWT `is_super_admin`.

Hoje, ataque viável:
1. Admin de empresa tem XSS no app (ex: nome de cliente com `<script>`)
2. Script escreve `master:user:hack` no localStorage
3. Abre `?master=1` → loga como master → controla todas as empresas

Mitigação atual: `_h` em document generators, sanitização em inputs. Mitigação real: mover schema pra Supabase com RLS apropriado.

## Diferenças vs admin de empresa

| | Admin (role) | Master |
|---|---|---|
| Login | `LoginScreen` | `MasterLoginScreen` (`?master=1`) |
| Schema | `erp:user:` | `master:user:` |
| Sync | sim (sem secrets) | **não** (local-only) |
| Scope DB | filtra por `companyId` ativa | bypassa via `listAll` |
| Audit | `erp:audit:` | `master:audit:` |
| Permissions | `ROLE_PERMISSIONS["admin"]` | hardcoded (acesso total ao MasterApp) |
| Pode criar empresa? | não | sim |

## Padrões / armadilhas

- **Master nunca aparece em `company_members`** (Supabase) — não tem vínculo com tenant.
- **`isSuperAdmin: true` no admin inicial** ≠ master. É flag legacy/interna do `company_members.is_super_admin` carregado em `_afterAuth`. Master é orthogonal.
- **`__activeCompanyId` permanece null** durante sessão master — `recordAudit` skipa, `syncToSupabase` skipa keys scoped. Por isso master grava direto e chama sync explícito.
- **2FA do master**: enrollment funciona (mesmo helper TOTP), mas como secret é local-only, troca de device = re-enrollar.
- **`erp:company:*` não é scoped** — companies são a raiz da hierarquia, não pertencem a outra company. Por isso `MasterApp` consegue listar todas via `DB.listAll`.

## Lacunas

- [a expandir] Recovery se master perder senha — não há flow de "esqueci"
- [a expandir] Múltiplos masters? Hoje suportado pelo schema mas UI assume 1
- [a expandir] Migração planejada pra Edge Function (TODO acima) — desenho não documentado
