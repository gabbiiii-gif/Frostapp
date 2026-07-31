-- ============================================================================
-- Move public.current_device_ok() → schema private (hardening)
-- ----------------------------------------------------------------------------
-- POR QUÊ
--   O advisor de segurança acusa `current_device_ok()` como SECURITY DEFINER
--   executável por anon/authenticated via /rest/v1/rpc/current_device_ok.
--   PostgREST só expõe o schema `public`; movendo a função para `private` ela
--   some do endpoint RPC, mas continua chamável internamente pela RLS.
--
-- POR QUE É SEGURO
--   - O frontend NÃO chama esta função via `.rpc()` (verificado: os únicos
--     .rpc do app são `promote_self_member_to_ativo` e `master_count`).
--   - A policy `device_gate` (kv_store e demais tabelas) referencia a função
--     por OID, que NÃO muda no `SET SCHEMA` — a policy continua funcionando.
--   - Mesma técnica já validada em produção para os helpers user_role/
--     user_company_id/is_master_admin (ver decision 009, adendo 2026-06-01).
--   - Reversível: `alter function private.current_device_ok() set schema public;`
--
-- COMO APLICAR (não roda em deploy; sem CI):
--   supabase db push        # ou colar este SQL no SQL Editor do dashboard
-- ============================================================================

alter function public.current_device_ok() set schema private;

-- O caller da RLS precisa de usage no schema + execute na função (idempotente).
grant usage on schema private to anon, authenticated, service_role;
grant execute on function private.current_device_ok() to anon, authenticated, service_role;
