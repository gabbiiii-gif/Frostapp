# Spec — Integração WhatsApp: webhook IA + envio de documentos da OS

- **Data:** 2026-05-20
- **Status:** aprovado (design), aguardando revisão do spec
- **Escopo:** Duas entregas relacionadas, ambas sobre a Evolution API já no ar:
  - **Parte 1** — Edge Function `whatsapp-webhook`: recebe o webhook da Evolution, persiste a conversa e roda o agente de IA (Claude). Substitui o orquestrador n8n previsto no spec `2026-05-18-ia-whatsapp-v2-design.md`.
  - **Parte 2** — Botão na OS (`ProcessModule`) para enviar orçamento e OS executada ao WhatsApp do cliente (texto + PDF), via nova Edge Function `send-document`.

## Contexto

A infraestrutura Evolution API está no ar (sessão 2026-05-20):

- VPS Hetzner `162.55.58.199`, Evolution API **v2.3.7** + Postgres + Caddy (HTTPS).
- Domínio `https://evolution.frosterp.com.br`. Instância `frost-minas` conectada (`state: open`), envio de texto validado.

O design v2 (`2026-05-18-ia-whatsapp-v2-design.md`) assumia **n8n** como orquestrador entre Evolution e Supabase. Decisão revista nesta sessão: **substituir o n8n por uma Edge Function Supabase**, eliminando a necessidade de hospedar um servidor n8n separado. As decisões de produto D1–D4 e os componentes A–D do spec v2 permanecem válidos; muda apenas o local de execução (Deno/TypeScript na Edge Function em vez de nós n8n).

Estado atual do projeto PROD `frostapp2.0` (`rbwzhglsztmjvwrcydcy`):

- Tabelas `ai_conversations`, `ai_messages`, `ai_agent_config` existem (schema `01-supabase-schema.sql` aplicado parcialmente) — todas **vazias**.
- Tabela `ai_os_proposals` **não criada** no PROD (existe só no arquivo `.sql`).
- `ai_agent_config` **sem nenhuma linha** — instância `frost-minas` não mapeada a empresa.
- Bucket `ai-media` — não criado.
- Empresa única: `cmp_default` (MINAS REFRIGERAÇÃO).
- Edge Functions existentes: `migrate-login`, `admin-create-user`, `send-push`, `master-login`, `pos-venda-dispatch`. A `pos-venda-dispatch` já usa o secret `EVOLUTION_APIKEY` e lê `ai_agent_config` para `evolution_url`/`evolution_instance` — padrão a reaproveitar.

## Decisões (confirmadas com o usuário)

| # | Decisão |
|---|---------|
| D1 | LLM do agente = **Claude `claude-haiku-4-5`** (Anthropic). Escolhido por tool calling confiável e pt-BR. |
| D2 | **Fase 1** = texto + imagem. **Áudio (voz) fica para a fase 2** (Anthropic não transcreve áudio; opção futura: Groq Whisper). |
| D3 | A IA **respeita horário comercial** (`ai_agent_config.business_hours`). Fora do horário: envia `out_of_hours_message` e **não** aciona o LLM. |
| D4 | Arquitetura = **função única com processamento em background** (`EdgeRuntime.waitUntil`). Responde `200` imediato para evitar retry/duplicação da Evolution. |
| D5 | Permanecem do spec v2: criação de OS sempre exige aprovação humana (proposta via `propose_os`); a OS é escrita pelo app via `DB.set`, não pela Edge Function. |
| D6 | Parte 2: enviar orçamento/OS ao cliente como **texto + PDF anexo**. PDF gerado no app a partir do HTML existente; envio via nova Edge Function `send-document` (apikey Evolution não pode ficar no frontend). |

## Arquitetura

Edge Function `whatsapp-webhook`, `verify_jwt: false` (a Evolution não envia JWT).

