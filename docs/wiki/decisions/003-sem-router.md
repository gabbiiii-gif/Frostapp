---
title: ADR 003 — Sem router, navegação por useState
type: decision
updated: 2026-05-10
status: aceita
sources: []
related: []
code_refs:
  - src/App.jsx
---

# ADR 003 — Sem router, navegação por useState

## Contexto

App tem 6 módulos (Dashboard, Processos, Agenda, Financeiro, Cadastro, Configurações) + shells especiais (TecnicoMobileApp, MasterApp). Roteamento poderia usar React Router / TanStack Router.

## Decisão

Não há lib de roteamento. Navegação via `activeModule = useState("dashboard")` no `App`. Sidebar muda `activeModule`; `<ModuleSwitcher>` faz crossfade entre módulos.

## Razões

- **Sem URLs profundas necessárias** (PWA single-window, login obrigatório, sem deep-links externos).
- **Estado de cada módulo em React state** — voltar ao módulo restaura sub-tab/filtros (Cadastro mantém aba ativa, Process mantém filtros).
- **Crash isolation já coberto** por `ModuleErrorBoundary` envolvendo o switcher — não precisa de error boundaries por rota.
- **Master tier acessado por `?master=1`** — único caso "URL-driven", tratado com query param parsing manual no boot.
- **Calendar feed** (`api/calendar.js`) é serverless separado, não compartilha rotas client-side.

## Trade-offs aceitos

- **Sem back/forward do navegador entre módulos**: usuário clica "voltar" → sai do app. Mitigação: ninguém pediu isso ainda.
- **Sem deep-linking pra OS específica**: link "abrir OS #1234" não existe. Pra implementar precisaria parsear query param + navegar pro `ProcessModule` + abrir detail. Hoje fora de escopo.
- **Reload perde activeModule**: cai sempre em "dashboard". Aceitável.

## Quando rever

- Suporte a deep-link de OS/cliente (compartilhar URL com cliente final, abrir notificação push num item específico)
- Multi-window PWA
- Browser back/forward virar requisito (UX feedback)

Nenhum hoje.

## Alternativas consideradas

- **React Router**: 8KB + boilerplate de `<Routes>/<Route>`, sem ganho.
- **TanStack Router**: mais ainda + type-safety que não exploramos (sem TS).
- **Hash routing manual** (`#dashboard`): pequeno, daria back/forward grátis. Custo de migrar baixo se virar requisito.
