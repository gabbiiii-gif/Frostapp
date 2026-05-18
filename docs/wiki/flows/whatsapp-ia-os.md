---
title: Fluxo WhatsApp → IA → Proposta → OS
type: flow
updated: 2026-05-18
sources: []
related:
  - ../modules/ia-atendimento.md
  - ../concepts/evolution-multitenant.md
  - ../decisions/007-ia-os-aprovacao-humana.md
code_refs:
  - docs/ai-agent/02-n8n-workflow.json
  - src/App.jsx#IAAtendimentoModule
  - src/App.jsx#createOSFromProposal
---

# Fluxo WhatsApp → IA → Proposta → OS (v2)

End-to-end do atendimento automático até a OS revisada por humano.

1. **WhatsApp → Evolution → n8n webhook** (`Webhook Evolution`). Filtra `messages.upsert` e `fromMe=false`.
2. **Extrai campos** (phone, name, instance, text/mídia).
3. **Resolve empresa**: `select company_id from ai_agent_config where evolution_instance = <instance> and enabled=true`. Sem match → IF `Empresa encontrada?` ramo falso → `Responde Webhook` (no-op gracioso). Ver [[../concepts/evolution-multitenant]].
4. **Tipo de mídia** (switch): áudio/imagem → `Baixa mídia Evolution` (`/chat/getBase64FromMediaMessage`) → `Upload Storage` (bucket `ai-media`, ext jpg/ogg) → `Rota mídia` → `Whisper` (transcrição) ou `Vision` (gpt-4o, descrição). Texto → direto. Tudo converge em `Texto efetivo` (text + media_url).
5. **Upsert conversa** + **Grava msg cliente** (`ai_messages`, com `media_url`).
6. **AI Agent** (gpt-4o-mini, memória Postgres) com tools: `propose_os`, `get_recent_os`, `handoff_to_human`.
7. **`propose_os`**: insere em `ai_os_proposals` (`status=pending_approval`, payload jsonb com dados + `media_urls`). O agente **não** cria OS; informa ao cliente que o pedido será analisado.
8. **Realtime → app**: `IAAtendimentoModule` recebe INSERT, dispara push ao admin.
9. **Admin aprova** na aba "Propostas de OS": `validateOSProposal` → `createOSFromProposal` (via `DB.set`, preserva audit/scope/sync, dispara pós-venda) → OS `status=aguardando` com fotos → proposta `approved`, `ai_conversations.linked_os_id` setado. Daí entra no ciclo padrão de revisão técnico/admin ([[os-tecnico-aprovacao]]).

Risco runtime não verificável sem infra: endpoint Evolution de mídia e formato da resposta do upload Storage — validar conforme roteiro manual em `docs/ai-agent/03-setup-guide.md`. `[a confirmar com o usuário]`
