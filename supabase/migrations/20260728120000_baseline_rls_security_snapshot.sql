-- ============================================================================
-- BASELINE — Snapshot da camada de SEGURANÇA (RLS + helpers) da produção
-- Projeto: frostapp2.0 (rbwzhglsztmjvwrcydcy) · Extraído AO VIVO em 2026-07-28
-- ----------------------------------------------------------------------------
-- POR QUE ESTE ARQUIVO EXISTE
--   Várias políticas de RLS e funções de segurança foram aplicadas direto na
--   produção via MCP (ver docs/wiki/decisions/009-hardening-seguranca) e NÃO
--   estavam versionadas no repo. Isto as traz para o repositório — para revisão
--   de código e para reprodutibilidade (DR). As definições abaixo foram
--   extraídas do banco de produção, então refletem fielmente o que roda hoje.
--
-- LIMITAÇÕES (importante)
--   - NÃO é o schema completo. As tabelas-base (kv_store, company_members,
--     companies, device_*) são provisionadas fora do repo. Para um dump
--     completo do schema use `supabase db pull`.
--   - Idempotente e defensivo: `create or replace` nas funções, `drop policy
--     if exists` antes de cada policy e guarda `to_regclass` onde a tabela pode
--     não existir. Seguro para rodar em qualquer ambiente sem quebrar o atual.
--   - Reflete o estado de 2026-07-28. Se a produção mudar, re-extrair.
-- ============================================================================

-- ─── Schema private (helpers fora da API exposta pelo PostgREST) ─────────────
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;

-- ─── Helpers de RLS (SECURITY DEFINER) ───────────────────────────────────────
-- Papel e empresa do caller, derivados de company_members via auth.uid().
create or replace function private.user_role()
  returns text language sql stable security definer set search_path to 'public'
as $$
  select role from public.company_members where user_id = auth.uid() limit 1
$$;

create or replace function private.user_company_id()
  returns text language sql stable security definer set search_path to 'public'
as $$
  select company_id from public.company_members where user_id = auth.uid() limit 1
$$;

-- Master tier: flag is_master no app_metadata do JWT.
create or replace function private.is_master_admin()
  returns boolean language sql stable security definer set search_path to 'public'
as $$
  select coalesce((auth.jwt() -> 'app_metadata' ->> 'is_master')::boolean, false)
$$;

-- Autorização por CHAVE (leitura): quais prefixos do kv_store cada papel pode ler.
create or replace function private.kv_can_read(p_key text)
  returns boolean language sql stable security definer set search_path to 'public'
as $$
  select case private.user_role()
    when 'admin'   then true
    when 'gerente' then true
    -- Portal externo da Vanda: SÓ demandas/eventos de escola. Nada do ERP.
    when 'cliente_escola' then (p_key like 'erp:escola:%' or p_key like 'erp:evento_escola:%')
    -- Funcionário que só bate ponto: SÓ dados de ponto.
    when 'ponto' then (p_key like 'erp:ponto:%' or p_key like 'erp:jornada:%' or p_key like 'erp:ocorrencia:%')
    -- Demais internos (técnico, atendente, …): tudo MENOS financeiro/segredos/auditoria.
    else not (
      p_key like 'erp:finance:%'           or
      p_key like 'erp:transaction:%'       or
      p_key like 'erp:banking:%'           or
      p_key like 'erp:transferencia:%'     or
      p_key like 'erp:vale:%'              or
      p_key like 'erp:calendarFeedToken:%' or
      p_key like 'erp:audit:%'
    )
  end
$$;

-- Autorização por CHAVE (escrita): mais restrito que leitura (protege config/user/employee).
create or replace function private.kv_can_write(p_key text)
  returns boolean language sql stable security definer set search_path to 'public'
as $$
  select case private.user_role()
    when 'admin'   then true
    when 'gerente' then true
    when 'cliente_escola' then (p_key like 'erp:escola:%' or p_key like 'erp:evento_escola:%')
    when 'ponto' then (p_key like 'erp:ponto:%' or p_key like 'erp:jornada:%' or p_key like 'erp:ocorrencia:%')
    else not (
      p_key like 'erp:finance:%'           or
      p_key like 'erp:transaction:%'       or
      p_key like 'erp:banking:%'           or
      p_key like 'erp:transferencia:%'     or
      p_key like 'erp:vale:%'              or
      p_key like 'erp:calendarFeedToken:%' or
      p_key like 'erp:config:%'            or
      p_key like 'erp:user:%'              or
      p_key like 'erp:employee:%'
    )
  end
