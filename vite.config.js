import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// Plugin que injeta CSP apenas no build de produção
function cspPlugin() {
  return {
    name: 'inject-csp',
    transformIndexHtml(html, ctx) {
      if (ctx.bundle) {
        // Produção: injeta CSP restritivo
        const csp = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; connect-src 'self' https://*.supabase.co wss://*.supabase.co; img-src 'self' data: blob:;" />`;
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
  ],
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
