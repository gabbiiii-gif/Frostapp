-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Baseline do schema (reconstruído da produção)
-- Data: 2026-06-01 (timestamp deliberadamente ANTERIOR à 20260602000000_ponto_escola
--   para que rode primeiro num banco zerado / preview branch)
--
-- Por que existe:
--   O schema de produção (projeto frostapp2.0) foi construído à mão pelo
--   dashboard/MCP e nunca virou migration. Resultado: branches de preview do
--   Supabase (banco zerado, roda só as migrations do repo) quebravam porque a
--   migration ponto_escola referencia public.company_members, que não existia.
--   Esta baseline cria o schema núcleo para que qualquer ambiente novo suba igual.
--
-- Extraída por introspecção em 2026-06-06 (pg_attribute, pg_indexes, pg_policies,
--   pg_get_functiondef). NÃO inclui tabelas descartáveis de backup/dedupe
--   (kv_store_backup_*, kv_finance_dup_*, backup_*_20260523).
--   push_subscriptions e os buckets de Storage continuam na migration ponto_escola.
--
-- Observação: produção NÃO usa foreign keys (acoplamento solto via kv_store).
--   Mantido idêntico aqui de propósito.
-- ─────────────────────────────────────────────────────────────────────────────

create extension if not exists pgcrypto;

-- 1) Schema private + helpers de RLS ──────────────────────────────────────────
-- Funções SECURITY DEFINER usadas pelas policies. Derivam company/role do JWT
-- ou de company_members. Precisam existir ANTES das policies que as chamam.
create schema if not exists private;

create or replace function private.is_master_admin()
  returns boolean
  language sql stable security definer
  set search_path to 'public'
as $function$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_master')::boolean, false)
$function$;

create or replace function private.user_company_id()
  returns text
  language sql stable security definer
  set search_path to 'public'
as $function$
  select company_id from public.company_members where user_id = auth.uid() limit 1
$function$;

create or replace function private.user_role()
  returns text
  language sql stable security definer
  set search_path to 'public'
as $function$
  select role from public.company_members where user_id = auth.uid() limit 1
$function$;

-- 2) Tabelas núcleo ───────────────────────────────────────────────────────────

-- kv_store: coração do app. Toda key do window.storage é sincronizada aqui.
create table if not exists public.kv_store (
  key         text primary key,
  value       jsonb,
  updated_at  timestamptz default now(),
  company_id  text not null
);
create index if not exists idx_kv_store_company on public.kv_store using btree (company_id);

-- companies: tenants. id é texto (gerado pelo app, não uuid).
create table if not exists public.companies (
  id                       text primary key,
  cnpj                     text,
  nome                     text not null,
  email                    text,
  telefone                 text,
  endereco                 text,
  logo_url                 text,
  ativo                    boolean default true,
  criado_em                timestamptz default now(),
  atualizado_em            timestamptz default now(),
  metadata                 jsonb default '{}'::jsonb,
  require_first_login_otp  boolean not null default false,   -- Fase 2.4
  require_mfa              boolean not null default false,   -- Fase 2.5
  notify_os_email          boolean not null default true     -- Fase 2.7
);

-- company_members: vínculo user (auth.users) ↔ company + role/permissões.
create table if not exists public.company_members (
  user_id              uuid not null,
  company_id           text not null,
  role                 text not null,
  is_super_admin       boolean default false,
  legacy_user_id       text,
  legacy_password      text,
  custom_permissions   jsonb,
  status               text default 'ativo'::text,
  nome                 text,
  avatar               text,
  created_at           timestamptz default now(),
  comissao_percentual  numeric,
  first_login_otp_done boolean not null default false,        -- Fase 2.4
  primary key (user_id, company_id)
);
create index if not exists idx_company_members_legacy  on public.company_members using btree (legacy_user_id);
create index if not exists idx_company_members_company on public.company_members using btree (company_id);

