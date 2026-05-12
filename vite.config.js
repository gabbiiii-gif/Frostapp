import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// Plugin que injeta CSP apenas no build de produção
function cspPlugin() {
  return {
    name: 'inject-csp',
    transformIndexHtml(html, ctx) {
      if (ctx.bundle) {
        // Produção: CSP restritivo com worker-src e manifest-src para PWA, base-uri e form-action.
        // OBS: frame-ancestors NÃO é incluído aqui — esse diretivo é ignorado em <meta>
        // pelo browser. A proteção contra clickjacking é feita pelo header X-Frame-Options:
        // DENY (ou Content-Security-Policy: frame-ancestors 'none') configurado no vercel.json.
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; worker-src 'self' blob:; manifest-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: blob: https://api.qrserver.com https://*.supabase.co; media-src 'self' blob: https://*.supabase.co; object-src 'none'; base-uri 'self'; form-action 'self';" />`;
        return html.replace('<!-- CSP aplicado via servidor em produção; em dev o Vite precisa de ws: e eval para HMR -->', csp);
      }
      return html;
    },
  };
}

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    cspPlugin(),

    // ─── PWA: transforma o app em instalável no Android/iOS + Push API ──────
    // Strategy: injectManifest — usa nosso src/sw.js custom (que tem o
    // handler de push notifications). Antes era generateSW; mudou pra
    // permitir Web Push (Fase 5 do sistema de notificações).
    VitePWA({
      registerType: 'autoUpdate',
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.js',
      includeAssets: ['icon-192.png', 'icon-512.png'],
      manifest: {
        name: 'FrostERP',
        short_name: 'FrostERP',
        description: 'Sistema de Gestão FrostERP',
        theme_color: '#1e3a8a',
        background_color: '#0f172a',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [
          {
            src: '/icon-192.png',
            sizes: '192x192',
            type: 'image/png',
            purpose: 'any maskable',
          },
          {
            src: '/icon-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'any maskable',
          },
        ],
      },
      injectManifest: {
        // Cacheia todos os assets do build para funcionamento offline
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // Aumenta limite — o App.jsx bundled passa de 2MB em dev
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      devOptions: {
        // Permite testar service worker em dev mode também
        enabled: true,
        type: 'module',
      },
    }),
  ],
  build: {
    chunkSizeWarningLimit: 1500,
  },
  // Configuração do Vitest — happy-dom é mais leve que jsdom e tem WebCrypto
  test: {
    environment: 'happy-dom',
    globals: true,
    include: ['src/**/*.test.{js,jsx}'],
  },
})
