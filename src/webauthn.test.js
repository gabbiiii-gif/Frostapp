import { describe, it, expect, vi } from 'vitest';
vi.mock('./platform.js', () => ({ isNative: () => false }));
import { bufToB64url, b64urlToBuf, isWebAuthnSupported } from './webauthn.js';

describe('webauthn helpers', () => {
  it('base64url ida-e-volta preserva os bytes', () => {
    const original = new Uint8Array([0, 1, 2, 250, 251, 255, 65, 66]);
    const s = bufToB64url(original.buffer);
    expect(s).not.toMatch(/[+/=]/); // base64url não tem +, /, =
    const back = new Uint8Array(b64urlToBuf(s));
    expect([...back]).toEqual([...original]);
  });

  it('base64url roundtrip de vários tamanhos (padding)', () => {
    for (const n of [1, 2, 3, 4, 5, 31, 32, 65]) {
      const arr = new Uint8Array(n).map((_, i) => (i * 37) % 256);
      const back = new Uint8Array(b64urlToBuf(bufToB64url(arr.buffer)));
      expect([...back]).toEqual([...arr]);
    }
  });

  it('isWebAuthnSupported é false sem window.PublicKeyCredential', () => {
    // happy-dom não expõe PublicKeyCredential → não suportado.
    expect(isWebAuthnSupported()).toBe(false);
  });
});
