---
title: Design System FrostERP
type: concept
updated: 2026-11-01
sources: []
related:
  - ../decisions/010-performance-abertura.md
code_refs:
  - src/index.css
  - src/constants.js#STATUS_MAP
  - src/constants.js#COLORS
  - src/App.jsx#StyleSheet
  - src/App.jsx#Modal
  - src/App.jsx#StatusBadge
  - src/App.jsx#KPICard
  - src/FrostIcons.jsx
---

# Design System FrostERP

Extração do sistema visual do app para um Design System publicado:
https://claude.ai/artifact/JbifYmfUkvzk9NKQxEMep6 (privado; compartilhar pelo menu Share da página).

## O que tem lá

- **Tokens** (`tokens.json`), tema `dark` (padrão) + `light`: superfícies `color-surface*`, texto `color-text-*`,
  marca `color-brand` (#1B8FE8), família `status-*`, cores do `StatusBadge` (`badge-*`), paleta de gráficos
  `chart-1..8`, espaçamento (escala de 4px), raios (`radius-lg` = 12px — o `@theme` do projeto sobrescreve o
  Tailwind), sombras e camadas (`z-modal` 50 < `z-confirm` 55 < `z-toast` 60).
- **DM Sans** (os 4 woff2 de `public/fonts/`) e 10 estilos de texto mapeados das classes `text-*` mais usadas.
- **Logos** de `public/` e os **18 ícones minimal** do `FrostIcons` convertidos em SVG.
- **11 componentes** reescritos em CSS (`fr-*`) com preview: Button, Input, SearchInput, StatusBadge, KPICard,
  Modal, Toast, ConfirmDialog, EmptyState, LoadingSkeleton e Alert (adição: os tokens `status-*` não têm
  componente no app).

## Achados (pontos fracos do sistema atual)

- **Dois sistemas paralelos.** `src/index.css` define tokens semânticos (`--color-surface`…), mas os
  componentes pintam com classes Tailwind (`bg-gray-800`, `bg-blue-600`) e o tema claro funciona por ~150
  overrides `!important` em `body[data-theme="light"]`. Toda cor nova exige dois lugares.
- **`@theme` × `:root` conflitam:** `--color-surface-raised` é `#1f2937` no `@theme` e `#1c2a3f` no `:root`
  (este vence). Idem `--color-surface-muted`.
- **Contraste abaixo de WCAG** (mantido exato no DS, sinalizado nas notas):
  - `color-text-muted` ~3,7:1 (escuro) e ~2,4:1 (claro) sobre `color-surface`.
  - Texto branco do `StatusBadge` sobre verde/amarelo/ciano no escuro (< 3:1). O claro já corrige.
  - Botão primário no claro (`#3ba4f0` + branco) ~2,6:1.
- **Emoji como ícone** em KPIs/EmptyState/Toast em vez do `FrostIcons`.

## Próximo passo sugerido [a confirmar com o usuário]

Migrar os componentes base para consumir os tokens (`var(--…)`) em vez de classes gray/blue do Tailwind;
isso elimina os overrides do tema claro e corrige os contrastes num lugar só.
