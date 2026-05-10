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
