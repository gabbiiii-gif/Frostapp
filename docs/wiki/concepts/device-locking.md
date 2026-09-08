---
title: Travamento por Aparelho (REMOVIDO)
type: concept
updated: 2026-09-08
status: removido
sources:
  - ../../superpowers/specs/2026-07-22-device-locking-servidor-terminais-design.md
related:
  - ./supabase-sync.md
  - ./role-permissions.md
  - ./master-tier.md
code_refs:
  - supabase/migrations/20260908000000_remove_device_locking.sql
---

# Travamento por Aparelho — REMOVIDO em 2026-09-08

> ⚠️ **Este recurso não existe mais.** A página fica como registro do que foi
> tentado e por que saiu — não descreve o comportamento atual do app.

O recurso prendia cada membro a **um único aparelho** aprovado pelo superadmin
(camada Master). Rodou em produção de 2026-07-22 a 2026-09-08 e foi retirado
depois do teste de campo: na prática travava mais o usuário legítimo (trocou de
máquina, de navegador, limpou o site, entrou pelo celular → tela de "aguardando
aprovação") do que impedia acesso indevido, e cada liberação virava trabalho
manual do superadmin.

## O que foi retirado

| Camada | Peças |
| ------ | ----- |
| Banco | tabelas `member_devices`, `device_sessions`, `device_challenges`, `device_enforcement`; função `private.current_device_ok()`; política restritiva `device_gate` em 12 tabelas |
| Edges | `device-enroll`, `device-verify`, `device-challenge`, `master-devices` |
| Cliente | `src/device-identity.js`, `src/webauthn.js`, `src/lib/device-policy.js` (+ testes); helpers `deviceEnroll`/`deviceVerify`/`masterDevices` em `src/supabase.js` |
| UI | `DeviceGateScreen`, portão no `handleLogin` e na restauração de sessão, `MasterDevicesPanel` e o botão **📱 Aparelhos** do `MasterApp` |

Ordem da remoção no banco (importa): **desligar o kill-switch → derrubar as
políticas `device_gate` → só então apagar a função e as tabelas.** As políticas
eram RESTRITIVAS e chamavam `current_device_ok()`; apagar a função antes deixaria
as 12 tabelas com política quebrada. No dia da remoção o kill-switch estava
**LIGADO** — isto é, o bloqueio por RLS estava valendo de verdade em produção.

## O que sobrou de propósito

- **Migrações históricas** `20260722*` e `20260730*` continuam no repo (histórico
  append-only). Elas recriam o recurso inteiro se um dia ele voltar.
- **`@capacitor/device`** ficou no `package.json` sem uso — remover exige
  `npx cap sync` no projeto Android; não valia o risco junto desta mudança.
- **A chave `frost_device_uuid`** pode sobrar no `localStorage`/`Preferences` de
  aparelhos que já usaram o app. É lixo inerte — nada mais lê.
- **Terminologia "Servidor e Terminais"** no `UserManagement` (Fase 4) — é só
  rótulo de exibição, não limita nada, e ficou como estava.

## Se um dia voltar

O erro de projeto não foi a criptografia (WebAuthn funcionou), foi a **política
1:1 estrita**: um membro, um aparelho, aprovação manual, sem grandfather no
rollout. Uma versão futura precisaria de N aparelhos por membro, auto-aprovação
do primeiro e revogação sob demanda — travar no primeiro aparelho e obrigar o
superadmin a liberar cada troca não sobrevive ao uso real.
