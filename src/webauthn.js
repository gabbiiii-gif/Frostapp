// src/webauthn.js
// Fase 2 do travamento por aparelho (WEB): liga o aparelho a uma chave de
// hardware via WebAuthn (passkey de plataforma — TPM/Secure Enclave). A chave
// privada nunca sai do dispositivo, então copiar storage não permite logar em
// outra máquina. Usado só no navegador; no app nativo (Android WebView) caímos
// no modo soft (Fase 1) até o plugin Keystore (fase futura).
import { isNative } from './platform.js';

// ─── base64url ↔ ArrayBuffer ─────────────────────────────────────────────────
export function bufToB64url(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function b64urlToBuf(b64url) {
  const s = String(b64url).replace(/-/g, '+').replace(/_/g, '/');
  const pad = s.length % 4;
  const b64 = s + (pad ? '='.repeat(4 - pad) : '');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

// WebAuthn suportado neste navegador? (não vale no app nativo)
export function isWebAuthnSupported() {
  return !isNative() && typeof window !== 'undefined' && !!window.PublicKeyCredential && !!navigator.credentials?.create;
}

// Existe autenticador de plataforma (Windows Hello / Touch ID / bloqueio Android)?
export async function hasPlatformAuthenticator() {
  if (!isWebAuthnSupported()) return false;
  try {
    return await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch { return false; }
}

// rpId = host atual (WebAuthn liga a credencial ao domínio).
export function currentRpId() {
  try { return window.location.hostname; } catch { return ''; }
}

// Lê as flags BE (backup eligible) / BS (backup state) do authenticatorData —
// permitem detectar passkey "sincronizada" (roameável entre aparelhos).
function readBackupFlags(authDataBuf) {
  try {
    const flags = new Uint8Array(authDataBuf)[32]; // byte de flags
    return { be: !!(flags & 0x08), bs: !!(flags & 0x10) };
  } catch { return { be: false, bs: false }; }
}

// Cria a credencial de dispositivo (enroll). Retorna a chave pública em SPKI
// (base64url) + credentialId + algoritmo + flags de sincronização.
export async function createDeviceCredential({ challenge, userId, userName }) {
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: b64urlToBuf(challenge),
      rp: { id: currentRpId(), name: 'FrostERP' },
      user: { id: new TextEncoder().encode(String(userId)), name: userName || 'terminal', displayName: userName || 'Terminal' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'preferred', residentKey: 'discouraged' },
      timeout: 60000,
      attestation: 'none',
    },
  });
  if (!cred) throw new Error('credential_creation_failed');
  const resp = cred.response;
  const spki = typeof resp.getPublicKey === 'function' ? resp.getPublicKey() : null;
  if (!spki) throw new Error('no_public_key'); // navegador sem getPublicKey → cai no soft
  const alg = typeof resp.getPublicKeyAlgorithm === 'function' ? resp.getPublicKeyAlgorithm() : -7;
  const authData = typeof resp.getAuthenticatorData === 'function' ? resp.getAuthenticatorData() : new ArrayBuffer(37);
  const { be, bs } = readBackupFlags(authData);
  return {
    credentialId: bufToB64url(cred.rawId),
    publicKey: bufToB64url(spki),
    alg,
    be, bs,
    rpId: currentRpId(),
  };
}

// Prova de posse (verify). Assina o desafio com a chave de hardware.
export async function getDeviceAssertion({ challenge, credentialId }) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: b64urlToBuf(challenge),
      rpId: currentRpId(),
      allowCredentials: [{ type: 'public-key', id: b64urlToBuf(credentialId) }],
      userVerification: 'discouraged',
      timeout: 60000,
    },
  });
  if (!assertion) throw new Error('assertion_failed');
  const resp = assertion.response;
  return {
    credentialId: bufToB64url(assertion.rawId),
    authenticatorData: bufToB64url(resp.authenticatorData),
    clientDataJSON: bufToB64url(resp.clientDataJSON),
    signature: bufToB64url(resp.signature),
    rpId: currentRpId(),
  };
}

// Guarda local do credentialId — evita recriar a passkey a cada login (a criação
// só precisa acontecer uma vez por aparelho; a prova de posse roda a cada login).
const CRED_KEY = 'frost_device_credential';
export function getStoredCredentialId() {
  try { return localStorage.getItem(CRED_KEY) || null; } catch { return null; }
}
export function setStoredCredentialId(id) {
  try { if (id) localStorage.setItem(CRED_KEY, id); } catch { /* ignora */ }
}
