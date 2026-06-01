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

## Comportamento do agente (atualização 2026-06-01)

O agente roda na Edge Function `whatsapp-webhook` (não mais n8n). Mudanças desta rodada:

- **Modelo:** `claude-haiku-4-5` → **`claude-sonnet-4-6`** (raciocínio melhor pra seguir o fluxo e regras de desconto). Constante `MODEL` em `supabase/functions/whatsapp-webhook/index.ts`.
- **Nome primeiro:** o `system_prompt` (em `ai_agent_config`, por empresa) foi reescrito pra pedir o nome no início e usar o **primeiro nome** em toda mensagem.
- **Tool nova `get_customer`:** busca o cliente no `kv_store` por telefone (normalizado, tolerante a DDI/máscara). Retorna `{found, primeiro_nome, data_nascimento, aniversario_mes_atual, ja_cliente}`. Permite: saudar cliente que volta sem re-perguntar nome; saber se é cliente novo (desconto de 1º serviço); e decidir o desconto de aniversário **sem o LLM fazer conta de data**.
- **Desconto de aniversário (bug corrigido):** o prompt agora só oferece se `aniversario_mes_atual=true`, calculado em código (fuso Brasília). A data de hoje é injetada no prompt (`== CONTEXTO ATUAL ==`). Antes a IA não tinha relógio e dava desconto fora do mês.
- **Descontos:** aniversariante e 1º serviço, ambos **15% em pagamento à vista**, não acumulam. A IA sinaliza via campo `discount_note` no `propose_os` → vira nota na `observacoes` da OS (`createOSFromProposal`) pro técnico aplicar.
- **Fix de prefixo kv_store:** `get_recent_os`/`get_customer` usam `kvList()` que tenta o prefixo escopado (`<company_id>:erp:...`) e cai pro legado sem prefixo (`erp:...`). Os dados de prod são legados (bare) — o `get_recent_os` antigo (`${company_id}:erp:os:`) nunca achava nada.
- **Aviso ao aprovar (Edge `frost-notify-approval`, verify_jwt=true):** ao aprovar uma proposta, `approveProposal` chama a function que manda WhatsApp ao cliente ("solicitação verificada por um atendente, contato humano em seguida") e grava a msg em `ai_messages`. Valida que o caller é admin/gerente ativo da empresa.
