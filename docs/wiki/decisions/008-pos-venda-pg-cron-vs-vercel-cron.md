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

## Implementação (aplicada 2026-05-19, via MCP)

Projeto de prod confirmado = **`frostapp2.0`** (ref `rbwzhglsztmjvwrcydcy`); o antigo `frostApp` (`hewsltabdygpwcfdcczg`) está INACTIVE/pausado (não usar — cron não dispararia).

Para o agendamento ser 100% gerenciável via MCP (sem coordenar env entre pg_cron e a função), a auth deixou de depender só de env:

- Segredo gravado no **Vault** (`vault.secrets` nome `pos_venda_dispatch_key`).
- RPC `public.pos_venda_dispatch_key()` (security definer, search_path fixo, execute só `service_role`) expõe a chave decifrada à Edge Function.
- Edge Function v2: `expected = env DISPATCH_KEY ?? rpc()`. Env mantém prioridade (compat com trigger manual `api/pos-venda-cron.js`).
- pg_cron job `pos-venda-dispatch` (`jobid=1`, `*/15 * * * *`, active) lê o mesmo segredo do Vault no header.

Smoke test pós-deploy: `200 {"skipped":"evolution_nao_configurada","sent":0}` — auth via Vault OK, função saudável, no-op gracioso (Evolution ainda não configurada). SQL idempotente versionado em `docs/ai-agent/04-pos-venda-pg-cron.sql` (sem o segredo real).

## Consequência

Setup de prod já aplicado — nenhum passo manual pendente do operador. Re-rodar o `.sql` só é necessário em outro ambiente (substituir `<DISPATCH_KEY>` e a URL do projeto). Enquanto Evolution não estiver configurada, a fila `pos_venda_mensagens` acumula sem despachar (no-op gracioso, não quebra).
