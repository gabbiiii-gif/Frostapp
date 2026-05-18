# Spec — Agente IA WhatsApp v2 (4 extensões) + ingest wiki

- **Data:** 2026-05-18
- **Status:** aprovado (design), aguardando revisão do spec
- **Escopo:** as 4 extensões do `docs/ai-agent/03-setup-guide.md` ("Próximos passos") + ingest do conhecimento no wiki do projeto.

## Contexto

O FrostERP já possui:

- Módulo **IA / Atendimento** (`IAAtendimentoModule` em `src/App.jsx`, ~linha 11980): lista conversas, chat ao vivo via Supabase Realtime, intervenção manual, painel de config. Permissão `ia` em `ROLE_PERMISSIONS`.
- Schema do agente em `docs/ai-agent/01-supabase-schema.sql`: `ai_conversations`, `ai_messages`, `ai_agent_config` + RLS multi-tenant + Realtime + trigger `touch_conversation_on_message`.
- Workflow n8n em `docs/ai-agent/02-n8n-workflow.json`: webhook Evolution → filtra → extrai campos → upsert conversa → grava msg → AI Agent (gpt-4o-mini) com memória Postgres e tools `create_os`/`get_recent_os`/`handoff_to_human` → grava resposta → envia WhatsApp.
- `src/platform.js`: helpers de push já prontos (`sendServerPush`, `requestNotifPermission`, `showNotification`).
- Pós-Venda (sessão 2026-05-18): `src/modules/PosVendaModule.jsx`, `scheduleOSPosVenda()` (`App.jsx:946`), tabelas `pos_venda_config/optout/mensagens/templates`, Edge Function `supabase/functions/pos-venda-dispatch`, `api/pos-venda-cron.js`, cron Vercel `*/15 * * * *`. Reusa `ai_agent_config` (evolution_url/instance) + secret `EVOLUTION_APIKEY`.

Lacunas que motivam este spec:

1. **Multi-empresa quebrado:** o nó "Extrai campos" usa `company_id = $json.body.company_id || 'cmp_default'`. A Evolution não envia `company_id`; o mapeamento correto é por `instance`.
2. **Áudio/imagem ignorados:** "Extrai campos" só lê `message.conversation` / `extendedTextMessage.text`. Mensagens de voz e foto caem como texto vazio.
3. **OS nunca é criada:** o tool `create_os` é um `toolWorkflow` com `workflowId` vazio — não existe sub-workflow. Mesmo se existisse, foi decidido que a criação não fica no n8n.
4. **Sem gate humano:** não há aprovação antes de gerar OS.

## Decisões (confirmadas com o usuário)

| # | Decisão |
|---|---|
| D1 | Criação de OS **sempre exige aprovação humana** (sem modo automático). |
| D2 | Ao aprovar, a OS é escrita **pelo app via DB layer** (`DB.set`) — preserva audit trail, escopo por empresa, sync Supabase e bridge finance (CLAUDE.md Regras 2/4). Não usar Edge Function/n8n para criar a OS. |
| D3 | Áudio e imagem do cliente são **persistidos no Supabase Storage** (bucket dedicado `ai-media`), não só transcritos. URL pública gravada em `ai_messages.media_url`. |
| D4 | Multi-empresa: 1 instância Evolution por empresa; `company_id` resolvido por `evolution_instance` em `ai_agent_config`. |

## Arquitetura

Fluxo alvo:

```
WhatsApp → Evolution → n8n
  → Filtra msg recebida
  → Extrai campos (phone, name, instance, tipo de mídia)
  → Resolve empresa (instance → company_id via ai_agent_config)   [novo]
  → [áudio?  baixa mídia → Storage → Whisper → texto]               [novo]
  → [imagem? baixa mídia → Storage → GPT-4o vision → descrição]     [novo]
  → Upsert conversa → grava msg cliente (content + media_url)
  → AI Agent (gpt-4o-mini)
      tools: propose_os [renomeado de create_os], get_recent_os, handoff_to_human
  → grava resposta IA → envia WhatsApp
ai_os_proposals (INSERT por propose_os)
  → Supabase Realtime → app IAAtendimentoModule (aba Propostas)
  → admin Aprova → App.jsx cria OS via DB.set (fotos = media_urls) → push admin
            Rejeita → status=rejected
```

