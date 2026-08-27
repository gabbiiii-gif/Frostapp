---
title: Módulo IA / Atendimento WhatsApp
type: module
updated: 2026-08-27
sources: []
related:
  - ../flows/whatsapp-ia-os.md
  - ../concepts/evolution-multitenant.md
  - ../decisions/007-ia-os-aprovacao-humana.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/App.jsx#IAAtendimentoModule
  - src/App.jsx#createOSFromProposal
  - src/utils.js#validateOSProposal
  - docs/ai-agent/02-n8n-workflow.json
  - docs/ai-agent/01-supabase-schema.sql
---

# Módulo IA / Atendimento WhatsApp

Painel do agente de IA: lista conversas WhatsApp, chat ao vivo via Supabase Realtime, intervenção manual, config do agente e — na v2 — **aprovação de propostas de OS**. Sidebar item `ia`; permissão `ia` em `ROLE_PERMISSIONS`. Não é módulo separado: tudo dentro de `IAAtendimentoModule` (`src/App.jsx`).

## Estrutura

- `companyId` = `getCurrentMember()?.company_id`. Recebe props `{ user, addToast }`.
- Canal Realtime único `ai_msgs_${companyId}` escuta `ai_messages` (INSERT), `ai_conversations` (\*) e, na v2, `ai_os_proposals` (INSERT).
- Config persistida em `ai_agent_config` (upsert por `company_id`).

## Aba "Propostas de OS" (v2)

- `loadProposals()` busca `ai_os_proposals` `status='pending_approval'` da empresa.
- Botão no header com badge de contagem; painel toggle `showProposals`.
- **Aprovar** → `validateOSProposal(payload)` (de `src/utils.js`) → `createOSFromProposal(payload)` (escopo de módulo em `src/App.jsx`, escreve via `DB.set("erp:os:")` — preserva audit/scope/sync/pós-venda) → atualiza proposta (`status=approved`, `created_os_id`, `decided_by`, `decided_at`) → seta `ai_conversations.linked_os_id`.
- **Rejeitar** → `status='rejected'` + `decided_by`/`decided_at`.
- INSERT de proposta via Realtime dispara `sendServerPush(supabase, { title, body })` (assinatura real em `src/platform.js`).

Decisão de por que a OS não é criada pelo n8n/Edge: ver [[../decisions/007-ia-os-aprovacao-humana]]. Fluxo end-to-end: [[../flows/whatsapp-ia-os]].

## Comportamento do agente (atualização 2026-06-01)

O agente roda na Edge Function `whatsapp-webhook` (não mais n8n). Mudanças desta rodada:

- **Modelo:** `claude-haiku-4-5` → **`claude-sonnet-4-6`** (raciocínio melhor pra seguir o fluxo e regras de desconto). Constante `MODEL` em `supabase/functions/whatsapp-webhook/index.ts`.
- **Nome primeiro:** o `system_prompt` (em `ai_agent_config`, por empresa) foi reescrito pra pedir o nome no início e usar o **primeiro nome** em toda mensagem.
- **Tool nova `get_customer`:** busca o cliente no `kv_store` por telefone (normalizado, tolerante a DDI/máscara). Retorna `{found, primeiro_nome, data_nascimento, aniversario_mes_atual, ja_cliente}`. Permite: saudar cliente que volta sem re-perguntar nome; saber se é cliente novo (desconto de 1º serviço); e decidir o desconto de aniversário **sem o LLM fazer conta de data**.
- **Desconto de aniversário (bug corrigido):** o prompt agora só oferece se `aniversario_mes_atual=true`, calculado em código (fuso Brasília). A data de hoje é injetada no prompt (`== CONTEXTO ATUAL ==`). Antes a IA não tinha relógio e dava desconto fora do mês.
- **Descontos:** aniversariante e 1º serviço, ambos **15% em pagamento à vista**, não acumulam. A IA sinaliza via campo `discount_note` no `propose_os` → vira nota na `observacoes` da OS (`createOSFromProposal`) pro técnico aplicar.
- **Fix de prefixo kv_store:** `get_recent_os`/`get_customer` usam `kvList()` que tenta o prefixo escopado (`<company_id>:erp:...`) e cai pro legado sem prefixo (`erp:...`). Os dados de prod são legados (bare) — o `get_recent_os` antigo (`${company_id}:erp:os:`) nunca achava nada.
- **Aviso ao aprovar (Edge `frost-notify-approval`, verify_jwt=true):** ao aprovar uma proposta, `approveProposal` chama a function que manda WhatsApp ao cliente ("solicitação verificada por um atendente, contato humano em seguida") e grava a msg em `ai_messages`. Valida que o caller é admin/gerente ativo da empresa.

## Handoff humano pelo WhatsApp (sem abrir o app)

O Gate 1 do webhook (`status != 'active' → return`) já pausa a IA. O webhook agora usa os eventos `fromMe` (mensagens que saem do número do negócio) pra automatizar o handoff (`handleOperatorMessage`):

- **Operador responde manual no WhatsApp** → IA pausa naquele cliente (`status='pending_human'`), a fala do humano é gravada em `ai_messages`. Cliente continua mandando msg (registradas), mas a IA não responde.
- **Operador manda `#ia`** (constante `REENABLE_COMMAND`) → IA reassume (`status='active'`). O comando não é repassado ao cliente.
- **Distinção IA vs humano (eco):** todo `fromMe` é comparado com as últimas 5 msgs `role=agent` da conversa; se o texto bate, é eco da própria IA/aprovação → ignora (não pausa). A resposta da IA é gravada antes de enviar, então o eco sempre chega depois (sem race).
- **Backup:** botão "Reativar IA" no app (`status='active'`) continua valendo.
- Sem mudança de schema — reusa `ai_conversations.status` e `whatsapp_processed_messages` (dedupe).

