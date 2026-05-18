# Agente de IA WhatsApp — Guia de Setup

Atendimento via WhatsApp com IA que cria OS automaticamente no FrostERP.

```
WhatsApp ─► Evolution API ─► N8N (AI Agent) ─► Supabase ─► FrostERP (Realtime)
                                  │
                                  └─► Evolution API ─► WhatsApp (resposta)
```

---

## Pré-requisitos

- Projeto Supabase do FrostERP já em uso
- Conta OpenAI com créditos (~US$5 cobre milhares de mensagens com `gpt-4o-mini`)
- Número de WhatsApp dedicado (recomendo um chip novo — Evolution API usa WhatsApp Web não-oficial)
- Docker instalado em alguma VPS/PC para rodar a Evolution API (ou usar imagem do Render/Railway)

---

## Passo 1 — Rodar SQL no Supabase

1. Abra o **SQL Editor** do projeto Supabase
2. Cole o conteúdo de `docs/ai-agent/01-supabase-schema.sql`
3. Execute. Vai criar `ai_conversations`, `ai_messages`, `ai_agent_config`, `ai_os_proposals` + RLS + Realtime
4. **Crie o bucket de mídia `ai-media` (público)** — armazena os áudios/imagens que o cliente envia pelo WhatsApp e o agente encaminha. Use uma das opções:
   - **Dashboard**: Storage → **New bucket** → nome `ai-media` → marque **Public** → criar
   - **SQL** (no mesmo SQL Editor):
     ```sql
     insert into storage.buckets (id, name, public)
     values ('ai-media', 'ai-media', true)
     on conflict (id) do nothing;
     ```

---

## Passo 2 — Subir Evolution API

Crie um arquivo `docker-compose.yml`:

```yaml
version: '3.8'
services:
  evolution:
    image: atendai/evolution-api:latest
    container_name: evolution-frost
    restart: unless-stopped
    ports:
      - "8080:8080"
    environment:
      SERVER_URL: https://seu-dominio.com
      AUTHENTICATION_API_KEY: troque-por-uma-chave-forte-aleatoria
      DATABASE_ENABLED: "true"
      DATABASE_PROVIDER: postgresql
      DATABASE_CONNECTION_URI: postgresql://usuario:senha@host:5432/evolution
      CACHE_REDIS_ENABLED: "false"
      WEBHOOK_GLOBAL_URL: https://SEU_N8N.app.n8n.cloud/webhook/frost-whatsapp
      WEBHOOK_GLOBAL_ENABLED: "true"
      WEBHOOK_EVENTS_MESSAGES_UPSERT: "true"
    volumes:
      - evolution_instances:/evolution/instances

volumes:
  evolution_instances:
```

```bash
docker compose up -d
```

**Crie uma instância** (substitua o `apikey` pela sua):

```bash
curl -X POST 'http://localhost:8080/instance/create' \
  -H 'apikey: troque-por-uma-chave-forte-aleatoria' \
  -H 'Content-Type: application/json' \
  -d '{"instanceName":"frost-empresa1","qrcode":true,"integration":"WHATSAPP-BAILEYS"}'
```

A resposta traz um QR code (base64). Escaneie pelo WhatsApp do número dedicado em **Aparelhos conectados → Conectar aparelho**.

---

## Passo 3 — Importar workflow no N8N Cloud

1. Acesse seu n8n.cloud → **Workflows → Import from File**
2. Selecione `docs/ai-agent/02-n8n-workflow.json`
3. O workflow vai aparecer com placeholders — substitua:
   - **Credencial Postgres** (Supabase): Settings → Database em Supabase pega `host`, `port=6543` (pooler), `database=postgres`, `user=postgres.<ref>`, `password` (gere no Supabase). SSL = `require`
   - **Credencial OpenAI**: API key de https://platform.openai.com/api-keys
   - **Nó "Envia WhatsApp"**: troque `SEU_EVOLUTION_HOST` pela URL pública da Evolution e `SUBSTITUA_PELA_API_KEY_EVOLUTION` pela apikey
   - **Nó "Extrai campos"** → `company_id`: cole o UUID da empresa do FrostERP (busque em `public.companies` no Supabase)
4. Ative o workflow (toggle no topo)
5. Copie a **URL do webhook de produção** (no nó "Webhook Evolution", aba Production URL) — formato `https://SEU.app.n8n.cloud/webhook/frost-whatsapp`
6. Atualize a env `WEBHOOK_GLOBAL_URL` da Evolution API com essa URL e reinicie o container

