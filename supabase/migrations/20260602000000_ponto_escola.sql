-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Ponto Eletrônico + Escola (Vanda)
-- Data: 2026-06-02
-- Estratégia:
--   Dados primários (registros de ponto, ocorrências, demandas escola) ficam
--   no kv_store sob prefixos novos scoped por company (ver SCOPED_PREFIXES em
--   src/App.jsx). Padrão é o mesmo de erp:os:*, erp:client:*, etc.
--
--   Esta migration cria apenas:
--     1. push_subscriptions: assinaturas Web Push (precisa query indexada
--        por user_id, não cabe no kv_store)
--     2. Buckets Storage: ponto-fotos, ponto-docs, escola-anexos
--     3. RLS policies dos buckets
-- ─────────────────────────────────────────────────────────────────────────────

-- 1) Tabela push_subscriptions ───────────────────────────────────────────────
create table if not exists public.push_subscriptions (
  id          bigserial primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  company_id  uuid,                                       -- nullable: master tier
  endpoint    text not null,
  p256dh      text not null,
  auth_key    text not null,                              -- "auth" do PushSubscription
  user_agent  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (user_id, endpoint)
);

create index if not exists push_subscriptions_user_idx     on public.push_subscriptions(user_id);
create index if not exists push_subscriptions_company_idx  on public.push_subscriptions(company_id);

alter table public.push_subscriptions enable row level security;

-- Cada user só vê/altera suas próprias inscrições (mesma company)
drop policy if exists push_subs_select_own on public.push_subscriptions;
create policy push_subs_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);

drop policy if exists push_subs_insert_own on public.push_subscriptions;
create policy push_subs_insert_own on public.push_subscriptions
  for insert with check (auth.uid() = user_id);

drop policy if exists push_subs_update_own on public.push_subscriptions;
create policy push_subs_update_own on public.push_subscriptions
  for update using (auth.uid() = user_id);

drop policy if exists push_subs_delete_own on public.push_subscriptions;
create policy push_subs_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- 2) Storage buckets ─────────────────────────────────────────────────────────
-- ponto-fotos: foto facial capturada na hora do registro (auditoria anti-fraude).
-- ponto-docs: atestados, declarações, anexos de ocorrência.
-- escola-anexos: opcional, futuro upload de fotos do serviço da escola.
insert into storage.buckets (id, name, public)
values
  ('ponto-fotos',   'ponto-fotos',   false),
  ('ponto-docs',    'ponto-docs',    false),
  ('escola-anexos', 'escola-anexos', false)
on conflict (id) do nothing;

-- RLS dos buckets: paths usam padrão `<company_id>/<user_id>/<filename>` para
-- que policies isolem por company sem precisar de tabela extra de metadados.
-- Auth.uid() autenticado pode ler/escrever apenas o próprio prefixo company.

-- ponto-fotos
drop policy if exists ponto_fotos_select on storage.objects;
create policy ponto_fotos_select on storage.objects
  for select using (
    bucket_id = 'ponto-fotos'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

drop policy if exists ponto_fotos_insert on storage.objects;
create policy ponto_fotos_insert on storage.objects
  for insert with check (
    bucket_id = 'ponto-fotos'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

-- ponto-docs
drop policy if exists ponto_docs_select on storage.objects;
create policy ponto_docs_select on storage.objects
  for select using (
    bucket_id = 'ponto-docs'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

drop policy if exists ponto_docs_insert on storage.objects;
create policy ponto_docs_insert on storage.objects
  for insert with check (
    bucket_id = 'ponto-docs'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

drop policy if exists ponto_docs_delete on storage.objects;
create policy ponto_docs_delete on storage.objects
  for delete using (
    bucket_id = 'ponto-docs'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

-- escola-anexos (mesmo padrão)
drop policy if exists escola_anexos_select on storage.objects;
create policy escola_anexos_select on storage.objects
  for select using (
    bucket_id = 'escola-anexos'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

drop policy if exists escola_anexos_insert on storage.objects;
create policy escola_anexos_insert on storage.objects
  for insert with check (
    bucket_id = 'escola-anexos'
    and (storage.foldername(name))[1] in (
      select company_id::text from public.company_members where user_id = auth.uid()
    )
  );

-- ─────────────────────────────────────────────────────────────────────────────
-- Esquemas de payload do kv_store (referência — não criam tabelas)
-- ─────────────────────────────────────────────────────────────────────────────
-- erp:ponto:<uuid>          → registro individual de ponto
--   { id, funcionario_id, tipo, datahora, metodo, gps_lat, gps_lng, gps_acc,
--     ip, user_agent, device_id, foto_path, manual_motivo, manual_por }
--
-- erp:jornada:<funcionario_id>   → config jornada do funcionário (singleton por func.)
--   { funcionario_id, horas_dia, horas_semana, dias_semana[], tolerancia_min,
--     metodo_padrao, hora_entrada, hora_saida, intervalo_min, ativo }
--
-- erp:ocorrencia:<uuid>     → justificativa/ocorrência
--   { id, funcionario_id, data_ref, tipo, descricao, documento_path, status,
--     decidido_por, decidido_em, decisao_obs, zera_debito }
--
-- erp:escola:<uuid>         → demanda da Vanda
--   { id, escola_nome, descricao, urgencia, data_solicitacao, status,
--     solicitante_id, responsavel_id, assumido_em, concluido_em,
--     observacao_conclusao }
--
-- erp:evento_escola:<uuid>  → linha do tempo de uma demanda escola
--   { id, demanda_id, evento, ator_id, payload, created_at }
-- ─────────────────────────────────────────────────────────────────────────────
