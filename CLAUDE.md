# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Princípio operacional:** Este projeto adota o padrão **LLM Wiki** (ver seção [Wiki do Projeto](#wiki-do-projeto-padrão-llm-wiki)). O conhecimento sobre o código, decisões, fluxos de negócio e fontes brutas é mantido em `docs/wiki/` por Claude — não pelo humano. O usuário curadoriza fontes e faz perguntas; Claude faz o bookkeeping (resumir, cruzar referências, manter consistência). Antes de responder qualquer pergunta de domínio ou implementar uma feature não-trivial, leia `docs/wiki/index.md` primeiro.

---

## Build & Dev Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build (output in `dist/`)
- `npm run preview` — Preview production build locally
- `npm run test` — Run Vitest test suite (one-shot)
- `npm run test:watch` — Vitest in watch mode
- No linter is configured.

## Tech Stack

- **React 19** with JSX (no TypeScript)
- **Vite 6** as bundler with `@vitejs/plugin-react` and **`vite-plugin-pwa`** (the app is installable as a PWA)
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin (imported in `src/index.css`)
- **Recharts** for charts/graphs in the Dashboard and Finance reports
- **Supabase** (`@supabase/supabase-js`) — cloud sync + Realtime + Storage backend via `src/supabase.js`
- **Motion** (`motion`) — animation library used in `src/BlurText.jsx`
- **anime.js** (`animejs`) — used by `src/AnimatedLogo.jsx` and `src/AnimatedSnowflake.jsx`
- **OGL** (`ogl`) — WebGL library used in `src/Aurora.jsx` for the login background
- **qrcode** — generates QR codes (TOTP/2FA enrollment, calendar feed, etc.)
- **Vitest** + `@testing-library/react` + `happy-dom` — unit tests for pure utils (`src/utils.test.js`)
- No router library — navigation is state-driven within a single component (`activeModule` useState)

## Architecture

FrostERP is an effectively-single-file React app. The vast majority of the UI lives in `src/App.jsx` (~12.228 lines as of 2026-05-10). A few pieces have been extracted to enable unit testing and reuse:

