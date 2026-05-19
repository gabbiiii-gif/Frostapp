-- ─────────────────────────────────────────────────────────────────────────────
-- Pós-Venda — agendamento via Supabase pg_cron (substitui o Vercel Cron)
-- ─────────────────────────────────────────────────────────────────────────────
-- Motivo: o plano Vercel Hobby limita Cron Jobs a 1x/dia. O dispatcher do
-- Pós-Venda precisa rodar a cada 15 min. Solução: agendar dentro do Supabase
-- com pg_cron + pg_net chamando a Edge Function `pos-venda-dispatch`.
--
-- APLICADO EM PROD 2026-05-19 via MCP no projeto `frostapp2.0`
-- (ref rbwzhglsztmjvwrcydcy). Este arquivo documenta o que foi feito —
-- é idempotente e pode ser re-rodado. NÃO contém o segredo real (vive no Vault).
--
-- Decisão de auth: a chave NÃO fica em env coordenada. A Edge Function lê do
-- Vault via RPC public.pos_venda_dispatch_key() (fallback quando env
-- DISPATCH_KEY não está setada). O pg_cron lê o mesmo segredo do Vault.
-- ADR: docs/wiki/decisions/008-pos-venda-pg-cron-vs-vercel-cron.md
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extensões (idempotente)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Segredo compartilhado no Vault. Substitua <DISPATCH_KEY> ao re-rodar em
--    outro ambiente (o valor de prod já está gravado; não fica neste arquivo).
do $$
declare v_id uuid;
begin
  select id into v_id from vault.secrets where name = 'pos_venda_dispatch_key';
  if v_id is null then
    perform vault.create_secret('<DISPATCH_KEY>', 'pos_venda_dispatch_key',
      'Chave compartilhada do dispatcher Pos-Venda (pg_cron <-> Edge Function)');
  else
    perform vault.update_secret(v_id, '<DISPATCH_KEY>', 'pos_venda_dispatch_key',
      'Chave compartilhada do dispatcher Pos-Venda (pg_cron <-> Edge Function)');
  end if;
end $$;

-- 3. RPC que a Edge Function (service_role) usa pra ler a chave do Vault.
create or replace function public.pos_venda_dispatch_key()
returns text
language sql
security definer
set search_path = public, vault
as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'pos_venda_dispatch_key' limit 1;
$$;
revoke all on function public.pos_venda_dispatch_key() from public, anon, authenticated;
grant execute on function public.pos_venda_dispatch_key() to service_role;

-- 4. Agendamento: a cada 15 min, POST na Edge Function com a chave do Vault.
--    Trocar o host pela URL do projeto se re-rodar em outro ambiente.
select cron.unschedule('pos-venda-dispatch')
where exists (select 1 from cron.job where jobname = 'pos-venda-dispatch');

select cron.schedule(
  'pos-venda-dispatch',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://rbwzhglsztmjvwrcydcy.supabase.co/functions/v1/pos-venda-dispatch',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-dispatch-key', (select decrypted_secret
                         from vault.decrypted_secrets
                         where name = 'pos_venda_dispatch_key')
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Verificação ──────────────────────────────────────────────────────────────
-- Job agendado:
--   select jobid, jobname, schedule, active from cron.job where jobname='pos-venda-dispatch';
-- Histórico de execuções:
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname='pos-venda-dispatch')
--   order by start_time desc limit 10;
-- Resposta HTTP da Edge Function:
--   select id, status_code, content, error_msg, created
--   from net._http_response order by created desc limit 5;
-- Smoke test esperado (sem Evolution): 200 {"skipped":"evolution_nao_configurada","sent":0}