### Componente A — Multi-empresa (instance → company_id)

Novo nó Postgres "Resolve empresa" após "Extrai campos":

```sql
select company_id
from ai_agent_config
where evolution_instance = '{{ $json.instance }}' and enabled = true
limit 1;
```

- `company_id` passa a ser o resultado deste nó em todos os nós downstream (substituir `$('Extrai campos').item.json.company_id` por `$('Resolve empresa').item.json.company_id`).
- Sem match → ir direto para "Responde Webhook" (instância não registrada / agente desabilitado; no-op gracioso).
- Não há mais fallback `'cmp_default'`.

### Componente B — Áudio (Whisper)

Ramo condicional após "Resolve empresa", quando `body.data.message.audioMessage` existe:

1. HTTP POST à Evolution `/chat/getBase64FromMediaMessage/{instance}` (a `url` crua do WhatsApp é criptografada — precisa do endpoint da Evolution que devolve base64/binário). Header `apikey`.
2. Upload do binário ao Storage: `ai-media/{company_id}/{conversation_id}/{uuid}.ogg`.
3. OpenAI `whisper-1` (transcription) sobre o binário → texto pt-BR.
4. Entrada do AI Agent = transcrição. `ai_messages` gravada com `content` = transcrição e `media_url` = URL pública do Storage.

### Componente C — Imagem (GPT-4o vision)

Ramo condicional idem, quando `body.data.message.imageMessage` existe:

1. Baixa mídia via mesmo endpoint Evolution; sobe ao Storage `ai-media/{company_id}/{conversation_id}/{uuid}.jpg` (URLs da Evolution expiram — Storage garante durabilidade e permite virar foto da OS).
2. OpenAI `gpt-4o` (vision) com prompt de diagnóstico de refrigeração/climatização → descrição textual objetiva.
3. Entrada do AI Agent = `[Imagem enviada pelo cliente]: <descrição> + <legenda da imagem se houver>`. `ai_messages.media_url` = URL pública (candidata a foto da OS na aprovação).

### Componente D — Confirmação humana (núcleo)

**Nova tabela** (em `01-supabase-schema.sql`):

```sql
create table if not exists public.ai_os_proposals (
  id               uuid primary key default gen_random_uuid(),
  company_id       text not null references public.companies(id) on delete cascade,
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  payload          jsonb not null,   -- {customer_name,address,equipment_type,equipment_brand,equipment_model,problem,phone,media_urls[]}
  status           text not null default 'pending_approval'
                     check (status in ('pending_approval','approved','rejected')),
  created_os_id    text,             -- preenchido ao aprovar (id da OS no kv_store)
  decided_by       text,             -- user id do admin que decidiu
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);
create index if not exists ai_os_prop_company_idx
  on public.ai_os_proposals(company_id, status, created_at desc);
```

- RLS por `company_id` no mesmo padrão das outras tabelas (`company_members` + `auth.uid()`); n8n usa service_role (bypass).
- Publicar em `supabase_realtime` (bloco `do $$ ... $$` igual às demais).

**n8n:** o tool `create_os` é renomeado para `propose_os`. Em vez de criar OS, faz:

```sql
insert into ai_os_proposals (company_id, conversation_id, payload)
values ('<company_id resolvido>', '<conversation id>', '<json dos campos coletados + media_urls>'::jsonb);
```

Descrição do tool atualizada: "Registra uma PROPOSTA de OS para aprovação humana. Use quando tiver todos os dados. Não promete que a OS já existe — informe ao cliente que o pedido foi registrado e está em análise." O system prompt do Agent (em `ai_agent_config.system_prompt` e no nó "AI Agent") é ajustado de "registre a Ordem de Serviço e confirme" para "registre a solicitação; informe que será analisada por um atendente e que retornaremos em breve".

**App (`IAAtendimentoModule` em `src/App.jsx`):**

