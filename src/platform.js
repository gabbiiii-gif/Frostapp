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

// ─── NOTIFICAÇÕES — Web (Notification API) + Capacitor (Local) ────────────────
// Estratégia híbrida:
// - Web (PWA/browser): usa Notification API. Funciona com aba em background.
//   Não funciona com browser fechado — pra isso precisa Push API + service worker
//   + servidor (fase futura).
// - APK nativo: usa @capacitor/local-notifications. Notificação agendada local,
//   dispara no horário mesmo com app fechado. Não precisa de servidor.
//
// Permissão é solicitada na primeira vez que tentamos disparar (lazy).

let _notifPermissionAsked = false;

// Pede permissão pra notificar (web ou nativo). Idempotente.
export async function requestNotifPermission() {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const perm = await LocalNotifications.checkPermissions();
      if (perm.display !== 'granted') {
        const req = await LocalNotifications.requestPermissions();
        return req.display === 'granted';
      }
      return true;
    } catch (e) {
      console.warn('[notif] requestPermission native falhou:', e?.message || e);
      return false;
    }
  }
  // Web
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  if (_notifPermissionAsked) return false;
  _notifPermissionAsked = true;
  try {
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch {
    return false;
  }
}

// Dispara notificação imediata (banner do SO ou tab inativa do browser).
// Web: Notification(); Nativo: LocalNotifications agendada pra "agora".
export async function showNotification({ title, body, tag, icon, url }) {
  if (isNative()) {
    try {
      const { LocalNotifications } = await import('@capacitor/local-notifications');
      const id = Math.abs(hashCode(tag || String(Date.now())));
      await LocalNotifications.schedule({
        notifications: [{
          id,
          title: title || 'FrostERP',
          body: body || '',
          smallIcon: 'ic_stat_icon_config_sample',
          schedule: { at: new Date(Date.now() + 100) },
          extra: { url, tag },
        }],
      });
      return true;
    } catch (e) {
      console.warn('[notif] showNative falhou:', e?.message || e);
      return false;
    }
  }
  // Web
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return false;
  try {
    const n = new Notification(title || 'FrostERP', {
      body: body || '',
      icon: icon || '/icon-192.png',
      badge: '/icon-192.png',
      tag: tag || undefined,
      renotify: false,
    });
    if (url) {
      n.onclick = () => {
        window.focus();
        // tag pode ser usado pra navegar (App escuta evento abaixo)
        try {
          window.dispatchEvent(new CustomEvent('frost-notif-click', { detail: { tag, url } }));
        } catch { /* ignora */ }
        n.close();
      };
    }
    return true;
  } catch (e) {
    console.warn('[notif] showWeb falhou:', e?.message || e);
    return false;
  }
}

// Agenda notificação futura (APK nativo apenas — web não persiste sem service worker).
// `at` é Date. Retorna o id agendado.
export async function scheduleNotification({ title, body, at, tag, url }) {
  if (!isNative()) return null;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const id = Math.abs(hashCode(tag || String(at.getTime())));
    await LocalNotifications.schedule({
      notifications: [{
        id,
        title: title || 'FrostERP',
        body: body || '',
        smallIcon: 'ic_stat_icon_config_sample',
        schedule: { at },
        extra: { url, tag },
      }],
    });
    return id;
  } catch (e) {
    console.warn('[notif] scheduleNotification falhou:', e?.message || e);
    return null;
  }
}

export async function cancelNotification(id) {
  if (!isNative() || !id) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.cancel({ notifications: [{ id }] });
  } catch { /* ignora */ }
}

// Lista notificações agendadas pendentes (debug + dedupe).
export async function getPendingNotifications() {
  if (!isNative()) return [];
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    const { notifications } = await LocalNotifications.getPending();
    return notifications || [];
  } catch { return []; }
}

// Hash determinístico pra ID estável a partir de uma string (tag) → int32.
// Permite re-agendar idempotente: mesmo tag = mesmo id = sobrescreve.
function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h) + str.charCodeAt(i);
    h |= 0;
  }
  return h;
}

