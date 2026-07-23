// src/demo.js
// Modo Demonstração: o prospect experimenta o ERP com dados de exemplo, isolado
// no próprio navegador. NUNCA toca o Supabase real — os guards isDemoMode() em
// supabase.js tornam hydrate/sync/delete/notify no-op enquanto a demo roda.
import { supabaseUrl, supabaseKey } from './supabase.js';

export const DEMO_COMPANY_ID = 'cmp_demo';
const DEMO_FLAG = 'frost_demo';

// Detecta demo por querystring (?demo=1) ou flag de sessão (persiste ao navegar
// dentro do app, já que a navegação é por estado e a URL não muda).
export function isDemoMode() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.get('demo') === '1') return true;
    return sessionStorage.getItem(DEMO_FLAG) === '1';
  } catch { return false; }
}

// Fixa a flag de sessão para a demo continuar mesmo sem a querystring.
export function markDemoStarted() {
  try { sessionStorage.setItem(DEMO_FLAG, '1'); } catch { /* ignora */ }
}

// Usuário sintético (Servidor/admin) só em memória/local — não passa por
// Supabase Auth. Serve apenas para renderizar o shell do ERP na demo.
export function buildDemoUser() {
  return {
    id: 'demo-user',
    nome: 'Demonstração',
    email: 'demo@frosterp.com.br',
    role: 'admin',
    isSuperAdmin: true,
    status: 'ativo',
    companyId: DEMO_COMPANY_ID,
    avatar: 'DE',
    createdAt: new Date().toISOString(),
  };
}

// Limpa os dados do escopo demo (cmp_demo) e a flag global de seed, para
// re-semear um estado limpo a cada início de demo.
export function resetDemoData() {
  try {
    const toRemove = [];
    for (let i = 0; i < window.storage.length; i++) {
      const k = window.storage.key(i);
      if (!k) continue;
      // Chaves escopadas viram `cmp_<companyId>:<key>`; cobrimos as variações.
      if (k.startsWith(`cmp_${DEMO_COMPANY_ID}:`) || k.includes(`${DEMO_COMPANY_ID}:`)) {
        toRemove.push(k);
      }
    }
    toRemove.forEach((k) => window.storage.removeItem(k));
    window.storage.removeItem('erp:seeded'); // flag global de seed → força re-seed
  } catch { /* ignora */ }
}

// Registra o lead na edge demo-lead (best-effort — falha NÃO bloqueia a demo).
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
