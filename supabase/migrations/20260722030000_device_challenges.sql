-- Fase 2 (WebAuthn) — desafios (nonce) anti-replay para enroll/verify de aparelho.
-- Cada desafio é de uso único e expira rápido. RLS trancada (acesso só via edge).
create table if not exists public.device_challenges (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null,
  nonce text not null,
  purpose text not null check (purpose in ('enroll','verify')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists device_challenges_member_idx on public.device_challenges (member_user_id);
create index if not exists device_challenges_nonce_idx on public.device_challenges (nonce);
alter table public.device_challenges enable row level security;
