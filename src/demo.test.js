import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('./supabase.js', () => ({ supabase: null, supabaseUrl: '', supabaseKey: '' }));

// `markDemoStarted` fixa a demo para o resto da vida do MÓDULO (é o contrato:
// uma página é demo ou não é, e não volta atrás). Por isso cada teste importa
// demo.js do zero — senão o teste que liga a demo contamina todos os seguintes.
async function carregarDemo() {
  vi.resetModules();
  return import('./demo.js');
}

describe('demo mode', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

  it('isDemoMode false sem flag', async () => {
    const { isDemoMode } = await carregarDemo();
    expect(isDemoMode()).toBe(false);
  });

  it('isDemoMode true com ?demo=1', async () => {
    window.history.replaceState({}, '', '/?demo=1');
    const { isDemoMode } = await carregarDemo();
    expect(isDemoMode()).toBe(true);
  });

  it('markDemoStarted mantém a demo ao navegar dentro da página', async () => {
    const { isDemoMode, markDemoStarted } = await carregarDemo();
    markDemoStarted();
    window.history.replaceState({}, '', '/'); // sem querystring
    expect(isDemoMode()).toBe(true);
  });

  it('flag antiga em sessionStorage NÃO liga o modo demo', async () => {
    // A aba ficava presa em demo: storage vazio e cliente Supabase sem sessão
    // no app real. A flag agora é de página, não de sessão.
    sessionStorage.setItem('frost_demo', '1');
    const { isDemoMode } = await carregarDemo();
    expect(isDemoMode()).toBe(false);
  });

  it('buildDemoUser é admin no escopo demo', async () => {
    const { buildDemoUser, DEMO_COMPANY_ID } = await carregarDemo();
    const u = buildDemoUser();
    expect(u.role).toBe('admin');
    expect(u.companyId).toBe(DEMO_COMPANY_ID);
    expect(u.isSuperAdmin).toBe(true);
  });
});

describe('resetDemoData', () => {
  const criarStore = () => {
    const m = new Map();
    return {
      getItem: (k) => (m.has(k) ? m.get(k) : null),
      setItem: (k, v) => m.set(k, v),
      removeItem: (k) => m.delete(k),
      get length() { return m.size; },
      key: (i) => Array.from(m.keys())[i] ?? null,
      clear: () => m.clear(),
    };
  };

  beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

  it('na demo limpa tudo, inclusive os registros semeados', async () => {
    window.history.replaceState({}, '', '/?demo=1');
    const { resetDemoData } = await carregarDemo();
    const store = criarStore();
    store.setItem('erp:client:1', '{}');
    store.setItem('erp:employee:1', '{}');
    store.setItem('erp:seeded', 'true');
    window.storage = store;
    resetDemoData();
    // O bug: só `erp:seeded` era removido — o varredor procurava o prefixo
    // `cmp_cmp_demo:`, formato que o DB.set nunca gera. Os registros ficavam e
    // o seedDatabase rodava por cima, duplicando clientes e funcionários.
    expect(store.length).toBe(0);
  });

  it('fora da demo NÃO toca no storage — apagaria os dados reais da empresa', async () => {
    const { resetDemoData } = await carregarDemo();
    const store = criarStore();
    store.setItem('erp:client:1', '{}');
    store.setItem('erp:seeded', 'true');
    window.storage = store;
    resetDemoData();
    expect(store.length).toBe(2);
  });
});