```
WhatsApp → Evolution (webhook MESSAGES_UPSERT) → whatsapp-webhook
  1. Valida ?token= contra secret WEBHOOK_TOKEN          → 401 se errado
  2. Parseia payload; ignora eventos != messages.upsert  → 200 vazio
  3. Filtra: descarta fromMe=true, grupos (@g.us), msg sem texto nem imagem
  4. Responde 200 OK imediatamente
  ── background: EdgeRuntime.waitUntil(...) ──
  5. Resolve empresa: evolution_instance → company_id (ai_agent_config)
       sem match ou enabled=false → no-op
  6. Upsert ai_conversations (company_id + customer_phone)
     Se imagem: download base64 via Evolution → upload bucket ai-media → media_url
     Insert ai_messages (role='customer', content, media_url)
  7. Gates (qualquer um para o fluxo antes do LLM):
       a. conversation.status != 'active'  → não responde (humano assumiu)
       b. fora de business_hours           → envia out_of_hours_message, fim
  8. Monta histórico (~20 últimas ai_messages) → chama Claude (loop tool-use, máx 5 iterações)
  9. Insert ai_messages (role='agent', content)
 10. POST {evolution_url}/message/sendText/{instance}  (header apikey)
```

Eventos `connection.update` e `qrcode.updated` (caso o webhook global os envie) retornam `200` vazio sem processamento.

## Componentes

### A — Parser / filtro
Extrai do payload da Evolution: `instance`, `customer_phone` (de `key.remoteJid`, normalizado E.164 sem `@s.whatsapp.net`), `customer_name` (`pushName`), tipo e conteúdo:
- texto: `message.conversation` ou `message.extendedTextMessage.text`
- imagem: `message.imageMessage` (+ `caption` como legenda)

Descarta: `key.fromMe === true`, `remoteJid` terminando em `@g.us` (grupo), mensagens sem texto e sem imagem (ex.: áudio na fase 1 — ver Fora de escopo).

### B — Resolução de empresa
```sql
select company_id, system_prompt, business_hours, out_of_hours_message,
       evolution_url, evolution_instance, enabled
from ai_agent_config
where evolution_instance = $1 and enabled = true
limit 1;
```
Sem match → no-op gracioso (instância não registrada / agente desabilitado). Não há fallback `cmp_default`.

### C — Persistência
- `ai_conversations`: upsert pela chave única `(company_id, customer_phone)`. Atualiza `customer_name` se vier preenchido.
- `ai_messages`: insert `role='customer'`, `content` (texto ou legenda da imagem), `media_url` (se imagem).
- Imagem: a `url` do `imageMessage` é criptografada — baixar via endpoint Evolution `POST /chat/getBase64FromMediaMessage/{instance}` (header `apikey`). Upload do binário ao bucket `ai-media`, path `ai-media/{company_id}/{conversation_id}/{uuid}.jpg`. `media_url` = URL pública. A imagem persiste para virar foto da OS quando a proposta for aprovada (bucket `os-fotos`, Regra 4 do CLAUDE.md).
- O trigger `touch_conversation_on_message` já atualiza `last_message_at` e `unread_count`.

### D — Agente Claude
- Modelo `claude-haiku-4-5`, API Anthropic Messages.
- `system` = `ai_agent_config.system_prompt`.
- `messages` = histórico das ~20 últimas `ai_messages` da conversa, mapeadas: `role='customer'` → `user`; `role='agent'` → `assistant`. Imagem da mensagem atual enviada como bloco `image` (base64) dentro do `user`.
- Loop tool-use: enquanto a resposta tiver `stop_reason='tool_use'`, executa as tools, devolve `tool_result`, chama de novo. Limite **5 iterações**.

### E — Tools
| Tool | Ação |
|------|------|
| `propose_os` | `insert into ai_os_proposals (company_id, conversation_id, payload)`. `payload` = `{customer_name,address,equipment_type,equipment_brand,equipment_model,problem,phone,media_urls[]}`. Descrição deixa claro que é PROPOSTA (não OS criada). |
| `get_recent_os` | Lê OS recentes do `kv_store`: `select value from kv_store where key like '{company_id}:erp:os:%'`, filtrando por telefone do cliente. Read-only. (Prefixo `erp:os:` confirmado em `App.jsx`; chaves escopadas como `cmp_<id>:erp:os:<id>`.) |
| `handoff_to_human` | `update ai_conversations set status='pending_human', ai_handoff_reason=$motivo`. Dispara push ao admin via Edge Function `send-push`. |

O `system_prompt` em `ai_agent_config` é ajustado para refletir `propose_os` (registra solicitação para análise; **não** promete OS criada). Substitui o texto atual que cita `create_os`.

### F — Resposta ao cliente
`POST {evolution_url}/message/sendText/{evolution_instance}`, header `apikey: $EVOLUTION_APIKEY`, body `{number, text}`. Mesmo padrão de `pos-venda-dispatch`.

