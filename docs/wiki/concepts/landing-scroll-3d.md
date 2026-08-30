---
title: Landing — orquestração de scroll + cena 3D
type: concept
updated: 2026-08-30
sources:
  - https://reactbits.dev/components/scroll-stack
  - https://reactbits.dev/components/card-swap
related:
  - ./demo-mode.md
code_refs:
  - landing/index.html
  - landing/scroll.js
  - landing/scene3d.js
---

# Landing — orquestração de scroll + cena 3D

A landing (`landing/`) é **HTML estático + GSAP/ScrollTrigger + three.js**. Não é React, não
passa pelo Vite e não compartilha nada com `src/`. Consequência prática: **componente de
biblioteca React não se instala aqui** — tem que ser portado pra vanilla.

## Camadas de z-index

| z | O quê | Onde |
| - | ----- | ---- |
| 0 | `body::before` — gradientes atmosféricos | CSS |
| 1 | `#bg-canvas` — cena three.js (floco + neve) | `scene3d.js` |
| 2 | `main` — todas as `.panel` | CSS |
| 20 | `.topbar` | CSS |

## ⚠️ Armadilha recorrente: o floco atravessa o cartão

O canvas está **atrás** do conteúdo (z 1 vs 2), mas isso só resolve metade. Cartões com
`background:rgba(255,255,255,.025)` são praticamente transparentes — o floco aparece **através**
deles e embaralha o texto. Já mordeu duas vezes:

1. Cartões de Planos (`.plano`) — corrigido isoladamente, com comentário no CSS.
2. `.pain`, `.mod`, `.mod-card`, `.faq-item`, `.glass`, `.car-arrow` — mesmo problema, mesma causa.

**Regra:** todo cartão da landing usa o token `--card` (`rgba(19,36,63,.92)`), não um branco
translúcido. Para variação de estado (hover/active com tinta ciano), empilhe camadas —
`background:linear-gradient(<tinta>,<tinta>), var(--card)` — em vez de trocar por uma cor
transparente. Títulos e leads (`.h-sec`, `.lead`, `.h-hero`) levam `text-shadow` escuro, porque
texto não tem como ficar opaco.

## `data-dim` — floco discreto por seção

Opacidade não resolve título cruzado pelo floco. Para isso a cena expõe `frostScene.setDim(0..1)`,
um multiplicador de opacidade aplicado a floco, cristal, arestas, núcleo e partículas, suavizado
por frame (`curDim`) pra não piscar na troca de seção. O `scroll.js` lê `data-dim` da `.panel` no
`onToggle` do ScrollTrigger. Sem atributo = `1` (cheio).

Hoje: `#demo` 0.22 e `#planos` 0.25 (texto/tabela densos), `#dores`/`#solucao` 0.6, `#faq` 0.55.
`#hero` e `#cta` ficam em 1 — o CTA é onde o floco explode.

## Entrada lateral (`[data-reveal]`)

Cada `.panel` desliza seu conteúdo pelo lado em que está ancorado (`data-side`), com fade e blur
**presos à rolagem** (`scrub`), não num disparo único. Painéis `center` alternam o lado pelo
índice; o `#hero` não desliza (entra só na vertical, e o título tem a animação de palavras do
anime.js). `.panel` ganhou `overflow-x:clip` pra que o deslocamento lateral não gere barra
horizontal.

`prefers-reduced-motion` e telas ≤820px desligam o blur (reblurar por frame é o item mais caro do
scroll no celular).

## ScrollStack — porte vanilla do React Bits

A seção `#dores` empilha os cartões usando a matemática do
[`<ScrollStack />` do React Bits](https://reactbits.dev/components/scroll-stack) (variante JS-CSS),
reescrita como IIFE no fim do `scroll.js`. Três desvios deliberados do original:

1. **Sem Lenis.** O pacote depende de `lenis` pra smooth-scroll global. Lenis sequestra o scroll da
   janela e brigaria com o ScrollTrigger que dirige a cena 3D. Aqui a leitura é do scroll nativo,
   num `requestAnimationFrame` com throttle.
2. **`offsetTop` em vez de `getBoundingClientRect`.** No modo `useWindowScroll` o original mede a
   posição do cartão pelo rect — que é afetado pelo `transform` que a própria pilha acabou de
   aplicar, criando realimentação. `offsetTop` é posição de layout, imune a transform.
3. **Espaçador `.scroll-stack-end` com `margin-top:36vh`.** O original calcula
   `pinEnd = topo do marcador − metade da tela`, dimensionado pra cartões de 20rem. Os `.pain` têm
   ~104px: sem o espaçador o `pinEnd` cai **antes** do `pinStart` do 3º cartão e ele nunca encaixa
   em viewport alta. Com 36vh os três encaixam de 640px a 1440px de altura, com ~270–360px de hold.

Os cartões da pilha **não** levam `data-reveal`: quem escreve o `transform` deles é o ScrollStack,
e o GSAP brigaria pelo mesmo atributo. A entrada lateral deles vai no mesmo `transform`, derivada
do próprio scroll.

## CardSwap — vitrine de telas em `#demo`

A seção "Veja como funciona" ganhou uma pilha 3D de screenshots do app, porte vanilla do
[`<CardSwap />` do React Bits](https://reactbits.dev/components/card-swap). Esse original **já
depende de GSAP**, que a landing carrega — então `makeSlot`/`placeNow` e a timeline de troca
vieram inteiras; só a camada React virou DOM puro. Quatro acréscimos:

1. **Pré-carga das imagens.** Cada `data-src` é testado com `new Image()` antes de montar. Tela
   ausente não entra; com menos de duas a vitrine se apaga inteira em vez de mostrar quadro
   quebrado. Isso é o que permite soltar os PNGs aos poucos sem quebrar a seção no ar.
2. **Rodízio.** A pilha tem 5 cartões e o pool de telas é maior (8 hoje). A troca de `src`
   acontece no callback do label `return`, quando o cartão da frente já caiu fora do quadro —
   a mudança não aparece.
3. **`IntersectionObserver`.** A timeline só roda com a seção na tela. O intervalo nunca é
   destruído no meio de uma troca: parar a timeline pela metade deixaria a pilha desalinhada.
   Sempre via `window.IntersectionObserver`, nunca o identificador solto.
4. **Layout condicional.** Uma coluna é o estado **base** do `.demo-top`, não o fallback. A 2ª
   coluna só aparece via `:has(.demo-shots.ready)`, ou seja, depois que o JS confirma as
   imagens. Onde `:has()` não existe, fica em coluna única — que é o layout mobile, e funciona.

A moldura (`.shots-frame`) recorta com `mask-image` a queda de 500px do cartão. A máscara fica
num **ancestral** do elemento que tem `perspective`: `mask`/`filter` no próprio elemento com
`perspective` achataria o 3D dos filhos.

### Telas: nada de dado real

`landing/screens/` guarda os PNGs e o README com os nomes esperados. As capturas devem sair do
modo demonstração (`?demo=1`). As telas de **IA / Atendimento**, **Pós-Venda** e **Folha de
Pagamento** foram deliberadamente deixadas de fora da primeira leva: as capturas traziam nome e
telefone de clientes reais e nomes/valores de funcionários, e a landing é pública e indexada.
