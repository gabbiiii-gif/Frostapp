# FrostERP — Landing Page

Next.js 14 (App Router) + Tailwind + Framer Motion + Anime.js.

## Stack

- Next.js 14.2 (App Router, Server Components)
- TypeScript
- Tailwind CSS 3.4 + tailwindcss-animate
- Framer Motion (scroll reveals, transições)
- Anime.js (snowflake do logo, pulse do botão WhatsApp)
- Radix UI (Accordion, Tabs)
- Lucide Icons
- Geist Sans + Geist Mono (next/font)

## Setup

```bash
pnpm install
cp .env.example .env.local
pnpm dev
```

Acessa em `http://localhost:3000`.

## Scripts

| Comando | Função |
|---|---|
| `pnpm dev` | Dev server (Hot reload) |
| `pnpm build` | Build de produção |
| `pnpm start` | Servir build de produção |
| `pnpm lint` | ESLint Next |

## Variáveis de ambiente (`.env.local`)

```env
NEXT_PUBLIC_STRIPE_URL=https://buy.stripe.com/SEU_LINK
NEXT_PUBLIC_GA_ID=G-XXXXXXXXXX
NEXT_PUBLIC_META_PIXEL_ID=000000000000000
NEXT_PUBLIC_WHATSAPP_NUMBER=5593984166832
NEXT_PUBLIC_SUPPORT_EMAIL=suportefrosterp@gmail.com
NEXT_PUBLIC_SITE_URL=https://frosterp.com.br
```

- **`NEXT_PUBLIC_STRIPE_URL`** — link de checkout do Stripe. Enquanto não tiver, qualquer valor placeholder serve. Substituir quando pronto.
- **`NEXT_PUBLIC_GA_ID` / `NEXT_PUBLIC_META_PIXEL_ID`** — opcionais. Em branco = analytics desativado.
- **WhatsApp** — número internacional sem `+` ou separadores.

## Eventos de analytics

Disparados via `trackEvent()` (`components/Analytics.tsx`):

| Evento | Onde |
|---|---|
| `cta_primary_click` | Hero, Pricing, CTA Final, Nav |
| `cta_whatsapp_click` | Hero, CTA Final, Floating |
| `pricing_toggle` | Toggle mensal/anual |
| `faq_open` | Cada item do FAQ |

## Deploy Vercel

```bash
# Primeira vez
npx vercel link
npx vercel --prod
```

Ou conectar repo no dashboard Vercel:
1. New Project → import repo
2. **Root Directory**: `landing`
3. Framework: Next.js (auto-detectado)
4. Adicionar env vars (`NEXT_PUBLIC_*`) em Settings → Environment Variables
5. Deploy

Auto-deploy em push pra `main` é configurado por padrão.

## Estrutura

```
landing/
├── app/
│   ├── layout.tsx       # Metadata, fonts, JsonLd, Analytics
│   ├── page.tsx         # Composição das 9 seções
│   └── globals.css      # Reset + glass utilities
├── components/
│   ├── Logo.tsx         # Snowflake animado (Anime.js)
│   ├── JsonLd.tsx       # Schema.org SoftwareApplication
│   ├── Analytics.tsx    # GA4 + Meta Pixel + trackEvent
│   ├── ui/              # button, accordion (shadcn-style)
│   └── sections/
│       ├── Hero.tsx
│       ├── Pain.tsx
│       ├── Solution.tsx
│       ├── Demo.tsx
│       ├── Pricing.tsx
│       ├── FAQ.tsx
│       ├── CTAFinal.tsx
│       ├── Footer.tsx
│       └── FloatingWhatsApp.tsx
├── content/
│   └── landing.ts       # TODO o copy. Editar aqui, não no JSX.
├── lib/
│   └── utils.ts         # cn(), SITE config, whatsappLink()
└── public/
    └── screenshots/     # dashboard.webp, ordens-servico.webp, financeiro.webp, cadastros.webp
```

## Editar copy

Toda a copy vive em `content/landing.ts`. Mudar texto = editar uma linha, sem tocar JSX.

## Trocar screenshots

Substituir os `.webp` em `public/screenshots/` mantendo os mesmos nomes:
- `dashboard.webp`
- `ordens-servico.webp`
- `financeiro.webp`
- `cadastros.webp`

Aspect ratio recomendado: 1600×980 ou similar 16:10.

## Performance

Otimizações já aplicadas:
- `next/image` com `priority` no hero
- `next/font` (Geist) — sem flash de fonte
- Server Components onde não precisa de JS no cliente (Footer, JsonLd)
- Framer Motion + Anime.js só em componentes `"use client"`
- WebP nos screenshots

Meta Lighthouse mobile: Performance ≥ 90, A11y ≥ 95, SEO 100.
