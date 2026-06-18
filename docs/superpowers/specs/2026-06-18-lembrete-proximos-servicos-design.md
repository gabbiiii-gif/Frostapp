---
title: Lembrete de próximos serviços (personalizável)
type: design
updated: 2026-06-18
related:
  - ../../wiki/modules/process.md
code_refs:
  - supabase/functions/pos-venda-dispatch/index.ts
  - supabase/functions/whatsapp-webhook/index.ts
  - supabase/functions/send-push/index.ts
  - src/modules/PosVendaModule.jsx
---

# Lembrete de próximos serviços (personalizável)

## Objetivo

Avisar automaticamente sobre serviços que estão chegando. Totalmente
configurável por empresa: quando avisar (múltiplas antecedências), por qual
canal, pra quem, e com que texto. O **dono** recebe um resumo diário escrito
pela IA (Claude Sonnet).

## Decisões (fechadas no brainstorming)

- **Gatilho:** OS agendada (`erp:os:*` com `dataAgendada`+`horaAgendada` no futuro,
  status não finalizado/cancelado) **+** eventos da Agenda (`erp:agenda:*`).
- **Destinatários:** cliente, admin/gerente, e o **dono** (telefone fixo
  configurável, ex. `5593991106818`).
- **Canais:** WhatsApp (Evolution) + Push (PWA, `send-push`).
- **Antecedência:** múltiplos offsets configuráveis (ex. 1 dia antes E 2h antes).
- **Envio:** automático (cron), sem aprovação manual.
- **Templates cliente/admin:** editáveis com variáveis. **Dono:** texto gerado
  pela IA (resumo dos próximos serviços), não template.

## Arquitetura

Reusa o padrão do pós-venda: config por empresa + **cron** (`pg_cron` →
edge function) que varre os serviços e dispara o que está na hora. Dedupe em
tabela própria evita reenvio a cada tick. Sem fila intermediária — o cron varre
o estado atual das OS/Agenda (que vivem no `kv_store`) e envia direto.

```
pg_cron (a cada 15 min)
   └─ POST /functions/v1/lembrete-dispatch  (x-dispatch-key)
        ├─ lê lembrete_config (por empresa, ativo)
        ├─ varre erp:os:* / erp:agenda:* agendados no futuro
        ├─ pra cada offset due e ainda não enviado (lembrete_enviado):
        │     ├─ cliente  → WhatsApp/Push (template preenchido)
        │     └─ admin    → WhatsApp/Push (template preenchido)
        ├─ resumo do dono (1x/dia no horário configurado):
        │     └─ Claude Sonnet escreve o resumo → WhatsApp pro dono
        └─ grava lembrete_enviado (dedupe) + status
```

## Modelo de dados (Postgres)

### `lembrete_config` (1 linha por empresa)
```
company_id        text  PK
ativo             boolean        default false
offsets_min       int[]          default '{1440,120}'   -- antecedências em minutos
canais            text[]         default '{whatsapp}'   -- whatsapp | push
para_cliente      boolean        default true
para_admin        boolean        default true
para_dono         boolean        default false
dono_telefone     text                                  -- ex 5593991106818
dono_resumo_hora  text           default '07:00'        -- HH:MM (fuso America/Sao_Paulo)
template_cliente  text                                  -- com {variaveis}
template_admin    text
updated_at        timestamptz    default now()
```
RLS: leitura/escrita só admin/gerente da empresa (via `private.user_role()`),
igual às demais tabelas hardened. O cron acessa via service_role.

### `lembrete_enviado` (dedupe + histórico)
```
id              uuid PK default gen_random_uuid()
company_id      text
origem_tipo     text        -- 'os' | 'agenda'
origem_id       text        -- erp:os:<id> ou erp:agenda:<id>
destinatario    text        -- 'cliente' | 'admin' | 'dono'
canal           text        -- 'whatsapp' | 'push'
offset_min      int         -- qual antecedência (ou -1 pro resumo do dono)
ref_dia         date        -- dia do serviço (ou do resumo) — facilita dedupe
status          text        -- 'enviado' | 'erro'
erro            text
enviado_em      timestamptz default now()
unique (company_id, origem_id, destinatario, canal, offset_min)
```
A UNIQUE garante idempotência: cada (serviço, destinatário, canal, offset) só
dispara uma vez. Pro resumo do dono, `origem_id = 'dono:'||ref_dia` + offset -1.

## Edge function `lembrete-dispatch` (verify_jwt = false, auth x-dispatch-key)

Mesma fronteira do `pos-venda-dispatch`: chave via env `DISPATCH_KEY` ou Vault
RPC. Roda por `pg_cron`. Passos:

1. Para cada empresa com `lembrete_config.ativo`:
2. Carrega Evolution (`ai_agent_config.metadata.evolution_apikey`, igual pós-venda).
3. **Lembretes por serviço (cliente/admin):**
   - Lê OS agendadas: `kvList(supabase, companyId, 'erp:os:')`, filtra
     `status NOT IN ('finalizado','cancelado')` e monta `quando = dataAgendada T horaAgendada`
     (fuso America/Sao_Paulo). Idem Agenda (`erp:agenda:`).
   - Para cada offset em `offsets_min`: `disparo = quando - offset`. Se
     `agora ∈ [disparo, disparo + 15min)` (janela = intervalo do cron) e não há
     `lembrete_enviado` pra (origem_id, destinatario, canal, offset):
     - monta mensagem preenchendo o template (`template_cliente`/`template_admin`)
       com as variáveis (ver abaixo);
     - cliente: envia WhatsApp pro `clienteTelefone` (normalizado) e/ou Push se canal push;
     - admin: envia pra cada admin/gerente ativo (telefone do `erp:user`/`company_members`)
       e/ou Push (via `send-push` pro `user_id`);
     - grava `lembrete_enviado`.
4. **Resumo do dono (IA):**
   - Se `para_dono` e `agora` cruza `dono_resumo_hora` (mesma janela de 15min) e não
     há `lembrete_enviado` pra (`'dono:'||hoje`, 'dono', 'whatsapp', -1):
     - coleta os serviços de hoje (e amanhã) das OS/Agenda;
     - chama Claude Sonnet (`claude-sonnet-4-6`, `ANTHROPIC_API_KEY`) com um system
       prompt curto pedindo um resumo natural em pt-BR (ex.: "Bom dia! Hoje você
       tem 3 serviços: 9h João — geladeira (Rua X); 14h Maria — ...");
     - envia o texto via WhatsApp pro `dono_telefone`;
     - grava `lembrete_enviado`.
5. Retorna `{ enviados, falhas, empresas }`.

### Variáveis do template (cliente/admin)
`{cliente}` `{data}` `{hora}` `{servico}` `{equipamento}` `{endereco}`
`{tecnico}` `{empresa}` `{valor}`. Substituição simples por `replace`.
Default `template_cliente`: *"Olá {cliente}! Lembrete do seu serviço em {empresa}:
{servico} dia {data} às {hora}. Endereço: {endereco}. Qualquer coisa é só
chamar!"*. Default `template_admin`: *"Lembrete: {servico} de {cliente} ({equipamento})
amanhã {data} {hora}, técnico {tecnico}."*

## Frontend — painel de configuração

Novo painel **"Lembretes de serviço"** dentro do `SettingsModule` (admin/gerente),
seguindo o padrão dos painéis existentes:
- Toggle ativo.
- Editor de offsets (chips: "1 dia antes", "2h antes", "+ adicionar" → minutos).
- Checkboxes de canais (WhatsApp / Push) e destinatários (cliente / admin / dono).
- Campo telefone do dono + horário do resumo diário.
- Textareas dos templates cliente/admin com lista de variáveis clicáveis.
- Botão "Enviar teste" (dispara um lembrete de exemplo pro próprio admin).

Helpers em `src/supabase.js`: `getLembreteConfig(companyId)`,
`saveLembreteConfig(companyId, cfg)`, `sendLembreteTeste()`.

## Setup / infra
- `pg_cron`: agenda `lembrete-dispatch` a cada 15 min (script SQL em
  `docs/ai-agent/`), reusando o segredo do Vault (`pos_venda_dispatch_key` ou um
  novo `lembrete_dispatch_key`).
- Secrets já existentes: `ANTHROPIC_API_KEY`, Evolution via `ai_agent_config`.
- `send-push` já deployado (push). WhatsApp via Evolution já configurado.

## Fora de escopo (YAGNI)
- Manutenção recorrente (lembrete por cliente a cada X meses) — fase futura.
- Aprovação manual antes de enviar (escolhido: automático).
- Resposta do cliente ao lembrete (isso é o pós-venda, já existe).
- Canal email pro lembrete (escolhido WhatsApp+Push; email pode entrar depois
  reusando `send-email`).

## Testes
- Lib pura `src/lib/lembrete.js`: `calcularDisparos(quando, offsets, agora, janelaMin)`
  (quais offsets estão due) e `preencherTemplate(tpl, vars)`. Cobertas por Vitest
  (determinístico, sem rede).
- Edge function: teste manual via trigger com `x-dispatch-key` + uma OS de teste
  agendada pra daqui a poucos minutos.

## Deploy
- Front-end: merge na `main` → Vercel.
- Edge function: `deploy_edge_function lembrete-dispatch` (verify_jwt=false).
- SQL: criar tabelas + policies + pg_cron (via apply_migration).