## Mudanças de schema / setup

| Item | Ação | Como |
|------|------|------|
| Tabela `ai_os_proposals` | Criar no PROD | `apply_migration` com DDL de `01-supabase-schema.sql` (linhas 76-90) + RLS `prop_company_scope` + publicação Realtime |
| Bucket `ai-media` | Criar — público (alinha com `os-fotos`) | Painel Supabase Storage ou SQL `storage.buckets` |
| Linha `ai_agent_config` | Inserir | `company_id='cmp_default'`, `evolution_instance='frost-minas'`, `evolution_url='https://evolution.frosterp.com.br'`, `enabled=true`. `system_prompt` ajustado para `propose_os`. |
| Secret `ANTHROPIC_API_KEY` | Adicionar (usuário) | Painel Supabase → Edge Functions → Secrets, ou `supabase secrets set`. **Chave nova** — a anterior foi exposta no chat e será revogada. |
| Secret `WEBHOOK_TOKEN` | Adicionar | String aleatória; usada na query `?token=` do webhook |
| Secret `EVOLUTION_APIKEY` | Verificar | Já usado por `pos-venda-dispatch`; reusar |
| `.env` da Evolution VPS | Religar webhook | `N8N_WEBHOOK_URL=https://rbwzhglsztmjvwrcydcy.supabase.co/functions/v1/whatsapp-webhook?token=<WEBHOOK_TOKEN>` → `docker compose up -d` |
| Edge Function `whatsapp-webhook` | Criar e deployar (Parte 1) | `supabase functions deploy` ou MCP `deploy_edge_function`, `verify_jwt:false` |
| Edge Function `send-document` | Criar e deployar (Parte 2) | idem; auth alinhada com `send-push` |
| Dependência de PDF no app | Adicionar | `npm install` da lib escolhida (ex.: `html2pdf.js`) |

## Segurança

- Edge Function pública (`verify_jwt:false`); proteção = secret `WEBHOOK_TOKEN` comparado contra `?token=` da URL. Sem match → `401`.
- A função usa `SUPABASE_SERVICE_ROLE_KEY` (injetada pelo runtime) → bypass de RLS para escrever em qualquer empresa.
- Segredos (`ANTHROPIC_API_KEY`, `EVOLUTION_APIKEY`, `WEBHOOK_TOKEN`) apenas como env/secrets — nunca em código ou repositório.
- Escrita sempre com `company_id` resolvido de `ai_agent_config`; sem match = no-op (não cria registro órfão).
- **Pendência de segurança:** a chave Anthropic colada no chat desta sessão deve ser revogada pelo usuário; usar uma chave nova no secret.

## Tratamento de erro

- Payload inválido ou evento ignorado → `200` vazio (evita retry da Evolution).
- `token` ausente/errado → `401`.
- Erro no processamento em background (timeout Claude, Evolution indisponível, falha de tool) → log no console da função. A mensagem do cliente **já foi gravada** em `ai_messages` no passo 6, então o admin a vê no app e pode responder manualmente. Sem retry automático na fase 1.
- Loop de tools do Claude limitado a 5 iterações (anti-loop infinito).
- Falha no download/upload da imagem → segue sem `media_url`; a IA responde considerando só o texto/legenda.

## Testes

- Helper puro de validação/normalização do payload da proposta (campos obrigatórios, telefone E.164) → `src/utils.js` + caso em `src/utils.test.js` (Vitest, padrão do projeto).
- Edge Functions: sem runner automatizado no projeto. Roteiro de validação manual.

Parte 1 (`whatsapp-webhook`):
  1. Enviar texto ao WhatsApp da instância → conferir resposta da IA e linha em `ai_messages`.
  2. Enviar imagem de equipamento → conferir descrição/uso pela IA e `media_url` no bucket `ai-media`.
  3. Enviar mensagem fora do horário comercial → conferir `out_of_hours_message` e ausência de chamada ao LLM.
  4. Conversa completa de coleta → conferir `insert` em `ai_os_proposals` (`status='pending_approval'`).
  5. Enviar mensagem em conversa com `status='pending_human'` → conferir que a IA não responde.

Parte 2 (`send-document` + botão OS):
  6. OS com cliente com telefone → clicar "Enviar orçamento" → conferir texto + PDF no WhatsApp do cliente.
  7. OS com cliente sem telefone → conferir botão desabilitado.
  8. Simular falha (Evolution offline) → conferir toast de erro e OS inalterada.

