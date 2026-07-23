---
title: Modo Demonstração (Demo Interativa)
type: concept
updated: 2026-07-22
sources:
  - ../../superpowers/specs/2026-07-22-demo-interativa-design.md
related:
  - ./supabase-sync.md
  - ./db-layer.md
code_refs:
  - src/demo.js
  - supabase/functions/demo-lead/index.ts
---

# Modo Demonstração (Demo Interativa)

O botão "Ver uma demonstração" da landing abre o app em `?demo=1`. O prospect
preenche um formulário curto (lead) e entra numa cópia do ERP semeada com dados
de exemplo, isolada no próprio navegador. Nada é salvo no Supabase real nem
dispara WhatsApp/email de verdade.

## Peças

- `src/demo.js`: `isDemoMode()` (URL `?demo=1` ou sessionStorage), `DEMO_COMPANY_ID='cmp_demo'`,
  `buildDemoUser()` (admin sintético), `resetDemoData()`, `recordDemoLead()`.
- `src/supabase.js`: guards `if (isDemoMode()) return` em `hydrateFromSupabase`,
  `syncToSupabase`, `deleteFromSupabase`, `notifyOsCreated` → demo nunca toca o Supabase real.
- `src/App.jsx`: boot pula o fluxo Supabase no demo; `DemoLeadForm` (captura lead) →
  `handleDemoStart` (seed `cmp_demo` via `seedDatabase()` + injeta usuário demo) →
  shell do ERP com `DemoBanner` (Resetar + "Falar com a equipe").
- `supabase/functions/demo-lead` + tabela `demo_leads`: registra o lead + notifica
  a equipe por email (send-email). Isolado dos dados locais da demo.

## Isolamento

Tudo roda em `window.storage` (escopo `cmp_demo`), por navegador do prospect.
Guards em `supabase.js` são a fronteira que impede vazamento pro Supabase real.
Usuário normal (sem `?demo=1`) é 100% inalterado — todo código demo é gated.

## Fora de escopo (fase 1)

Visão do app do técnico na demo; notificação de lead por WhatsApp (hoje é email).
