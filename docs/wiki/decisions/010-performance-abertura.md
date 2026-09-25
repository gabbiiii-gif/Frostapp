---
title: 010 — Performance da abertura (login) — PageSpeed 2026-09-24
type: decision
updated: 2026-09-25
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
  demanda) só entra com a página assentada (`load` + 3 s + idle), com GPU de verdade, sem
  `prefers-reduced-motion` e sem `saveData`. Roda a ~30 fps, pausa fora da tela ou com a aba oculta e
  **desacelera até parar em ~12 s**. O teste de GPU cria um contexto WebGL real (~95 ms com GPU, ~320 ms com
  SwiftShader): por isso roda tarde e o resultado fica 7 dias no `localStorage` (`frost:aurora-gpu`).
  Atenção: `failIfMajorPerformanceCaveat` NÃO devolve null no Chrome com SwiftShader; quem barra é a regex
  do nome do renderer.
- **Login na hora; o splash só quando muda a primeira tela.** O `index.html` já traz o logo (SVG +
  wordmark em texto HTML com fonte do sistema), então FCP/LCP não esperam o JS. Esse splash
  (`#splash-inicial`) fica FORA do `#root`, atrás do app (z-index -1), e o `src/main.jsx` só o remove
  depois do evento `first-contentful-paint`. Motivo medido: quando o React trocava o conteúdo de `#root`
  logo após a primeira pintura, o Chrome descartava o wordmark como candidato a LCP (removido antes da
  confirmação da pintura) e o LCP virava o subtítulo do login ~1 s depois. Atrasar a montagem por quadros
  (rAF) não resolve de forma confiável: foi uma corrida em 1 de 2 rodadas. O splash do React
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
- **Tarefas longas na abertura:** o `autoFocus` do email focava durante o commit do React, antes de
  existir layout (417 ms de CPU no perfil 4×). Agora o foco vem depois da primeira pintura e é pulado em
  telas de toque, onde não abre o teclado mesmo. O índice do catálogo de equipamentos (normalização +
  `localeCompare`) virou `catalogoEquipamentosPorTipo()`, montado no primeiro uso.
- **Dependências removidas:** `gsap`, `animejs` e `qrcode` (o QR do 2FA vem pronto do Supabase MFA).
- **Acessibilidade:** a viewport não trava mais o zoom. Para o iOS não dar zoom ao focar um campo, os
  campos pequenos usam 16 px em telas de toque (`pointer: coarse`).
- **Cache:** `/assets/*` e `/fonts/*` com `max-age=31536000, immutable` (nomes com hash ou versão).

## Medição (Lighthouse 12.8 local, build com as envs de produção, 2026-09-25)

Máquina compartilhada com o Antigravity: a base variou entre rodadas (desktop 61 → 93), então vale a
comparação da mesma rodada.

| | Base (produção, `5c5cb34`) | Depois |
|---|---|---|
| Celular: desempenho | 53–54 | **95–96** |
| Celular: FCP / LCP | 3,9 s / 3,9–4,1 s | 2,05 s / 2,4–2,6 s |
| Celular: TBT | 828–1035 ms | 13–27 ms |
| Celular: Speed Index | 6,1–6,4 s | 2,05 s |
| Desktop: desempenho / TBT | 93 / ~138 ms | **100** / 0 ms |
| Acessibilidade / Boas práticas | 94 / 100 | 100 / 100 |
| JS+CSS iniciais (gzip) | 526 KB | 271 KB |

SEO continua 66 pelo `noindex` (intencional).

## O que ficou de fora (e por quê)

- **Bundle inicial < 170 KB** (meta do prompt): impossível sem quebrar o `App.jsx` (18 mil linhas, ~480 KB
  minificado) em arquivos. Ver [[001-single-file-app]]: se a abertura em 4G lento continuar um problema,
  a próxima alavanca é extrair o shell do ERP (módulos) do `App.jsx` para chunks.
- **`sourcemap: 'hidden'`:** na Vercel os `.map` ficariam públicos, e não há Sentry para consumi-los.
- **CSS crítico inline:** o CSS inteiro tem 16 KB gzip; o risco de a tela aparecer sem estilo não compensa.
- **SEO 66:** é o `noindex` do app logado, e está correto. O SEO é trabalho da landing (`frosterp.com.br`).
