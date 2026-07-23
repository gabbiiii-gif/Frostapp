---
title: Travamento por Aparelho
type: concept
updated: 2026-07-22
sources:
  - ../../superpowers/specs/2026-07-22-device-locking-servidor-terminais-design.md
related:
  - ./supabase-sync.md
  - ./role-permissions.md
  - ./master-tier.md
code_refs:
  - src/device-identity.js
  - src/lib/device-policy.js
  - supabase/functions/device-verify/index.ts
  - supabase/functions/master-devices/index.ts
---

# Travamento por Aparelho (Fase 1)

Cada membro fica preso a um aparelho aprovado pelo superadmin (camada Master).
A Fase 1 usa prova "soft" (`device_uuid`). O enforcement é de UX (portão no
login); o bloqueio via RLS entra na Fase 3. Estrito 1:1 (índices únicos parciais).

## Peças

- **Tabelas** (`supabase/migrations/20260722000000_device_locking.sql`): `member_devices`
  (vínculo, status `pending|approved|rejected|revoked`) e `device_sessions` (prova viva).
- **Edges**: `device-enroll` (registra pendente, verify_jwt=true), `device-verify`
  (decide status + emite `device_sessions`, verify_jwt=true), `master-devices`
  (superadmin aprova/rejeita/revoga, auth por `master_users.session_token_hash`).
- **Cliente**: `src/device-identity.js` (UUID por aparelho + fingerprint),
  `src/lib/device-policy.js` (decisão pura, espelha a edge), helpers
  `deviceEnroll`/`deviceVerify`/`masterDevices` em `src/supabase.js`.
- **UI**: `DeviceGateScreen` + portão no `handleLogin` (App.jsx); painel
  **📱 Aparelhos** no `MasterApp` (aprovação pelo superadmin).

## Fluxo

login → `deviceEnroll` (cria pendente) → `deviceVerify`. Se ≠ approved, App
mostra `DeviceGateScreen` (aguardando/negado) e não carrega o ERP. Superadmin
aprova no painel Aparelhos → próximo login libera.

## Terminologia (Fase 4 — aplicada)

Servidor = admin principal (`isSuperAdmin` / `company_members.is_super_admin = true`);
Terminais = demais membros. Camada de exibição no `UserManagement` (título "Servidor e
Terminais", badge por linha, "Novo Terminal") — papéis/permissões não mudam.

## Fases

- ✅ 1 — fundação + portão soft (device_uuid).
- ✅ 2 — WebAuthn no web (`src/webauthn.js`): passkey de plataforma, `device_challenges`,
  `device-challenge`, verificação de assinatura ECDSA no `device-verify`. Android nativo
  (Keystore) fica para depois.
- ✅ 3 — RLS por aparelho: `current_device_ok()` + política restritiva `device_gate` em
  12 tabelas, com **kill-switch** `device_enforcement` (começa OFF). device_session TTL 12h;
  renovada no login e no boot. Toggle no painel Aparelhos (`master-devices` action `enforcement`).
- ✅ 4 — rename Servidor/Terminais na UI.
- 🔜 5 — passe offline + endurecimento (root/emulador, rejeitar passkey sincronizada).

> **Ligar o cadeado:** aprovar os aparelhos dos membros ativos → confirmar que
> `device_sessions` estão sendo criadas → ligar o kill-switch no painel. Se travar,
> desligar na hora (RLS volta a no-op).

> Migração no rollout: **sem grandfather** — todos caem pendentes; o superadmin
> aprova cada aparelho.