-- master_users: tier super-admin (local-only). Acesso só via service_role.
create table if not exists public.master_users (
  id                  text primary key,
  email               text not null,
  nome                text not null,
  password            text not null,
  role                text not null default 'master'::text,
  session_token_hash  text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create unique index if not exists master_users_email_key on public.master_users using btree (email);
create index if not exists idx_master_users_email on public.master_users using btree (lower(email));

-- ai_conversations: conversas WhatsApp/IA por (company, telefone).
create table if not exists public.ai_conversations (
  id                uuid primary key default gen_random_uuid(),
  company_id        text not null,
  customer_phone    text not null,
  customer_name     text,
  status            text not null default 'active'::text,
  last_message_at   timestamptz not null default now(),
  linked_client_id  text,
  linked_os_id      text,
  ai_handoff_reason text,
  unread_count      integer not null default 0,
  metadata          jsonb,
  created_at        timestamptz not null default now()
);
create unique index if not exists ai_conversations_company_id_customer_phone_key on public.ai_conversations using btree (company_id, customer_phone);
create index if not exists ai_conv_company_idx on public.ai_conversations using btree (company_id, last_message_at desc);

-- ai_messages: mensagens de uma conversa.
create table if not exists public.ai_messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null,
  company_id      text not null,
  role            text not null,
  content         text not null,
  media_url       text,
  metadata        jsonb,
  created_at      timestamptz not null default now()
);
create index if not exists ai_msg_conv_idx on public.ai_messages using btree (conversation_id, created_at);

-- ai_agent_config: config do agente IA por company (PK = company_id).
create table if not exists public.ai_agent_config (
  company_id          text primary key,
  enabled             boolean not null default true,
  evolution_instance  text,
  evolution_url       text,
  system_prompt       text default $prompt$Voce e o assistente virtual de uma empresa de assistencia tecnica em refrigeracao e climatizacao. Atenda em portugues brasileiro, seja cordial, objetivo e profissional.

Quando o cliente solicitar um servico, colete em ordem:
1. Nome completo
2. Endereco (rua, numero, bairro, cidade)
3. Equipamento (tipo, marca e modelo)
4. Descricao do problema
5. Telefone de contato (se diferente do WhatsApp)

Apos coletar TODOS os dados, use a ferramenta "create_os" para registrar a Ordem de Servico e confirme ao cliente que um tecnico entrara em contato em breve.

Se o cliente perguntar sobre uma OS existente, use "get_recent_os" com o telefone dele.

Se a pergunta for muito tecnica, fora do escopo, ou se o cliente parecer insatisfeito, encerre educadamente e use "handoff_to_human" para transferir.

Nunca prometa prazos especificos sem confirmacao. Nunca discuta precos fixos.$prompt$::text,
  business_hours      jsonb default '{"end": "18:00", "start": "08:00", "weekdays": [1, 2, 3, 4, 5, 6]}'::jsonb,
  out_of_hours_message text default 'Ola! Recebemos sua mensagem fora do horario de atendimento (Seg-Sab 08h-18h). Retornaremos no proximo dia util.'::text,
  updated_at          timestamptz default now(),
  metadata            jsonb
);

-- ai_os_proposals: propostas de OS geradas pela IA, pendentes de aprovação humana.
create table if not exists public.ai_os_proposals (
  id              uuid primary key default gen_random_uuid(),
  company_id      text not null,
  conversation_id uuid not null,
  payload         jsonb not null,
  status          text not null default 'pending_approval'::text,
  created_os_id   text,
  decided_by      text,
  created_at      timestamptz not null default now(),
  decided_at      timestamptz
);
create index if not exists ai_os_prop_company_idx on public.ai_os_proposals using btree (company_id, status, created_at desc);

