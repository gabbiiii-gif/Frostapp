# Travamento por Aparelho — Fase 1 (Fundação) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar a fundação testável do travamento por aparelho — tabelas, edge functions, painel do superadmin e o portão no login — usando prova "soft" (device UUID), sem hardware nem RLS ainda.

**Architecture:** Cada membro registra um aparelho (`member_devices`) ao logar; fica `pending` até o superadmin aprovar no painel `MasterApp`. O login roda um portão (`deviceVerify`) que libera só se houver aparelho `approved` cujo `device_uuid` bate com o aparelho atual. Enforcement é de UX nesta fase (o bloqueio real via RLS vem na Fase 3). Estrito 1:1 garantido por índices únicos parciais.

**Tech Stack:** React 19 + Vite 6 (JS, sem TS no front), Supabase (Postgres + Edge Functions Deno/TS), Capacitor 8 (`@capacitor/preferences`, `@capacitor/device`), Vitest + happy-dom.

## Global Constraints

- **Front-end é JavaScript puro (sem TypeScript).** Edge functions são Deno/TypeScript.
- **UI 100% em pt-BR** (labels, mensagens, erros). Comentários de código em **pt-BR** (Regra 2 do CLAUDE.md).
- **Deploy contínuo (Regra 1):** ao fim da fase, commitar no Git e deployar (push → Vercel). Repo remoto: `https://github.com/gabbiiii-gif/Frostapp.git`.
- **Edge functions master** autenticam via `{ masterId, sessionTokenHash }` comparados timing-safe contra `master_users.session_token_hash` (padrão `master-companies`).
- **Edge functions de membro** usam `verify_jwt = true`; o caller é identificado pelo JWT (`Authorization: Bearer`).
- **`company_members`** colunas reais: `user_id, company_id, role, is_super_admin, legacy_user_id, custom_permissions, status, nome, avatar, first_login_otp_done`. O **Servidor** = membro com `is_super_admin = true` (não criar coluna nova).
- **Estrito 1:1:** 1 membro → no máx. 1 aparelho `approved`; 1 `device_uuid` → no máx. 1 membro `approved`.
- **DB layer:** dados do app vivem em `kv_store` via `DB.set/get`. Não bypassar. Nesta fase não tocamos RLS de `kv_store`.
- **App.jsx é gigante (~17.8k linhas)** e efetivamente single-file. Números de linha driftam — **sempre grep pelo nome da função** antes de editar.
- **Master tier NÃO passa pelo portão** (o master é o superadmin que aprova; login master é separado, `MasterLoginScreen`).
- **Wiki (Regra 5):** ao fim, ingerir a mudança arquitetural em `docs/wiki/`.

---

## File Structure

**Criar:**
- `supabase/migrations/20260722000000_device_locking.sql` — tabelas `member_devices`, `device_sessions` + índices + RLS lockdown.
- `supabase/functions/device-enroll/index.ts` — registra aparelho pendente do membro autenticado.
- `supabase/functions/device-verify/index.ts` — decide `approved`/`pending`/`denied` e cria `device_sessions`.
- `supabase/functions/master-devices/index.ts` — painel do superadmin: `list`/`approve`/`reject`/`revoke`.
- `src/device-identity.js` — identidade soft do aparelho (UUID em Preferences + plataforma/modelo).
- `src/device-identity.test.js` — testes Vitest.
- `src/lib/device-policy.js` — lógica pura de decisão de status (compartilhada mentalmente com a edge; testável).
- `src/lib/device-policy.test.js` — testes Vitest.

**Modificar:**
- `src/supabase.js` — helpers `deviceEnroll`, `deviceVerify`, `callMasterDevices`/`masterDevices` (perto dos helpers master existentes).
- `src/App.jsx` — (a) painel "Aparelhos" no `MasterApp`; (b) portão no `LoginScreen` + boot do `App`.
- `docs/wiki/index.md`, `docs/wiki/log.md`, nova página `docs/wiki/concepts/device-locking.md` — memória do projeto.

---

## Task 1: Migration — tabelas e RLS

**Files:**
- Create: `supabase/migrations/20260722000000_device_locking.sql`

**Interfaces:**
- Produces: tabelas `public.member_devices`, `public.device_sessions`; colunas usadas por todas as edges das Tasks 3-5.

- [ ] **Step 1: Escrever a migration**

```sql
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
```

- [ ] **Step 2: Aplicar e verificar**

Aplicar via Supabase (Dashboard SQL Editor ou `supabase db push`). Verificação:

Run (SQL Editor):
```sql
select table_name from information_schema.tables
where table_schema='public' and table_name in ('member_devices','device_sessions');
select indexname from pg_indexes where tablename='member_devices';
```
Expected: 2 tabelas listadas; índices `member_devices_one_approved_per_member`, `member_devices_one_member_per_device`, `member_devices_member_device_uniq` presentes.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260722000000_device_locking.sql
git commit -m "feat(device-lock): migration member_devices + device_sessions (Fase 1)"
```

---

## Task 2: `src/device-identity.js` — identidade soft do aparelho

**Files:**
- Create: `src/device-identity.js`
- Test: `src/device-identity.test.js`

**Interfaces:**
- Consumes: `@capacitor/preferences` (Preferences), `@capacitor/device` (Device), `isNative()` de `src/platform.js`.
- Produces:
  - `getOrCreateDeviceUuid(): Promise<string>` — UUID estável por instalação (persistido em Preferences; fallback localStorage no web).
  - `getPlatform(): 'android' | 'ios' | 'web'`
  - `getDeviceFingerprint(): Promise<{ platform, model, osVersion, manufacturer }>`
  - `buildDevicePayload(): Promise<{ device_uuid, platform, fingerprint }>` — payload pronto para as edges.

- [ ] **Step 1: Adicionar dependência `@capacitor/device`**

Run:
```bash
npm install @capacitor/device@^8
```
Expected: `@capacitor/device` em `dependencies` do `package.json`.

- [ ] **Step 2: Escrever o teste que falha**

```javascript
// src/device-identity.test.js
import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock dos plugins Capacitor: no ambiente de teste (happy-dom) não há nativo.
const store = {};
vi.mock('@capacitor/preferences', () => ({
  Preferences: {
    get: async ({ key }) => ({ value: store[key] ?? null }),
    set: async ({ key, value }) => { store[key] = value; },
  },
}));
vi.mock('@capacitor/device', () => ({
  Device: {
    getId: async () => ({ identifier: 'hw-id-123' }),
    getInfo: async () => ({ platform: 'web', model: 'Test', osVersion: '1', manufacturer: 'X' }),
  },
}));
vi.mock('./platform.js', () => ({ isNative: () => false }));

import { getOrCreateDeviceUuid, buildDevicePayload } from './device-identity.js';

