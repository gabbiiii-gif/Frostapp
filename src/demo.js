// src/demo.js
// Modo Demonstração: o prospect experimenta o ERP com dados de exemplo, isolado
// no próprio navegador. NUNCA toca o Supabase real — os guards isDemoMode() em
// supabase.js tornam hydrate/sync/delete/notify no-op enquanto a demo roda.
import { supabaseUrl, supabaseKey } from './supabase.js';

export const DEMO_COMPANY_ID = 'cmp_demo';
// A demo dura enquanto a PÁGINA viver. Não persiste em sessionStorage.
//
// Antes a flag ficava em sessionStorage pra sobreviver à navegação interna do
// app — e ficava presa: quem experimentava a demo e depois abria o app de
// verdade na mesma aba herdava o modo demo, com storage em memória (dados
// somem da tela) e cliente Supabase sem sessão ("Sua sessão expirou").
//
// Tentei limpar a flag no import deste módulo, mas demo.js e supabase.js se
// importam mutuamente: se supabase.js for avaliado primeiro, ele lê a flag
// ANTES da limpeza rodar e decide errado. Guardar em memória tira a ordem de
// avaliação da jogada — não há estado entre carregamentos para dar errado.
//
// Não se perde nada: os dados da demo já vivem num Map em memória, então
// recarregar a página sempre reiniciou a demo de qualquer forma.
let _demoNaSessao = false;

// Detecta demo por querystring (?demo=1) — o app não muda a URL ao navegar,
// então o parâmetro acompanha a demo inteira — ou pela flag em memória, para o
// caso de algum fluxo limpar a querystring no meio do caminho.
export function isDemoMode() {
  if (_demoNaSessao) return true;
  try {
    return new URLSearchParams(window.location.search).get('demo') === '1';
  } catch { return false; }
}

// Fixa a demo para o restante da vida desta página.
export function markDemoStarted() {
  _demoNaSessao = true;
  // Higiene: se alguma aba antiga ainda carrega a flag da versão anterior,
  // remove — senão ela reaparece como modo demo no próximo acesso real.
  try { sessionStorage.removeItem('frost_demo'); } catch { /* ignora */ }
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
  // GUARDA OBRIGATÓRIA. Fora da demo, `window.storage` é o localStorage real do
  // usuário — um clear() aqui apagaria os dados da empresa. Nunca remover.
  if (!isDemoMode()) return;
  try {
    // Em modo demo o `window.storage` é um Map em memória exclusivo da
    // demonstração (ver App.jsx), então limpar tudo é seguro e completo.
    //
    // A versão anterior varria as chaves procurando o prefixo `cmp_cmp_demo:`,
    // formato que o DB.set NUNCA produz: só os singletons são reescritos com o
    // id da empresa (`erp:config:<id>`); um `erp:client:<id>` é gravado literal,
    // e o escopo por empresa vem do campo `companyId` do registro, filtrado no
    // DB.list. Ou seja: o reset não apagava nada — mas apagava a flag
    // `erp:seeded`, liberando o seedDatabase() para rodar de novo e empilhar um
    // segundo lote de clientes e funcionários. Daí os registros duplicados.
    window.storage.clear();
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