- Nova seção "Propostas de OS" (badge com contagem de `pending_approval` da empresa ativa; aba/painel dentro do módulo IA — não criar módulo novo, segue padrão do projeto).
- Lista propostas `status='pending_approval'` ordenadas por `created_at`. Cada item mostra payload formatado + thumbnails das `media_urls`.
- **Aprovar:** chama a função de criação de OS já existente em `App.jsx` (caminho que passa por `DB.set` — mantém audit/scope/sync e o bridge `syncOSToFinance`/`scheduleOSPosVenda`). As `media_urls` da proposta são anexadas como fotos da OS (bucket `os-fotos`, fluxo da Regra 4 preservado). Atualiza a proposta: `status='approved'`, `created_os_id`, `decided_by`, `decided_at`. Vincula `ai_conversations.linked_os_id`.
- **Rejeitar:** `status='rejected'`, `decided_by`, `decided_at`. Opcional: mensagem ao cliente via Evolution (fora do escopo desta v2 — registrar como TODO no setup guide).
- **Push:** ao receber INSERT em `ai_os_proposals` via Realtime (subscribe já presente no módulo para `ai_messages`/`ai_conversations` — adicionar canal/escuta para a nova tabela), disparar `sendServerPush` para o admin ("Nova proposta de OS aguardando aprovação").

### Storage

Novo bucket `ai-media` (privado ou público — **público**, alinhado a `os-fotos` que já é público; simplifica exibição de thumbnail no app sem assinar URL). Path: `ai-media/{company_id}/{conversation_id}/{uuid}.{ext}`. Criação do bucket documentada no `03-setup-guide.md` (Passo 1, junto do SQL) — Storage não é criado por SQL puro; instruir via painel Supabase ou snippet `storage.create_bucket`.

## Ingest wiki (CLAUDE.md Regra 5)

Páginas novas em `docs/wiki/`:

- `modules/pos-venda.md` — módulo Pós-Venda, tabelas, dispatcher cron, ponteiros de código.
- `modules/ia-atendimento.md` — `IAAtendimentoModule`, Realtime, aba Propostas.
- `flows/whatsapp-ia-os.md` — fluxo end-to-end WhatsApp → proposta → aprovação → OS.
- `concepts/evolution-multitenant.md` — resolução instance→company_id, 1 instância por empresa, infra compartilhada com Pós-Venda.
- `decisions/007-ia-os-aprovacao-humana.md` — ADR: por que sempre exige aprovação e por que a OS é escrita pelo app, não pelo n8n/Edge.

Atualizar `docs/wiki/index.md` (1 linha por página) e append em `docs/wiki/log.md` (entrada `ingest`). Sem colar código — só ponteiros estáveis (`src/App.jsx#IAAtendimentoModule`, `supabase/functions/pos-venda-dispatch`, etc.). Marcar `[inferido]` o que não tiver fonte em `docs/raw/`.

## Testes

- Helper puro de validação/normalização do payload da proposta (campos obrigatórios, telefone normalizado) → `src/utils.js` + caso em `src/utils.test.js` (Vitest, padrão do projeto — helpers puros não vão para `App.jsx`).
- n8n e Storage: sem runner automatizado no projeto; roteiro de validação manual documentado no `03-setup-guide.md` (enviar áudio, imagem, mensagem multi-empresa, aprovar/rejeitar proposta).

## Fora de escopo

- Sub-workflow de criação de OS no n8n (D2: criação fica no app).
- Modo de criação automática de OS (D1: sempre manual).
- Throttling de `verifyTotp` (dívida pré-existente, não relacionada).
- Refactor do monólito `App.jsx`.
- Resposta automática ao cliente em caso de rejeição (TODO documentado, não implementado).

## Riscos / notas

- **Git não inicializado neste repositório** (`git` retorna exit 128). CLAUDE.md Regra 1 (deploy contínuo: commit + Vercel) **não é executável aqui**. Spec e mudanças ficam locais; commit/deploy pendentes até o repositório git existir. Sinalizar ao usuário antes de "concluir".
- Endpoint exato da Evolution para obter mídia (`/chat/getBase64FromMediaMessage`) deve ser confirmado contra a versão da imagem `atendai/evolution-api:latest` em uso — validar no Passo de teste manual.
- Custo OpenAI sobe com vision (`gpt-4o` > `gpt-4o-mini`); aceitável pelo volume estimado (~500 conv/mês). Documentar no quadro de custos do setup guide.
- `propose_os` substituindo `create_os` muda contrato do tool — garantir que o system prompt não prometa OS criada (evita expectativa errada do cliente).
