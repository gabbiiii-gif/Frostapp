-- Agendamento pg_cron do lembrete-dispatch (a cada 15 min).
-- Aplicado em prod via MCP execute_sql em 2026-06-18 (jobid 2).
-- A chave vem do Vault via public.lembrete_dispatch_key() (EXECUTE revogado de
-- anon/authenticated; só o cron/postgres acessa).

select cron.schedule(
  'lembrete-dispatch-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rbwzhglsztmjvwrcydcy.supabase.co/functions/v1/lembrete-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-dispatch-key', public.lembrete_dispatch_key()),
    body := '{}'::jsonb
  );
  $$
);

-- Para remover: select cron.unschedule('lembrete-dispatch-15min');
