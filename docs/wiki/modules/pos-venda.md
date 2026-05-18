---
title: Módulo Pós-Venda
type: module
updated: 2026-05-18
sources: []
related:
  - ../concepts/evolution-multitenant.md
  - ../concepts/supabase-sync.md
  - ../flows/whatsapp-ia-os.md
code_refs:
  - src/modules/PosVendaModule.jsx
  - src/App.jsx#scheduleOSPosVenda
  - supabase/functions/pos-venda-dispatch
  - api/pos-venda-cron.js
---

# Módulo Pós-Venda

Envia mensagens automáticas de pós-venda (ex.: pesquisa de satisfação) após uma OS, via WhatsApp pela mesma infra Evolution do agente IA.

## Componentes

- **`src/modules/PosVendaModule.jsx`** — UI do módulo (sidebar item `pos-venda`, ver `src/App.jsx` navItems). Gerencia config, templates, opt-out e fila de mensagens.
- **`scheduleOSPosVenda(os)`** (`src/App.jsx`) — agenda mensagens ao salvar/atualizar OS. Early-return se `!os.clienteId`. Lê `pos_venda_config`/`pos_venda_optout`/`pos_venda_templates`, insere em `pos_venda_mensagens`.
- **Edge Function `pos-venda-dispatch`** (`supabase/functions/pos-venda-dispatch/index.ts`) — dispatcher por cron. Auth via header `x-dispatch-key === DISPATCH_KEY`. Envia mensagens elegíveis (`agendada_para <= now`) pela Evolution (`/message/sendText`). Status `aprovada` sempre; `pendente` só se `modo_disparo='auto'`. Retry até 3 tentativas → `status='erro'`.
- **`api/pos-venda-cron.js`** — endpoint serverless Vercel fino; só repassa para a Edge Function. Cron `*/15 * * * *` em `vercel.json`. Guard opcional `CRON_SECRET`.

## Tabelas Supabase

`pos_venda_config` (global, `cliente_id IS NULL`, flag `ativo`, `modo_disparo`), `pos_venda_optout`, `pos_venda_mensagens` (fila: status/tentativas/erro_envio/canal), `pos_venda_templates`.

## Infra compartilhada

Reusa `ai_agent_config` (`evolution_url`/`evolution_instance`, `enabled=true`) e o secret `EVOLUTION_APIKEY` — ver [[../concepts/evolution-multitenant]]. Sem Evolution configurada → no-op gracioso (fila acumula). Env do dispatcher: `DISPATCH_KEY`, `EVOLUTION_APIKEY` (+ `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` injetadas pelo runtime).
