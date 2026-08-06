-- ============================================================================
-- BASELINE — Schema BASE (tabelas provisionadas fora do repo)
-- Projeto: frostapp2.0 (rbwzhglsztmjvwrcydcy) · Extraído AO VIVO em 2026-08-06
-- ----------------------------------------------------------------------------
-- POR QUE ESTE ARQUIVO EXISTE
--   As tabelas-base do FrostERP (kv_store, companies, company_members, ai_*,
--   pos_venda_*, ...) foram criadas direto na produção, nunca por migração.
--   Em produção isso passou despercebido porque as tabelas já existiam; num
--   banco NOVO (Preview Branch de PR, `supabase start` local, restore de
--   desastre) a primeira migração que as referencia quebrava:
--
--     ERROR: relation "public.company_members" does not exist (SQLSTATE 42P01)
--     at 20260602000000_ponto_escola.sql — policy ponto_fotos_select
--
--   Este arquivo traz o schema base para o repositório, ordenado ANTES de todas
--   as demais migrações (timestamp 00000000000000), fechando o buraco.
--
-- ESCOPO
--   - Só o schema base: tabelas, PKs, FKs, checks, índices e `enable row level
--     security`. As POLÍTICAS de RLS continuam em
--     20260728120000_baseline_rls_security_snapshot.sql, que roda depois.
--   - Tabelas já versionadas em outras migrações NÃO entram aqui
--     (push_subscriptions, member_devices, device_sessions, device_challenges,
--     device_enforcement, demo_leads, lembrete_config, lembrete_enviado).
--   - Tabelas de backup pontual (kv_store_backup_*, backup_*, _backup_dedup_*)
--     ficam de fora de propósito: são resíduo de operação, não schema.
--
-- IDEMPOTENTE
--   `create table if not exists` / `create index if not exists` em tudo. Rodar
--   contra a produção atual é no-op — nenhuma tabela existente é alterada.
-- ============================================================================

-- ─── Schema private + helper usado em DEFAULTs de pos_venda_* ────────────────
-- A definição canônica destes helpers está no baseline de RLS
-- (20260728120000), com `create or replace`. Aqui criamos a versão mínima
-- necessária porque as tabelas abaixo têm DEFAULT private.user_company_id() e
-- o default precisa existir no momento do CREATE TABLE.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

create or replace function private.user_company_id()
  returns text language sql stable security definer set search_path to 'public'
as $$
  select company_id from public.company_members where user_id = auth.uid() limit 1
$$;

-- ─── Empresas (tenant raiz) ─────────────────────────────────────────────────
create table if not exists public.companies (
  id text not null,
  cnpj text,
  nome text not null,
  email text,
  telefone text,
  endereco text,
  logo_url text,
  ativo boolean default true,
  criado_em timestamp with time zone default now(),
  atualizado_em timestamp with time zone default now(),
  metadata jsonb default '{}'::jsonb,
  require_first_login_otp boolean default false not null,
  require_mfa boolean default false not null,
  notify_os_email boolean default true not null,
  constraint companies_pkey primary key (id)
);
alter table public.companies enable row level security;

-- ─── Vínculo usuário ↔ empresa (papel, permissões, status) ──────────────────
create table if not exists public.company_members (
  user_id uuid not null,
  company_id text not null,
  role text not null,
  is_super_admin boolean default false,
  legacy_user_id text,
  legacy_password text,
  custom_permissions jsonb,
  status text default 'ativo'::text,
  nome text,
  avatar text,
  created_at timestamp with time zone default now(),
  comissao_percentual numeric,
  first_login_otp_done boolean default false not null,
  constraint company_members_pkey primary key (user_id, company_id),
  constraint company_members_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete cascade,
  constraint company_members_user_id_fkey foreign key (user_id)
    references auth.users(id) on delete cascade,
  constraint company_members_role_check check (role = any (array[
    'admin'::text, 'gerente'::text, 'tecnico'::text, 'atendente'::text,
    'cliente_escola'::text, 'ponto'::text
  ]))
);
alter table public.company_members enable row level security;
create index if not exists idx_company_members_company on public.company_members using btree (company_id);
create index if not exists idx_company_members_legacy on public.company_members using btree (legacy_user_id);

-- ─── kv_store — todo o dado do ERP (espelho do window.storage do app) ───────
create table if not exists public.kv_store (
  key text not null,
  value jsonb,
  updated_at timestamp with time zone default now(),
  company_id text not null,
  constraint kv_store_pkey primary key (key),
  constraint fk_kv_store_company foreign key (company_id)
    references public.companies(id) on delete cascade
);
alter table public.kv_store enable row level security;
create index if not exists idx_kv_store_company on public.kv_store using btree (company_id);

-- ─── Master tier (super-admin que gerencia empresas) ────────────────────────
create table if not exists public.master_users (
  id text not null,
  email text not null,
  nome text not null,
  password text not null,
  role text default 'master'::text not null,
  session_token_hash text,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  constraint master_users_pkey primary key (id),
  constraint master_users_email_key unique (email)
);
alter table public.master_users enable row level security;
create index if not exists idx_master_users_email on public.master_users using btree (lower(email));

