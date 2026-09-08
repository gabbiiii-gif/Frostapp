-- ============================================================================
-- Remoção do travamento por aparelho ("Servidor e Terminais")
-- ----------------------------------------------------------------------------
-- POR QUÊ
--   O recurso prendia cada membro a um único aparelho aprovado pelo superadmin.
--   Na prática atrapalhou mais do que ajudou (usuário legítimo trocando de
--   máquina/navegador ficava preso na tela de "aguardando aprovação"), então o
--   sistema foi removido por inteiro — cliente, edges e banco.
--
-- ORDEM IMPORTA
--   1) Derrubar as políticas RESTRITIVAS `device_gate` ANTES de apagar a função
--      que elas chamam. Com o kill-switch ligado (estado em produção antes desta
--      migração), qualquer sessão sem `device_sessions` válida era negada pela
--      RLS — apagar a função primeiro deixaria as políticas quebradas.
--   2) Só então some a função e as tabelas de apoio.
--
-- REVERSÃO
--   Não há: as migrações 20260722* recriam tudo se um dia o recurso voltar.
-- ============================================================================

-- ─── 1. Remove a política restritiva device_gate de TODAS as tabelas ─────────
-- Varre pg_policies em vez de repetir a lista fixa da Fase 3 — pega também
-- qualquer tabela que tenha herdado a política depois.
do $$
declare
  r record;
begin
  for r in
    select schemaname, tablename
    from pg_policies
    where policyname = 'device_gate'
  loop
    execute format('drop policy if exists device_gate on %I.%I', r.schemaname, r.tablename);
  end loop;
end $$;

-- ─── 2. Função de decisão da RLS (mora em `private` desde 20260730) ─────────
drop function if exists private.current_device_ok();
drop function if exists public.current_device_ok();

-- ─── 3. Tabelas de apoio ────────────────────────────────────────────────────
-- device_sessions tem FK para member_devices → cai antes.
drop table if exists public.device_sessions;
drop table if exists public.device_challenges;
drop table if exists public.member_devices;
drop table if exists public.device_enforcement;
