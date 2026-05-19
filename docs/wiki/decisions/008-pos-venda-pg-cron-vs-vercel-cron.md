---
title: 008 — Pós-Venda agendado via Supabase pg_cron (não Vercel Cron)
type: decision
updated: 2026-05-18
sources: []
related:
  - ../modules/pos-venda.md
code_refs:
  - docs/ai-agent/04-pos-venda-pg-cron.sql
  - vercel.json
  - api/pos-venda-cron.js
---

# 008 — Pós-Venda agendado via Supabase pg_cron (não Vercel Cron)

## Contexto

O dispatcher do Pós-Venda (`pos-venda-dispatch`) precisa rodar a cada 15 min.
A v1 usava Vercel Cron (`crons` em `vercel.json`, `*/15 * * * *` → `/api/pos-venda-cron` → Edge Function).

No primeiro deploy real em `main` (2026-05-18), a Vercel **rejeitou a implantação**: a conta está no plano **Hobby**, que limita Cron Jobs a **1 execução por dia**. `*/15 * * * *` é inválido nesse plano.

## Decisão

Mover o agendamento para **dentro do Supabase**, com `pg_cron` + `pg_net` chamando a Edge Function `pos-venda-dispatch` diretamente a cada 15 min. Bloco `crons` removido do `vercel.json`.

- Sem limite de plano (independe da Vercel).
- Frequência original (15 min) preservada.
- Auth inalterada: header `x-dispatch-key` (Edge Function tem `verify_jwt=false`); a chave é lida do Vault no agendamento, não em texto puro.
- `api/pos-venda-cron.js` **mantido** como endpoint de trigger manual/HTTP — só deixou de ser disparado por cron.

SQL versionado em `docs/ai-agent/04-pos-venda-pg-cron.sql`, rodado uma vez no SQL Editor do projeto de produção.

## Alternativas descartadas

- **Cron Vercel diário** (`0 9 * * *`): passa no Hobby, mas degrada o produto — pós-venda dispararia 1x/dia em vez de 15 min.
- **Upgrade para Vercel Pro**: custo recorrente para um problema que o Supabase já resolve de graça.

## Consequência

Operador precisa rodar o SQL no Supabase após o deploy (passo manual, documentado no header do `.sql`). Sem isso, a fila `pos_venda_mensagens` acumula sem ser despachada (no-op gracioso, não quebra).
