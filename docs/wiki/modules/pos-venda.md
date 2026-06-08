---
title: Módulo Pós-Venda
type: module
updated: 2026-06-08
sources: []
related:
  - ../concepts/evolution-multitenant.md
  - ../concepts/supabase-sync.md
  - ../flows/whatsapp-ia-os.md
  - ../decisions/008-pos-venda-pg-cron-vs-vercel-cron.md
code_refs:
  - src/modules/PosVendaModule.jsx
  - src/App.jsx#scheduleOSPosVenda
  - supabase/functions/pos-venda-dispatch
  - supabase/functions/whatsapp-webhook#handlePosVendaReply
  - api/pos-venda-cron.js
  - docs/ai-agent/04-pos-venda-pg-cron.sql
---

# Módulo Pós-Venda

Envia mensagens automáticas de pós-venda (ex.: pesquisa de satisfação) após uma OS, via WhatsApp pela mesma infra Evolution do agente IA.

## Componentes

- **`src/modules/PosVendaModule.jsx`** — UI do módulo (sidebar item `pos-venda`, ver `src/App.jsx` navItems). Gerencia config, templates, opt-out e fila de mensagens.
- **`scheduleOSPosVenda(os)`** (`src/App.jsx`) — agenda mensagens ao salvar/atualizar OS. Early-return se `!os.clienteId`. Lê `pos_venda_config`/`pos_venda_optout`/`pos_venda_templates`, insere em `pos_venda_mensagens`.
- **Edge Function `pos-venda-dispatch`** (`supabase/functions/pos-venda-dispatch/index.ts`) — dispatcher por cron (`verify_jwt=false`, v9 em prod). Auth via header `x-dispatch-key`; chave esperada = env `DISPATCH_KEY` se setada, **senão lida do Vault** via RPC `public.pos_venda_dispatch_key()` (security definer, só `service_role`) — assim pg_cron e função compartilham o segredo sem coordenar env. Envia mensagens elegíveis (`agendada_para <= now`) pela Evolution (`/message/sendText`). Status `aprovada` sempre; `pendente` só se `modo_disparo='auto'`. Retry até 3 tentativas → `status='erro'`.
  - **apikey da Evolution (fix 2026-06-08):** lê de `ai_agent_config.metadata.evolution_apikey` (mesma fonte do `whatsapp-webhook`/`frost-notify-approval`), com fallback pro env `EVOLUTION_APIKEY`. Antes lia só o env (nunca setado) → bailava com `{"skipped":"evolution_nao_configurada"}` e nada saía.
  - **normalização de telefone (fix 2026-06-08):** prepende DDI `55` em números de 10/11 dígitos antes de enviar. Telefones cadastrados em formato local (ex `(93) 9172-1424` → `9391721424`) faziam a Evolution responder `number exists:false`.
- **Captura + classificação de respostas** (`supabase/functions/whatsapp-webhook/index.ts#handlePosVendaReply`, 2026-06-08) — o inbound do cliente chega pelo mesmo `whatsapp-webhook` do agente de OS. **Antes** de acionar o agente, o webhook checa se é resposta a uma msg de pós-venda `enviada`/sem resposta da empresa (match por telefone via `phonesMatch`, janela de 7 dias). Se for: classifica intenção (`confirma`/`reagenda`/`duvida`/`cancela`/`parar`/`outro`) + nota NPS via **Claude Haiku 4.5** (saída estruturada por tool `registrar_classificacao`); grava `status='respondida'`, `resposta_cliente`, `intencao_detectada`, `respondida_em`, `metadata.nps_score`; `parar` → insere `pos_venda_optout`; manda ack curto pro cliente; e se `precisa_humano` (dúvida/cancela/parar ou NPS ≤6) marca a flag (aparece na aba **Inbox**) e dispara email pra admin/gerente via `send-email`. Resposta de pós-venda **não** cai no agente conversacional de OS.
- **Agendamento via Supabase pg_cron** (`docs/ai-agent/04-pos-venda-pg-cron.sql`) — `pg_cron` + `pg_net` chamam a Edge Function a cada 15 min (`net.http_post` com header `x-dispatch-key` lido do Vault). Substituiu o Vercel Cron, que o plano Hobby limita a 1x/dia — ver [[../decisions/008-pos-venda-pg-cron-vs-vercel-cron]].
- **`api/pos-venda-cron.js`** — endpoint serverless Vercel fino; só repassa para a Edge Function. **Não está mais ligado a um cron** (bloco `crons` removido do `vercel.json`); mantido como trigger manual/HTTP. Guard opcional `CRON_SECRET`.

## Tabelas Supabase

`pos_venda_config` (global, `cliente_id IS NULL`, flag `ativo`, `modo_disparo`), `pos_venda_optout`, `pos_venda_mensagens` (fila: status/tentativas/erro_envio/canal), `pos_venda_templates`.

## Infra compartilhada

Reusa `ai_agent_config` (`evolution_url`/`evolution_instance`, `enabled=true`, `metadata.evolution_apikey`) — ver [[../concepts/evolution-multitenant]]. Sem Evolution configurada → no-op gracioso (fila acumula). Env do dispatcher: `DISPATCH_KEY`, `EVOLUTION_APIKEY` (fallback) (+ `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` injetadas pelo runtime). A apikey canônica vive em `ai_agent_config.metadata.evolution_apikey` (por empresa), não em env.
