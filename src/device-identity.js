// src/device-identity.js
// Identidade "soft" do aparelho para a Fase 1 do travamento por aparelho.
// Um UUID estável por instalação identifica o device. Na Fase 2 este UUID é
// complementado por uma chave de hardware (Android Keystore / WebAuthn).
import { Preferences } from '@capacitor/preferences';
import { Device } from '@capacitor/device';
import { isNative } from './platform.js';

const UUID_KEY = 'frost_device_uuid';

// UUID v4 sem depender de libs (crypto.randomUUID quando disponível).
function genUuid() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Lê o UUID persistido; cria e persiste se ainda não existir.
// Persiste em Preferences (nativo) e sempre espelha em localStorage (web/fallback).
export async function getOrCreateDeviceUuid() {
  let existing = null;
  try {
    const res = await Preferences.get({ key: UUID_KEY });
    existing = res?.value || null;
  } catch { /* Preferences indisponível → cai no localStorage */ }
  if (!existing) existing = localStorage.getItem(UUID_KEY);
  if (existing) return existing;

  const fresh = genUuid();
  try { await Preferences.set({ key: UUID_KEY, value: fresh }); } catch { /* ignora */ }
  try { localStorage.setItem(UUID_KEY, fresh); } catch { /* ignora */ }
  return fresh;
}

// Plataforma normalizada para a coluna member_devices.platform.
export function getPlatform() {
  const p = (globalThis.Capacitor?.getPlatform?.() || 'web');
  return p === 'ios' ? 'ios' : p === 'android' ? 'android' : 'web';
}

// Dados de exibição/auditoria (modelo, versão do SO). Nunca são base de segurança.
export async function getDeviceFingerprint() {
  try {
    const info = await Device.getInfo();
    return {
      platform: info.platform || getPlatform(),
      model: info.model || (isNative() ? 'desconhecido' : (navigator.userAgent || 'navegador')),
      osVersion: info.osVersion || '',
      manufacturer: info.manufacturer || '',
    };
  } catch {
    return { platform: getPlatform(), model: navigator.userAgent || 'navegador', osVersion: '', manufacturer: '' };
  }
}

// Payload pronto para as edges device-enroll / device-verify.
export async function buildDevicePayload() {
  const [device_uuid, fingerprint] = await Promise.all([getOrCreateDeviceUuid(), getDeviceFingerprint()]);
  return { device_uuid, platform: getPlatform(), fingerprint };
}