describe('device-identity', () => {
  beforeEach(() => { for (const k of Object.keys(store)) delete store[k]; localStorage.clear(); });

  it('gera um UUID estável entre chamadas', async () => {
    const a = await getOrCreateDeviceUuid();
    const b = await getOrCreateDeviceUuid();
    expect(a).toBeTruthy();
    expect(a).toBe(b);
  });

  it('buildDevicePayload retorna device_uuid, platform e fingerprint', async () => {
    const p = await buildDevicePayload();
    expect(p.device_uuid).toBeTruthy();
    expect(p.platform).toBe('web');
    expect(p.fingerprint).toHaveProperty('model');
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npm run test -- device-identity`
Expected: FAIL — `Cannot find module './device-identity.js'`.

- [ ] **Step 4: Implementar `src/device-identity.js`**

```javascript
// src/device-identity.js
// Identidade "soft" do aparelho para a Fase 1 do travamento por aparelho.
// Um UUID estável por instalação identifica o device. Na Fase 2 este UUID é
// complementado por uma chave de hardware (Android Keystore / WebAuthn).
import { Preferences } from '@capacitor/preferences';
import { Device } from '@capacitor/device';
import { isNative } from './platform.js';

const UUID_KEY = 'frost_device_uuid';

// UUID v4 sem depender de libs (crypto.randomUUID quando disponível).
function genUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Lê o UUID persistido; cria e persiste se ainda não existir.
// Persiste em Preferences (nativo) e sempre espelha em localStorage (web/fallback).
export async function getOrCreateDeviceUuid() {
  let existing = null;
  try {
    const res = await Preferences.get({ key: UUID_KEY });
    existing = res?.value || null;
  } catch { /* Preferences indisponível → cai no localStorage */ }
  if (!existing) existing = localStorage.getItem(UUID_KEY);
  if (existing) return existing;

  const fresh = genUuid();
  try { await Preferences.set({ key: UUID_KEY, value: fresh }); } catch { /* ignora */ }
  try { localStorage.setItem(UUID_KEY, fresh); } catch { /* ignora */ }
  return fresh;
}

// Plataforma normalizada para a coluna member_devices.platform.
export function getPlatform() {
  const p = (globalThis.Capacitor?.getPlatform?.() || 'web');
  return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'web';
}

// Dados de exibição/auditoria (modelo, versão do SO). Nunca são base de segurança.
export async function getDeviceFingerprint() {
  try {
    const info = await Device.getInfo();
    return {
      platform: info.platform || getPlatform(),
      model: info.model || (isNative() ? 'desconhecido' : (navigator.userAgent || 'navegador')),
      osVersion: info.osVersion || '',
      manufacturer: info.manufacturer || '',
    };
  } catch {
    return { platform: getPlatform(), model: navigator.userAgent || 'navegador', osVersion: '', manufacturer: '' };
  }
}

// Payload pronto para as edges device-enroll / device-verify.
export async function buildDevicePayload() {
  const [device_uuid, fingerprint] = await Promise.all([getOrCreateDeviceUuid(), getDeviceFingerprint()]);
  return { device_uuid, platform: getPlatform(), fingerprint };
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npm run test -- device-identity`
Expected: PASS (2 testes).

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/device-identity.js src/device-identity.test.js
git commit -m "feat(device-lock): identidade soft do aparelho (device-identity)"
```

---

## Task 3: `src/lib/device-policy.js` — decisão pura de status

**Files:**
- Create: `src/lib/device-policy.js`
- Test: `src/lib/device-policy.test.js`

**Interfaces:**
- Produces: `decideDeviceStatus(devices, deviceUuid): { status, deviceId } ` onde `status ∈ 'approved'|'pending'|'denied'|'needs_enroll'`. `devices` = linhas de `member_devices` do membro (`[{ id, device_uuid, status }]`).
  - Regras (as mesmas que a edge `device-verify` aplica no servidor):
    - Há `approved` cujo `device_uuid` == atual → `approved`.
    - Há `approved` com `device_uuid` diferente → `denied` (preso a outro aparelho).
    - Não há approved, mas há linha deste device com `status='pending'` → `pending`.
    - Há linha deste device `rejected`/`revoked` → `denied`.
    - Nenhuma linha para este device → `needs_enroll`.

- [ ] **Step 1: Escrever o teste que falha**

```javascript
// src/lib/device-policy.test.js
import { describe, it, expect } from 'vitest';
import { decideDeviceStatus } from './device-policy.js';

describe('decideDeviceStatus', () => {
  it('aprova quando há aparelho approved com uuid igual', () => {
    const r = decideDeviceStatus([{ id: 'd1', device_uuid: 'u1', status: 'approved' }], 'u1');
    expect(r).toEqual({ status: 'approved', deviceId: 'd1' });
  });
  it('nega quando approved é de outro aparelho', () => {
    const r = decideDeviceStatus([{ id: 'd1', device_uuid: 'u1', status: 'approved' }], 'u2');
    expect(r.status).toBe('denied');
  });
  it('pendente quando este aparelho está pending e nada approved', () => {
    const r = decideDeviceStatus([{ id: 'd2', device_uuid: 'u2', status: 'pending' }], 'u2');
    expect(r).toEqual({ status: 'pending', deviceId: 'd2' });
  });
  it('nega quando este aparelho foi rejeitado', () => {
    const r = decideDeviceStatus([{ id: 'd3', device_uuid: 'u3', status: 'rejected' }], 'u3');
    expect(r.status).toBe('denied');
  });
  it('needs_enroll quando não há linha para este aparelho', () => {
    const r = decideDeviceStatus([], 'u9');
    expect(r.status).toBe('needs_enroll');
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- device-policy`
Expected: FAIL — módulo não existe.

- [ ] **Step 3: Implementar `src/lib/device-policy.js`**

```javascript
// src/lib/device-policy.js
// Lógica PURA de decisão do status do aparelho. Espelha as regras aplicadas no
// servidor pela edge device-verify — mantida aqui para dar UX no portão do login
// e para ser testável. NÃO é a fronteira de segurança (isso é o RLS, Fase 3).
export function decideDeviceStatus(devices, deviceUuid) {
  const list = Array.isArray(devices) ? devices : [];
  const approved = list.find((d) => d.status === 'approved');
  if (approved) {
    return approved.device_uuid === deviceUuid
      ? { status: 'approved', deviceId: approved.id }
      : { status: 'denied', deviceId: approved.id };
  }
  const thisDevice = list.find((d) => d.device_uuid === deviceUuid);
  if (!thisDevice) return { status: 'needs_enroll', deviceId: null };
  if (thisDevice.status === 'pending') return { status: 'pending', deviceId: thisDevice.id };
  return { status: 'denied', deviceId: thisDevice.id }; // rejected | revoked
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- device-policy`
Expected: PASS (5 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/device-policy.js src/lib/device-policy.test.js
git commit -m "feat(device-lock): política pura de decisão de status do aparelho"
```

---

## Task 4: Edge `device-enroll`

**Files:**
- Create: `supabase/functions/device-enroll/index.ts`

**Interfaces:**
- Consumes: JWT do membro; body `{ device_uuid, platform, fingerprint }`.
- Produces: resposta `{ ok, status: 'pending'|'approved'|'denied', device_id }`. Upsert idempotente em `member_devices` por `(member_user_id, device_uuid)`.

- [ ] **Step 1: Escrever a função**

```typescript
// Edge Function: device-enroll (verify_jwt = true)
// Registra o aparelho atual do membro autenticado como 'pending' (se ainda não
// existir). Idempotente por (member_user_id, device_uuid). Não aprova nada — a
// aprovação é exclusiva do superadmin (edge master-devices).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  // Identifica o caller pelo JWT.
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const deviceUuid = String(body.device_uuid || "").trim();
  const platform = String(body.platform || "").trim();
  const fingerprint = (body.fingerprint && typeof body.fingerprint === "object") ? body.fingerprint : {};
  if (!deviceUuid || !["android", "web", "ios"].includes(platform)) {
    return json({ ok: false, error: "invalid_device" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Descobre a company_id do membro.
  const { data: member } = await admin
    .from("company_members").select("company_id").eq("user_id", userId).maybeSingle();
  if (!member?.company_id) return json({ ok: false, error: "no_membership" }, 403);

  // Já existe linha para (membro, device)? Preserva status; senão cria pending.
  const { data: existing } = await admin
    .from("member_devices")
    .select("id, status")
    .eq("member_user_id", userId).eq("device_uuid", deviceUuid).maybeSingle();

  if (existing) {
    // Atualiza fingerprint/plataforma para exibição; não altera status.
    await admin.from("member_devices")
      .update({ platform, fingerprint, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return json({ ok: true, status: existing.status, device_id: existing.id });
  }

  const { data: inserted, error: insErr } = await admin.from("member_devices").insert({
    company_id: member.company_id,
    member_user_id: userId,
    status: "pending",
    platform,
    device_uuid: deviceUuid,
    fingerprint,
  }).select("id").single();
  if (insErr) { console.error("device-enroll insert:", insErr.message); return json({ ok: false, error: "internal" }, 500); }

  return json({ ok: true, status: "pending", device_id: inserted.id });
});
```

- [ ] **Step 2: Deploy da função**

Run: `supabase functions deploy device-enroll`
Expected: deploy OK (verify_jwt padrão true).

- [ ] **Step 3: Verificar (smoke manual)**

Com um usuário logado no app (Task 8 ainda não feita), este passo é validado via Task 8. Por ora, conferir no Dashboard → Functions que `device-enroll` existe e está deployada.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/device-enroll/index.ts
git commit -m "feat(device-lock): edge device-enroll (registra aparelho pendente)"
```

---

## Task 5: Edge `device-verify`

**Files:**
- Create: `supabase/functions/device-verify/index.ts`

**Interfaces:**
- Consumes: JWT do membro; body `{ device_uuid }`.
- Produces: `{ ok, status: 'approved'|'pending'|'denied'|'needs_enroll' }`. Quando `approved`, insere `device_sessions` (expira +15min).

- [ ] **Step 1: Escrever a função**

```typescript
// Edge Function: device-verify (verify_jwt = true)
// Aplica no servidor as MESMAS regras de src/lib/device-policy.js e, quando o
// aparelho está aprovado, emite uma device_session curta (base do RLS na Fase 3).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const SESSION_TTL_MIN = 15;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const deviceUuid = String(body.device_uuid || "").trim();
  if (!deviceUuid) return json({ ok: false, error: "invalid_device" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: devices } = await admin
    .from("member_devices")
    .select("id, device_uuid, status")
    .eq("member_user_id", userId);

  // Regras espelhadas de src/lib/device-policy.js
  const list = devices || [];
  const approved = list.find((d) => d.status === "approved");
  let status = "needs_enroll";
  let deviceId: string | null = null;
  if (approved) {
    if (approved.device_uuid === deviceUuid) { status = "approved"; deviceId = approved.id; }
    else { status = "denied"; deviceId = approved.id; }
  } else {
    const thisDev = list.find((d) => d.device_uuid === deviceUuid);
    if (!thisDev) status = "needs_enroll";
    else if (thisDev.status === "pending") { status = "pending"; deviceId = thisDev.id; }
    else { status = "denied"; deviceId = thisDev.id; }
  }

  if (status === "approved" && deviceId) {
    const expires = new Date(Date.now() + SESSION_TTL_MIN * 60_000).toISOString();
    await admin.from("device_sessions").insert({ member_user_id: userId, device_id: deviceId, expires_at: expires });
  }

  return json({ ok: true, status });
});
```

- [ ] **Step 2: Deploy**

Run: `supabase functions deploy device-verify`
Expected: deploy OK.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/device-verify/index.ts
git commit -m "feat(device-lock): edge device-verify (decide status + device_session)"
```

---

## Task 6: Edge `master-devices` (painel do superadmin)

**Files:**
- Create: `supabase/functions/master-devices/index.ts`

**Interfaces:**
- Consumes: `{ action: 'list'|'approve'|'reject'|'revoke', masterId, sessionTokenHash, deviceId? }`.
- Produces:
  - `list` → `{ ok, devices: [{ id, company_id, company_nome, member_user_id, member_nome, role, is_super_admin, status, platform, device_uuid, fingerprint, created_at, approved_at }] }`
  - `approve/reject/revoke` → `{ ok }`. `approve` revoga conflitos 1:1 antes de aprovar; `revoke` apaga `device_sessions` do aparelho.

- [ ] **Step 1: Escrever a função (modelada em master-companies)**

```typescript
// Edge Function: master-devices (verify_jwt = false — master não tem JWT)
// Autentica via master_users.session_token_hash (timing-safe), igual master-companies.
// Painel do superadmin para aprovar/rejeitar/revogar aparelhos de qualquer empresa.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const action = String(body.action || "");
  const masterId = String(body.masterId || "");
  const sessionTokenHash = String(body.sessionTokenHash || "");
  if (!masterId || !sessionTokenHash) return json({ ok: false, error: "unauthenticated" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Auth do master via token hash.
  const { data: masterRow } = await admin
    .from("master_users").select("id, session_token_hash").eq("id", masterId).maybeSingle();
  if (!masterRow?.session_token_hash || !timingSafeEqual(String(masterRow.session_token_hash), sessionTokenHash)) {
    return json({ ok: false, error: "invalid_session" }, 401);
  }

  // ─── LIST ───
  if (action === "list") {
    const { data: devices, error } = await admin
      .from("member_devices")
      .select("id, company_id, member_user_id, status, platform, device_uuid, fingerprint, created_at, approved_at")
      .order("created_at", { ascending: false });
    if (error) { console.error("master-devices list:", error.message); return json({ ok: false, error: "internal" }, 500); }

    // Enriquecer com nome do membro/empresa (uma varredura simples; volumes pequenos).
    const memberIds = [...new Set((devices || []).map((d) => d.member_user_id))];
    const { data: members } = await admin
      .from("company_members").select("user_id, nome, role, is_super_admin").in("user_id", memberIds.length ? memberIds : ["_none_"]);
    const memberMap = new Map((members || []).map((m) => [m.user_id, m]));
    const { data: companies } = await admin.from("companies").select("id, nome");
    const companyMap = new Map((companies || []).map((c) => [String(c.id), c.nome]));

    const enriched = (devices || []).map((d) => ({
      ...d,
      company_nome: companyMap.get(String(d.company_id)) || d.company_id,
      member_nome: memberMap.get(d.member_user_id)?.nome || d.member_user_id,
      role: memberMap.get(d.member_user_id)?.role || null,
      is_super_admin: !!memberMap.get(d.member_user_id)?.is_super_admin,
    }));
    return json({ ok: true, devices: enriched });
  }

  const deviceId = String(body.deviceId || "");
  if (!deviceId) return json({ ok: false, error: "missing_device" }, 400);

  // ─── APPROVE ───
  if (action === "approve") {
    const { data: target } = await admin
      .from("member_devices").select("id, member_user_id, device_uuid").eq("id", deviceId).maybeSingle();
    if (!target) return json({ ok: false, error: "not_found" }, 404);
    // Garante 1:1: revoga qualquer outro aprovado do mesmo membro E qualquer
    // aprovado do mesmo device_uuid pertencente a outro membro.
    await admin.from("member_devices").update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("member_user_id", target.member_user_id).eq("status", "approved").neq("id", deviceId);
    await admin.from("member_devices").update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("device_uuid", target.device_uuid).eq("status", "approved").neq("id", deviceId);
    const { error } = await admin.from("member_devices")
      .update({ status: "approved", approved_by: masterId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", deviceId);
    if (error) { console.error("master-devices approve:", error.message); return json({ ok: false, error: error.message }, 500); }
    return json({ ok: true });
  }

  // ─── REJECT ───
  if (action === "reject") {
    const { error } = await admin.from("member_devices")
      .update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", deviceId);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // ─── REVOKE ───
  if (action === "revoke") {
    await admin.from("device_sessions").delete().eq("device_id", deviceId);
    const { error } = await admin.from("member_devices")
      .update({ status: "revoked", updated_at: new Date().toISOString() }).eq("id", deviceId);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
```

- [ ] **Step 2: Deploy com verify_jwt=false**

Run: `supabase functions deploy master-devices --no-verify-jwt`
Expected: deploy OK.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/master-devices/index.ts
git commit -m "feat(device-lock): edge master-devices (aprovar/rejeitar/revogar)"
```

---

## Task 7: Helpers no `src/supabase.js`

**Files:**
- Modify: `src/supabase.js` (adicionar perto de `callMasterCompanies` / helpers master, ~linha 1142-1186)

**Interfaces:**
- Consumes: `buildDevicePayload` de `./device-identity.js`; `supabase`, `supabaseUrl`, `supabaseKey` já no módulo.
- Produces (exportados):
  - `deviceEnroll(): Promise<{ ok, status?, device_id?, error? }>`
  - `deviceVerify(): Promise<{ ok, status?, error? }>`
  - `masterDevices(master, action, payload?): Promise<{ ok, devices?, error? }>`

- [ ] **Step 1: Adicionar import no topo de `src/supabase.js`**

Grep o bloco de imports do topo do arquivo e adicionar:
```javascript
import { buildDevicePayload } from './device-identity.js';
```

- [ ] **Step 2: Adicionar os helpers (após `masterDeleteCompany`, ~linha 1186)**

```javascript
// ─── Travamento por aparelho (Fase 1) ───────────────────────────────────────
// Registra o aparelho atual do membro logado como pendente. Idempotente.
export async function deviceEnroll() {
  if (!supabase) return { ok: false, error: 'no_supabase' };
  try {
    const payload = await buildDevicePayload();
    const { data, error } = await supabase.functions.invoke('device-enroll', { body: payload });
    if (error) return { ok: false, error: error.message };
    return data?.ok ? data : { ok: false, error: data?.error || 'enroll_failed' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Verifica se o aparelho atual está aprovado. Retorna status
// 'approved'|'pending'|'denied'|'needs_enroll'.
export async function deviceVerify() {
  if (!supabase) return { ok: false, error: 'no_supabase' };
  try {
    const { device_uuid } = await buildDevicePayload();
    const { data, error } = await supabase.functions.invoke('device-verify', { body: { device_uuid } });
    if (error) return { ok: false, error: error.message };
    return data?.ok ? data : { ok: false, error: data?.error || 'verify_failed' };
  } catch (e) { return { ok: false, error: e.message }; }
}

// Painel do superadmin — autentica via masterId+sessionTokenHash (padrão master-companies).
async function callMasterDevices(master, action, payload = {}) {
  if (!supabase) return { ok: false, error: 'Supabase não configurado.' };
  const masterId = master?.id;
  const sessionTokenHash = master?.sessionTokenHash;
  if (!masterId || !sessionTokenHash) return { ok: false, error: 'Sessão do master expirada. Entre novamente.' };
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/master-devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey },
      body: JSON.stringify({ action, masterId, sessionTokenHash, ...payload }),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) return { ok: false, error: body.error || `HTTP ${resp.status}` };
    return { ok: true, ...body };
  } catch (err) { return { ok: false, error: err.message }; }
}

// Lista aparelhos (pendentes + aprovados + histórico) de todas as empresas.
export async function masterDevices(master, action = 'list', payload = {}) {
  return callMasterDevices(master, action, payload);
}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build sem erros (imports resolvem).

- [ ] **Step 4: Commit**

```bash
git add src/supabase.js
git commit -m "feat(device-lock): helpers deviceEnroll/deviceVerify/masterDevices"
```

---

## Task 8: Portão no login + boot (App.jsx)

**Files:**
- Modify: `src/App.jsx` — `LoginScreen` (grep `function LoginScreen`) e o `App` (grep `export default function App`).

**Interfaces:**
- Consumes: `deviceEnroll`, `deviceVerify` de `./supabase.js` (adicionar aos imports existentes).
- Produces: gating de acesso — usuário só chega ao ERP quando `deviceVerify` retorna `approved`.

- [ ] **Step 1: Adicionar imports**

Grep a linha `import { supabase, hydrateFromSupabase, ...` (topo do App.jsx) e acrescentar `deviceEnroll, deviceVerify` à lista de nomes importados de `./supabase.js`.

- [ ] **Step 2: Criar o componente de tela de bloqueio (adicionar antes de `function LoginScreen`)**

```javascript
// Tela exibida quando o aparelho não está aprovado. Sem acesso ao ERP.
// status: 'pending' (aguardando superadmin) | 'denied' (aparelho não autorizado).
function DeviceGateScreen({ status, onLogout }) {
  const pendente = status === 'pending';
  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-900 text-slate-100 p-6">
      <div className="max-w-md w-full bg-slate-800 rounded-2xl p-8 text-center shadow-xl">
        <div className="text-5xl mb-4">{pendente ? '⏳' : '🔒'}</div>
        <h1 className="text-xl font-semibold mb-2">
          {pendente ? 'Aguardando aprovação do aparelho' : 'Aparelho não autorizado'}
        </h1>
        <p className="text-slate-300 text-sm mb-6">
          {pendente
            ? 'Este aparelho foi registrado e está aguardando liberação pelo administrador do sistema. Assim que aprovado, você poderá acessar normalmente.'
            : 'Seu acesso está vinculado a outro aparelho. Fale com o administrador do sistema para liberar este aparelho.'}
        </p>
        <button onClick={onLogout} className="px-4 py-2 rounded-lg bg-slate-700 hover:bg-slate-600 text-sm">
          Sair
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Chamar o portão no fim do login bem-sucedido**

No `LoginScreen`, logo antes da chamada final a `onLogin(userToLogin)` (grep `onLogin(` dentro de `handleSubmit`; é o ponto após MFA/OTP resolverem), inserir:

```javascript
      // Portão de aparelho (Fase 1): registra + verifica antes de liberar o ERP.
      // Master não passa por aqui (login master é separado).
      try {
        await deviceEnroll();                 // idempotente; cria pendente se 1ª vez
        const chk = await deviceVerify();
        if (chk.ok && chk.status !== 'approved') {
          // Sinaliza ao App para renderizar a tela de bloqueio.
          onLogin({ ...userToLogin, __deviceGate: chk.status });
          return;
        }
      } catch (e) {
        console.warn('portão de aparelho falhou (soft, libera):', e.message);
      }
```

> Nota: nesta fase o portão é "soft" — se a verificação falhar por rede, libera (não trava o usuário legítimo offline). O bloqueio duro entra com o RLS na Fase 3.

- [ ] **Step 4: Tratar `__deviceGate` no App**

No componente `App`, onde o usuário autenticado é renderizado (grep pelo estado `user` e o retorno que decide entre `LoginScreen` e o shell logado), adicionar antes do shell:

```javascript
  // Se o login sinalizou aparelho não aprovado, mostra a tela de bloqueio.
  if (user && user.__deviceGate) {
    return <DeviceGateScreen status={user.__deviceGate} onLogout={() => handleLogout()} />;
  }
```

(Grep `handleLogout` para confirmar o nome exato da função de logout; ajustar se necessário.)

- [ ] **Step 5: Verificar build + testes**

Run: `npm run build && npm run test`
Expected: build OK; toda a suíte Vitest passa.

- [ ] **Step 6: Teste manual (fluxo ponta a ponta)**

1. `npm run dev`, logar com um usuário comum → deve cair na tela **"Aguardando aprovação do aparelho"**.
2. Logar no `MasterApp` (superadmin) → painel **Aparelhos** (Task 9 se ainda não integrado; ou testar via `masterDevices` no console) → **Aprovar** o aparelho pendente.
3. Deslogar e logar de novo com o usuário → agora entra no ERP normalmente.

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat(device-lock): portão de aparelho no login + tela de bloqueio"
```

---

## Task 9: Painel "Aparelhos" no MasterApp

**Files:**
- Modify: `src/App.jsx` — `MasterApp` (grep `function MasterApp`).

**Interfaces:**
- Consumes: `masterDevices` de `./supabase.js`.
- Produces: nova aba/painel no MasterApp listando aparelhos com ações Aprovar/Rejeitar/Revogar.

- [ ] **Step 1: Adicionar `masterDevices` aos imports do App.jsx**

Grep o import de `./supabase.js` e acrescentar `masterDevices`.

- [ ] **Step 2: Criar o componente `MasterDevicesPanel` (adicionar antes de `function MasterApp`)**

```javascript
// Painel do superadmin: lista aparelhos e permite aprovar/rejeitar/revogar.
// Só o master controla vínculos de aparelho (decisão de projeto — spec 2026-07-22).
function MasterDevicesPanel({ master, addToast }) {
  const [devices, setDevices] = React.useState([]);
  const [loading, setLoading] = React.useState(true);
  const [busyId, setBusyId] = React.useState(null);

  const load = React.useCallback(async () => {
    setLoading(true);
    const res = await masterDevices(master, 'list');
    if (res.ok) setDevices(res.devices || []);
    else addToast?.(res.error || 'Falha ao listar aparelhos', 'error');
    setLoading(false);
  }, [master, addToast]);

  React.useEffect(() => { load(); }, [load]);

  async function act(deviceId, action) {
    setBusyId(deviceId);
    const res = await masterDevices(master, action, { deviceId });
    if (res.ok) { addToast?.('Feito.', 'success'); await load(); }
    else addToast?.(res.error || 'Falha na ação', 'error');
    setBusyId(null);
  }

  const statusPt = { pending: 'Pendente', approved: 'Aprovado', rejected: 'Rejeitado', revoked: 'Revogado' };

  if (loading) return <div className="p-6 text-slate-300">Carregando aparelhos…</div>;

  return (
    <div className="p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-100">Aparelhos</h2>
        <button onClick={load} className="text-sm px-3 py-1.5 rounded-lg bg-slate-700 hover:bg-slate-600">Atualizar</button>
      </div>
      {devices.length === 0 ? (
        <div className="text-slate-400 text-sm">Nenhum aparelho registrado ainda.</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-slate-400 text-left">
              <tr>
                <th className="py-2 pr-3">Empresa</th>
                <th className="py-2 pr-3">Membro</th>
                <th className="py-2 pr-3">Papel</th>
                <th className="py-2 pr-3">Plataforma</th>
                <th className="py-2 pr-3">Aparelho</th>
                <th className="py-2 pr-3">Status</th>
                <th className="py-2 pr-3">Ações</th>
              </tr>
            </thead>
            <tbody className="text-slate-200">
              {devices.map((d) => (
                <tr key={d.id} className="border-t border-slate-700">
                  <td className="py-2 pr-3">{d.company_nome}</td>
                  <td className="py-2 pr-3">{d.member_nome}{d.is_super_admin ? ' (Servidor)' : ''}</td>
                  <td className="py-2 pr-3">{d.role || '—'}</td>
                  <td className="py-2 pr-3">{d.platform}</td>
                  <td className="py-2 pr-3" title={d.device_uuid}>{d.fingerprint?.model || d.device_uuid?.slice(0, 8)}</td>
                  <td className="py-2 pr-3">{statusPt[d.status] || d.status}</td>
                  <td className="py-2 pr-3 whitespace-nowrap">
                    {d.status !== 'approved' && (
                      <button disabled={busyId === d.id} onClick={() => act(d.id, 'approve')}
                        className="px-2 py-1 mr-1 rounded bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50">Aprovar</button>
                    )}
                    {d.status === 'pending' && (
                      <button disabled={busyId === d.id} onClick={() => act(d.id, 'reject')}
                        className="px-2 py-1 mr-1 rounded bg-amber-600 hover:bg-amber-500 disabled:opacity-50">Rejeitar</button>
                    )}
                    {d.status === 'approved' && (
                      <button disabled={busyId === d.id} onClick={() => act(d.id, 'revoke')}
                        className="px-2 py-1 rounded bg-red-600 hover:bg-red-500 disabled:opacity-50">Revogar</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

> `React` já está em escopo no App.jsx (import default). Se o arquivo usar hooks desestruturados (`useState` direto), trocar `React.useState`/`React.useEffect`/`React.useCallback` pelos nomes já importados — grep `useState` no topo para confirmar o estilo.

- [ ] **Step 3: Ligar o painel na navegação do MasterApp**

No `MasterApp`, localizar como as seções/abas são renderizadas (grep dentro de `function MasterApp` por `MasterAuditLog` — é uma sub-tela análoga já existente). Adicionar uma aba/botão "Aparelhos" que renderiza `<MasterDevicesPanel master={master} addToast={addToast} />`, seguindo o mesmo padrão de navegação da aba de auditoria.

- [ ] **Step 4: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 5: Teste manual**

`npm run dev` → logar no MasterApp → abrir "Aparelhos" → ver o pendente da Task 8 → Aprovar → status vira "Aprovado".

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(device-lock): painel Aparelhos no MasterApp (aprovar/rejeitar/revogar)"
```

---

## Task 10: Wiki, deploy e fechamento da fase

**Files:**
- Create: `docs/wiki/concepts/device-locking.md`
- Modify: `docs/wiki/index.md`, `docs/wiki/log.md`

- [ ] **Step 1: Criar a página de wiki**

```markdown
---
title: Travamento por Aparelho
type: concept
updated: 2026-07-22
sources:
  - ../../superpowers/specs/2026-07-22-device-locking-servidor-terminais-design.md
related:
  - ./supabase-sync.md
  - ./role-permissions.md
code_refs:
  - src/device-identity.js
  - src/lib/device-policy.js
  - supabase/functions/device-verify/index.ts
  - supabase/functions/master-devices/index.ts
---

# Travamento por Aparelho (Fase 1)

Cada membro fica preso a um aparelho aprovado pelo superadmin (camada Master).
Fase 1 usa prova "soft" (device_uuid). Enforcement é de UX (portão no login);
o bloqueio via RLS entra na Fase 3. Estrito 1:1 (índices únicos parciais).

- Tabelas: `member_devices`, `device_sessions` (migration `20260722000000_device_locking.sql`).
- Edges: `device-enroll`, `device-verify` (membro), `master-devices` (superadmin).
- Fluxo: login → enroll (pendente) → superadmin aprova em MasterApp → verify libera.
- Fases seguintes: 2 (chave de hardware/WebAuthn), 3 (RLS total), 4 (rename Servidor/Terminais), 5 (offline + endurecimento).
```

- [ ] **Step 2: Atualizar index e log do wiki**

Adicionar em `docs/wiki/index.md` (seção Conceitos):
```markdown
- [Travamento por Aparelho](concepts/device-locking.md) — vínculo membro↔aparelho, aprovação pelo superadmin
```
Append em `docs/wiki/log.md`:
```markdown
## [2026-07-22] feature | Travamento por aparelho — Fase 1
- spec: docs/superpowers/specs/2026-07-22-device-locking-servidor-terminais-design.md
- plan: docs/superpowers/plans/2026-07-22-device-locking-fase-1.md
- new: member_devices, device_sessions, edges device-enroll/verify/master-devices, painel Aparelhos
```

- [ ] **Step 3: Rodar toda a suíte + build (verificação final)**

Run: `npm run test && npm run build`
Expected: todos os testes passam; build OK.

- [ ] **Step 4: Commit + push (deploy contínuo — Regra 1)**

```bash
git add docs/wiki/
git commit -m "docs(wiki): ingerir travamento por aparelho Fase 1"
# Se ainda não houver remoto configurado:
git remote add origin https://github.com/gabbiiii-gif/Frostapp.git 2>/dev/null || true
git push -u origin HEAD
```
Expected: push OK → Vercel builda e publica automaticamente (se o projeto estiver conectado ao repo).

- [ ] **Step 5: Deploy das edges (se ainda não deployadas nas Tasks 4-6)**

Run:
```bash
supabase functions deploy device-enroll
supabase functions deploy device-verify
supabase functions deploy master-devices --no-verify-jwt
```
Expected: 3 deploys OK.

---

## Self-Review (feito pelo autor do plano)

**1. Cobertura do spec (Fase 1):** tabelas ✔ (Task 1), identidade do aparelho ✔ (Task 2), decisão de status ✔ (Task 3), edges enroll/verify/master ✔ (Tasks 4-6), helpers ✔ (Task 7), portão no login ✔ (Task 8), painel superadmin ✔ (Task 9), migração "do zero" ✔ (sem grandfather — todos caem pendentes ao subir), wiki+deploy ✔ (Task 10). Fora da Fase 1 por decisão de faseamento: chave de hardware/WebAuthn (Fase 2), RLS total (Fase 3), rename Servidor/Terminais na UI ampla (Fase 4 — nesta fase só o rótulo "(Servidor)" no painel), offline/endurecimento (Fase 5). `device_challenges` entra na Fase 2 (assinaturas).

**2. Placeholders:** nenhum "TBD/TODO" de implementação; todo passo tem código ou comando concreto.

**3. Consistência de tipos/nomes:** `decideDeviceStatus(devices, deviceUuid)` idêntico entre Task 3 e a lógica espelhada na edge (Task 5). `masterDevices(master, action, payload)` consistente entre Task 7 e uso nas Tasks 8-9. Status usados em todo o plano: `pending|approved|rejected|revoked` (DB) e `approved|pending|denied|needs_enroll` (decisão). `buildDevicePayload` retorna `{ device_uuid, platform, fingerprint }` consumido igual nas edges.