-- email_otps: códigos OTP de 1º login (Fase 2.4). Acesso só via service_role.
create table if not exists public.email_otps (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null,
  company_id  text not null,
  code_hash   text not null,
  purpose     text not null,
  expires_at  timestamptz not null,
  attempts    integer not null default 0,
  consumed_at timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists email_otps_active_by_user on public.email_otps using btree (user_id, purpose) where (consumed_at is null);

-- pos_venda_config: config de pós-venda (global ou por cliente) por company.
create table if not exists public.pos_venda_config (
  id                  uuid primary key default gen_random_uuid(),
  cliente_id          text,
  dias_proxima_visita integer not null default 90,
  enviar_nps          boolean not null default true,
  enviar_lembrete     boolean not null default true,
  enviar_reagendamento boolean not null default true,
  modo_disparo        text not null default 'aprovar'::text,
  horario_envio       time not null default '09:00:00'::time,
  ativo               boolean not null default true,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  company_id          text default private.user_company_id()
);
create unique index if not exists idx_pos_venda_config_global  on public.pos_venda_config using btree (((cliente_id is null))) where (cliente_id is null);
create unique index if not exists idx_pos_venda_config_cliente on public.pos_venda_config using btree (cliente_id) where (cliente_id is not null);

-- pos_venda_mensagens: fila/histórico de mensagens pós-venda.
create table if not exists public.pos_venda_mensagens (
  id                 uuid primary key default gen_random_uuid(),
  os_id              text,
  cliente_id         text not null,
  cliente_nome       text,
  os_numero          text,
  tipo               text not null,
  status             text not null default 'pendente'::text,
  canal              text not null default 'whatsapp'::text,
  conteudo           text not null,
  telefone           text,
  agendada_para      timestamptz not null,
  enviada_em         timestamptz,
  respondida_em      timestamptz,
  resposta_cliente   text,
  intencao_detectada text,
  precisa_humano     boolean not null default false,
  atendida_por       uuid,
  atendida_em        timestamptz,
  erro_envio         text,
  tentativas         integer not null default 0,
  metadata           jsonb default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  company_id         text default private.user_company_id()
);
create index if not exists idx_pvm_status_agendada on public.pos_venda_mensagens using btree (status, agendada_para);
create index if not exists idx_pvm_cliente on public.pos_venda_mensagens using btree (cliente_id, created_at desc);
create index if not exists idx_pvm_os on public.pos_venda_mensagens using btree (os_id);
create index if not exists idx_pvm_precisa_humano on public.pos_venda_mensagens using btree (precisa_humano) where (precisa_humano = true);
create unique index if not exists idx_pvm_os_tipo_unico on public.pos_venda_mensagens using btree (os_id, tipo) where (os_id is not null);

-- pos_venda_optout: clientes que pediram para não receber pós-venda.
create table if not exists public.pos_venda_optout (
  cliente_id   text primary key,
  motivo       text,
  origem       text default 'cliente'::text,
  opted_out_at timestamptz not null default now(),
  company_id   text default private.user_company_id()
);

-- pos_venda_templates: templates de mensagem por tipo.
create table if not exists public.pos_venda_templates (
  id         uuid primary key default gen_random_uuid(),
  tipo       text not null,
  nome       text not null,
  conteudo   text not null,
  variaveis  text[] default array[]::text[],
  ativo      boolean not null default true,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  company_id text default private.user_company_id()
);
create unique index if not exists idx_template_default_por_tipo on public.pos_venda_templates using btree (tipo) where ((is_default = true) and (ativo = true));

-- whatsapp_processed_messages: dedupe de webhooks Evolution. Só service_role.
create table if not exists public.whatsapp_processed_messages (
  message_id   text primary key,
  processed_at timestamptz not null default now()
);
comment on table public.whatsapp_processed_messages is 'Dedupe de webhooks Evolution MESSAGES_UPSERT (mesmo key.id dispara várias vezes por status update).';

-- 3) RLS ──────────────────────────────────────────────────────────────────────
alter table public.kv_store                    enable row level security;
alter table public.companies                   enable row level security;
alter table public.company_members             enable row level security;
alter table public.master_users                enable row level security;
alter table public.ai_conversations            enable row level security;
alter table public.ai_messages                 enable row level security;
alter table public.ai_agent_config             enable row level security;
alter table public.ai_os_proposals             enable row level security;
alter table public.email_otps                  enable row level security;
alter table public.pos_venda_config            enable row level security;
alter table public.pos_venda_mensagens         enable row level security;
alter table public.pos_venda_optout            enable row level security;
alter table public.pos_venda_templates         enable row level security;
alter table public.whatsapp_processed_messages enable row level security;

-- kv_store: cada user só acessa sua company; master acessa tudo.
drop policy if exists kv_select_own on public.kv_store;
create policy kv_select_own on public.kv_store for select to authenticated using (company_id = private.user_company_id());
drop policy if exists kv_insert_own on public.kv_store;
create policy kv_insert_own on public.kv_store for insert to authenticated with check (company_id = private.user_company_id());
drop policy if exists kv_update_own on public.kv_store;
create policy kv_update_own on public.kv_store for update to authenticated using (company_id = private.user_company_id()) with check (company_id = private.user_company_id());
drop policy if exists kv_delete_own on public.kv_store;
create policy kv_delete_own on public.kv_store for delete to authenticated using (company_id = private.user_company_id());
drop policy if exists kv_master_select on public.kv_store;
create policy kv_master_select on public.kv_store for select to authenticated using (private.is_master_admin());
drop policy if exists kv_master_insert on public.kv_store;
create policy kv_master_insert on public.kv_store for insert to authenticated with check (private.is_master_admin());
drop policy if exists kv_master_update on public.kv_store;
create policy kv_master_update on public.kv_store for update to authenticated using (private.is_master_admin()) with check (private.is_master_admin());
drop policy if exists kv_master_delete on public.kv_store;
create policy kv_master_delete on public.kv_store for delete to authenticated using (private.is_master_admin());

