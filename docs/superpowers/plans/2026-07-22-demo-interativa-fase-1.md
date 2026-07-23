# Demo Interativa — Fase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans / subagent-driven-development. Steps use `- [ ]`.

**Goal:** O botão da landing leva o prospect a uma demo interativa: formulário curto (lead) → app semeado com dados de exemplo, isolado no navegador do prospect, sem tocar Supabase real nem disparar integrações.

**Architecture:** Modo demo detectado por `?demo=1` (guarda `isDemoMode()`). Em demo, o boot pula todo o fluxo Supabase; após o formulário de lead, o app semeia `cmp_demo` (reusando `seedDatabase()`), injeta um usuário demo (role admin/Servidor) e renderiza o ERP com banner "Modo Demonstração". Guards em `supabase.js` tornam sync/hydrate/notify no-op no demo. O lead vai para uma tabela via edge `demo-lead` (isolado dos dados locais).

**Tech Stack:** React 19 + Vite (JS), Supabase (edge Deno/TS + Postgres), Vitest.

## Global Constraints

- Front JS puro; edges Deno/TS. UI/comentários em **pt-BR**.
- **Não pode tocar o Supabase real** com dados da demo: `isDemoMode()` curto-circuita `hydrateFromSupabase`/`syncToSupabase`/`deleteFromSupabase` e as notificações.
- Usuário normal (`?demo=1` ausente) **100% inalterado** — todo código demo é gated por `isDemoMode()`.
- `erp:seeded` é **global**; dados (`erp:client:` etc.) são **company-scoped** (`SCOPED_PREFIXES`). Reset limpa o escopo `cmp_demo` + a flag.
- Escopo desta fase: **só o ERP admin**. Visão do técnico fica para depois.

## File Structure

- Create: `src/demo.js` (+ `src/demo.test.js`) — `isDemoMode`, `DEMO_COMPANY_ID`, `markDemoStarted`, `resetDemoData`, `buildDemoUser`, `recordDemoLead`.
- Modify: `src/supabase.js` — guards `isDemoMode()` em hydrate/sync/delete/notify.
- Modify: `src/App.jsx` — boot demo, `DemoLeadForm`, `DemoBanner`, `handleDemoStart`.
- Create: `supabase/functions/demo-lead/index.ts` + `supabase/migrations/20260722010000_demo_leads.sql`.
- Modify: `landing/index.html` — botões de demo → `?demo=1`.

---

## Task 1: `src/demo.js` — guarda e utilitários

**Files:** Create `src/demo.js`, `src/demo.test.js`.

**Interfaces:**
- `isDemoMode(): boolean` — true se `?demo=1` na URL OU `sessionStorage.frost_demo === '1'`.
- `DEMO_COMPANY_ID = 'cmp_demo'`.
- `markDemoStarted(): void` — grava sessionStorage flag (mantém demo ao navegar).
- `buildDemoUser(): object` — usuário sintético role `admin`, `isSuperAdmin`, `companyId=cmp_demo`.
- `resetDemoData(dbApi): void` — limpa chaves do escopo `cmp_demo` + `erp:seeded` via `window.storage`.
- `recordDemoLead(lead): Promise<{ok}>` — POST à edge `demo-lead` (best-effort).

- [ ] **Step 1: Teste que falha** (`src/demo.test.js`)

```javascript
import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('./supabase.js', () => ({ supabase: null, supabaseUrl: '', supabaseKey: '' }));
import { isDemoMode, DEMO_COMPANY_ID, markDemoStarted, buildDemoUser } from './demo.js';

describe('demo mode', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

  it('isDemoMode false sem flag', () => { expect(isDemoMode()).toBe(false); });
  it('isDemoMode true com ?demo=1', () => {
    window.history.replaceState({}, '', '/?demo=1');
    expect(isDemoMode()).toBe(true);
  });
  it('markDemoStarted persiste na sessão', () => {
    markDemoStarted();
    expect(isDemoMode()).toBe(true);
  });
  it('buildDemoUser é admin no escopo demo', () => {
    const u = buildDemoUser();
    expect(u.role).toBe('admin');
    expect(u.companyId).toBe(DEMO_COMPANY_ID);
  });
});
```

- [ ] **Step 2: Rodar → FAIL** (`npm run test -- demo`)

- [ ] **Step 3: Implementar `src/demo.js`**

