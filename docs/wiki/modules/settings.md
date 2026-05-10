---
title: Configurações (SettingsModule)
type: module
updated: 2026-05-10
sources: []
related:
  - ./schedule.md
  - ../concepts/db-layer.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/App.jsx#SettingsModule
  - src/App.jsx#UserManagement
  - src/App.jsx#CalendarFeedPanel
  - src/App.jsx#CompanyAuditPanel
  - src/App.jsx#AutoBackupPanel
  - src/App.jsx:10105
  - src/App.jsx:9446
  - src/App.jsx:9843
  - src/App.jsx:9931
  - src/App.jsx:10021
  - api/calendar.js
---

# Configurações (SettingsModule)

Sidebar id: `config`. **Admin-only** (ou `customPermissions` com `config`). Orquestra sub-painéis e config global da empresa.

## Store principal

- `erp:config` — singleton (escopado por empresa via `SCOPED_SINGLETONS`).

Schema: `{nomeEmpresa/razaoSocial, cnpj, telefone, email, endereco, logoUrl, pixChave, pixTipoChave, pixFavorecido, pixBanco, pixQrUrl, mensagemAgradecimento}`.

`razaoSocial` e `nomeEmpresa` são **mantidos sincronizados** ao salvar (legacy compat).

## Sub-painéis (componentes)

| Componente | Linha | Função |
|---|---|---|
| `UserManagement` | 9446 | CRUD de usuários (`erp:user:`), atribui role/customPermissions, gera tokens |
| `CalendarFeedPanel` | 9843 | Gera/regenera/desativa token iCal — ver [Schedule](./schedule.md) |
| `CompanyAuditPanel` | 9931 | Lê audit log (entries de `recordAudit`) |
| `AutoBackupPanel` | 10021 | Configura `ensureAutoBackup` (singleton `erp:autoBackupMeta`) |
| `LogoPicker` | 3326 | Upload/seleção de logo (Supabase Storage) |

## Calendar Feed

Singleton `erp:calendarFeedToken`: `{token, enabled, name, createdAt, regeneratedAt?}`.

Operações:
- `handleEnableCalendarFeed` — `genSecureToken()` + grava
- `handleRegenerateCalendarToken` — novo token (link antigo morre)
- `handleDisableCalendarFeed` — `enabled=false`
- `handleCopyCalendarURL` — clipboard

URL é consumida por `api/calendar.js`.

## Backup / Restore

`handleExport` empacota `{clients, employees, services (erp:os:), schedule, ...}` em JSON. Apenas prefixos dos módulos **ativos** — outros (financeiro/fiscal/estoque/mensageria) não entram. Comentário no código (line 10141) é a fonte de verdade do que foi removido do app.

`handleImport` confirma duas vezes (`importConfirm` → `pendingImportData`) antes de sobrescrever.

`systemInfo.totalRecords` conta registros nos prefixos: `erp:client:`, `erp:employee:`, `erp:os:`, `erp:schedule:`, `erp:user:`.

## Reset

`confirmReset` → `confirmResetFinal` → purge. Two-stage confirmation porque é destrutivo (apaga toda a empresa).

## Tema

Recebe `theme` + `setTheme` do App pai — toggle dark/light também aqui (além do header).

## Lacunas

- [a expandir] `UserManagement` — fluxo completo de criar usuário com TOTP/2FA
- [a expandir] Schema do `erp:autoBackupMeta`
- [a expandir] Audit log entry shape (`recordAudit` em App.jsx:521)