## Parte 2 — Envio de documentos da OS ao WhatsApp

Botão no módulo de Ordens de Serviço para mandar orçamento e OS executada ao WhatsApp do cliente, como mensagem de texto + PDF anexo.

### App (`ProcessModule` em `App.jsx`)

- Botões na OS: "Enviar orçamento" e "Enviar OS" ao WhatsApp do cliente.
- Telefone resolvido do cliente vinculado (`os.clienteId` → cadastro de clientes, prefixo `erp:client:`). Cliente sem telefone → botão desabilitado com aviso.
- Gera PDF a partir do HTML já existente (`generateOrcamentoHTML(os, clients)` / `generateOSHTML(os, clients)` — `App.jsx` linhas ~5044-4910) usando lib de geração de PDF (ex.: `html2pdf.js`; lib definitiva decidida no plano de implementação). Resultado: PDF em base64.
- Monta resumo em texto (cliente, serviços, total, garantia, dados PIX).
- Chama `supabase.functions.invoke('send-document', { body: {company_id, phone, text, pdf_base64, filename} })`.
- Feedback via toast (padrão do app). Falha no envio → toast de erro; a OS não muda de estado.

### Edge Function `send-document` (nova)

- Recebe `{company_id, phone, text, pdf_base64, filename}`.
- Resolve `evolution_url`/`evolution_instance` de `ai_agent_config` (mesma query da Parte 1).
- Envia texto: `POST {evolution_url}/message/sendText/{instance}`.
- Envia PDF: `POST {evolution_url}/message/sendMedia/{instance}` — `mediatype: document`, conteúdo base64, `fileName`.
- Header `apikey` = secret `EVOLUTION_APIKEY` (reusado).
- Erros propagados ao app como JSON `{error}` + status apropriado.

### Pontos a confirmar no plano de implementação (não no spec)

- Lib de PDF definitiva (`html2pdf.js` vs `jsPDF.html()`); ambas rasterizam via html2canvas — aceitável para documento visual.
- Modelo de auth da `send-document` — alinhar com o padrão de `send-push` (`verify_jwt`); confirmar como o app autentica chamadas a Edge Functions (Supabase Auth JWT vs anon key).
- Endpoint exato de mídia da Evolution v2.3.7 (`/message/sendMedia` — confirmar nome do campo do arquivo: `media`/`fileName`/`mediatype`).

## Fora de escopo (fase 1)

- **Áudio (mensagem de voz):** ignorado na fase 1 (descartado no filtro). Fase 2 com transcrição (ex.: Groq Whisper).
- Aba "Propostas de OS" no `IAAtendimentoModule` e fluxo de aprovação no app — coberto pelo spec v2 (`2026-05-18-ia-whatsapp-v2-design.md`); não faz parte desta Edge Function. Esta spec entrega o lado servidor (proposta gravada + Realtime); o app consome.
- Resposta automática ao cliente quando uma proposta é rejeitada.
- Retry automático de mensagens que falharam no background.
- Refactor do monólito `App.jsx`.

## Riscos / notas

- **Git não inicializado neste repositório** (ver memória `git-remote` / spec v2). CLAUDE.md Regra 1 (commit + deploy Vercel) não é executável para o spec/código local até o repositório git existir; o deploy da Edge Function em si é via Supabase (`supabase functions deploy` ou MCP `deploy_edge_function`), independente do git.
- Endpoint `POST /chat/getBase64FromMediaMessage/{instance}` deve ser validado contra a Evolution **v2.3.7** em uso (o spec v2 citava a imagem `latest`).
- Custo: Claude Haiku 4.5 no volume estimado (~500 conv/mês) é baixo; vision (imagem) tem custo por imagem — aceitável. Documentar no quadro de custos do `03-setup-guide.md`.
- O webhook global da Evolution (`WEBHOOK_GLOBAL_*`) envia todos os eventos; a função precisa filtrar `messages.upsert`. Alternativa: restringir eventos no `.env` da Evolution (`WEBHOOK_EVENTS_*`) — já está com `MESSAGES_UPSERT=true`.
- Ingest no wiki (`docs/wiki/`) das mudanças — CLAUDE.md Regra 5 — após a implementação.
