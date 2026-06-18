-- Lembrete de manutenção/visita — tabelas, RLS e chave de dispatch.
-- Aplicado em prod via MCP apply_migration (name: lembrete_tables) em 2026-06-18.

-- Config do lembrete por empresa
create table if not exists public.lembrete_config (
  company_id        text primary key,
  ativo             boolean     not null default false,
  manutencao_ativa  boolean     not null default true,
  intervalo_pj_dias int         not null default 90,
  intervalo_pf_dias int         not null default 180,
  antecedencia_dias int         not null default 15,
  agendados_ativo   boolean     not null default true,
  lookahead_dias    int         not null default 7,
  resumo_hora       text        not null default '07:00',
  canais            text[]      not null default '{whatsapp}',
  para_cliente      boolean     not null default true,
  para_admin        boolean     not null default true,
  para_dono         boolean     not null default false,
  dono_telefone     text,
  template_cliente  text,
  template_admin    text,
  updated_at        timestamptz not null default now()
);

-- Dedupe + histórico de envios
create table if not exists public.lembrete_enviado (
  id           uuid primary key default gen_random_uuid(),
  company_id   text not null,
  tipo         text not null,        -- 'manutencao' | 'agendado' | 'resumo_dono'
  cliente_id   text,
  ref_data     date not null,
  destinatario text not null,        -- 'cliente' | 'admin' | 'dono'
  canal        text not null,        -- 'whatsapp' | 'push'
  status       text not null default 'enviado',
  erro         text,
  enviado_em   timestamptz not null default now(),
  unique (company_id, tipo, cliente_id, ref_data, destinatario, canal)
);
create index if not exists lembrete_enviado_company_idx on public.lembrete_enviado (company_id, enviado_em desc);

-- RLS: config rw só admin/gerente da empresa; enviado leitura admin/gerente.
alter table public.lembrete_config  enable row level security;
alter table public.lembrete_enviado enable row level security;

drop policy if exists lembrete_config_rw on public.lembrete_config;
create policy lembrete_config_rw on public.lembrete_config
  for all
  using (company_id = private.user_company_id() and private.user_role() in ('admin','gerente'))
  with check (company_id = private.user_company_id() and private.user_role() in ('admin','gerente'));

drop policy if exists lembrete_enviado_ro on public.lembrete_enviado;
create policy lembrete_enviado_ro on public.lembrete_enviado
  for select
  using (company_id = private.user_company_id() and private.user_role() in ('admin','gerente'));

-- Chave de dispatch (Vault). Trava EXECUTE: só service_role/postgres (cron) acessa.
create or replace function public.lembrete_dispatch_key()
returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'lembrete_dispatch_key' limit 1;
$$;
revoke all on function public.lembrete_dispatch_key() from public, anon, authenticated;
