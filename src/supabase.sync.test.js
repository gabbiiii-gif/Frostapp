import { describe, it, expect, beforeEach, vi } from 'vitest';

// Gravação no kv_store por (empresa, chave) — decisão 012. Cliente Supabase
// falso que só registra o `onConflict` de cada upsert e devolve a resposta da
// fila `respostas` (sucesso quando vazia).

const estado = vi.hoisted(() => ({ conflitos: [], respostas: [] }));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getSession: async () => ({ data: { session: { user: { id: 'u1' } } } }) },
    from: () => ({
      upsert: (_rows, opts) => {
        estado.conflitos.push(opts.onConflict);
        return Promise.resolve(estado.respostas.shift() || { error: null });
      },
    }),
  }),
}));

async function carregar() {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://teste.supabase.co');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', 'anon');
  const mod = await import('./supabase.js');
  mod.setCurrentMember({ user_id: 'u1', company_id: 'cmp_2', role: 'admin', status: 'ativo' });
  return mod;
}

beforeEach(() => {
  localStorage.clear();
  window.storage = localStorage;
  estado.conflitos = [];
  estado.respostas = [];
});

describe('upsertKv', () => {
  it('grava com conflito por (empresa, chave)', async () => {
    const sb = await carregar();
    const r = await sb.upsertKv({ key: 'erp:seeded', value: true, company_id: 'cmp_2' });
    expect(r.error).toBeNull();
    expect(estado.conflitos).toEqual(['company_id,key']);
  });

  it('banco sem o índice (42P10): volta para o conflito por key e mantém até recarregar', async () => {
    const sb = await carregar();
    estado.respostas = [{ error: { code: '42P10', message: 'there is no unique or exclusion constraint matching the ON CONFLICT specification' } }];
    const r = await sb.upsertKv({ key: 'erp:client:1', value: {}, company_id: 'cmp_2' });
    expect(r.error).toBeNull(); // a gravação acontece na 2ª tentativa
    await sb.upsertKv({ key: 'erp:client:2', value: {}, company_id: 'cmp_2' });
    expect(estado.conflitos).toEqual(['company_id,key', 'key', 'key']);
  });

  it('outro erro (ex.: RLS) volta para quem chamou e não muda o conflito', async () => {
    const sb = await carregar();
    estado.respostas = [{ error: { code: '42501', message: 'new row violates row-level security policy' } }];
    const r = await sb.upsertKv({ key: 'erp:finance:1', value: {}, company_id: 'cmp_2' });
    expect(r.error.code).toBe('42501');
    await sb.upsertKv({ key: 'erp:finance:2', value: {}, company_id: 'cmp_2' });
    expect(estado.conflitos).toEqual(['company_id,key', 'company_id,key']);
  });
});

describe('syncToSupabase', () => {
  it('o DB.set comum grava por (empresa, chave)', async () => {
    const sb = await carregar();
    sb.syncToSupabase('erp:fechamento:2026-09', { mes: '2026-09' });
    await new Promise((r) => setTimeout(r, 0));
    expect(estado.conflitos).toEqual(['company_id,key']);
  });
});
