---
title: Módulo Pós-Venda
type: module
updated: 2026-07-12
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
- **`scheduleOSPosVenda(os)`** (`src/App.jsx`) — agenda mensagens de pós-venda. Early-return se `!os.clienteId`. Lê `pos_venda_config` (override do cliente → global)/`pos_venda_optout`/`pos_venda_templates` (`is_default`), aplica variáveis `{{...}}` e insere em `pos_venda_mensagens`. Idempotente por OS (set de `tipo` já existentes). **Só gera 2 tipos:** `nps` (24h após finalização) e `lembrete_visita` (3 dias antes de conclusão + `dias_proxima_visita`). Chamado **apenas na finalização da OS** — `changeStatus`→`finalizado` e "Aprovar e finalizar" da revisão do admin, onde `dataConclusao` existe. **(fix 2026-07-12)** removida a chamada que rodava na *criação* de OS vinda da IA (`criarOSdeProposta`): a OS nasce `aguardando`, `dataConclusao` caía no fallback `now` e o NPS era agendado para 24h depois — antes do serviço acontecer.
  - **`reagendamento` automático (implementado 2026-07-12, spec `docs/superpowers/specs/2026-07-12-reagendamento-automatico-pos-venda-design.md`):** quando o cliente responde positivo a um `lembrete_visita` (intenção `confirma`/`reagenda`), o `whatsapp-webhook#handlePosVendaReply` envia na hora a proposta com a data prevista e grava a linha `tipo=reagendamento` (`status=enviada`). O texto vem **pré-renderizado no `scheduleOSPosVenda`** (App.jsx) e guardado em `metadata.reagendamento_conteudo` da linha do lembrete — o edge só lê e dispara. Gated por `enviar_reagendamento` (toggle re-adicionado à ConfigTab). Idempotente por `os_id`, só nasce de resposta a lembrete (sem loop). A resposta do cliente à proposta marca `precisa_humano` → Inbox, onde o operador fecha o agendamento (preserva Regra 4). **Envio pendente de deploy do `whatsapp-webhook`** (v17 em prod; MCP não usado pelo tamanho/risco do arquivo — requer `supabase functions deploy whatsapp-webhook`).
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

## Escopo multi-empresa do dispatcher (corrigido 2026-07-12)

> **Bug encontrado e corrigido em 2026-07-12** (verificado no prod `rbwzhglsztmjvwrcydcy`). Era latente — não causava dano porque só havia 1 empresa com pós-venda ativo — mas quebraria assim que uma 2ª empresa ligasse.

Todas as tabelas `pos_venda_*` têm coluna `company_id` (multi-tenant por design), mas o `pos-venda-dispatch` **ignorava `company_id` em todas as queries**: pegava uma config global (`.maybeSingle()` sem filtro — erraria com 2 configs), uma instância Evolution arbitrária (`.limit(1)`) e **toda** a fila sem filtro → mandaria mensagens de todas as empresas pela conta WhatsApp errada.

**Correção (deploy pos-venda-dispatch v14):** o dispatcher agora itera por `pos_venda_config` **por empresa** (como o `lembrete-dispatch` faz com `lembrete_config`) e escopa `ai_agent_config`, a fila `pos_venda_mensagens` e os updates por `company_id`. Retorna `{ sent, failed, processados, skipped }` (o `skipped` mapeia `company_id → motivo`). Preserva `ativo` null = ativo.

**Mesmo germe no `lembrete-dispatch` (deploy v7):** apesar de já iterar por empresa, ele buscava `ai_agent_config` com `.limit(1)` sem filtrar por `companyId` — corrigido com `.eq("company_id", companyId)`.
