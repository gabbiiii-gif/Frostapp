// Detecta runtime Capacitor (Android/iOS) vs web puro.
// Usar pra escolher API nativa (Camera, Filesystem, Share) vs fallback web.

import { Capacitor } from '@capacitor/core';

export const isNative = () => Capacitor.isNativePlatform();
export const isAndroid = () => Capacitor.getPlatform() === 'android';
export const isIOS = () => Capacitor.getPlatform() === 'ios';
export const isWeb = () => Capacitor.getPlatform() === 'web';
export const platform = () => Capacitor.getPlatform();

// Storage nativo (Preferences) com fallback localStorage no web.
// API alinhada com window.storage atual: get/set/remove sync-like via wrapper async.
export async function nativeStorageGet(key) {
  if (!isNative()) return localStorage.getItem(key);
  const { Preferences } = await import('@capacitor/preferences');
  const { value } = await Preferences.get({ key });
  return value;
}

export async function nativeStorageSet(key, value) {
  if (!isNative()) return localStorage.setItem(key, value);
  const { Preferences } = await import('@capacitor/preferences');
  await Preferences.set({ key, value });
}

export async function nativeStorageRemove(key) {
  if (!isNative()) return localStorage.removeItem(key);
  const { Preferences } = await import('@capacitor/preferences');
  await Preferences.remove({ key });
}

// Camera nativa pra fotos OS técnico. Retorna dataURL pra preview + upload.
export async function takePhoto({ quality = 80, allowEditing = false } = {}) {
  if (!isNative()) {
    throw new Error('takePhoto: não suportado no web. Use input file.');
  }
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const photo = await Camera.getPhoto({
    quality,
    allowEditing,
    resultType: CameraResultType.DataUrl,
    source: CameraSource.Camera,
  });
  return photo.dataUrl;
}

// Compartilhar OS/orçamento via WhatsApp/email nativo.
export async function shareNative({ title, text, url, dialogTitle = 'Compartilhar' }) {
  if (!isNative()) {
    if (navigator.share) return navigator.share({ title, text, url });
    throw new Error('shareNative: não suportado neste navegador.');
  }
  const { Share } = await import('@capacitor/share');
  return Share.share({ title, text, url, dialogTitle });
}

// Feedback tátil em ações importantes (finalizar OS, salvar, erro).
export async function haptic(style = 'medium') {
  if (!isNative()) return;
  const { Haptics, ImpactStyle } = await import('@capacitor/haptics');
  const map = { light: ImpactStyle.Light, medium: ImpactStyle.Medium, heavy: ImpactStyle.Heavy };
  await Haptics.impact({ style: map[style] || ImpactStyle.Medium });
}

// Listener network status pra mostrar badge offline.
export async function watchNetwork(callback) {
  if (!isNative()) {
    const handler = () => callback({ connected: navigator.onLine });
    window.addEventListener('online', handler);
    window.addEventListener('offline', handler);
    callback({ connected: navigator.onLine });
    return () => {
      window.removeEventListener('online', handler);
      window.removeEventListener('offline', handler);
    };
  }
  const { Network } = await import('@capacitor/network');
  const status = await Network.getStatus();
  callback(status);
  const sub = await Network.addListener('networkStatusChange', callback);
  return () => sub.remove();
}

// Hardware back button Android: intercepta pra fechar modais ou voltar módulo.
export async function onBackButton(handler) {
  if (!isAndroid()) return () => {};
  const { App } = await import('@capacitor/app');
  const sub = await App.addListener('backButton', handler);
  return () => sub.remove();
}

// ─── BOOT NATIVO ─────────────────────────────────────────────────────────────
// Configura StatusBar (cor + estilo) e esconde splash quando app pronto.
// Chamado uma vez em main.jsx antes de renderizar React.
export async function initNative() {
  if (!isNative()) return;
  try {
    const { StatusBar, Style } = await import('@capacitor/status-bar');
    await StatusBar.setStyle({ style: Style.Dark });
    if (isAndroid()) {
      await StatusBar.setBackgroundColor({ color: '#0f172a' });
      await StatusBar.setOverlaysWebView({ overlay: false });
    }
  } catch (e) {
    console.warn('[platform] StatusBar setup falhou:', e);
  }
}

// Esconde splash apos React montar — garantia de transicao suave.
export async function hideSplash() {
  if (!isNative()) return;
  try {
    const { SplashScreen } = await import('@capacitor/splash-screen');
    await SplashScreen.hide({ fadeOutDuration: 300 });
  } catch { /* splash ja escondida */ }
}

// ─── BIOMETRIA (Touch ID / Face ID / Fingerprint) ────────────────────────────
// Fluxo:
//  1. Primeiro login com senha → app pergunta "Habilitar biometria?"
//  2. Se sim, salva email+senha cifrados em Preferences (chave biometric_creds)
//     e flag biometric_enabled=true.
//  3. Proximo boot do APK: se biometric_enabled, mostra prompt biometrico antes
//     da LoginScreen. Sucesso → autoLogin com creds salvas.
//
// SEGURANCA: Capacitor Preferences nao cifra por padrao. Pra MVP, aceitavel.
// TODO: migrar pra @capacitor-community/secure-storage-plugin (Keystore Android,
// Keychain iOS) quando tiver tempo.
const BIOMETRIC_FLAG = 'frost_biometric_enabled';
const BIOMETRIC_CREDS = 'frost_biometric_creds';

export async function isBiometricAvailable() {
  if (!isNative()) return { available: false, reason: 'web' };
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const info = await BiometricAuth.checkBiometry();
    return {
      available: info.isAvailable,
      type: info.biometryType,
      reason: info.reason,
    };
  } catch (e) {
    return { available: false, reason: String(e) };
  }
}

export async function isBiometricEnabled() {
  if (!isNative()) return false;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: BIOMETRIC_FLAG });
    return value === '1';
  } catch { return false; }
}

export async function authenticateBiometric(reason = 'Desbloquear FrostERP') {
  if (!isNative()) return false;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason,
      cancelTitle: 'Cancelar',
      allowDeviceCredential: true,
      iosFallbackTitle: 'Usar senha',
      androidTitle: 'FrostERP',
      androidSubtitle: reason,
      androidConfirmationRequired: false,
    });
    return true;
  } catch (e) {
    console.warn('[platform] Biometric falhou:', e?.message || e);
    return false;
  }
}

export async function enableBiometricLogin(email, password) {
  if (!isNative()) return false;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.set({ key: BIOMETRIC_CREDS, value: JSON.stringify({ email, password }) });
    await Preferences.set({ key: BIOMETRIC_FLAG, value: '1' });
    return true;
  } catch (e) {
    console.warn('[platform] enableBiometric falhou:', e);
    return false;
  }
}

export async function getBiometricCreds() {
  if (!isNative()) return null;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    const { value } = await Preferences.get({ key: BIOMETRIC_CREDS });
    if (!value) return null;
    return JSON.parse(value);
  } catch { return null; }
}

export async function disableBiometricLogin() {
  if (!isNative()) return;
  try {
    const { Preferences } = await import('@capacitor/preferences');
    await Preferences.remove({ key: BIOMETRIC_FLAG });
    await Preferences.remove({ key: BIOMETRIC_CREDS });
  } catch { /* ignora */ }
}
