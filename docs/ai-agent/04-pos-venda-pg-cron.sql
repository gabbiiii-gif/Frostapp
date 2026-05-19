-- ─────────────────────────────────────────────────────────────────────────────
-- Pós-Venda — agendamento via Supabase pg_cron (substitui o Vercel Cron)
-- ─────────────────────────────────────────────────────────────────────────────
-- Motivo: o plano Vercel Hobby limita Cron Jobs a 1x/dia. O dispatcher do
-- Pós-Venda precisa rodar a cada 15 min. Solução: agendar dentro do Supabase
-- com pg_cron + pg_net, chamando a Edge Function `pos-venda-dispatch`
-- diretamente (verify_jwt=false; auth = header x-dispatch-key).
--
-- Rodar UMA VEZ no SQL Editor do Supabase (projeto de produção).
-- Pré-requisitos: extensões pg_cron e pg_net (disponíveis no Supabase).
--
-- Substitua os 2 placeholders antes de rodar:
--   <PROJECT_REF>  → ref do projeto (ex: abcd1234 em https://abcd1234.supabase.co)
--   <DISPATCH_KEY> → o mesmo segredo configurado na env DISPATCH_KEY da
--                     Edge Function pos-venda-dispatch.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1. Extensões (idempotente; no Supabase já costumam existir)
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 2. Guarda o segredo no Vault (evita deixar a chave em texto puro no agendamento).
--    Se já existir, atualiza.
select vault.create_secret('<DISPATCH_KEY>', 'pos_venda_dispatch_key')
on conflict do nothing;

-- 3. Remove agendamento anterior (idempotente — permite re-rodar este script).
select cron.unschedule('pos-venda-dispatch')
where exists (select 1 from cron.job where jobname = 'pos-venda-dispatch');

-- 4. Agenda: a cada 15 minutos, POST na Edge Function com o header de auth.
select cron.schedule(
  'pos-venda-dispatch',
  '*/15 * * * *',
  $$
  select net.http_post(
    url     := 'https://<PROJECT_REF>.supabase.co/functions/v1/pos-venda-dispatch',
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
--   select jobid, jobname, schedule, active from cron.job;
-- Histórico de execuções (sucesso/erro):
--   select * from cron.job_run_details
--   where jobid = (select jobid from cron.job where jobname = 'pos-venda-dispatch')
--   order by start_time desc limit 10;
-- Resposta HTTP da Edge Function (status/body):
--   select * from net._http_response order by created desc limit 5;
