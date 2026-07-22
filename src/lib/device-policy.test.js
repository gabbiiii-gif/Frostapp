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
