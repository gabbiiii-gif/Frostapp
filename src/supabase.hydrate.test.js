import { describe, it, expect, beforeEach, vi } from 'vitest';

// Testes do hydrate (caminho crítico da abertura/login) com um cliente
// Supabase falso. O módulo lê as envs e cria o cliente no import, então cada
// teste reimporta src/supabase.js do zero (estado de módulo limpo).

const estado = vi.hoisted(() => ({ session: null, rows: [], atraso: null }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: estado.session } }) },
    from: () => {
      const q = {
        select: () => q, eq: () => q, not: () => q, order: () => q,
        // A "foto" do servidor é tirada quando a consulta sai, como no Postgres.
        range: (de, ate) => {
          const pagina = { data: estado.rows.slice(de, ate + 1), error: null };
          return estado.atraso ? estado.atraso.then(() => pagina) : Promise.resolve(pagina);
        },
        upsert: () => Promise.resolve({ error: null }),
      };
      return q;
    },
  }),
}));

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://teste.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  const mod = await import('./supabase.js');
  mod.setCurrentMember({ user_id: 'u1', company_id: 'cmp_x', role: 'admin', status: 'ativo' });
  return mod;
}

const ler = (k) => JSON.parse(window.storage.getItem(k));

beforeEach(() => {
  localStorage.clear();
  window.storage = localStorage;
  estado.session = { user: { id: 'u1' } };
  estado.rows = [];
  estado.atraso = null;
});

describe('hydrateFromSupabase', () => {
  it('sem sessão Supabase não hidrata — e não apaga o cache local', async () => {
    const sb = await carregar();
    estado.session = null;
    window.storage.setItem('erp:client:1', JSON.stringify({ nome: 'Ana' }));
    expect(await sb.hydrateFromSupabase()).toBe(false);
    expect(ler('erp:client:1')).toEqual({ nome: 'Ana' });
  });

  it('hydrate completo traz o remoto e remove o que sumiu do servidor', async () => {
    const sb = await carregar();
    window.storage.setItem('erp:client:1', JSON.stringify({ nome: 'Apagado no servidor' }));
    estado.rows = [{ key: 'erp:client:2', value: { nome: 'Beto' } }];
    expect(await sb.hydrateFromSupabase()).toBe(true);
    expect(window.storage.getItem('erp:client:1')).toBeNull();
    expect(ler('erp:client:2')).toEqual({ nome: 'Beto' });
  });

  it('limparLocal:false só traz/atualiza, sem apagar do local', async () => {
    const sb = await carregar();
    window.storage.setItem('erp:client:1', JSON.stringify({ nome: 'Ana' }));
    estado.rows = [{ key: 'erp:client:2', value: { nome: 'Beto' } }];
    expect(await sb.hydrateFromSupabase({ limparLocal: false })).toBe(true);
    expect(ler('erp:client:1')).toEqual({ nome: 'Ana' });
    expect(ler('erp:client:2')).toEqual({ nome: 'Beto' });
  });

  it('chave gravada no aparelho durante o hydrate não é sobrescrita pela foto velha', async () => {
    const sb = await carregar();
    let liberar;
    estado.atraso = new Promise((r) => { liberar = r; });
    estado.rows = [{ key: 'erp:os:1', value: { status: 'agendado' } }];
    const emCurso = sb.hydrateFromSupabase({ limparLocal: false });
    await new Promise((r) => setTimeout(r, 0)); // a consulta já saiu
    // Usuário muda a OS enquanto a resposta não chega (DB.set → syncToSupabase)
    window.storage.setItem('erp:os:1', JSON.stringify({ status: 'em_servico' }));
    sb.syncToSupabase('erp:os:1', { status: 'em_servico' });
    liberar();
    expect(await emCurso).toBe(true);
    expect(ler('erp:os:1')).toEqual({ status: 'em_servico' });
  });

  it('chave criada no aparelho durante o hydrate não é apagada pela limpeza', async () => {
    const sb = await carregar();
    let liberar;
    estado.atraso = new Promise((r) => { liberar = r; });
    estado.rows = [];
    const emCurso = sb.hydrateFromSupabase();
    await new Promise((r) => setTimeout(r, 0));
    window.storage.setItem('erp:client:novo', JSON.stringify({ nome: 'Recém-criado' }));
    sb.syncToSupabase('erp:client:novo', { nome: 'Recém-criado' });
    liberar();
    expect(await emCurso).toBe(true);
    expect(ler('erp:client:novo')).toEqual({ nome: 'Recém-criado' });
  });
});

describe('hydrateRecenteDe (login aproveita o hydrate do boot)', () => {
  it('vale só para o mesmo usuário, empresa e papel', async () => {
    const sb = await carregar();
    expect(sb.hydrateRecenteDe('u1', 'cmp_x', 'admin')).toBe(false); // nenhum hydrate ainda
    await sb.hydrateFromSupabase();
    expect(sb.hydrateRecenteDe('u1', 'cmp_x', 'admin')).toBe(true);
    expect(sb.hydrateRecenteDe('u2', 'cmp_x', 'admin')).toBe(false);
    expect(sb.hydrateRecenteDe('u1', 'cmp_y', 'admin')).toBe(false);
    expect(sb.hydrateRecenteDe('u1', 'cmp_x', 'tecnico')).toBe(false);
    expect(sb.hydrateRecenteDe(undefined, 'cmp_x', 'admin')).toBe(false);
  });

  it('expira (boot velho → login faz o hydrate completo)', async () => {
    const sb = await carregar();
    await sb.hydrateFromSupabase();
    expect(sb.hydrateRecenteDe('u1', 'cmp_x', 'admin', 0)).toBe(false);
  });

  it('hydrate sem sessão não conta como hydrate do boot', async () => {
    const sb = await carregar();
    estado.session = null;
    await sb.hydrateFromSupabase();
    expect(sb.hydrateRecenteDe('u1', 'cmp_x', 'admin')).toBe(false);
  });
});

describe('fatoresMfaDaSessao', () => {
  it('separa os TOTP verificados (mesmo formato de listMfaFactors)', async () => {
    const sb = await carregar();
    const r = sb.fatoresMfaDaSessao({
      user: {
        factors: [
          { id: 'f1', factor_type: 'totp', status: 'verified' },
          { id: 'f2', factor_type: 'totp', status: 'unverified' },
        ],
      },
    });
    expect(r.factors).toHaveLength(2);
    expect(r.totp.map((f) => f.id)).toEqual(['f1']);
  });

  it('sem o campo factors (GoTrue omite quando vazio) → nenhum fator', async () => {
    const sb = await carregar();
    expect(sb.fatoresMfaDaSessao({ user: { id: 'u1' } })).toEqual({ ok: true, factors: [], totp: [] });
  });
});
