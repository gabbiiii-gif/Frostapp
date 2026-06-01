// ─── Service Worker do FrostERP ─────────────────────────────────────────────
// Estratégia: injectManifest (vite-plugin-pwa).
// Responsabilidades:
//   1. Precache dos assets do build (offline-first do app shell)
//   2. Cache de fontes do Google (runtime)
//   3. Push notifications (Web Push API + VAPID)
//   4. Click no banner → abre/foca a URL alvo
//
// O manifest de precache é injetado pelo vite-plugin-pwa em build time
// no placeholder self.__WB_MANIFEST.

import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute } from 'workbox-routing';
import { CacheFirst } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

// ─── 1. Precache do app shell (gerado em build) ──────────────────────────────
precacheAndRoute(self.__WB_MANIFEST || []);
cleanupOutdatedCaches();

// ─── 2. Cache de fontes do Google (runtime) ──────────────────────────────────
registerRoute(
  /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
  new CacheFirst({
    cacheName: 'google-fonts',
    plugins: [new ExpirationPlugin({ maxEntries: 10, maxAgeSeconds: 60 * 60 * 24 * 365 })],
  })
);

// ─── 3. Push handler ─────────────────────────────────────────────────────────
// Payload esperado (JSON): { title, body, url, ts }
self.addEventListener('push', (event) => {
  let data;
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'FrostERP', body: event.data ? event.data.text() : '' };
  }
  const title = data.title || 'FrostERP';
  const body = data.body || '';
  const url = data.url || '/';
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: data.tag || undefined,
      renotify: !!data.tag,
      data: { url, ts: data.ts || Date.now() },
    })
  );
});

// ─── 4. Click no banner → foca/abre a URL alvo ───────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil((async () => {
    const allClients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    // Se já tem uma janela aberta, foca nela
    for (const c of allClients) {
      try {
        await c.focus();
        if (c.url !== url && 'navigate' in c) {
          await c.navigate(url);
        }
        return;
      } catch {
        /* segue tentando */
      }
    }
    // Senão, abre nova
    if (self.clients.openWindow) await self.clients.openWindow(url);
  })());
});

// Aceita skipWaiting do client (registerType: autoUpdate em modo claim)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});