-- ─── IA / Atendimento WhatsApp ──────────────────────────────────────────────
create table if not exists public.ai_conversations (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  customer_phone text not null,
  customer_name text,
  status text default 'active'::text not null,
  last_message_at timestamp with time zone default now() not null,
  linked_client_id text,
  linked_os_id text,
  ai_handoff_reason text,
  unread_count integer default 0 not null,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  constraint ai_conversations_pkey primary key (id),
  constraint ai_conversations_company_id_customer_phone_key unique (company_id, customer_phone),
  constraint ai_conversations_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete cascade,
  constraint ai_conversations_status_check check (status = any (array[
    'active'::text, 'pending_human'::text, 'closed'::text
  ]))
);
alter table public.ai_conversations enable row level security;
create index if not exists ai_conv_company_idx on public.ai_conversations using btree (company_id, last_message_at desc);

create table if not exists public.ai_messages (
  id uuid default gen_random_uuid() not null,
  conversation_id uuid not null,
  company_id text not null,
  role text not null,
  content text not null,
  media_url text,
  metadata jsonb,
  created_at timestamp with time zone default now() not null,
  constraint ai_messages_pkey primary key (id),
  constraint ai_messages_conversation_id_fkey foreign key (conversation_id)
    references public.ai_conversations(id) on delete cascade,
  constraint ai_messages_role_check check (role = any (array[
    'customer'::text, 'agent'::text, 'admin'::text, 'system'::text
  ]))
);
alter table public.ai_messages enable row level security;
create index if not exists ai_msg_conv_idx on public.ai_messages using btree (conversation_id, created_at);

create table if not exists public.ai_agent_config (
  company_id text not null,
  enabled boolean default true not null,
  evolution_instance text,
  evolution_url text,
  system_prompt text,
  business_hours jsonb default '{"end": "18:00", "start": "08:00", "weekdays": [1, 2, 3, 4, 5, 6]}'::jsonb,
  out_of_hours_message text,
  updated_at timestamp with time zone default now(),
  metadata jsonb,
  constraint ai_agent_config_pkey primary key (company_id),
  constraint ai_agent_config_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete cascade
);
alter table public.ai_agent_config enable row level security;

-- Propostas de OS geradas pela IA — dependem de aprovação humana (decisão 007).
create table if not exists public.ai_os_proposals (
  id uuid default gen_random_uuid() not null,
  company_id text not null,
  conversation_id uuid not null,
  payload jsonb not null,
  status text default 'pending_approval'::text not null,
  created_os_id text,
  decided_by text,
  created_at timestamp with time zone default now() not null,
  decided_at timestamp with time zone,
  constraint ai_os_proposals_pkey primary key (id),
  constraint ai_os_proposals_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete cascade,
  constraint ai_os_proposals_conversation_id_fkey foreign key (conversation_id)
    references public.ai_conversations(id) on delete cascade,
  constraint ai_os_proposals_status_check check (status = any (array[
    'pending_approval'::text, 'approved'::text, 'rejected'::text
  ]))
);
alter table public.ai_os_proposals enable row level security;
create index if not exists ai_os_prop_company_idx on public.ai_os_proposals using btree (company_id, status, created_at desc);

-- Dedupe de webhooks Evolution: o mesmo key.id chega várias vezes por status update.
create table if not exists public.whatsapp_processed_messages (
  message_id text not null,
  processed_at timestamp with time zone default now() not null,
  constraint whatsapp_processed_messages_pkey primary key (message_id)
);
alter table public.whatsapp_processed_messages enable row level security;

-- ─── Pós-Venda ──────────────────────────────────────────────────────────────
create table if not exists public.pos_venda_config (
  id uuid default gen_random_uuid() not null,
  cliente_id text,
  dias_proxima_visita integer default 90 not null,
  enviar_nps boolean default true not null,
  enviar_lembrete boolean default true not null,
  enviar_reagendamento boolean default true not null,
  modo_disparo text default 'aprovar'::text not null,
  horario_envio time without time zone default '09:00:00'::time without time zone not null,
  ativo boolean default true not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_id text default private.user_company_id(),
  constraint pos_venda_config_pkey primary key (id),
  constraint pos_venda_config_dias_proxima_visita_check
    check (dias_proxima_visita >= 1 and dias_proxima_visita <= 365),
  constraint pos_venda_config_modo_disparo_check check (modo_disparo = any (array[
    'auto'::text, 'aprovar'::text, 'manual'::text
  ]))
);
alter table public.pos_venda_config enable row level security;
-- Uma config por cliente, e no máximo uma config global (cliente_id null).
create unique index if not exists idx_pos_venda_config_cliente
  on public.pos_venda_config using btree (cliente_id) where (cliente_id is not null);
create unique index if not exists idx_pos_venda_config_global
  on public.pos_venda_config using btree (((cliente_id is null))) where (cliente_id is null);

