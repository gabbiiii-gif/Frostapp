---
title: 010 — Performance da abertura (login) — PageSpeed 2026-09-24
type: decision
updated: 2026-09-24
sources: []
related:
  - 001-single-file-app.md
  - ../concepts/supabase-sync.md
code_refs:
  - index.html
  - src/BrandSplash.jsx
  - src/AnimatedSnowflake.jsx
  - src/Aurora.jsx
  - src/AuroraGL.jsx
  - src/DashboardCharts.jsx
  - src/lib/prefetch.js
  - src/lib/doc.js#carregarHtml2pdf
  - src/App.jsx#aguardarBoot
  - vite.config.js
  - vercel.json
---

# 010 — Performance da abertura (login)

Reclamação do usuário: "ao logar demora muito para entrar". PageSpeed (Lighthouse 13.5, 24/09/2026) em
`app.frosterp.com.br`: desempenho 68–72 no celular e **59 no computador**, com TBT de **5,97 s** no desktop e
~30 s de trabalho "Other" na thread principal.

## O que era caro (em ordem de impacto)

1. **Animações infinitas na tela de login.** O fundo `Aurora` é um shader WebGL em tela cheia num loop
   `requestAnimationFrame` a 60 fps, para sempre, com `antialias` e objetos novos a cada quadro. No
   servidor do Lighthouse (sem GPU → SwiftShader) cada quadro vira CPU. Somam-se o floco do login girando em
   loop, o anel pulsando pelo atributo `r` e 41 linhas do splash animando `stroke-dashoffset`: nada disso é
   composto pela GPU, então o SVG era repintado a cada quadro.
2. **Splash fixo.** Timer de 3 s + 0,6 s de fade em toda abertura. O wordmark (elemento de LCP) nascia com
   `opacity: 0` e só aparecia aos 2 s → 1,9 s de "atraso de renderização" do LCP.
3. **Bundle único.** Tudo num `index-*.js` de 2,8 MB (812 KB gzip): `html2pdf` (970 KB, só para gerar
   PDF), Recharts, motion, gsap, animejs, qrcode (importado sem uso) e os módulos de `src/modules/`.
4. **Bloqueio de renderização:** CSS do Google Fonts (~750 ms) e `registerSW.js` sem `defer` (~680 ms).

## Decisões

- **Nenhuma animação infinita.** Floco e splash são estáticos, com no máximo uma entrada curta de
  `opacity`/`transform` num contêiner HTML (composta pela GPU). Tudo respeita `prefers-reduced-motion`.
- **Aurora com orçamento.** Gradiente CSS estático aparece na hora. O WebGL (`AuroraGL`, carregado sob
  demanda) só entra depois do primeiro paint, em idle, e só com GPU de verdade (`failIfMajorPerformanceCaveat`),
  sem `prefers-reduced-motion` e sem `saveData`. Roda a ~30 fps, pausa fora da tela ou com a aba oculta e
  **desacelera até parar em ~12 s**.
- **Login na hora; o splash só quando muda a primeira tela.** O `index.html` já traz o logo (SVG +
  wordmark em texto HTML com fonte do sistema), então FCP/LCP não esperam o JS. O splash do React
  (`BrandSplash`, mesmo markup) só aparece quando o init decide a primeira tela: sessão a restaurar, modo
  master ou app sem Supabase. Teto de 3 s. Sem sessão, o login aparece direto e o `handleSubmit` espera
  o boot (`aguardarBoot`), para o hydrate do login não rodar em paralelo com o do init nem com o `seedDatabase`.
- **Code-splitting sem quebrar o monolito.** Fica fora do bundle inicial o que só é usado depois do login:
  `html2pdf` (`carregarHtml2pdf`), gráficos do Dashboard (`DashboardCharts`), `BlurText`/motion, Aurora/ogl
  e os módulos de `src/modules/` (`React.lazy`). `gsap` e `animejs` foram trocados por `requestAnimationFrame`
  e Web Animations API. Na tela de login, `prefetchPosLogin()` baixa em idle o que o Dashboard vai usar.
  Vendors em chunks próprios (`vendor-react`, `vendor-supabase`), para o cache sobreviver aos deploys.
- **Fonte própria.** DM Sans v17 (os mesmos arquivos que o Google servia) em `public/fonts/`, com
  `@font-face` em `src/index.css`. CSP sem os domínios do Google. Itálico e latin-ext ficam fora do precache.
- **Acessibilidade:** a viewport não trava mais o zoom. Para o iOS não dar zoom ao focar um campo, os
  campos pequenos usam 16 px em telas de toque (`pointer: coarse`).
- **Cache:** `/assets/*` e `/fonts/*` com `max-age=31536000, immutable` (nomes com hash ou versão).

## O que ficou de fora (e por quê)

- **Bundle inicial < 170 KB** (meta do prompt): impossível sem quebrar o `App.jsx` (18 mil linhas, ~480 KB
  minificado) em arquivos. Ver [[001-single-file-app]]: se a abertura em 4G lento continuar um problema,
  a próxima alavanca é extrair o shell do ERP (módulos) do `App.jsx` para chunks.
- **`sourcemap: 'hidden'`:** na Vercel os `.map` ficariam públicos, e não há Sentry para consumi-los.
- **CSS crítico inline:** o CSS inteiro tem 16 KB gzip; o risco de a tela aparecer sem estilo não compensa.
- **SEO 66:** é o `noindex` do app logado, e está correto. O SEO é trabalho da landing (`frosterp.com.br`).