---

## Passo 4 — Habilitar módulo no Frostapp

1. Faça login no app como **admin**
2. Sidebar → **IA / Atendimento** (novo módulo)
3. Em **Configurações do Agente**:
   - Marque "Agente ativo"
   - Informe nome da instância Evolution (`frost-empresa1`)
   - Informe URL pública da Evolution API
   - Ajuste o prompt do sistema se quiser
4. Salvar

---

## Passo 5 — Testar

Envie uma mensagem do **seu celular pessoal** para o número da empresa:

> "oi, preciso consertar minha geladeira que não tá gelando"

Em alguns segundos:
- A IA responde no WhatsApp pedindo nome, endereço, marca/modelo
- No app, em **IA / Atendimento**, aparece a conversa em tempo real
- Quando você der todos os dados, a IA cria uma OS automaticamente — visível no módulo Ordens de Serviço

---

## Troubleshooting

| Sintoma | Provável causa | Fix |
|---|---|---|
| QR code não aparece | Evolution não iniciou | `docker logs evolution-frost` |
| Mensagem chega no WhatsApp mas N8N não dispara | Webhook global não setado | Confira `WEBHOOK_GLOBAL_URL` e reinicie container |
| N8N dispara mas Postgres falha | Credencial errada ou porta 5432 (use 6543 pooler) | Use pooler do Supabase |
| IA responde mas mensagem não volta pro WhatsApp | API key Evolution errada no nó HTTP | Verifique header `apikey` no nó "Envia WhatsApp" |
| App não recebe novas mensagens em tempo real | Realtime não publicado | Rode novamente o trecho `alter publication supabase_realtime add table ...` |
| IA loop infinito (responde si mesma) | Filtro `fromMe` falhou | Confira nó "Filtra msg recebida" |

---

## Custos estimados (mensal, ~500 conversas)

| Serviço | Custo |
|---|---|
| N8N Cloud | $20 (Starter) |
| OpenAI GPT-4o-mini (texto) | ~$3 |
| OpenAI GPT-4o (vision, imagens) | variável — maior que gpt-4o-mini; só quando o cliente manda foto |
| OpenAI Whisper (`whisper-1`, áudios) | ~$0.006/min de áudio |
| Evolution API (VPS Hetzner CX11) | $4 |
| Supabase (inclui Storage `ai-media`) | $0 (Free tier serve) |
| **Total** | **~$27/mês + uso de vision/whisper** |

Para reduzir: rode N8N self-hosted na mesma VPS da Evolution → economiza $20.

---

## v2 — Implementado

Os 4 itens que antes eram "próximos passos opcionais" já estão implementados nesta versão (ref `docs/superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md`):

- **Áudios**: voz → transcrição com Whisper (`whisper-1`) → Agent
- **Imagens**: foto → GPT-4o vision para diagnóstico visual
- **Confirmação humana**: proposta de OS gravada em `ai_os_proposals` (`status=pending_approval`) → aprovação no app antes de virar OS real
- **Múltiplas empresas**: 1 instância Evolution por empresa, `company_id` resolvido pelo `evolution_instance` no webhook

### Roteiro de teste manual

1. **Multi-empresa**: cadastre 2 registros `ai_agent_config` com `evolution_instance` distintos; envie msg de cada número → confira que cada conversa/proposta recebe o `company_id` correto (e que uma instância não cadastrada é um no-op gracioso).
2. **Áudio**: envie uma mensagem de voz → confira a transcrição em `ai_messages.content`, o `media_url` preenchido e o arquivo presente no bucket `ai-media`.
3. **Imagem**: envie uma foto de equipamento → confira a descrição (vision) no fluxo e o `media_url`/arquivo no bucket.
4. **Proposta + aprovação**: complete os dados pelo WhatsApp → confira a linha em `ai_os_proposals` (status `pending_approval`); no app, módulo IA / Atendimento → aba "Propostas de OS" → **Aprovar** → confira a OS criada (Ordens de Serviço) com as fotos, push recebido, e `ai_os_proposals.status=approved` + `ai_conversations.linked_os_id` setado. Teste **Rejeitar** → status `rejected`.
5. **Ponto de verificação de risco**: confirme que o endpoint Evolution de mídia (`/chat/getBase64FromMediaMessage`) e o formato de resposta do upload do Supabase Storage batem com a versão `atendai/evolution-api:latest` em uso; ajuste os nós "Baixa mídia Evolution" / "Upload Storage" / "Vision" do workflow se divergir.