```javascript
// src/demo.js
// Modo Demonstração: o prospect experimenta o ERP com dados de exemplo, isolado
// no próprio navegador. NUNCA toca o Supabase real (guards em supabase.js).
import { supabaseUrl, supabaseKey } from './supabase.js';

export const DEMO_COMPANY_ID = 'cmp_demo';
const DEMO_FLAG = 'frost_demo';

// Detecta demo por querystring (?demo=1) ou flag de sessão (persiste ao navegar).
export function isDemoMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') return true;
    return sessionStorage.getItem(DEMO_FLAG) === '1';
  } catch { return false; }
}

export function markDemoStarted() {
  try { sessionStorage.setItem(DEMO_FLAG, '1'); } catch { /* ignora */ }
}

// Usuário sintético (Servidor/admin) só em memória/local — não passa por Supabase Auth.
export function buildDemoUser() {
  return {
    id: 'demo-user', nome: 'Demonstração', email: 'demo@frosterp.com.br',
    role: 'admin', isSuperAdmin: true, status: 'ativo', companyId: DEMO_COMPANY_ID,
    avatar: 'DE', createdAt: new Date().toISOString(),
  };
}

// Limpa os dados do escopo demo (cmp_demo:*) e a flag global de seed, para re-semear limpo.
export function resetDemoData() {
  try {
    const toRemove = [];
    for (let i = 0; i < window.storage.length; i++) {
      const k = window.storage.key(i);
      if (k && (k.startsWith(`cmp_${DEMO_COMPANY_ID}:`) || k.startsWith(`${DEMO_COMPANY_ID}:`) || k.includes(`:${DEMO_COMPANY_ID}:`))) toRemove.push(k);
    }
    toRemove.forEach((k) => window.storage.removeItem(k));
    window.storage.removeItem('erp:seeded');
  } catch { /* ignora */ }
}

// Registra o lead na edge demo-lead (best-effort — falha não bloqueia a demo).
export async function recordDemoLead(lead) {
  if (!supabaseUrl || !supabaseKey) return { ok: false, error: 'no_supabase' };
  try {
    const resp = await fetch(`${supabaseUrl}/functions/v1/demo-lead`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: supabaseKey },
      body: JSON.stringify({ ...lead, user_agent: navigator.userAgent }),
    });
    const body = await resp.json().catch(() => ({}));
    return resp.ok && body.ok ? { ok: true } : { ok: false, error: body.error || `HTTP ${resp.status}` };
  } catch (e) { return { ok: false, error: e.message }; }
}
```

> Nota: `supabaseUrl`/`supabaseKey` precisam ser exportados de `supabase.js` (hoje são const de módulo). Adicionar `export` a eles na Task 3.

- [ ] **Step 4: Rodar → PASS**. **Step 5: Commit.**

---

## Task 2: Migração `demo_leads` + edge `demo-lead`

**Files:** Create migration + `supabase/functions/demo-lead/index.ts`.

- [ ] **Step 1: Migration** (`supabase/migrations/20260722010000_demo_leads.sql`)

```sql
-- Leads capturados na demo interativa da landing. RLS trancada (acesso só via edge).
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
```

- [ ] **Step 2: Edge** (`supabase/functions/demo-lead/index.ts`, verify_jwt=false)

```typescript
// Edge Function: demo-lead (verify_jwt = false — chamada pública da landing)
// Registra o lead da demo e (best-effort) notifica a equipe por email via send-email.
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
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const nome = String(body.nome || "").trim().slice(0, 120);
  const whatsapp = String(body.whatsapp || "").trim().slice(0, 40);
  const email = String(body.email || "").trim().slice(0, 160);
  const userAgent = String(body.user_agent || "").slice(0, 300);
  if (!nome || (!whatsapp && !email)) return json({ ok: false, error: "missing_fields" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from("demo_leads").insert({ nome, whatsapp, email, user_agent: userAgent });
  if (error) { console.error("demo-lead insert:", error.message); return json({ ok: false, error: "internal" }, 500); }

  // Notifica a equipe (best-effort). Reusa a edge send-email (Resend) já existente.
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: "suportefrosterp@gmail.com",
        subject: `Novo lead da demo: ${nome}`,
        html: `<h2>Novo lead na demo</h2><p><b>Nome:</b> ${nome}</p><p><b>WhatsApp:</b> ${whatsapp || "-"}</p><p><b>Email:</b> ${email || "-"}</p>`,
      }),
    });
  } catch (_) { /* best-effort */ }

  return json({ ok: true });
});
```

- [ ] **Step 3: Commit** (deploy fica para o fim, junto do resto).

---

## Task 3: Guards de demo em `src/supabase.js`

**Files:** Modify `src/supabase.js`.

