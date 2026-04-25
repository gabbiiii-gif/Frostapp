# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Dev Commands

- `npm run dev` — Start Vite dev server
- `npm run build` — Production build (output in `dist/`)
- `npm run preview` — Preview production build locally
- No test runner or linter is configured.

## Tech Stack

- **React 19** with JSX (no TypeScript)
- **Vite 6** as bundler with `@vitejs/plugin-react`
- **Tailwind CSS 4** via `@tailwindcss/vite` plugin (imported in `src/index.css`)
- **Recharts** for charts/graphs
- **Supabase** (`@supabase/supabase-js`) — cloud sync backend via `src/supabase.js`
- **Motion** (`motion`) — animation library used in `src/BlurText.jsx`
- **OGL** (`ogl`) — WebGL library used in `src/Aurora.jsx` for the login background
- No router library — navigation is state-driven within a single component

## Architecture

This is a single-file ERP application ("FrostERP") — the entire app lives in `src/App.jsx` (~7600 lines). There are no other component files, no routing, and no external state management.

### Key structural sections in App.jsx (in order):

1. **Constants** (~lines 8–53) — Color palettes, revenue/expense categories, status mappings, role permissions, message templates, payment methods
2. **DB Layer** (~lines 55–115) — `window.storage`-backed persistence using a `DB` object with `get/set/delete/list` methods (JSON-serialized key-value store, falls back to in-memory Map)
3. **Utility Functions** (~lines 117–240) — ID generation, currency/date/CPF/CNPJ/phone formatting, date filtering, password hashing, permission checks
4. **Seed Data** (~lines 242–513) — `seedDatabase()` populates demo data on first run
5. **CSS StyleSheet** (~lines 514–595) — Injected CSS via a `<style>` component (animations, print styles)
6. **Base UI Components** (~lines 596–980) — Modal, Toast, StatusBadge, KPICard, DataTable (with sort/filter/pagination), DateFilterBar, SearchInput, ConfirmDialog, EmptyState, LoadingSkeleton
7. **LoginScreen** (~lines 982–1085)
8. **Dashboard** (~lines 1087–1427) — KPIs, charts, recent activity
9. **Feature Modules** — Each is a self-contained function component:
   - `FinanceModule` (~line 1493) — Revenue/expenses with printable reports
   - `InventoryModule` (~line 1878) — Stock management
   - `InvoiceModule` (~line 2579) — NF-e/NFS-e invoices and boletos with print views
   - `PDVModule` (~line 3255) — Point of sale
   - `WebdeskModule` (~line 3694) — Support tickets
   - `ProcessModule` (~line 4095) — Service orders (OS)
   - `ScheduleModule` (~line 4629) — Calendar/agenda
   - `BankingModule` (~line 5251) — Bank accounts and transfers
   - `CadastroModule` (~line 5622) — Client and employee registration
   - `MessageCenter` (~line 6452) — WhatsApp/Email messaging
   - `SettingsModule` (~line 6605) — App config, user management, data backup/restore
10. **Main App component** (~line 7000) — Orchestrates login, sidebar navigation, module rendering, and global state

### Data & State Patterns

- All data is persisted to `window.storage` (localStorage or in-memory polyfill) via the `DB` utility with prefixed keys (e.g., `frost_clients`, `frost_transactions`)
- Navigation between modules uses `useState` (`currentPage`) — no URL routing
- Role-based access control via `ROLE_PERMISSIONS` with roles: `admin`, `gerente`, `tecnico`, `atendente`
- Toast notifications managed at the App level and passed down as `addToast` prop

### Language

The app UI is entirely in **Brazilian Portuguese** (pt-BR). All labels, categories, messages, and field names are in Portuguese.

## Supabase Sync Layer (`src/supabase.js`)

The app syncs its `window.storage` key-value data to a Supabase table `kv_store` (columns: `key`, `value`, `updated_at`). Requires env vars `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. If absent, Supabase is disabled and the app runs fully local.

- `hydrateFromSupabase()` — called on app load; Supabase is source of truth, overwrites local data
- `syncToSupabase(key, value)` — called on every `DB.set()` to keep remote in sync
- `deleteFromSupabase(key)` — called on every `DB.delete()`
- `uploadAllToSupabase()` — bulk upsert (used in backup/restore)
- `subscribeToChanges(cb)` — Realtime listener; propagates changes from other devices/tabs
- Keys prefixed with `erp:user:` are never synced (sensitive local-only data)

## Animation Components

- `src/Aurora.jsx` — WebGL aurora background rendered via OGL, shown on the login screen
- `src/BlurText.jsx` — Text reveal animation using Motion, used for decorative text

## Working with This Codebase

- Since the entire app is a single file, any change requires careful attention to the section boundaries documented above.
- Font: DM Sans, loaded from Google Fonts in `index.html`.
- The `StyleSheet` component injects global CSS including print media queries and animations — check there for styling that isn't Tailwind.
- The `DataTable` component is reused across all modules and supports sorting, filtering, pagination, and inline actions.

## Regras Obrigatórias do Projeto

1. **Deploy contínuo** — Toda e qualquer alteração no código deve ser commitada no Git e deployada na Vercel. Nunca deixar mudanças apenas locais.
2. **Comentários nos pontos importantes (em PT-BR)** — Comentar todos os pontos mais importantes do código (funções principais, lógica de negócio, integrações, decisões arquiteturais) para facilitar manutenção e entendimento. Todos os comentários devem ser escritos em Português Brasileiro (pt-BR).
3. **Sistema integrado PC + Mobile** — O sistema deve funcionar integrado ao PC e como um app mobile responsivo. Todas as telas e componentes devem ser responsivos e adaptados para desktop e dispositivos móveis.
4. **App do Técnico — fluxo dedicado** — Usuários com `role="tecnico"` devem ver exclusivamente o `TecnicoMobileApp` (sem sidebar do ERP). Esse shell mostra apenas as OS atribuídas ao próprio técnico, com fluxo: visualizar demanda → marcar chegada (registra `tecnico.chegada`) → preencher descrição detalhada e upload de fotos → finalizar (status muda para `aguardando_finalizacao` e registra `tecnico.saida`). Nunca dar acesso a outros módulos para esse role. Toda OS finalizada pelo técnico precisa ser revisada e aprovada por admin/gerente no ERP antes de virar `finalizado`. O relatório mensal de produtividade por técnico (`ProductivityReport`) deve sempre estar disponível para admin/gerente. Fotos do serviço são armazenadas no bucket Supabase Storage `os-fotos` (público) — qualquer feature nova relacionada a OS deve preservar esse fluxo de revisão.
