---
title: Fluxo WhatsApp → IA → Proposta → OS
type: flow
updated: 2026-05-21
sources: []
related:
  - ../modules/ia-atendimento.md
  - ../concepts/evolution-multitenant.md
  - ../decisions/007-ia-os-aprovacao-humana.md
code_refs:
  - supabase/functions/whatsapp-webhook
  - src/App.jsx#IAAtendimentoModule
  - src/App.jsx#createOSFromProposal
---

# Fluxo WhatsApp → IA → Proposta → OS (v3)

End-to-end do atendimento automático até a OS revisada por humano.

> **v3 (2026-05-21):** o n8n foi substituído pela Edge Function `whatsapp-webhook`. Agente = Claude Haiku 4.5. Áudio (voz) fora de escopo na fase 1. Spec: `docs/superpowers/specs/2026-05-20-whatsapp-webhook-edge-function-design.md`.

1. **WhatsApp → Evolution → Edge Function** `whatsapp-webhook` (`?token=` valida contra secret `WEBHOOK_TOKEN`). Filtra `messages.upsert`, descarta `fromMe`, grupos (`@g.us`), e msg sem texto/imagem (áudio cai aqui — fase 2).
2. **Responde `200` imediato**; processa em background (`EdgeRuntime.waitUntil`).
3. **Resolve empresa**: `select ... from ai_agent_config where evolution_instance = <instance> and enabled=true`. Sem match → no-op. Ver [[../concepts/evolution-multitenant]].
4. **Imagem**: baixa via `/chat/getBase64FromMediaMessage` → upload bucket `ai-media` → `media_url`. A imagem vai ao Claude como bloco `image` (vision nativo).
5. **Upsert conversa** + **grava msg cliente** (`ai_messages`, com `media_url`).
6. **Gates**: conversa `status != 'active'` (humano assumiu) → para. Fora do horário comercial (`business_hours`) → envia `out_of_hours_message`, sem LLM.
7. **Agente Claude** (`claude-haiku-4-5`), histórico das ~20 últimas msgs, loop tool-use (máx 5 iterações). Tools: `propose_os`, `get_recent_os`, `handoff_to_human`.
8. **`propose_os`**: insere em `ai_os_proposals` (`status=pending_approval`, payload jsonb + `media_urls`). O agente **não** cria OS; informa que o pedido será analisado. **`handoff_to_human`**: marca conversa `pending_human`.
9. **Grava resposta IA** (`ai_messages` role=agent) → envia via Evolution `/message/sendText`.
10. **Realtime → app**: `IAAtendimentoModule` recebe INSERT em `ai_os_proposals`.
11. **Admin aprova** na aba "Propostas de OS": `validateOSProposal` → `createOSFromProposal` (via `DB.set`, preserva audit/scope/sync, dispara pós-venda) → OS `status=aguardando` com fotos. Daí entra no ciclo padrão de revisão técnico/admin ([[os-tecnico-aprovacao]]).

Risco não verificável sem teste: endpoint Evolution de mídia (`/chat/getBase64FromMediaMessage`) na v2.3.7 — validar no roteiro manual. `[a confirmar com o usuário]`