- [ ] **Step 1:** Exportar `supabaseUrl`/`supabaseKey` (add `export` às const das linhas 9-10).
- [ ] **Step 2:** Import no topo: `import { isDemoMode } from './demo.js';` (⚠️ evitar ciclo: `demo.js` importa só `supabaseUrl/supabaseKey`, que são const avaliadas no load — ok; mas para segurança, em `demo.js` importar de `supabase.js` é aceitável pois não chama `isDemoMode` no top-level de `supabase.js`).
- [ ] **Step 3:** No início de `hydrateFromSupabase`, `syncToSupabase`, `deleteFromSupabase`, `notifyOsCreated` (e helper `_evoFetch`/notify de OS status se aplicável): `if (isDemoMode()) return <no-op apropriado>;`.

```javascript
// Exemplo em hydrateFromSupabase (retornar false = "não hidratou"):
export async function hydrateFromSupabase() {
  if (isDemoMode()) return false; // demo: nunca lê do Supabase real
  ...
}
// Em syncToSupabase / deleteFromSupabase: return; no topo.
```

- [ ] **Step 4:** Build (`npm run build`). **Step 5: Commit.**

---

## Task 4: Boot demo + UI em `src/App.jsx`

**Files:** Modify `src/App.jsx`.

- [ ] **Step 1:** Imports: `import { isDemoMode, DEMO_COMPANY_ID, markDemoStarted, resetDemoData, buildDemoUser, recordDemoLead } from './demo.js';`
- [ ] **Step 2:** No boot `useEffect` (grep `ensureMemberLoaded().then`), no topo do corpo, antes de tudo:

```javascript
    // Modo Demonstração: boot isolado — nada de Supabase real. O seed + injeção do
    // usuário demo acontecem após o formulário de lead (handleDemoStart).
    if (isDemoMode()) {
      setLoading(false);
      return () => clearTimeout(t1);
    }
```

- [ ] **Step 3:** Handler `handleDemoStart` (perto de `handleLogin`):

```javascript
  // Inicia a demo: registra lead (best-effort), semeia cmp_demo, injeta usuário demo.
  const handleDemoStart = useCallback(async (lead) => {
    markDemoStarted();
    try { await recordDemoLead(lead); } catch { /* best-effort */ }
    setActiveCompanyId(DEMO_COMPANY_ID);
    resetDemoData();
    await seedDatabase();
    const demoUser = buildDemoUser();
    setActiveUser(demoUser);
    setUser(demoUser);
    setActiveModule("dashboard");
    lastActivityRef.current = Date.now();
    loadAllData();
  }, [loadAllData]);
```

- [ ] **Step 4:** Componentes `DemoLeadForm` (nome+whatsapp+email → onStart) e `DemoBanner` (fixo, "Modo Demonstração" + "Resetar" + "Falar com a equipe") — adicionar antes de `function LoginScreen` (código completo no passo).
- [ ] **Step 5:** Render: antes de `if (!user)`, adicionar:

```javascript
  // Demo: sem usuário injetado ainda → formulário de lead.
  if (isDemoMode() && !user) {
    return (<><StyleSheet /><DemoLeadForm onStart={handleDemoStart} /></>);
  }
```
E dentro do shell logado (ERP), renderizar `{isDemoMode() && <DemoBanner onReset={handleDemoReset} />}`.

- [ ] **Step 6:** Build + test. **Step 7: Commit.**

---

## Task 5: Landing → `?demo=1`

**Files:** Modify `landing/index.html` (2 botões de demo, linhas ~474 e ~569).

- [ ] **Step 1:** Trocar o `href` do `wa.me/...demonstração...` por `/?demo=1` (mantendo o texto "Ver uma demonstração (15 min)"). Manter o botão "Falar no WhatsApp".
- [ ] **Step 2:** Commit.

---

## Task 6: Verificação + deploy

- [ ] Test + build completos.
- [ ] Deploy: migration `demo_leads` + edge `demo-lead` (Supabase); merge/push (após revisão do usuário, pois toca boot).
- [ ] Wiki: página `concepts/demo-mode.md` + index/log.

## Self-Review

- Cobertura do spec: guarda+seed+shell (T1/T4), lead capture (T1/T2), landing (T5), isolamento (T3). Notificação = email (default do spec). Visão técnico e WhatsApp de lead = fora de escopo (fase 2).
- Sem placeholders. Nomes consistentes: `isDemoMode`, `DEMO_COMPANY_ID`, `handleDemoStart`, `recordDemoLead`.
