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

## Terminologia (planejada)

Servidor = admin principal (`company_members.is_super_admin = true`); Terminais =
demais membros. Rename amplo na UI fica para a Fase 4.

## Fases seguintes

2 (chave de hardware: Android Keystore/StrongBox + WebAuthn de plataforma;
`device_challenges` + assinaturas), 3 (RLS total via `current_device_ok()`),
4 (rename Servidor/Terminais na UI), 5 (passe offline + endurecimento).

> Migração no rollout: **sem grandfather** — todos caem pendentes; o superadmin
> aprova cada aparelho.
