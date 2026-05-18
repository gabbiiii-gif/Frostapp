---
title: Evolution API multi-tenant
type: concept
updated: 2026-05-18
sources: []
related:
  - ../modules/ia-atendimento.md
  - ../modules/pos-venda.md
  - ../flows/whatsapp-ia-os.md
code_refs:
  - docs/ai-agent/02-n8n-workflow.json
  - docs/ai-agent/01-supabase-schema.sql
  - supabase/functions/pos-venda-dispatch
---

# Evolution API multi-tenant

Como uma infra Evolution/n8n compartilhada atende várias empresas do FrostERP.

## Mapeamento instance → company_id

1 instância Evolution por empresa. O `company_id` **não** vem do webhook (era um bug pré-v2: `body.company_id || 'cmp_default'`). A v2 resolve no n8n:

```
select company_id from ai_agent_config
where evolution_instance = <body.instance> and enabled = true limit 1
```

Sem match (instância não cadastrada ou agente desabilitado) → IF `Empresa encontrada?` → ramo falso → `Responde Webhook`. **No-op gracioso**, sem null-ref downstream. Todos os nós downstream usam `$('Resolve empresa').item.json.company_id`.

## Infra compartilhada com Pós-Venda

`ai_agent_config` (`evolution_url`, `evolution_instance`, `enabled`) é a fonte única de config Evolution — usada tanto pelo agente IA quanto pelo dispatcher de pós-venda ([[../modules/pos-venda]]). Secret `EVOLUTION_APIKEY` compartilhado. Storage: bucket público `ai-media` para mídia do cliente (separado de `os-fotos`, que é o bucket de fotos de OS — ver [[supabase-sync]]).

## RLS

`ai_conversations`/`ai_messages`/`ai_agent_config`/`ai_os_proposals` têm RLS por `company_id` via `company_members` + `auth.uid()`. n8n usa service_role (bypass RLS). Mesmo padrão multi-tenant do `kv_store` ([[db-layer]]).