create table if not exists public.pos_venda_mensagens (
  id uuid default gen_random_uuid() not null,
  os_id text,
  cliente_id text not null,
  cliente_nome text,
  os_numero text,
  tipo text not null,
  status text default 'pendente'::text not null,
  canal text default 'whatsapp'::text not null,
  conteudo text not null,
  telefone text,
  agendada_para timestamp with time zone not null,
  enviada_em timestamp with time zone,
  respondida_em timestamp with time zone,
  resposta_cliente text,
  intencao_detectada text,
  precisa_humano boolean default false not null,
  atendida_por uuid,
  atendida_em timestamp with time zone,
  erro_envio text,
  tentativas integer default 0 not null,
  metadata jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_id text default private.user_company_id(),
  constraint pos_venda_mensagens_pkey primary key (id),
  constraint pos_venda_mensagens_atendida_por_fkey foreign key (atendida_por)
    references auth.users(id),
  constraint pos_venda_mensagens_canal_check check (canal = any (array[
    'whatsapp'::text, 'sms'::text, 'email'::text
  ])),
  constraint pos_venda_mensagens_intencao_detectada_check check (intencao_detectada = any (array[
    'confirma'::text, 'reagenda'::text, 'duvida'::text, 'cancela'::text, 'parar'::text, 'outro'::text
  ])),
  constraint pos_venda_mensagens_status_check check (status = any (array[
    'pendente'::text, 'aprovada'::text, 'enviada'::text, 'respondida'::text,
    'cancelada'::text, 'erro'::text
  ])),
  constraint pos_venda_mensagens_tipo_check check (tipo = any (array[
    'nps'::text, 'lembrete_visita'::text, 'reagendamento'::text, 'custom'::text,
    'aniversario'::text, 'reativacao'::text, 'pos_registro'::text, 'pre_visita'::text,
    'pos_servico'::text
  ]))
);
alter table public.pos_venda_mensagens enable row level security;
create index if not exists idx_pvm_cliente on public.pos_venda_mensagens using btree (cliente_id, created_at desc);
create index if not exists idx_pvm_os on public.pos_venda_mensagens using btree (os_id);
-- Idempotência do dispatcher: uma mensagem de cada tipo por OS.
create unique index if not exists idx_pvm_os_tipo_unico
  on public.pos_venda_mensagens using btree (os_id, tipo) where (os_id is not null);
create index if not exists idx_pvm_precisa_humano
  on public.pos_venda_mensagens using btree (precisa_humano) where (precisa_humano = true);
create index if not exists idx_pvm_status_agendada on public.pos_venda_mensagens using btree (status, agendada_para);

create table if not exists public.pos_venda_optout (
  cliente_id text not null,
  motivo text,
  origem text default 'cliente'::text,
  opted_out_at timestamp with time zone default now() not null,
  company_id text default private.user_company_id(),
  constraint pos_venda_optout_pkey primary key (cliente_id),
  constraint pos_venda_optout_origem_check check (origem = any (array[
    'cliente'::text, 'admin'::text, 'bounce'::text
  ]))
);
alter table public.pos_venda_optout enable row level security;

create table if not exists public.pos_venda_templates (
  id uuid default gen_random_uuid() not null,
  tipo text not null,
  nome text not null,
  conteudo text not null,
  variaveis text[] default array[]::text[],
  ativo boolean default true not null,
  is_default boolean default false not null,
  created_at timestamp with time zone default now() not null,
  updated_at timestamp with time zone default now() not null,
  company_id text default private.user_company_id(),
  constraint pos_venda_templates_pkey primary key (id),
  constraint pos_venda_templates_tipo_check check (tipo = any (array[
    'nps'::text, 'lembrete_visita'::text, 'reagendamento'::text, 'duvida_humano'::text,
    'optout_confirma'::text, 'aniversario'::text, 'reativacao'::text, 'pos_registro'::text,
    'pre_visita'::text, 'pos_servico'::text
  ]))
);
alter table public.pos_venda_templates enable row level security;
-- Um template default ativo por tipo.
create unique index if not exists idx_template_default_por_tipo
  on public.pos_venda_templates using btree (tipo) where (is_default = true and ativo = true);

-- ─── OTP de e-mail (1º login, Fase 2.4) ─────────────────────────────────────
-- RLS ligada e sem policies de propósito: acesso só via edge function com
-- service_role.
create table if not exists public.email_otps (
  id uuid default gen_random_uuid() not null,
  user_id uuid not null,
  company_id text not null,
  code_hash text not null,
  purpose text not null,
  expires_at timestamp with time zone not null,
  attempts integer default 0 not null,
  consumed_at timestamp with time zone,
  created_at timestamp with time zone default now() not null,
  constraint email_otps_pkey primary key (id),
  constraint email_otps_company_id_fkey foreign key (company_id)
    references public.companies(id) on delete cascade,
  constraint email_otps_user_id_fkey foreign key (user_id)
    references auth.users(id) on delete cascade
);
alter table public.email_otps enable row level security;
create index if not exists email_otps_active_by_user
  on public.email_otps using btree (user_id, purpose) where (consumed_at is null);
