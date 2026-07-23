import { describe, it, expect, beforeEach, vi } from 'vitest';
vi.mock('./supabase.js', () => ({ supabase: null, supabaseUrl: '', supabaseKey: '' }));
import { isDemoMode, DEMO_COMPANY_ID, markDemoStarted, buildDemoUser } from './demo.js';

describe('demo mode', () => {
  beforeEach(() => { sessionStorage.clear(); window.history.replaceState({}, '', '/'); });

  it('isDemoMode false sem flag', () => {
    expect(isDemoMode()).toBe(false);
  });
  it('isDemoMode true com ?demo=1', () => {
    window.history.replaceState({}, '', '/?demo=1');
    expect(isDemoMode()).toBe(true);
  });
  it('markDemoStarted persiste na sessão (mantém demo ao navegar)', () => {
    markDemoStarted();
    window.history.replaceState({}, '', '/'); // sem querystring
    expect(isDemoMode()).toBe(true);
  });
  it('buildDemoUser é admin no escopo demo', () => {
    const u = buildDemoUser();
    expect(u.role).toBe('admin');
    expect(u.companyId).toBe(DEMO_COMPANY_ID);
    expect(u.isSuperAdmin).toBe(true);
  });
});
