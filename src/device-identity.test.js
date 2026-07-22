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