- `src/constants.js` — exported constants (`STATUS_MAP`, `COLORS`, `VIDEO_EXT_RE`, etc.). Note: some of these constants are also still inlined in `App.jsx` — there is in-flight extraction work.
- `src/utils.js` — pure utilities (`genId`, `genSecureToken`, `sha256Hex`, `formatCurrency`, …). Covered by `src/utils.test.js`.
- `src/supabase.js` — cloud sync layer (see [Supabase Sync Layer](#supabase-sync-layer-srcsupabasejs)).
- `src/main.jsx` — Vite entry point.
- `src/Aurora.jsx`, `src/BlurText.jsx`, `src/AnimatedLogo.jsx`, `src/AnimatedSnowflake.jsx`, `src/FrostIcons.jsx` — visual/animation components.
- `src/equipment-catalog.json`, `src/products-seed.json`, `src/services-seed.json` — seed data for first-run demo.
- `api/calendar.js` — Vercel serverless function that exposes the user's agenda as an iCal feed (consumed by Google Calendar / Outlook via the Calendar Feed token).

Everything else — modules, dialogs, dashboards, the master/admin shell, the technician mobile shell — lives in `App.jsx`.

### Key structural sections in App.jsx (in order)

Line numbers are approximate and drift on every edit. When in doubt, grep for the function name.

| Lines        | What                                                                                         |
| ------------ | -------------------------------------------------------------------------------------------- |
| 1–110        | `ModuleSwitcher`, `ModuleErrorBoundary` (crossfade + crash isolation between modules), video URL helpers |
| 110–290      | Constants: `COLORS`, `STATUS_MAP`, `ROLE_PERMISSIONS`, revenue/expense categories, `PAYMENT_METHODS`, `EQUIPMENT_TYPES`, `SERVICE_TYPES_OS` |
| 365–500      | **Multi-tenant scope**: `SCOPED_PREFIXES`, `SCOPED_SINGLETONS`, active user/company tracking (`getActiveCompanyId`), legacy migration (`migrateLegacyConfigOnce`, `ensureCompanyMigration`), `ensureAutoBackup` |
| 500–650      | **Audit trail**: `AUDITED_PREFIXES`, `recordAudit` (records mutations to a per-company audit log) |
| 544–650      | **DB layer**: `DB.get/set/delete/list` (window.storage-backed, scoped/audited/synced) |
| 700–960      | Utilities still inline: `genId`, `genSecureToken`, formatters, `filterByDate`, **TOTP/2FA** (`generateTotpSecret`, `base32Encode/Decode`, `buildOtpAuthUri`), legacy password hashing |
| 982          | `syncOSToFinance` — bridges service-order completion into finance entries |
| 1030         | `ALL_MODULES` (canonical list of UI modules) and `hasPermission` |
| 1069–1350    | `purgeAllUsers`, `seedServiceCatalog`, `seedProductCatalog` (first-run demo data) |
| 1355         | `StyleSheet` (injected global CSS — animations + `@media print` rules) |
| 1437–2090    | **Base UI primitives**: `Modal`, `Toast`/`ToastContainer`, `StatusBadge`, `KPICard`, `DataTable` (sort/filter/pagination), `DateFilterBar`, `SearchInput`, `Combobox`, `ConfirmDialog`, `EmptyState`, `LoadingSkeleton` |
| 2087–2107    | Login attempt throttling (`frost_login_attempts`) |
| 2108         | `LoginScreen` — regular user login |
| 2484         | `ForcePasswordChangeDialog` |
| 2575         | `FirstUserSetup` — first-run admin bootstrap |
| 2725–2802    | **Master tier setup**: `MASTER_PREFIX`, `FirstMasterSetup` |
| 2802         | `MasterLoginScreen` — separate login for the master/super-admin tier |
| 2889         | `MasterApp` — admin shell for managing companies/tenants (separate from the ERP shell) |
| 3326         | `LogoPicker` |
| 3511         | `MasterAuditLog` |
| 3564         | **`Dashboard`** — KPIs, charts, recent activity (replaces what used to be its own module) |
| 3844         | **`FinanceModule`** — revenue/expenses with printable reports |
| 4385–4910    | **HTML document generators**: `openHTMLDoc`, plus `generateOrcamentoHTML`, `generateOSHTML`, `generateReciboHTML` and shared blocks (`_docHeader`, `_clienteBlock`, `_pixBlock`, …). These open a print-styled HTML document in a new window — they replaced the old "InvoiceModule" pattern |
| 5021         | **`ProcessModule`** — Ordens de Serviço (OS) — the heart of the app |
| 6548         | **`ScheduleModule`** — Agenda |
| 7289–7327    | Cadastro form constants (produtos, fornecedores, serviços, estoque) |
| 7328         | **`CadastroModule`** — Clients, employees, products, suppliers, services, **stock movements** (the old "InventoryModule" got folded in here) |
| 9446         | `UserManagement` — sub-panel of Settings |
| 9843         | `CalendarFeedPanel` — sub-panel of Settings (manages the iCal token consumed by `api/calendar.js`) |
| 9931         | `CompanyAuditPanel` — sub-panel of Settings (reads the audit log) |
| 10021        | `AutoBackupPanel` — sub-panel of Settings |
| 10105        | **`SettingsModule`** — orchestrates the sub-panels above plus app config and data backup/restore |
| 10690        | `ProductivityReport` — monthly per-technician productivity (must remain available to admin/gerente — see Regra 4) |
| 10871        | **`TecnicoMobileApp`** — dedicated shell for `role="tecnico"` (no ERP sidebar; see Regra 4) |
| 11025        | `TecnicoOSDetail` — per-OS detail screen used inside `TecnicoMobileApp` |
| 11600+       | Main `App` component — orchestrates auth (regular vs. master), sidebar, `ModuleSwitcher`, global state |

### Modules actually rendered in the sidebar

`navItems` (around line 11669) and the `<ModuleSwitcher>` block (around line 12200) are the ground truth. Today there are **6** modules:

1. `dashboard` → `Dashboard`
2. `processos` → `ProcessModule` ("Ordens de Serviço")
3. `agenda` → `ScheduleModule`
4. `financeiro` → `FinanceModule`
5. `cadastro` → `CadastroModule`
6. `config` → `SettingsModule` (admin only)

Modules referenced in earlier versions of this file but **no longer in the codebase**: `InventoryModule` (merged into `CadastroModule`), `InvoiceModule` (replaced by HTML doc generators around line 4385–4910), `PDVModule`, `WebdeskModule`, `BankingModule`, `MessageCenter`. Don't reintroduce them by name without checking whether the use case is already covered elsewhere.

### Multi-tenancy and scoping

The DB layer is **company-scoped**. Most keys (those matching `SCOPED_PREFIXES`) are automatically rewritten to `cmp_<id>:<key>` so that multiple tenants can share the same `window.storage` and Supabase `kv_store`. `SCOPED_SINGLETONS` lists keys that are scoped per-company but stored as a single value. `migrateLegacyConfigOnce` and `ensureCompanyMigration` migrate pre-multi-tenant data on load. The **Master** tier (`MasterApp`) is a separate shell for managing companies; it has its own login (`MasterLoginScreen`) and its own audit log (`MasterAuditLog`).

### Audit trail

Mutations to keys matching `AUDITED_PREFIXES` are logged via `recordAudit` (with `summarizeRecord` redacting sensitive fields). The `CompanyAuditPanel` inside Settings reads this log. Don't bypass `DB.set/delete` for audited entities — write through the DB layer so audit entries are produced.

### Authentication

- Regular users: password hashed (legacy `hashPasswordLegacy` + newer flow), with login-attempt throttling (`frost_login_attempts`).
- Optional **TOTP/2FA**: `generateTotpSecret` + `buildOtpAuthUri` + `qrcode` produce the enrollment QR. Base32 helpers live alongside.
- **Forgot-password** and **force-password-change** flows have dedicated dialogs.
- **Master** users live under the `master:user:` prefix and authenticate through `MasterLoginScreen`.

### Calendar feed (iCal export)

`api/calendar.js` is a Vercel serverless function that returns an iCal feed for a given user, authenticated by an opaque token stored hashed on the user. `CalendarFeedPanel` (Settings) lets the user generate / regenerate / disable the token. Don't expose calendar data via any other path — the token is the auth boundary.

### Document generation (orçamento / OS / recibo)

There is no longer an "InvoiceModule". Printable documents are produced imperatively:

- `openHTMLDoc(html)` opens a new window with the document.
- `generateOrcamentoHTML(os, clients)`, `generateOSHTML(os, clients)`, `generateReciboHTML(os, clients)` build the HTML.
- Shared building blocks: `_docStyles`, `_docHeader`, `_clienteBlock`, `_pixBlock`, `_agradecimentoBlock`, `_equipamentoDescricao`.

Any new printable artifact should follow the same pattern — don't introduce a new "module" for it.

### Data & State Patterns

- All data is persisted to `window.storage` (localStorage or in-memory polyfill) via the `DB` utility. Keys use prefixes (`frost_clients`, `frost_transactions`, `erp:config`, …) and are auto-scoped to the active company when matched by `SCOPED_PREFIXES`.
- Navigation between modules uses `useState` (`activeModule`) — no URL routing.
- Role-based access control via `ROLE_PERMISSIONS` with roles `admin`, `gerente`, `tecnico`, `atendente`. **`customPermissions`** on a user object overrides the role (admin can restrict an individual user even within their role). Always go through `hasPermission(user, module)` — don't compare roles directly.
- Toast notifications managed at the App level and passed down as `addToast` prop.
- `ModuleErrorBoundary` isolates crashes to the active module; `ModuleSwitcher` does a crossfade between modules.

### Language

The app UI is entirely in **Brazilian Portuguese** (pt-BR). All labels, categories, messages, and field names are in Portuguese.

## Notificação por email quando OS criada (Fase 2.7)

Quando uma nova OS é criada (`DB.set("erp:os:*", value)` com `prev` null), o frontend dispara fire-and-forget a edge function `notify-os-created` que envia email pra:
- Todos os admin/gerente ativos da empresa (`company_members WHERE role IN ('admin','gerente') AND status='ativo'`)
- Técnico atribuído à OS, se `osData.tecnicoId` mapear em `company_members.legacy_user_id`

Opt-out por empresa via `companies.notify_os_email` (default true). Admin/gerente alterna em Settings → "Segurança da empresa".

**Schema (migração `fase_2_7_notify_os_email`):**
- `companies.notify_os_email boolean` (default true)

**Edge function nova `notify-os-created`** (verify_jwt=true):
- Verifica caller pertence à `companyId` alvo
- Lê flag `notify_os_email` da empresa — skip se OFF
- Lista emails dos destinatários via `auth.admin.getUserById` (service_role)
- Monta template HTML pt-BR (número OS, cliente, equipamento, descrição, técnico, valor, agendamento)
- Chama `send-email` (Resend) com lista de emails

Helper em `src/supabase.js`: `notifyOsCreated(companyId, osData)` → `{ ok, sent_to?, skipped?, error? }`.

Mudanças de status (não criação) continuam indo pelo webhook n8n → WhatsApp (Fase 1.3) — não duplicam por email.

## Biometria (APK) — Fase 2.6

Login biométrico (digital/face) já existia em `src/platform.js` (`isBiometricAvailable`, `enableBiometricLogin`, `authenticateBiometric`, `disableBiometricLogin`, etc.) e era ativado opcionalmente após o 1º login com senha. A Fase 2.6 adicionou um painel dedicado em Settings pra ativar/desativar manualmente sem depender do flow do login.

**`BiometricLoginPanel`** (`src/App.jsx`):
- Aparece apenas em APK nativo (`isNative()` true). Esconde no web.
- Mostra status: hardware disponível, tipo de biometria, e se já está ativo no device.
- Ativar: modal pede senha atual → valida via `signInWithFallback` → exige `authenticateBiometric` (toque/face) → `enableBiometricLogin(email, password)` salva credenciais cifradas em `Preferences`.
- Desativar: confirm + `disableBiometricLogin()`.

**Storage:** Capacitor `Preferences` (Android SharedPreferences / iOS UserDefaults). TODO em `src/platform.js:127` aponta migração futura pra `@capacitor-community/secure-storage-plugin` (Keystore Android, Keychain iOS) — não feito nesta fase, mas planejado.

**Compatibilidade com 2FA:** biometria substitui apenas o passo de senha. Se a empresa exige MFA, o usuário ainda passa pelo `pendingMfaChallenge` após o auto-login biométrico.

## 2FA via Supabase MFA built-in (Fase 2.5)

Refactor do 2FA TOTP: usa `supabase.auth.mfa.enroll/challenge/verify/unenroll` em vez do `generateTotpSecret`/`verifyTotp` custom. Factors ficam em `auth.users` → cross-device automático, rate-limit e audit server-side.

**Mudanças principais:**
- Toggle por empresa `companies.require_mfa` (admin/gerente liga em Settings → "Segurança da empresa").
- `TwoFactorAuthPanel` refatorado: lista factors, enrolla via Supabase, mostra QR retornado pelo próprio Supabase, deleta via unenroll.
- LoginScreen detecta após `signInWithFallback`:
  - Tem verified TOTP factor → challenge → tela "Verificação em 2 etapas" (`pendingMfaChallenge`).
  - `require_mfa` ON sem factor → enroll forçado inline (`pendingMfaEnroll`).
  - Tem campos legacy (`twoFactorEnabled`/`twoFactorSecret`) sem factor + `require_mfa` OFF → limpa campos legacy do `erp:user` e permite login (panel mostra badge "Reenrolar" pra reativar).
- `UserManagement` ganhou botão "Resetar 2FA" (admin/gerente) → chama edge `admin-remove-user-mfa` que via service_role apaga todos os factors do alvo (caso "técnico perdeu celular").
- Campos legacy (`twoFactorEnabled`, `twoFactorSecret`, `twoFactorBackupCodes`, `twoFactorEnabledAt`) são limpos do `erp:user:*` automaticamente no primeiro enroll novo bem-sucedido.

**Backup codes:** não implementados nesta fase. Supabase MFA não tem nativo. Recovery: admin reseta 2FA via UserManagement.

**Migração silenciosa:** usuários com 2FA legacy não perdem login. Detectam-se 3 estados:
1. Online sem `require_mfa` → entra direto + cleanup local + panel sugere reativar.
2. Online com `require_mfa` → enroll forçado inline (reason="legacy_reenroll").
3. Offline (Supabase fora) → fallback local não checa MFA (degradação aceita).

**Schema (migração `fase_2_5_company_require_mfa`):**
- `companies.require_mfa boolean` (default false)

**Edge function nova:**
- `admin-remove-user-mfa` — verify_jwt=true; caller admin/gerente da mesma company; lista + deleta todos os factors do `user_id` alvo via service_role.

Helpers em `src/supabase.js`:
- `listMfaFactors()` → `{ ok, factors[], totp[] }`
- `enrollMfaTotp(friendlyName)` → `{ ok, factorId, qr, secret, uri }`
- `challengeMfa(factorId)` → `{ ok, challengeId }`
- `verifyMfaChallenge(factorId, challengeId, code)` → `{ ok, session? }`
- `challengeAndVerifyMfa(factorId, code)` — atalho enroll
- `unenrollMfa(factorId)` → `{ ok }`
- `adminRemoveUserMfa(targetUserId)` → `{ ok, removed }`

`_afterAuth` adiciona `member.company_require_mfa` derivado de `companies.require_mfa` (junto com `company_require_first_login_otp` da Fase 2.4).

## Email OTP no 1º login (Fase 2.4)

Camada extra de verificação no primeiro login bem-sucedido de cada membro. Opt-in por empresa (toggle em Settings → "Segurança da empresa").

**Fluxo:**
1. Admin/gerente ativa o toggle `require_first_login_otp` em `CompanySecurityPanel`.
2. Novo usuário aceita convite + define senha + tenta logar.
3. `signInWithFallback` OK → `_afterAuth` carrega `member` (com `company_require_first_login_otp` derivado de `companies` table).
4. LoginScreen `handleSubmit` detecta `member.company_require_first_login_otp && !member.first_login_otp_done` → chama edge `first-login-otp-send` → renderiza tela intermediária de OTP (estado `pendingFirstOTP`).
5. Edge `first-login-otp-send` gera código 6 dígitos, salva `sha256(code)` em `email_otps` (purpose='first_login', expires_at=+10min), chama `send-email` (Resend) com template pt-BR.
6. Usuário digita código → `verifyFirstLoginOTP(code)` → edge `first-login-otp-verify` compara hash, incrementa `attempts`, na 5ª errada esgota o OTP e força lockout local 15min.
7. Sucesso: marca `consumed_at` no OTP + `company_members.first_login_otp_done=true` → próximos logins pulam o passo.

**Tabelas/colunas (migração `fase_2_4_email_otp`):**
- `companies.require_first_login_otp boolean` (default false)
- `company_members.first_login_otp_done boolean` (default false)
- `email_otps` (id, user_id, company_id, code_hash, purpose, expires_at, attempts, consumed_at, created_at) — RLS ativa sem policies (acesso só via edge functions com service_role)

**Edge functions novas:**
- `send-email` — wrapper Resend reusável (verify_jwt=false; checa `INTERNAL_FUNCTION_SECRET` opcional)
- `first-login-otp-send` — verify_jwt=true; cooldown 60s; invalida OTP anteriores; chama `send-email`
- `first-login-otp-verify` — verify_jwt=true; SHA-256 do código; max 5 tentativas; promove flag no sucesso

**Setup obrigatório:**
- `supabase secrets set RESEND_API_KEY=re_xxx` (ou via dashboard → Functions → Secrets)
- (Opcional) `INTERNAL_FUNCTION_SECRET` se quiser blindar `send-email` contra abuso externo
- Sender email fixo: `noreply@app.frosterp.com.br` (precisa domínio verificado em Resend)

**Master tier:** ignorado. Master não passa por `company_members`.

Helpers em `src/supabase.js`:
- `sendFirstLoginOTP()` → `{ ok, expires_at?, retry_in?, error? }`
- `verifyFirstLoginOTP(code)` → `{ ok, attempts_left?, locked?, error? }`

## Convite por email (Fase 2.3)

Admin cria usuário sem digitar senha — sistema envia convite por email pra que o convidado defina a própria senha. Mais seguro: admin nunca vê senha do convidado.

**Fluxo:**
1. Admin abre Settings → Usuários → "+ Novo Usuário".
2. Form mostra apenas Nome, Email, Papel, Permissões (sem campo de senha — banner azul explica o convite).
3. Ao salvar, frontend chama `adminCreateUser({ mode: "invite", redirect_to, ... })`.
4. Edge function `admin-create-user` (branch invite) chama `admin.auth.admin.inviteUserByEmail(email, { data, redirectTo })`.
5. Supabase envia email com link `https://app/?type=invite#access_token=...`.
6. `company_members` é criado com `status='pendente'`.
7. Convidado clica link → app detecta `isInviteUrl()` → renderiza `ResetPasswordScreen` com `mode="invite"` (título "Bem-vindo ao FrostERP", botão "Ativar conta").
8. Convidado define senha → `updatePasswordWithRecoveryToken` → redirect ao login.
9. No primeiro login bem-sucedido, `_afterAuth` em `src/supabase.js` promove `company_members.status` de `pendente` → `ativo`. Local `erp:user:*` é sincronizado quando o convidado loga.

**Setup obrigatório no Supabase Dashboard:**
- Auth → URL Configuration → **Redirect URLs**: adicionar `https://SEU_DOMINIO/*` (já feito na Fase 2.2 — vale também pra invite).
- Auth → Email Templates → "Invite User" pode ser customizado em pt-BR. Variáveis: `{{ .ConfirmationURL }}`.

**Edição de usuário existente:** form continua mostrando os campos de senha (admin pode redefinir senha de usuário já ativo). Usa `mode: "update_password"` da própria edge function.

**Status `pendente`:** aparece na listagem de Settings → Usuários como badge amarela. Conta no limite de usuários por empresa (`maxUsuarios`). Admin pode excluir usuário pendente que nunca aceitou.

Helpers em `src/supabase.js`:
- `isInviteUrl()` → boolean (checa query `?type=invite` ou hash)
- `clearRecoveryUrl()` → limpa query/hash após aceite

## Recuperação de senha (Fase 2.2)

Usa Supabase Auth nativo (`resetPasswordForEmail` + `updateUser`). Sem edge function adicional.

**Fluxo:**
1. Usuário clica "Esqueci minha senha" em `LoginScreen` → `ForgotPasswordDialog`.
2. Dialog chama `requestPasswordReset(email)` → Supabase envia email com link `https://app/?type=recovery#access_token=...`.
3. Usuário clica link → Supabase JS auto-detecta hash → estabelece sessão temporária.
4. App detecta `isRecoveryUrl()` no top-level e renderiza `ResetPasswordScreen` (em vez de `LoginScreen`).
5. Usuário define nova senha → `updatePasswordWithRecoveryToken(pwd)` → `clearRecoveryUrl()` → volta ao login.

**Setup obrigatório no Supabase Dashboard:**
- Auth → URL Configuration → **Redirect URLs**: adicionar `https://SEU_DOMINIO/*` (e `http://localhost:5173/*` para dev).
- Auth → Email Templates → "Reset Password" pode ser customizado em pt-BR. Variáveis: `{{ .ConfirmationURL }}`.

Helpers exportados em `src/supabase.js`:
- `requestPasswordReset(email)` → `{ ok, error? }`
- `updatePasswordWithRecoveryToken(pwd)` → `{ ok, user?, error? }`
- `isRecoveryUrl()` → boolean (checa query `?type=recovery` ou hash)
- `clearRecoveryUrl()` → remove query/hash após reset

## Edge Functions

Pasta `supabase/functions/`. Deploy com `supabase functions deploy <nome>`.

| Função              | verify_jwt | Propósito                                                                |
| ------------------- | ---------- | ------------------------------------------------------------------------ |
| `master-login`      | false      | Valida credencial master via service_role (PBKDF2)                       |
| `migrate-login`     | false      | Migra user legacy → auth.users (deployed externamente, fora do repo)     |
| `admin-create-user` | true       | Cria/atualiza/convida user da empresa (auth.users + company_members)     |
| `pos-venda-dispatch`| —          | Cron pós-venda                                                           |
| `whatsapp-webhook`  | —          | Webhook WhatsApp → IA                                                    |
| `send-email`        | false      | Helper Resend (chamado server-to-server por outras edge functions)       |
| `first-login-otp-send`   | true  | Fase 2.4 — gera OTP 6 dígitos e dispara email                            |
| `first-login-otp-verify` | true  | Fase 2.4 — valida código + promove `first_login_otp_done`                |
| `admin-remove-user-mfa`  | true  | Fase 2.5 — admin/gerente apaga factors MFA de outro user (reset 2FA)     |
| `notify-os-created`      | true  | Fase 2.7 — email pra admin/gerente + técnico ao criar nova OS            |

### admin-create-user — provisionamento de usuário

`UserManagement` precisa chamar essa function ao criar (ou trocar senha de) usuário. Salvar só em `erp:user:*` deixa o registro órfão (login falha com 400 — user não existe em `auth.users`).

Payload: `{ mode: "create"|"update_password"|"invite", email, password?, nome, role, company_id, legacy_user_id, custom_permissions, comissao_percentual, avatar, redirect_to? }`.

A function:
1. Valida JWT do caller via `Authorization: Bearer`.
2. Confere que caller é `admin`/`gerente`/`is_super_admin` em `company_members` da `company_id` alvo.
3. Em `create`: `admin.auth.admin.createUser` (email_confirm=true) + upsert `company_members` (status='ativo').
4. Em `update_password`: `admin.auth.admin.updateUserById`.
5. Em `invite` (Fase 2.3): `admin.auth.admin.inviteUserByEmail` (sem password) + upsert `company_members` com status='pendente'. Promovido a 'ativo' em `_afterAuth` no primeiro login.

Deploy: `supabase functions deploy admin-create-user`.

## Integrações externas

### Webhook n8n → WhatsApp (Evolution API)

Mudanças de status de OS disparam um webhook configurável que o n8n consome para enviar mensagem WhatsApp ao cliente via Evolution API.

- **Trigger**: `DB.set("erp:os:*", value)` em `src/App.jsx` — quando `prev.status !== value.status`, chama `notifyOSStatusChange(prev, value)` (fire-and-forget POST).
- **URL configurável**: campo `n8nWebhookOSStatusUrl` em `erp:config`, editável em Settings → "🔔 Notificação WhatsApp ao mudar status de OS". Vazio = desabilitado.
- **Payload (JSON)**:
  ```json
  {
    "event": "os.status_changed",
    "ts": "ISO8601",
    "companyId": "...",
    "empresa": "...",
    "osId": "...",
    "numero": 123,
    "statusAnterior": "em_servico",
    "status": "aguardando_finalizacao",
    "clienteId": "...",
    "clienteNome": "...",
    "clienteTelefone": "+5599...",
    "valor": 350.0,
    "tecnicoNome": "...",
    "dataAgendada": "...",
    "horaAgendada": "...",
    "endereco": "..."
  }
  ```
- **Setup n8n (resumo)**: criar workflow com nó `Webhook` (POST) → `Switch` por `status` → `HTTP Request` para Evolution API `/message/sendText/{instance}` com `number=clienteTelefone` e `text` montado conforme template por status.

## Supabase Sync Layer (`src/supabase.js`)

The app syncs its `window.storage` key-value data to a Supabase table `kv_store` (columns: `key`, `value`, `updated_at`). Requires env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. If absent, Supabase is disabled and the app runs fully local.

- `hydrateFromSupabase()` — called on app load; Supabase is source of truth, overwrites local data
- `syncToSupabase(key, value)` — called on every `DB.set()` to keep remote in sync
- `deleteFromSupabase(key)` — called on every `DB.delete()`
- `uploadAllToSupabase()` — bulk upsert (used in backup/restore)
- `subscribeToChanges(cb)` — Realtime listener; propagates changes from other devices/tabs
- Keys prefixed with `erp:user:` are never synced (sensitive local-only data)

## Animation & Visual Components

- `src/Aurora.jsx` — WebGL aurora background rendered via OGL, shown on the login screen
- `src/BlurText.jsx` — Text reveal animation using Motion, used for decorative text
- `src/AnimatedLogo.jsx`, `src/AnimatedSnowflake.jsx` — anime.js-driven brand visuals
- `src/FrostIcons.jsx` — icon set used by the sidebar (`iconName` field on `navItems`)

## Working with This Codebase

- The app is effectively single-file. Any change to `App.jsx` requires careful attention to the section table above — and that table drifts on every edit, so **grep the function name** rather than trusting line numbers blindly.
- Font: DM Sans, loaded from Google Fonts in `index.html`.
- The `StyleSheet` component injects global CSS including `@media print` rules and animations — check there for styling that isn't Tailwind.
- The `DataTable` component is reused across all modules and supports sorting, filtering, pagination, and inline actions.
- The app is a **PWA** (`vite-plugin-pwa`); test the installable / offline behavior when touching service-worker-adjacent code.
- Pure helpers live in `src/utils.js` and are covered by Vitest. New pure helpers should go there with a test, not into `App.jsx`.
- Before reintroducing a "module" name (Inventory, Invoice, PDV, Webdesk, Banking, MessageCenter), check whether the use case is already handled by `CadastroModule`, the HTML doc generators, or another existing flow — these names appeared in earlier versions and were intentionally consolidated.

---

## Wiki do Projeto (Padrão LLM Wiki)

A complexidade do FrostERP (App.jsx com ~7600 linhas, ~11 módulos, regras de negócio em pt-BR, integração Supabase, fluxo dedicado do técnico) supera o que cabe nesse `CLAUDE.md`. Para acumular conhecimento sem inflar este arquivo, mantemos um **wiki incremental** em `docs/wiki/`. Claude é o mantenedor; o humano é o curador.

### Três camadas

| Camada       | Onde                | Quem escreve     | O que é                                                                 |
| ------------ | ------------------- | ---------------- | ----------------------------------------------------------------------- |
| Raw sources  | `docs/raw/`         | Humano (curador) | Imutável: PRDs, prints de bug, transcripts, requisitos do cliente, dumps de chat, screenshots de tela do app |
| Wiki         | `docs/wiki/`        | **Claude**       | Markdown estruturado e interlinkado: páginas de módulo, conceito, decisão, fluxo, fonte |
| Schema       | `CLAUDE.md` (este)  | Co-evoluído      | Convenções, layout, operações                                           |

### Layout de diretórios

```
docs/
├── raw/                          # fontes brutas (humano dropa aqui — Claude lê, nunca modifica)
│   ├── assets/                   # imagens, screenshots referenciadas
│   ├── prds/                     # documentos de requisito de feature
│   ├── bugs/                     # prints/descrições de bug do usuário final
│   ├── transcripts/              # conversas com cliente, reuniões
│   └── reference/                # docs externos: Receita Federal NF-e, layout boleto, etc.
└── wiki/                         # Claude mantém — humano só lê
    ├── index.md                  # catálogo de tudo (lido primeiro em qualquer query)
    ├── log.md                    # cronológico append-only de ingests/queries/lints
    ├── modules/                  # 1 página por módulo do App.jsx
    │   ├── finance.md
    │   ├── inventory.md
    │   ├── invoice.md
    │   ├── pdv.md
    │   ├── webdesk.md
    │   ├── process.md            # OS (ordem de serviço)
    │   ├── schedule.md
    │   ├── banking.md
    │   ├── cadastro.md
    │   ├── message-center.md
    │   ├── settings.md
    │   └── tecnico-mobile.md     # shell dedicado para role=tecnico
    ├── concepts/                 # padrões transversais que tocam vários módulos
    │   ├── db-layer.md           # window.storage + DB utility
    │   ├── supabase-sync.md      # hydrate/sync/realtime, prefixos não-sincronizados
    │   ├── role-permissions.md   # ROLE_PERMISSIONS, gating de módulos
    │   ├── data-table.md         # contrato do componente reutilizado
    │   ├── seed-data.md          # como seedDatabase() popula demo
    │   └── print-views.md        # @media print, modais de impressão de NF-e/relatórios
    ├── flows/                    # fluxos end-to-end multi-módulo
    │   ├── os-tecnico-aprovacao.md   # criação OS → atribuição → mobile → revisão admin
    │   ├── emissao-nfe.md
    │   └── pdv-checkout.md
    ├── decisions/                # ADRs leves (uma decisão arquitetural por arquivo)
    │   ├── 001-single-file-app.md
    │   ├── 002-window-storage-sem-orm.md
    │   ├── 003-sem-router.md
    │   └── 004-pt-br-no-codigo.md
    └── sources/                  # 1 página por documento ingerido em docs/raw/
        └── <slug>.md
```

### Convenções de página

Toda página em `docs/wiki/` começa com frontmatter YAML:

```yaml
---
title: Módulo Finance
type: module                    # module | concept | flow | decision | source
updated: 2026-05-10
sources:                        # links para docs/raw/ que alimentaram esta página
  - ../raw/prds/finance-v2.md
related:                        # wikilinks para páginas vizinhas
  - ../concepts/db-layer.md
  - ../flows/emissao-nfe.md
code_refs:                      # apontadores ESTÁVEIS para o código (sempre verifique antes de citar)
  - src/App.jsx#FinanceModule
---
```

Regras:

- **Conteúdo em pt-BR** (alinhado com o app). Termos técnicos podem ficar em inglês.
- **Wikilinks relativos**: `[[../concepts/db-layer]]` — facilita refactor de pastas.
- **Code refs como ponteiros, não cópias**: cite `src/App.jsx#FinanceModule` ou `src/App.jsx:1493`. Nunca cole blocos grandes de código no wiki — eles ficam stale na hora.
- **Citações de fonte obrigatórias**: toda afirmação não-óbvia deve linkar para uma página em `sources/` ou um arquivo em `raw/`. Sem fonte → marque como `[inferido]` ou `[a confirmar com o usuário]`.

### Operações

#### Ingest (humano dropa fonte → Claude integra)

Disparado quando o humano coloca um arquivo novo em `docs/raw/` e diz algo como _"ingest esse PRD"_ ou _"adicione esse print de bug"_.

1. Ler a fonte completa em `docs/raw/`.
2. Discutir com o usuário o que é mais relevante.
3. Criar `docs/wiki/sources/<slug>.md` com resumo + link de volta para o raw.
4. Atualizar todas as páginas de `modules/`, `concepts/`, `flows/` afetadas — propagar mudanças, marcar contradições com `> ⚠️ Contradição:`.
5. Atualizar `docs/wiki/index.md` (linha por nova página criada).
6. Append em `docs/wiki/log.md`:
   ```
   ## [2026-05-10] ingest | <título da fonte>
   - source: docs/raw/prds/<arquivo>.md
   - touched: modules/finance.md, concepts/db-layer.md, flows/emissao-nfe.md
   - decisions: <se aplicável>
   ```

Uma única ingest tipicamente toca 5–15 páginas. Não tenha medo de propagar.

#### Query (humano pergunta → Claude responde a partir do wiki)

1. **Sempre** ler `docs/wiki/index.md` primeiro.
2. Drilar nas páginas relevantes (não no código direto, a menos que precise verificar code_refs).
3. Responder citando o caminho da página: _"Conforme `docs/wiki/modules/process.md`, o fluxo do técnico..."_.
4. **Filar respostas valiosas de volta no wiki**: se a query produziu uma síntese, comparação ou descoberta nova (não apenas leitura), crie ou atualize uma página. Comparações e investigações **são** conhecimento — não devem viver só no histórico do chat.

#### Lint (saúde periódica do wiki)

Disparado quando o humano pede _"lint do wiki"_ ou _"health check"_.

Verificar:
- Páginas órfãs (sem inbound links em outras páginas)
- Conceitos mencionados em várias páginas mas sem página própria → candidatos a promover
- Wikilinks quebrados
- Code refs apontando para linhas que mudaram (rodar grep contra `src/`)
- Claims contraditórios entre páginas
- Fontes em `docs/raw/` sem página correspondente em `sources/`
- Páginas com `updated` muito antiga vs. mudanças recentes nos arquivos referenciados

Saída do lint: lista priorizada de itens, **não** correções automáticas. Humano decide o que atacar.

### `index.md` — formato

Catálogo plano por categoria. Uma linha por página: `- [Título](path) — gancho de uma linha`. Sem frontmatter. Mantenha conciso (sub-200 linhas — se passar, é hora de quebrar).

```markdown
# Wiki Index

## Módulos
- [Finance](modules/finance.md) — receitas/despesas, relatórios imprimíveis
- [Process / OS](modules/process.md) — ordens de serviço, ciclo de aprovação
...

## Conceitos
- [DB Layer](concepts/db-layer.md) — window.storage + DB utility, prefixos `frost_*`
...

## Fluxos
- [OS técnico → aprovação](flows/os-tecnico-aprovacao.md) — criação até finalização revisada

## Decisões
- [001 single-file App.jsx](decisions/001-single-file-app.md) — por que tudo em um arquivo

## Fontes
- [PRD Finance v2](sources/prd-finance-v2.md) — req 2026-04
```

### `log.md` — formato

Append-only, prefixo consistente para ser parseável com `grep "^## \[" log.md | tail -10`.

```markdown
# Log

## [2026-05-10] ingest | PRD Finance v2
- source: docs/raw/prds/finance-v2.md
- touched: modules/finance.md, concepts/db-layer.md
- new pages: sources/prd-finance-v2.md, decisions/005-categorias-revenue-fixas.md

## [2026-05-09] query | "como o técnico finaliza uma OS?"
- consulted: modules/tecnico-mobile.md, flows/os-tecnico-aprovacao.md
- filed back: nenhum (resposta direta de página existente)

## [2026-05-08] lint
- 3 órfãs encontradas: concepts/print-views.md, ...
- 2 code refs stale em modules/banking.md
```

### Quando NÃO usar o wiki

- **Não duplique código.** Aponte para `App.jsx:LINHA` em vez de colar.
- **Não documente o que `git log` já diz.** Histórico de commits é autoritativo para "o que mudou quando".
- **Bug fix pontual não vira página.** A correção está no código e no commit. Só vira página se descobriu algo sobre o domínio que vale guardar.
- **Não criar pasta `docs/`/wiki preventivamente.** Comece quando houver primeira fonte para ingerir. Páginas vazias são pior que ausência de páginas.

### Bootstrap

Na primeira vez que o humano disser _"vamos começar o wiki"_ ou _"ingest essa fonte"_:
1. Criar `docs/raw/` e `docs/wiki/`.
2. Criar `docs/wiki/index.md` (vazio com cabeçalhos de categoria) e `docs/wiki/log.md` (vazio com `# Log`).
3. Em seguida, executar a operação de ingest.

### Obsidian como IDE do wiki

A **raiz do projeto é o cofre Obsidian** (não há cofre separado). O humano abre `Frostapp-main/` como vault no Obsidian — `docs/wiki/` e `docs/raw/` aparecem como pastas normais, wikilinks `[[../concepts/db-layer]]` resolvem nativos, graph view funciona.

- `.obsidian/` é criado pelo Obsidian ao abrir o cofre. Estado de UI (`workspace*`, `cache`, `graph.json`) está no `.gitignore`. Configs compartilhadas (`app.json`, `appearance.json`, `core-plugins.json`, `community-plugins.json`) **podem** ir pro repo se quisermos consistência entre máquinas.
- Plugins recomendados (instalar manualmente no Obsidian): **Dataview** (queries em frontmatter YAML), **Templater** (snippets), **Obsidian Git** (já temos git mas integra commit/push). Opcional: **Marp** se precisar gerar slides do wiki.
- Não criar arquivos fora de `docs/` para o cofre — código continua sendo código, wiki continua em `docs/`. O cofre só "vê" tudo porque é a raiz; isso não significa que tudo é nota.

---

## Regras Obrigatórias do Projeto

1. **Deploy contínuo** — Toda e qualquer alteração no código deve ser commitada no Git e deployada na Vercel. Nunca deixar mudanças apenas locais.
2. **Comentários nos pontos importantes (em PT-BR)** — Comentar todos os pontos mais importantes do código (funções principais, lógica de negócio, integrações, decisões arquiteturais) para facilitar manutenção e entendimento. Todos os comentários devem ser escritos em Português Brasileiro (pt-BR).
3. **Sistema integrado PC + Mobile** — O sistema deve funcionar integrado ao PC e como um app mobile responsivo. Todas as telas e componentes devem ser responsivos e adaptados para desktop e dispositivos móveis.
4. **App do Técnico — fluxo dedicado** — Usuários com `role="tecnico"` devem ver exclusivamente o `TecnicoMobileApp` (sem sidebar do ERP). Esse shell mostra apenas as OS atribuídas ao próprio técnico, com fluxo: visualizar demanda → marcar chegada (registra `tecnico.chegada`) → preencher descrição detalhada e upload de fotos → finalizar (abre diálogo opcional de **assinatura digital do cliente** via `SignaturePad` → upload para bucket `os-assinaturas` → grava `os.assinatura = {url, nome, cpf?, dataHora}`) → status muda para `aguardando_finalizacao` e registra `tecnico.saida`. Nunca dar acesso a outros módulos para esse role. Toda OS finalizada pelo técnico precisa ser revisada e aprovada por admin/gerente no ERP antes de virar `finalizado`. O relatório mensal de produtividade por técnico (`ProductivityReport`) deve sempre estar disponível para admin/gerente. Fotos do serviço são armazenadas no bucket Supabase Storage `os-fotos` (público); assinaturas no bucket `os-assinaturas` (público, criar manualmente no Supabase Dashboard). A assinatura é embutida automaticamente via `_assinaturaBlock(os)` no fim de `generateOSHTML` e `generateReciboHTML`. Qualquer feature nova relacionada a OS deve preservar esse fluxo de revisão.
5. **Wiki como memória do projeto** — Mudanças arquiteturais, novos fluxos de negócio, decisões não-triviais e PRDs do cliente devem ser ingeridos no wiki em `docs/wiki/` (ver seção [Wiki do Projeto](#wiki-do-projeto-padrão-llm-wiki)). Antes de implementar uma feature complexa, consultar `docs/wiki/index.md` para verificar contexto pré-existente.
