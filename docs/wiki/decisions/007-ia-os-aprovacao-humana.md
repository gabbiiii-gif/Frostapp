---
title: 007 — OS do agente IA exige aprovação humana e é escrita pelo app
type: decision
updated: 2026-05-18
sources:
  - ../../superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md
related:
  - ../flows/whatsapp-ia-os.md
  - ../modules/ia-atendimento.md
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx#createOSFromProposal
  - docs/ai-agent/02-n8n-workflow.json
---

# ADR 007 — Aprovação humana + OS escrita pelo app

## Contexto

O agente IA WhatsApp coleta dados do cliente e poderia criar OS direto. O tool `create_os` no n8n nunca teve sub-workflow (era `toolWorkflow` com `workflowId` vazio) — OS nunca era criada de fato.

## Decisão

**D1 — Sempre exige aprovação humana.** O agente grava uma *proposta* (`ai_os_proposals`, `status=pending_approval`) via tool `propose_os`. Não há modo automático. O cliente é informado que o pedido será analisado.

**D2 — A OS é escrita pelo app, não pelo n8n/Edge.** Ao aprovar no `IAAtendimentoModule`, `createOSFromProposal` cria a OS via `DB.set("erp:os:")` ([[../concepts/db-layer]]).

## Justificativa

- IA alucina/coleta dados errados; gate humano evita OS lixo e expectativa falsa no cliente.
- Escrever pelo DB layer preserva audit trail, escopo por empresa, sync Supabase, bridge finance e disparo de pós-venda (CLAUDE.md Regras 2 e 4). Uma Edge Function/n8n inserindo direto no `kv_store` com service_role **bypassaria** essas invariantes e exigiria replicar a lógica — dívida e risco.

## Consequências

- Latência humana entre pedido e OS (aceitável: triagem é desejável).
- `createOSFromProposal` espelha o `newOS` do ProcessModule — se a forma da OS mudar lá, atualizar aqui (acoplamento conhecido).
- `scheduleOSPosVenda` é no-op para OS de proposta enquanto `clienteId=null` (sem cliente vinculado ainda) — by design.

## Fora de escopo

Sub-workflow de criação de OS no n8n (não existe e não será criado); modo automático.