$$;

-- Callers precisam de EXECUTE mesmo em SECURITY DEFINER (as policies chamam por OID).
grant execute on function
  private.user_role(),
  private.user_company_id(),
  private.is_master_admin(),
  private.kv_can_read(text),
  private.kv_can_write(text)
  to anon, authenticated, service_role;

-- ─── Funções de apoio no schema public ───────────────────────────────────────
-- Device gate (cadeado por aparelho, com kill-switch). Ver 20260722040000_device_rls_fase3.
create or replace function public.current_device_ok()
  returns boolean language plpgsql stable security definer set search_path to 'public'
as $$
declare
  v_enabled boolean;
  v_ok boolean;
begin
  select enabled into v_enabled from public.device_enforcement where id = 1;
  if v_enabled is not true then
    return true;
  end if;
  if auth.uid() is null then
    return true;
  end if;
  select exists(
    select 1 from public.device_sessions ds
    where ds.member_user_id = auth.uid() and ds.expires_at > now()
  ) into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- RPC self-service: convidado promove o próprio membro de 'pendente' → 'ativo' no 1º login.
create or replace function public.promote_self_member_to_ativo()
  returns public.company_members language plpgsql security definer set search_path to 'public'
as $$
declare updated_row public.company_members;
begin
  update company_members set status = 'ativo'
  where user_id = auth.uid() and status = 'pendente'
  returning * into updated_row;
  return updated_row;
end;
$$;

-- ─── RLS do kv_store: isolamento por empresa + autorização por chave ──────────
do $$
begin
  if to_regclass('public.kv_store') is null then
    raise notice 'kv_store não existe — pulando políticas do kv_store';
    return;
  end if;

  alter table public.kv_store enable row level security;

  -- Membro comum: só a própria empresa, respeitando kv_can_read/write por papel.
  drop policy if exists kv_select_own on public.kv_store;
  create policy kv_select_own on public.kv_store for select to authenticated
    using ((company_id = private.user_company_id()) and private.kv_can_read(key));

  drop policy if exists kv_insert_own on public.kv_store;
  create policy kv_insert_own on public.kv_store for insert to authenticated
    with check ((company_id = private.user_company_id()) and private.kv_can_write(key));

  drop policy if exists kv_update_own on public.kv_store;
  create policy kv_update_own on public.kv_store for update to authenticated
    using ((company_id = private.user_company_id()) and private.kv_can_write(key))
    with check ((company_id = private.user_company_id()) and private.kv_can_write(key));

  drop policy if exists kv_delete_own on public.kv_store;
  create policy kv_delete_own on public.kv_store for delete to authenticated
    using ((company_id = private.user_company_id()) and private.kv_can_write(key));

  -- Master tier: acesso amplo (bypass de company) via flag do JWT.
  drop policy if exists kv_master_select on public.kv_store;
  create policy kv_master_select on public.kv_store for select to authenticated
    using (private.is_master_admin());

  drop policy if exists kv_master_insert on public.kv_store;
  create policy kv_master_insert on public.kv_store for insert to authenticated
    with check (private.is_master_admin());

  drop policy if exists kv_master_update on public.kv_store;
  create policy kv_master_update on public.kv_store for update to authenticated
    using (private.is_master_admin()) with check (private.is_master_admin());

  drop policy if exists kv_master_delete on public.kv_store;
  create policy kv_master_delete on public.kv_store for delete to authenticated
    using (private.is_master_admin());

  -- Device gate (RESTRICTIVE): faz AND com as permissivas acima. NO-OP com kill-switch OFF.
  drop policy if exists device_gate on public.kv_store;
  create policy device_gate on public.kv_store as restrictive for all to authenticated
    using (public.current_device_ok()) with check (public.current_device_ok());
end $$;

