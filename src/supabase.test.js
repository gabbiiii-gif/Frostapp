import { describe, it, expect, beforeEach } from 'vitest';
import { isInviteUrl, isRecoveryUrl } from './supabase.js';

// Helpers de detecção de URL especiais do Supabase Auth (recovery e invite).
// Usados pelo top-level do App pra escolher entre LoginScreen e tela de senha.
describe('isInviteUrl', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('retorna false quando URL não tem marcador de invite', () => {
    window.history.replaceState({}, '', '/');
    expect(isInviteUrl()).toBe(false);
  });

  it('detecta type=invite na query string', () => {
    window.history.replaceState({}, '', '/?type=invite');
    expect(isInviteUrl()).toBe(true);
  });

  it('detecta type=invite no hash', () => {
    window.history.replaceState({}, '', '/#type=invite&access_token=xyz');
    expect(isInviteUrl()).toBe(true);
  });

  it('não confunde invite com recovery', () => {
    window.history.replaceState({}, '', '/?type=recovery');
    expect(isInviteUrl()).toBe(false);
  });
});

describe('isRecoveryUrl', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/');
  });

  it('não confunde recovery com invite', () => {
    window.history.replaceState({}, '', '/?type=invite');
    expect(isRecoveryUrl()).toBe(false);
  });
});
