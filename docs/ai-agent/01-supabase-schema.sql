-- ─────────────────────────────────────────────────────────────────────────────
-- AI AGENT — Schema Supabase
-- Rode este SQL no SQL Editor do Supabase do projeto FrostERP.
-- Cria:
--   • ai_conversations    — 1 linha por contato WhatsApp ativo (por empresa)
--   • ai_messages         — histórico de mensagens (cliente / agente / admin)
--   • ai_agent_config     — configuração do agente por empresa
--   • Políticas RLS multi-tenant (escopo por company_id, igual ao kv_store)
--   • Publicação Realtime (para o app receber novas mensagens em tempo real)
-- ─────────────────────────────────────────────────────────────────────────────

-- ─── 1. Conversas (uma por número de telefone, por empresa) ──────────────────
create table if not exists public.ai_conversations (
  id                 uuid primary key default gen_random_uuid(),
  company_id         text not null references public.companies(id) on delete cascade,
  customer_phone     text not null,                                  -- E.164 ex: 5511999998888
  customer_name      text,                                            -- nome puxado do WhatsApp
  status             text not null default 'active'
                       check (status in ('active','pending_human','closed')),
  last_message_at    timestamptz not null default now(),
  linked_client_id   text,                                            -- id do cliente em frost_clients (se já cadastrado)
  linked_os_id       text,                                            -- última OS criada pela conversa
  ai_handoff_reason  text,                                            -- motivo do escalonamento p/ humano
  unread_count       int  not null default 0,                         -- mensagens não lidas pelo admin
  metadata           jsonb,                                           -- extras (instância evolution, tags, etc)
  created_at         timestamptz not null default now(),
  unique (company_id, customer_phone)
);

create index if not exists ai_conv_company_idx
  on public.ai_conversations(company_id, last_message_at desc);

-- ─── 2. Mensagens ────────────────────────────────────────────────────────────
create table if not exists public.ai_messages (
  id               uuid primary key default gen_random_uuid(),
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  company_id       text not null,                                     -- denormalizado p/ RLS rápido
  role             text not null check (role in ('customer','agent','admin','system')),
  content          text not null,
  media_url        text,                                              -- foto/áudio enviado pelo cliente
  metadata         jsonb,                                              -- tokens, tool calls, etc
  created_at       timestamptz not null default now()
);

create index if not exists ai_msg_conv_idx
  on public.ai_messages(conversation_id, created_at);

-- ─── 3. Configuração do agente por empresa ───────────────────────────────────
create table if not exists public.ai_agent_config (
  company_id           text primary key references public.companies(id) on delete cascade,
  enabled              boolean not null default true,
  evolution_instance   text,                                          -- nome da instância na Evolution API
  evolution_url        text,                                          -- URL base da Evolution (https://...)
  system_prompt        text default $$Você é o assistente virtual de uma empresa de assistência técnica em refrigeração e climatização. Atenda em português brasileiro, seja cordial, objetivo e profissional.

Quando o cliente solicitar um serviço, colete em ordem:
1. Nome completo
2. Endereço (rua, número, bairro, cidade)
3. Equipamento (tipo, marca e modelo)
4. Descrição do problema
5. Telefone de contato (se diferente do WhatsApp)

Após coletar TODOS os dados, use a ferramenta "create_os" para registrar a Ordem de Serviço e confirme ao cliente que um técnico entrará em contato em breve.

Se o cliente perguntar sobre uma OS existente, use "get_recent_os" com o telefone dele.

Se a pergunta for muito técnica, fora do escopo, ou se o cliente parecer insatisfeito/raivoso, encerre educadamente e use a ferramenta "handoff_to_human" para transferir.

Nunca prometa prazos específicos sem confirmação. Nunca discuta preços fixos — informe apenas que será orçado pelo técnico na vistoria.$$,
  business_hours       jsonb default '{"start":"08:00","end":"18:00","weekdays":[1,2,3,4,5,6]}'::jsonb,
  out_of_hours_message text default 'Olá! Recebemos sua mensagem fora do horário de atendimento (Seg-Sáb 08h-18h). Retornaremos no próximo dia útil.',
  updated_at           timestamptz default now()
);

-- ─── 4. RLS — Row Level Security (escopo por empresa) ────────────────────────
alter table public.ai_conversations enable row level security;
alter table public.ai_messages enable row level security;
alter table public.ai_agent_config enable row level security;

-- Políticas: usuário só vê o que pertence à empresa dele (via company_members).
-- IMPORTANTE: o N8N usará a SERVICE_ROLE key, que faz BYPASS de RLS — não precisa de policy específica.

drop policy if exists "conv_company_scope" on public.ai_conversations;
create policy "conv_company_scope" on public.ai_conversations
  for all
  using (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  )
  with check (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  );

drop policy if exists "msg_company_scope" on public.ai_messages;
create policy "msg_company_scope" on public.ai_messages
  for all
  using (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  )
  with check (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  );

drop policy if exists "cfg_company_scope" on public.ai_agent_config;
create policy "cfg_company_scope" on public.ai_agent_config
  for all
  using (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  )
  with check (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  );

-- ─── 5. Realtime — publica tabelas para o app escutar via subscribe() ────────
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ai_conversations'
  ) then
    alter publication supabase_realtime add table public.ai_conversations;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ai_messages'
  ) then
    alter publication supabase_realtime add table public.ai_messages;
  end if;
end $$;

-- ─── 6. Trigger: ao inserir mensagem, atualiza last_message_at na conversa ───
create or replace function public.touch_conversation_on_message()
returns trigger
language plpgsql
as $$
begin
  update public.ai_conversations
     set last_message_at = new.created_at,
         unread_count    = case
                             when new.role = 'customer' then unread_count + 1
                             else unread_count
                           end
   where id = new.conversation_id;
  return new;
end;
$$;

drop trigger if exists trg_touch_conversation on public.ai_messages;
create trigger trg_touch_conversation
  after insert on public.ai_messages
  for each row execute function public.touch_conversation_on_message();