-- ─── RLS do storage.objects: isolamento por pasta (foldername[1] = company_id) ─
-- Padrão comum: o 1º segmento do path do arquivo deve ser uma company do caller.
-- Buckets são privados (public=false); acesso só via signed URLs + estas policies.
do $$
begin
  if to_regclass('storage.objects') is null then
    raise notice 'storage.objects não existe — pulando políticas de storage';
    return;
  end if;

  -- os-fotos (fotos de OS) — role authenticated
  drop policy if exists os_fotos_select on storage.objects;
  create policy os_fotos_select on storage.objects for select to authenticated
    using ((bucket_id = 'os-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists os_fotos_insert on storage.objects;
  create policy os_fotos_insert on storage.objects for insert to authenticated
    with check ((bucket_id = 'os-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists os_fotos_update on storage.objects;
  create policy os_fotos_update on storage.objects for update to authenticated
    using ((bucket_id = 'os-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())))
    with check ((bucket_id = 'os-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists os_fotos_delete on storage.objects;
  create policy os_fotos_delete on storage.objects for delete to authenticated
    using ((bucket_id = 'os-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));

  -- os-assinaturas (assinaturas de OS) — role authenticated
  drop policy if exists os_assin_select on storage.objects;
  create policy os_assin_select on storage.objects for select to authenticated
    using ((bucket_id = 'os-assinaturas') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists os_assin_insert on storage.objects;
  create policy os_assin_insert on storage.objects for insert to authenticated
    with check ((bucket_id = 'os-assinaturas') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists os_assin_update on storage.objects;
  create policy os_assin_update on storage.objects for update to authenticated
    using ((bucket_id = 'os-assinaturas') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())))
    with check ((bucket_id = 'os-assinaturas') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists os_assin_delete on storage.objects;
  create policy os_assin_delete on storage.objects for delete to authenticated
    using ((bucket_id = 'os-assinaturas') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));

  -- escola-oficios (ofícios do portal Escola) — role authenticated
  drop policy if exists escola_oficios_select on storage.objects;
  create policy escola_oficios_select on storage.objects for select to authenticated
    using ((bucket_id = 'escola-oficios') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists escola_oficios_insert on storage.objects;
  create policy escola_oficios_insert on storage.objects for insert to authenticated
    with check ((bucket_id = 'escola-oficios') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists escola_oficios_update on storage.objects;
  create policy escola_oficios_update on storage.objects for update to authenticated
    using ((bucket_id = 'escola-oficios') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())))
    with check ((bucket_id = 'escola-oficios') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists escola_oficios_delete on storage.objects;
  create policy escola_oficios_delete on storage.objects for delete to authenticated
    using ((bucket_id = 'escola-oficios') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));

  -- ai-media (mídia do agente IA) — role authenticated, apenas SELECT (escrita via service_role)
  drop policy if exists ai_media_select on storage.objects;
  create policy ai_media_select on storage.objects for select to authenticated
    using ((bucket_id = 'ai-media') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));

  -- escola-anexos — role public (qual usa auth.uid()), apenas INSERT/SELECT
  drop policy if exists escola_anexos_insert on storage.objects;
  create policy escola_anexos_insert on storage.objects for insert to public
    with check ((bucket_id = 'escola-anexos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists escola_anexos_select on storage.objects;
  create policy escola_anexos_select on storage.objects for select to public
    using ((bucket_id = 'escola-anexos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));

  -- ponto-docs — role public, SELECT/INSERT/DELETE
  drop policy if exists ponto_docs_select on storage.objects;
  create policy ponto_docs_select on storage.objects for select to public
    using ((bucket_id = 'ponto-docs') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists ponto_docs_insert on storage.objects;
  create policy ponto_docs_insert on storage.objects for insert to public
    with check ((bucket_id = 'ponto-docs') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists ponto_docs_delete on storage.objects;
  create policy ponto_docs_delete on storage.objects for delete to public
    using ((bucket_id = 'ponto-docs') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));

  -- ponto-fotos — role public, SELECT/INSERT
  drop policy if exists ponto_fotos_select on storage.objects;
  create policy ponto_fotos_select on storage.objects for select to public
    using ((bucket_id = 'ponto-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
  drop policy if exists ponto_fotos_insert on storage.objects;
  create policy ponto_fotos_insert on storage.objects for insert to public
    with check ((bucket_id = 'ponto-fotos') and ((storage.foldername(name))[1] in (select company_id from public.company_members where user_id = auth.uid())));
end $$;
