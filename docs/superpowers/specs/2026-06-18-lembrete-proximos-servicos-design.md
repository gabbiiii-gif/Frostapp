---
title: Lembrete de próxima visita / manutenção (personalizável)
type: design
updated: 2026-06-18
related:
  - ../../wiki/modules/process.md
code_refs:
  - supabase/functions/pos-venda-dispatch/index.ts
  - supabase/functions/whatsapp-webhook/index.ts
  - supabase/functions/send-push/index.ts
---

# Lembrete de próxima visita / manutenção (personalizável)

## Objetivo

Lembrar da **próxima visita** dentro de um período determinado. Duas partes:

- **A) Manutenção recorrente (principal):** cada cliente tem um intervalo até a
  próxima manutenção (que ainda NÃO está agendada). Conta a partir da última
  visita finalizada. O sistema avisa quando está chegando a hora (X dias antes
  de vencer) — pra marcar/vender a próxima visita.
- **B) Resumo das visitas já agendadas:** avisa sobre as visitas que JÁ estão
  marcadas dentro de um período à frente (ex: próximos 7 dias).

Totalmente configurável por empresa. O **dono** recebe um resumo escrito pela
IA (Claude Sonnet).

## Decisões (brainstorming)

- **Intervalo personalizável por TIPO de cliente:** Pessoa Jurídica (empresa) um
  período, Pessoa Física outro — cada um configurável. Override opcional por
  cliente (campo na ficha).
- **Âncora:** última OS/visita **finalizada** do cliente.
- **Disparo (parte A):** X dias **antes** de vencer (antecedência configurável).
- **Destinatários:** cliente, admin/gerente, dono (telefone fixo configurável).
- **Canais:** WhatsApp (Evolution) + Push (PWA, `send-push`).
- **Envio:** automático (cron). Dono: texto da IA; cliente/admin: template editável.

## Modelo de dados (Postgres)

### `lembrete_config` (1 linha por empresa)
```
company_id           text PK
ativo                boolean     default false

-- Parte A: manutenção recorrente
manutencao_ativa     boolean     default true
intervalo_pj_dias    int         default 90      -- próxima visita p/ Pessoa Jurídica
intervalo_pf_dias    int         default 180     -- próxima visita p/ Pessoa Física
antecedencia_dias    int         default 15      -- avisa N dias antes de vencer

-- Parte B: resumo das agendadas
agendados_ativo      boolean     default true
lookahead_dias       int         default 7       -- janela "próximas visitas"
resumo_hora          text        default '07:00' -- HH:MM (America/Sao_Paulo) p/ resumo diário

-- Comum
canais               text[]      default '{whatsapp}'   -- whatsapp | push
para_cliente         boolean     default true
para_admin           boolean     default true
para_dono            boolean     default false
dono_telefone        text                               -- ex 5593991106818
template_cliente     text                               -- com {variaveis}
template_admin       text
updated_at           timestamptz default now()
```
RLS: leitura/escrita só admin/gerente da empresa (`private.user_role()`); cron
acessa via service_role.

### Override por cliente
`erp:client:*` (kv_store) ganha campo opcional `intervalo_manutencao_dias`
(número). Se preenchido, tem prioridade sobre o padrão PJ/PF. Editável na ficha
do cliente (Cadastro → Clientes).

### `lembrete_enviado` (dedupe + histórico)
```
id            uuid PK default gen_random_uuid()
company_id    text
tipo          text        -- 'manutencao' | 'agendado' | 'resumo_dono'
cliente_id    text        -- p/ manutencao/agendado (null p/ resumo_dono)
ref_data      date        -- data-alvo (próxima visita / dia da visita / dia do resumo)
destinatario  text        -- 'cliente' | 'admin' | 'dono'
canal         text        -- 'whatsapp' | 'push'
status        text        -- 'enviado' | 'erro'
erro          text
enviado_em    timestamptz default now()
unique (company_id, tipo, cliente_id, ref_data, destinatario, canal)
```
A UNIQUE garante idempotência por ciclo: cada cliente vencendo só lembra uma vez
por data-alvo, por destinatário/canal.

## Tipo de cliente (PJ x PF)

`erp:client:*` distingue PF/PJ por: campo `tipo` ('fisica'|'juridica') quando
existe, senão presença de `cnpj` (→ PJ) vs `cpf` (→ PF). Helper
`tipoCliente(client)` centraliza essa regra (lib pura, testável). O intervalo
efetivo: `client.intervalo_manutencao_dias ?? (PJ ? intervalo_pj_dias : intervalo_pf_dias)`.

## Edge function `lembrete-dispatch` (verify_jwt=false, auth x-dispatch-key)

Mesma fronteira do `pos-venda-dispatch` (chave via env `DISPATCH_KEY` ou Vault
RPC). Roda por `pg_cron` a cada 15 min. Para cada empresa com `lembrete_config.ativo`:

