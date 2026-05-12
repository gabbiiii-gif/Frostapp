# Agente de IA — WhatsApp Atendimento

Pasta com tudo que você precisa para subir o agente de IA do FrostERP.

## Ordem de uso

1. **[01-supabase-schema.sql](./01-supabase-schema.sql)** — cole no SQL Editor do Supabase. Cria tabelas, RLS, Realtime.
2. **[02-n8n-workflow.json](./02-n8n-workflow.json)** — importe no n8n.cloud (Workflows → Import from File).
3. **[03-setup-guide.md](./03-setup-guide.md)** — passo a passo completo (Evolution API, credenciais, troubleshooting).

## O que já está pronto no código

- Novo módulo **IA / Atendimento** na sidebar (admin/gerente/atendente)
- `IAAtendimentoModule` em `src/App.jsx` — lista conversas, chat ao vivo via Supabase Realtime, intervenção manual, configuração do agente
- Permissão `ia` adicionada em `ROLE_PERMISSIONS`

## Stack

```
WhatsApp → Evolution API → N8N webhook → AI Agent (GPT-4o-mini)
                                          │
                                          ├─► Supabase (ai_conversations, ai_messages)
                                          │      │
                                          │      └─► Realtime → Frostapp (módulo IA)
                                          │
                                          └─► Evolution API → WhatsApp (resposta)
```

## Custo estimado

~US$ 27/mês (500 conversas). Detalhes no setup guide.
