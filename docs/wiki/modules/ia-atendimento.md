---
title: Módulo IA / Atendimento WhatsApp
type: module
updated: 2026-05-18
sources: []
related:
  - ../flows/whatsapp-ia-os.md
  - ../concepts/evolution-multitenant.md
  - ../decisions/007-ia-os-aprovacao-humana.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/App.jsx#IAAtendimentoModule
  - src/App.jsx#createOSFromProposal
  - src/utils.js#validateOSProposal
  - docs/ai-agent/02-n8n-workflow.json
  - docs/ai-agent/01-supabase-schema.sql
---

# Módulo IA / Atendimento WhatsApp

Painel do agente de IA: lista conversas WhatsApp, chat ao vivo via Supabase Realtime, intervenção manual, config do agente e — na v2 — **aprovação de propostas de OS**. Sidebar item `ia`; permissão `ia` em `ROLE_PERMISSIONS`. Não é módulo separado: tudo dentro de `IAAtendimentoModule` (`src/App.jsx`).

## Estrutura

- `companyId` = `getCurrentMember()?.company_id`. Recebe props `{ user, addToast }`.
- Canal Realtime único `ai_msgs_${companyId}` escuta `ai_messages` (INSERT), `ai_conversations` (\*) e, na v2, `ai_os_proposals` (INSERT).
- Config persistida em `ai_agent_config` (upsert por `company_id`).

## Aba "Propostas de OS" (v2)

- `loadProposals()` busca `ai_os_proposals` `status='pending_approval'` da empresa.
- Botão no header com badge de contagem; painel toggle `showProposals`.
- **Aprovar** → `validateOSProposal(payload)` (de `src/utils.js`) → `createOSFromProposal(payload)` (escopo de módulo em `src/App.jsx`, escreve via `DB.set("erp:os:")` — preserva audit/scope/sync/pós-venda) → atualiza proposta (`status=approved`, `created_os_id`, `decided_by`, `decided_at`) → seta `ai_conversations.linked_os_id`.
- **Rejeitar** → `status='rejected'` + `decided_by`/`decided_at`.
- INSERT de proposta via Realtime dispara `sendServerPush(supabase, { title, body })` (assinatura real em `src/platform.js`).

Decisão de por que a OS não é criada pelo n8n/Edge: ver [[../decisions/007-ia-os-aprovacao-humana]]. Fluxo end-to-end: [[../flows/whatsapp-ia-os]].
