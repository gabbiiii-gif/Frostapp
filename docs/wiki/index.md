# Wiki Index

Catálogo de todas as páginas do wiki. Uma linha por página: `- [Título](path) — gancho de uma linha`.

Sempre lido primeiro em qualquer query. Mantenha sub-200 linhas.

## Módulos

- [Dashboard](modules/dashboard.md) — KPIs, gráfico semanal de OS, próximas atividades (read-only)
- [Financeiro](modules/finance.md) — receitas/despesas com totais por status; backfill OS→Finance via `syncOSToFinance`
- [Ordens de Serviço](modules/process.md) — OS multi-serviço/multi-peça, integração com estoque, ciclo de revisão admin
- [Agenda](modules/schedule.md) — calendário unificado (próprios + OS), iCal feed
- [Cadastros](modules/cadastro.md) — multi-tab: clientes, funcionários, fornecedores, produtos, estoque, serviços
- [Configurações](modules/settings.md) — admin-only; orquestra UserManagement, CalendarFeed, AuditPanel, AutoBackup, dados da empresa, PIX
- [App do Técnico](modules/tecnico-mobile.md) — shell dedicado para `role=tecnico`; fluxo chegada→descrição+fotos→finalizar
- [Pós-Venda](modules/pos-venda.md) — mensagens automáticas pós-OS via WhatsApp; dispatcher cron + Edge Function
- [IA / Atendimento](modules/ia-atendimento.md) — agente WhatsApp, chat Realtime, aba Propostas de OS (aprovação humana)

## Conceitos

- [DB Layer](concepts/db-layer.md) — pipeline de DB.set/get/list, multi-tenant scope, audit trail, auto-backup
- [Supabase Sync](concepts/supabase-sync.md) — auth + kv_store/RLS + Realtime + Storage `os-fotos` + Edge Functions
- [Role Permissions](concepts/role-permissions.md) — ROLE_PERMISSIONS, hasPermission, customPermissions override, gates
- [DataTable](concepts/data-table.md) — sort/pagination/render custom; reusado em todos os módulos
- [Document Generators](concepts/document-generators.md) — HTML imprimível para orçamento/OS/recibo via `openHTMLDoc`
- [TOTP/2FA + Hashing](concepts/totp-2fa.md) — PBKDF2 100k iter, RFC 6238 ±1 step, base32, migração lazy de hash legado
- [Master Tier](concepts/master-tier.md) — super-admin local-only para criar/bloquear/excluir empresas
- [Evolution multi-tenant](concepts/evolution-multitenant.md) — instance→company_id, no-op gracioso, infra Evolution/Storage compartilhada

## Fluxos

- [OS técnico → aprovação](flows/os-tecnico-aprovacao.md) — criação ERP → atribuição Realtime → mobile chegada/finalizar → revisão admin → backfill finance
- [WhatsApp → IA → Proposta → OS](flows/whatsapp-ia-os.md) — webhook → resolve empresa → mídia → agente → proposta → aprovação humana → OS

## Decisões

- [001 single-file App.jsx](decisions/001-single-file-app.md) — manter monolito até dor concreta
- [002 window.storage sem ORM](decisions/002-window-storage-sem-orm.md) — KV sobre localStorage + sync Supabase 1:1
- [003 sem router](decisions/003-sem-router.md) — navegação por `useState(activeModule)`
- [004 pt-BR no código](decisions/004-pt-br-no-codigo.md) — UI/comentários/status em português; sem i18n
- [005 módulos removidos](decisions/005-modulos-removidos.md) — Inventory/Invoice/PDV/Webdesk/Banking/MessageCenter consolidados
- [006 master tier local-only](decisions/006-master-tier-multi-tenant.md) — dívida técnica explícita: TODO migrar pra Edge Function
- [007 IA OS aprovação humana](decisions/007-ia-os-aprovacao-humana.md) — proposta + gate humano; OS escrita pelo app via DB layer, não n8n/Edge
- [008 Pós-Venda pg_cron](decisions/008-pos-venda-pg-cron-vs-vercel-cron.md) — Vercel Hobby limita cron a 1x/dia; agendar no Supabase pg_cron
- [009 Hardening segurança](decisions/009-hardening-seguranca-2026-05-19.md) — pentest interno: master takeover anon, backup público, storage anon — fechados

## Fontes

- [Spec IA WhatsApp v2](../superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md) — 4 extensões do agente IA + ingest (2026-05-18)
