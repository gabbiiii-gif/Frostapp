-- Leads capturados na demo interativa da landing. RLS trancada: acesso só via
-- edge (service_role), mesmo padrão de email_otps / member_devices.
create table if not exists public.demo_leads (
  id uuid primary key default gen_random_uuid(),
  nome text,
  whatsapp text,
  email text,
  origem text not null default 'landing_demo',
  user_agent text,
  created_at timestamptz not null default now()
);
alter table public.demo_leads enable row level security;
