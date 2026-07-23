-- Fase 3 — Cadeado por aparelho no banco (RLS), com KILL-SWITCH.
-- Estratégia segura: política RESTRITIVA (AND com as permissivas existentes) que
-- chama current_device_ok(). Enquanto o kill-switch está DESLIGADO, a função
-- retorna sempre true → as políticas são NO-OP (zero mudança de comportamento).
-- Só ao LIGAR o kill-switch é que o bloqueio real passa a valer.

-- ─── Kill-switch global (linha única id=1), começa DESLIGADO ──────────────────
create table if not exists public.device_enforcement (
  id int primary key default 1,
  enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  constraint device_enforcement_single check (id = 1)
);
insert into public.device_enforcement (id, enabled) values (1, false)
  on conflict (id) do nothing;
alter table public.device_enforcement enable row level security;

-- ─── current_device_ok(): a decisão de RLS por aparelho ──────────────────────
-- true se: kill-switch OFF (libera geral), OU service_role/sem membro
-- (auth.uid() null → edges), OU existe device_session válida do usuário.
create or replace function public.current_device_ok()
returns boolean
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_enabled boolean;
  v_ok boolean;
begin
  select enabled into v_enabled from public.device_enforcement where id = 1;
  if v_enabled is not true then
    return true; -- kill-switch desligado
  end if;
  if auth.uid() is null then
    return true; -- service_role / sem sessão de membro
  end if;
  select exists(
    select 1 from public.device_sessions ds
    where ds.member_user_id = auth.uid() and ds.expires_at > now()
  ) into v_ok;
  return coalesce(v_ok, false);
end;
$$;

-- ─── Política restritiva "device_gate" nas tabelas de dados (aditiva) ─────────
-- Idempotente: só cria onde a tabela existe e a política ainda não existe.
do $$
declare
  t text;
  tables text[] := array[
    'kv_store','ai_conversations','ai_messages','ai_agent_config','ai_os_proposals',
    'pos_venda_config','pos_venda_mensagens','pos_venda_optout','pos_venda_templates',
    'lembrete_config','lembrete_enviado','push_subscriptions'
  ];
begin
  foreach t in array tables loop
    if to_regclass('public.'||t) is not null
       and not exists (
         select 1 from pg_policies
         where schemaname='public' and tablename=t and policyname='device_gate'
       ) then
      execute format(
        'create policy device_gate on public.%I as restrictive for all to authenticated using (public.current_device_ok()) with check (public.current_device_ok())',
        t
      );
    end if;
  end loop;
end $$;