## Tools reais + debounce (atualização 2026-08-27)

Fecha a Fase 4 do Frost — que tinha sido especificada para o orquestrador n8n e nunca chegou
inteira ao caminho vivo (a Edge Function `whatsapp-webhook`, que substituiu o n8n). Tudo abaixo
está em `supabase/functions/whatsapp-webhook/`.

### `propose_os` — completada

- **Valida antes de gravar.** Os campos exigidos espelham `PROPOSTA_OBRIGATORIOS` ↔ `required` de
  `validateOSProposal` (`src/utils.js`). Faltando algum, a tool devolve os rótulos em pt-BR e o
  modelo volta a perguntar ao cliente. Antes, proposta incompleta era gravada e só quebrava na
  hora de o atendente aprovar ("Proposta incompleta: address, phone").
- **Idempotente por conversa.** Se já existe proposta `pending_approval` na mesma conversa, ela é
  **atualizada** (com merge de `media_urls`) em vez de empilhar duplicata na fila do atendente.
- **`status: 'pending_approval'` explícito**, não só pelo DEFAULT da coluna.
- **Email para admin/gerente** via `send-email`. O push existente (listener Realtime de
  `ai_os_proposals` em `IAAtendimentoModule`) só chega em quem está com o app aberto na aba de IA —
  o email é o canal que não depende de alguém estar olhando.

### `handoff_to_human` — completada

- **Pausa a IA na hora**: `status='pending_human'` + `ai_handoff_reason` gravados dentro da própria
  tool. Antes só o motivo era escrito ali e o `status` ficava para um `if (handoff)` no fim de
  `handleMessage`, **depois** de um `return` que disparava quando o modelo chamava a tool sem
  escrever texto junto. Resultado: conversa com aviso amarelo na tela, `status='active'`, IA
  respondendo por cima do atendente e badge de `pending_human` sem contar.
- **Email para admin/gerente**, com o lembrete de que `#ia` devolve o atendimento à IA.

### Debounce

`debounce.ts` (lógica pura, testada em `debounce.test.ts`) + integração no `handleMessage`:

- Cada mensagem do cliente dispara uma execução própria da function. Passada a janela
  (`DEBOUNCE_SECONDS`, padrão **12s**, `0` desliga, teto 120s), a execução relê a última mensagem
  `role=customer` da conversa; se não for mais a sua, morre. Só a execução da **última** mensagem
  da rajada responde.
- Posição: **depois** do Gate 1 (conversa pausada sai na hora, sem gastar espera) e **antes** do
  Gate 2 (3 mensagens fora do horário → 1 aviso, não 3).
- Comparação por **id de `ai_messages`**, não por timestamp: sem risco de clock skew. Casos
  degenerados (id ausente) respondem em vez de calar — engolir atendimento é pior que responder 2x.
- **Fotos da rajada:** o histórico agora anexa ao modelo todas as imagens de mensagens do cliente
  posteriores à última resposta do agente (teto 3), baixando do bucket privado `ai-media` com
  service_role (`baixarImagemBase64`). Sem isso o debounce quebraria o caso mais comum de foto —
  cliente manda a imagem e escreve em seguida; a execução da imagem morre e a sobrevivente só teria
  o texto `[imagem enviada pelo cliente]`.

### Efeitos colaterais das tools

Emails entram numa fila `tarefasPosResposta` executada **depois** que a resposta já foi para o
cliente: não atrasam a conversa e não são promessa órfã (que corre risco de ser cortada quando o
`EdgeRuntime.waitUntil` resolve).

### Correções de arrasto

- `last_message_at` agora é bumpado no upsert da conversa. A coluna tem `DEFAULT now()`, mas
  default só vale no INSERT — no UPDATE do upsert ficava congelada na criação. O Inbox ordena por
  `last_message_at desc`, então conversa ativa afundava na lista.
- `unread_count` passou a ser incrementado (`bumpUnread`). O app zera ao abrir o chat; antes o
  contador nunca subia.
- `notifyPosVendaHumano` passou a escapar HTML do texto do cliente (mesma classe de risco que
  `frost-propose-os` já tratava): a resposta do cliente ia crua para o corpo do email do gestor.

### Edge Functions `frost-*` — órfãs

`frost-conversation`, `frost-propose-os`, `frost-handoff` e `frost-update-birthday` foram escritas
para o n8n e **nada no código as chama** desde que o agente migrou para `whatsapp-webhook`. Não
foram alteradas nesta rodada. Bugs conhecidos, caso alguém as reative:

- `frost-handoff` grava `status='handoff'`, valor que **viola** o CHECK de `ai_conversations`
  (`active|pending_human|closed`) → falha sempre com 500.
- `frost-propose-os` grava payload em pt-BR (`nome`, `telefone`, `endereco`…), mas
  `validateOSProposal` e o painel de aprovação leem o formato em inglês (`customer_name`,
  `address`…) → a proposta aparece em branco e é impossível de aprovar.
- `frost-conversation` faz INSERT quando a conversa existente está `closed`, violando o UNIQUE
  `(company_id, customer_phone)` → 500.
- `frost-update-birthday` tem o bug de prefixo do kv_store já registrado em [[../log]].
