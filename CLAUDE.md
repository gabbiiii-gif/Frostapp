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

## Working with This Codebase

- Since the entire app is a single file, any change requires careful attention to the section boundaries documented above.
- Font: DM Sans, loaded from Google Fonts in `index.html`.
- The `StyleSheet` component injects global CSS including print media queries and animations — check there for styling that isn't Tailwind.
- The `DataTable` component is reused across all modules and supports sorting, filtering, pagination, and inline actions.