-- companies
drop policy if exists companies_master_all on public.companies;
create policy companies_master_all on public.companies for all to authenticated using (private.is_master_admin()) with check (private.is_master_admin());
drop policy if exists companies_select_own on public.companies;
create policy companies_select_own on public.companies for select to authenticated using (id = private.user_company_id());
drop policy if exists companies_update_admin on public.companies;
create policy companies_update_admin on public.companies for update to authenticated using ((id = private.user_company_id()) and (private.user_role() = any (array['admin'::text, 'gerente'::text]))) with check (id = private.user_company_id());

-- company_members
drop policy if exists members_admin_all on public.company_members;
create policy members_admin_all on public.company_members for all to authenticated using ((company_id = private.user_company_id()) and (private.user_role() = 'admin'::text)) with check (company_id = private.user_company_id());
drop policy if exists members_master_all on public.company_members;
create policy members_master_all on public.company_members for all to authenticated using (private.is_master_admin()) with check (private.is_master_admin());
drop policy if exists members_select_own_company on public.company_members;
create policy members_select_own_company on public.company_members for select to authenticated using (company_id = private.user_company_id());

-- master_users: só service_role.
drop policy if exists "service_role only" on public.master_users;
create policy "service_role only" on public.master_users for all to service_role using (true) with check (true);

-- ai_* : scope por company via subquery em company_members (role public).
drop policy if exists cfg_company_scope on public.ai_agent_config;
create policy cfg_company_scope on public.ai_agent_config for all using (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid())) with check (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid()));
drop policy if exists conv_company_scope on public.ai_conversations;
create policy conv_company_scope on public.ai_conversations for all using (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid())) with check (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid()));
drop policy if exists msg_company_scope on public.ai_messages;
create policy msg_company_scope on public.ai_messages for all using (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid())) with check (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid()));
drop policy if exists prop_company_scope on public.ai_os_proposals;
create policy prop_company_scope on public.ai_os_proposals for all using (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid())) with check (company_id in (select cm.company_id from company_members cm where cm.user_id = auth.uid()));

-- email_otps: só service_role.
drop policy if exists "service_role only" on public.email_otps;
create policy "service_role only" on public.email_otps for all to service_role using (true) with check (true);

-- pos_venda_* : scope por company.
drop policy if exists pos_venda_config_company_scope on public.pos_venda_config;
create policy pos_venda_config_company_scope on public.pos_venda_config for all to authenticated using (company_id = private.user_company_id()) with check (company_id = private.user_company_id());
drop policy if exists pos_venda_mensagens_company_scope on public.pos_venda_mensagens;
create policy pos_venda_mensagens_company_scope on public.pos_venda_mensagens for all to authenticated using (company_id = private.user_company_id()) with check (company_id = private.user_company_id());
drop policy if exists pos_venda_optout_company_scope on public.pos_venda_optout;
create policy pos_venda_optout_company_scope on public.pos_venda_optout for all to authenticated using (company_id = private.user_company_id()) with check (company_id = private.user_company_id());
drop policy if exists pvo_authenticated_all on public.pos_venda_optout;
create policy pvo_authenticated_all on public.pos_venda_optout for all using (auth.role() = 'authenticated'::text) with check (auth.role() = 'authenticated'::text);
drop policy if exists pos_venda_templates_company_scope on public.pos_venda_templates;
create policy pos_venda_templates_company_scope on public.pos_venda_templates for all to authenticated using (company_id = private.user_company_id()) with check (company_id = private.user_company_id());
drop policy if exists pvt_authenticated_all on public.pos_venda_templates;
create policy pvt_authenticated_all on public.pos_venda_templates for all using (auth.role() = 'authenticated'::text) with check (auth.role() = 'authenticated'::text);

-- whatsapp_processed_messages: só service_role.
drop policy if exists "service_role full access" on public.whatsapp_processed_messages;
create policy "service_role full access" on public.whatsapp_processed_messages for all to service_role using (true) with check (true);