1. Carrega Evolution (`ai_agent_config.metadata.evolution_apikey`).
2. Lê clientes (`erp:client:`) e OS (`erp:os:`) do `kv_store` da empresa.

**Parte A — manutenção recorrente** (se `manutencao_ativa`):
- Por cliente: `ultimaVisita = max(dataFinalizacao | dataConclusao)` das OS
  finalizadas desse cliente. Sem OS finalizada → ignora.
- `intervalo = intervaloEfetivo(client, config)`; `proxima = ultimaVisita + intervalo`.
- Se `0 <= (proxima − hoje) <= antecedencia_dias` e não há `lembrete_enviado`
  (`manutencao`, cliente_id, `ref_data=proxima`, destinatario, canal):
  - cliente: WhatsApp/Push com `template_cliente` preenchido;
  - admin: entra na lista do dia (enviada agregada, ver Parte C);
  - grava `lembrete_enviado`.

**Parte B — resumo das agendadas** (se `agendados_ativo`):
- OS/Agenda com `dataAgendada` em `[hoje, hoje + lookahead_dias]`, status não
  finalizado/cancelado.
- Cliente: lembrete individual da visita marcada (template). Admin: entra no
  resumo. Dedupe `tipo='agendado'`, `ref_data = dia da visita`.

**Parte C — resumo do dono/admin (IA)** (se `para_dono`/`para_admin`):
- 1×/dia no `resumo_hora` (janela de 15 min, dedupe `tipo='resumo_dono'`,
  `ref_data=hoje`): junta (i) clientes vencendo a manutenção e (ii) visitas
  agendadas no lookahead; chama Claude Sonnet (`claude-sonnet-4-6`,
  `ANTHROPIC_API_KEY`) pedindo um resumo natural pt-BR; envia WhatsApp pro
  `dono_telefone` (e admins, se `para_admin`).

3. Retorna `{ manutencao, agendados, resumo, falhas }`.

### Variáveis do template (cliente/admin)
`{cliente}` `{empresa}` `{ultima_visita}` `{proxima_visita}` `{dias}`
`{equipamento}` `{endereco}` `{telefone}`. Substituição por `replace`.
Default `template_cliente`: *"Olá {cliente}! Já faz um tempinho desde a última
manutenção ({ultima_visita}). Recomendamos a próxima visita até {proxima_visita}.
Quer que a {empresa} agende pra você?"*

## Lib pura `src/lib/lembrete.js` (testável, sem rede)

- `tipoCliente(client)` → 'pj' | 'pf'.
- `intervaloEfetivo(client, config)` → dias.
- `proximaManutencao(ultimaVisitaISO, intervaloDias)` → Date.
- `manutencaoDue(proxima, hoje, antecedenciaDias)` → boolean (0..antecedência).
- `preencherTemplate(tpl, vars)` → string.
Cobertas por Vitest.

## Frontend — painel de configuração

Painel **"Lembrete de manutenção"** no `SettingsModule` (admin/gerente):
- Toggle ativo + sub-toggles (manutenção recorrente / resumo agendadas).
- Intervalo PJ (dias) + Intervalo PF (dias) + antecedência (dias).
- Lookahead (dias) + horário do resumo do dono.
- Canais (WhatsApp/Push) + destinatários (cliente/admin/dono) + telefone do dono.
- Templates cliente/admin com variáveis clicáveis.
- "Enviar teste" (manda exemplo pro próprio admin).
Ficha do cliente (Cadastro): campo opcional "Intervalo de manutenção (dias)".

Helpers em `src/supabase.js`: `getLembreteConfig`, `saveLembreteConfig`,
`sendLembreteTeste`.

## Setup / infra
- `pg_cron`: `lembrete-dispatch` a cada 15 min (SQL em `docs/ai-agent/`), segredo
  via Vault (RPC dedicada `lembrete_dispatch_key`).
- Secrets existentes: `ANTHROPIC_API_KEY`, Evolution via `ai_agent_config`.
- `send-push` já deployado; WhatsApp via Evolution já configurado.

## Fora de escopo (YAGNI)
- Intervalo por tipo de equipamento/serviço (escolhido: por tipo de cliente +
  override por cliente). Pode entrar depois.
- Cobrança quando JÁ venceu (escolhido: avisar antes de vencer). Fácil de somar
  depois (basta permitir `proxima − hoje` negativo até um limite).
- Email (escolhido WhatsApp+Push; `send-email` reaproveitável no futuro).

## Testes
- `src/lib/lembrete.js`: tipoCliente (cnpj→pj, cpf→pf), intervaloEfetivo
  (override > padrão), manutencaoDue (dentro/fora da antecedência),
  preencherTemplate. Vitest determinístico.
- Edge function: teste manual via `x-dispatch-key` com um cliente que tem OS
  finalizada datada pra cair na janela.

## Deploy
- Front-end: merge na `main` → Vercel.
- Edge function: `deploy_edge_function lembrete-dispatch` (verify_jwt=false).
- SQL: tabelas + policies + pg_cron (via apply_migration).