// ─── WEB PUSH — subscription + envio via Edge Function ──────────────────────
// Chave VAPID pública (deve casar com a usada pela Edge Function send-push).
// Gerada com crypto.subtle ECDSA P-256, mantida fixa pra não invalidar
// subscriptions existentes. Privada vive APENAS no servidor.
export const VAPID_PUBLIC_KEY = 'BAvUSfK0596soYUbI3PVnsnXfn4N0LASEX_RvTkBhmiktDBb3WPq4u7W4PBP9zzjYjpGKMF5D1qliD3ka6rMnu4';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function bufToBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

// Registra subscription Push e persiste no Supabase. Idempotente: se já há
// subscription pra esse browser, retorna a existente.
// `supabase` é o cliente Supabase. `companyId` é a empresa do user logado.
export async function subscribeWebPush(supabase, companyId) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
    return { ok: false, error: 'unsupported' };
  }
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') {
    return { ok: false, error: 'no_permission' };
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      });
    }
    // Extrai keys p256dh + auth no formato base64url-padded
    const p256dh = bufToBase64(sub.getKey('p256dh'));
    const auth = bufToBase64(sub.getKey('auth'));
    if (supabase && companyId) {
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        await supabase.from('push_subscriptions').upsert({
          user_id: user.id,
          company_id: companyId,
          endpoint: sub.endpoint,
          p256dh,
          auth,
          user_agent: navigator.userAgent,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id,endpoint' });
      }
    }
    return { ok: true, subscription: sub };
  } catch (e) {
    console.warn('[push] subscribe falhou:', e?.message || e);
    return { ok: false, error: e?.message || String(e) };
  }
}

export async function unsubscribeWebPush(supabase) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return false;
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return true;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    if (supabase) {
      await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
    }
    return true;
  } catch { return false; }
}

// Dispara push pra todos da empresa (admin/gerente) via Edge Function send-push.
// `target_roles` filtra destinatários (ex: ['admin','gerente']).
// Silent fail se Edge Function não estiver disponível.
export async function sendServerPush(supabase, { title, body, url, target_roles, target_user_ids }) {
  if (!supabase) return { ok: false, error: 'no_supabase' };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { ok: false, error: 'no_session' };
    const { data, error } = await supabase.functions.invoke('send-push', {
      body: { title, body, url, target_roles, target_user_ids },
    });
    if (error) return { ok: false, error: error.message };
    return { ok: true, ...data };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

// ─── WHATSAPP — disparo via Evolution API (lembrete cliente) ──────────────────
// Reaproveita config do agente IA (ai_agent_config no Supabase).
// Não bloqueia se Evolution não estiver configurada (silent fail).
export async function sendWhatsAppMessage(supabase, companyId, phone, text) {
  if (!supabase || !companyId || !phone || !text) return { ok: false, error: 'params' };
  try {
    const { data: cfg } = await supabase
      .from('ai_agent_config')
      .select('evolution_url, evolution_instance, metadata')
      .eq('company_id', companyId)
      .maybeSingle();
    if (!cfg?.evolution_url || !cfg?.evolution_instance) {
      return { ok: false, error: 'evolution_nao_configurada' };
    }
    const apikey = cfg.metadata?.evolution_apikey || '';
    const url = `${cfg.evolution_url.replace(/\/$/, '')}/message/sendText/${cfg.evolution_instance}`;
    // Normaliza telefone: tira tudo que não é dígito; se começa com 0 (BR DDD antigo), tira.
    const number = String(phone).replace(/\D/g, '').replace(/^0+/, '');
    const fullNumber = number.startsWith('55') ? number : '55' + number;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey },
      body: JSON.stringify({ number: fullNumber, text }),
    });
    if (!resp.ok) {
      const body = await resp.text().catch(() => '');
      return { ok: false, error: `HTTP ${resp.status}: ${body.slice(0, 100)}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
