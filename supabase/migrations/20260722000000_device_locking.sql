-- Fase 1 — Travamento por aparelho: tabelas de vínculo aparelho↔membro.
-- Prova "soft" (device_uuid) nesta fase; public_key/credential_id ficam prontas
-- para a Fase 2 (hardware/WebAuthn). RLS trancada: acesso só via edge (service_role),
-- mesmo padrão de email_otps.

create table if not exists public.member_devices (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,                      -- id da empresa (mesmo tipo usado em kv_store)
  member_user_id uuid not null,                  -- auth.users.id do membro
  status text not null default 'pending'
    check (status in ('pending','approved','rejected','revoked')),
  platform text not null check (platform in ('android','web','ios')),
  device_uuid text not null,                     -- identificador soft (Fase 1)
  public_key text,                               -- Fase 2 (Android EC / WebAuthn COSE)
  credential_id text,                            -- Fase 2 (WebAuthn)
  attestation_uncertain boolean not null default false,
  fingerprint jsonb not null default '{}'::jsonb,-- modelo/os/versão para exibição/auditoria
  approved_by uuid,                              -- master_users.id que aprovou
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Estrito 1:1 — no máximo um aparelho aprovado por membro...
create unique index if not exists member_devices_one_approved_per_member
  on public.member_devices (member_user_id) where status = 'approved';
-- ...e um mesmo aparelho aprovado não pode servir a dois membros.
create unique index if not exists member_devices_one_member_per_device
  on public.member_devices (device_uuid) where status = 'approved';
-- Uma linha por (membro, aparelho) para permitir upsert idempotente no enroll.
create unique index if not exists member_devices_member_device_uniq
  on public.member_devices (member_user_id, device_uuid);

create index if not exists member_devices_company_idx on public.member_devices (company_id);

-- Prova viva: criada no verify; consumida pelo RLS na Fase 3. TTL curto.
create table if not exists public.device_sessions (
  id uuid primary key default gen_random_uuid(),
  member_user_id uuid not null,
  device_id uuid not null references public.member_devices(id) on delete cascade,
  auth_session_id uuid,                          -- session_id do JWT (Fase 3)
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists device_sessions_member_idx on public.device_sessions (member_user_id);
create index if not exists device_sessions_device_idx on public.device_sessions (device_id);

-- RLS ligada SEM policies: nega tudo para anon/authenticated; edges usam service_role.
alter table public.member_devices enable row level security;
alter table public.device_sessions enable row level security;
