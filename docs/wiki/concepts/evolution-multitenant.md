---
title: Evolution API multi-tenant
type: concept
updated: 2026-05-21
sources: []
related:
  - ../modules/ia-atendimento.md
  - ../modules/pos-venda.md
  - ../flows/whatsapp-ia-os.md
code_refs:
  - supabase/functions/whatsapp-webhook
  - docs/ai-agent/01-supabase-schema.sql
  - supabase/functions/pos-venda-dispatch
---

# Evolution API multi-tenant

Como uma infra Evolution compartilhada atende várias empresas do FrostERP.

> **Mudança 2026-05-21:** o orquestrador n8n foi substituído pela Edge Function `whatsapp-webhook` (Deno/TypeScript). O agente roda em Claude Haiku 4.5. Ver [[../flows/whatsapp-ia-os]].

## Infra Evolution (2026-05-20)

VPS Hetzner `162.55.58.199`: Evolution API v2.3.7 + Postgres + Caddy (HTTPS). Domínio `https://evolution.frosterp.com.br`. Instância `frost-minas` (empresa `cmp_default`).

## Mapeamento instance → company_id

1 instância Evolution por empresa. O `company_id` **não** vem do webhook. A Edge Function resolve:

```
select company_id from ai_agent_config
where evolution_instance = <body.instance> and enabled = true limit 1
```

Sem match (instância não cadastrada ou agente desabilitado) → **no-op gracioso** (a função retorna sem processar).

## Infra compartilhada com Pós-Venda

`ai_agent_config` é a fonte única de config Evolution — usada pelo agente IA, pelo dispatcher de pós-venda ([[../modules/pos-venda]]) e pelo envio de documentos da OS. Colunas-chave: `evolution_url`, `evolution_instance`, `enabled`, e `metadata` (jsonb, coluna adicionada em 2026-05-21) com `evolution_apikey`. A apikey da Evolution mora em `metadata.evolution_apikey` — lida pela Edge Function `whatsapp-webhook` e pelos helpers de frontend `sendWhatsAppMessage`/`sendWhatsAppMedia` (`src/platform.js`). Storage: bucket público `ai-media` para mídia do cliente (separado de `os-fotos`).

> **Dívida de segurança:** a apikey em `metadata` é exposta ao frontend pelos helpers de envio. Migrar o envio para Edge Function é trabalho futuro.

## RLS

`ai_conversations`/`ai_messages`/`ai_agent_config`/`ai_os_proposals` têm RLS por `company_id` via `company_members` + `auth.uid()`. A Edge Function usa service_role (bypass RLS). Mesmo padrão multi-tenant do `kv_store` ([[db-layer]]).
