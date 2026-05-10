---
title: ADR 001 — App.jsx single-file
type: decision
updated: 2026-05-10
status: aceita
sources: []
related:
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx
---

# ADR 001 — App.jsx single-file

## Contexto

`src/App.jsx` tem ~12.228 linhas (2026-05-10). Contém todos os módulos do ERP (Dashboard, Process, Schedule, Finance, Cadastro, Settings), a camada Master, todos os modais, dialogs, e até helpers de doc generation. Apenas `constants.js`, `utils.js`, `supabase.js` e componentes visuais foram extraídos.

## Decisão

Manter App.jsx como arquivo único até que haja **dor concreta** (não estética).

## Razões

- **Refactor cross-cutting é trivial**: rename de função, mudança de schema, ajuste de status de OS — `Find/Replace` num arquivo. Splitting prematuro espalha a mesma mudança em 12 arquivos.
- **Sem build de TypeScript / circular deps** pra resolver — JSX puro, hot reload instantâneo.
- **State global é simples**: `useState` no `App` + props drilling 1-2 níveis. Não precisa de Context/Redux.
- **Histórico de tentativas de extração**: `constants.js` foi extraído mas várias constantes ainda vivem inline em App.jsx (extração in-flight). Mostra que o split não terminou de "render" valor.
- **Grep > navegação por arquivos** pra esse codebase. Function name é estável; linha drifta.

## Trade-offs aceitos

- LSP/IDE lento em arquivos > 10k linhas (sintoma real)
- Conflitos de merge mais frequentes em equipe (não-issue: equipe pequena)
- Onboarding intimidante — mitigado por `CLAUDE.md` + wiki

## Quando rever

Sintomas que justificam split:
- IDE inutilizável (autocompletar > 2s)
- 2+ pessoas editando concorrente sempre dá conflito
- Bundle size cresce desproporcional (App.jsx full no chunk inicial)

Hoje: nenhum desses. Mantém.

## Alternativas consideradas

- **Por módulo** (`Dashboard.jsx`, `Process.jsx`, etc): força split de helpers compartilhados (`Modal`, `DataTable`, `_h`, etc) — boilerplate de import sem ganho funcional.
- **Feature-folder** (`features/os/{Module,Detail,Form}.jsx`): mesmo problema; OS depende de Cadastro (clientes), Finance (sync), helpers de doc — estrutura "feature" vira mentira.
