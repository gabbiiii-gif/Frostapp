# Log

Append-only. Prefixo consistente para parsing: `## [YYYY-MM-DD] tipo | título`.

Tipos: `ingest` | `query` | `lint` | `bootstrap`.

## [2026-05-10] bootstrap | wiki inicializado
- criado: docs/raw/, docs/wiki/
- criado: docs/wiki/index.md (vazio com categorias)
- criado: docs/wiki/log.md (este arquivo)
- próximo passo: humano dropa primeira fonte em docs/raw/ e pede ingest

## [2026-05-10] ingest | concepts/ db-layer + supabase-sync + role-permissions
- gatilho: humano pediu páginas pra concepts/
- fontes lidas: src/App.jsx (140-650, ALL_MODULES, hasPermission), src/supabase.js (inteiro)
- novas páginas (3):
  - concepts/db-layer.md — pipeline DB.*, scope, audit, auto-backup
  - concepts/supabase-sync.md — auth, kv_store/RLS, Realtime, Storage os-fotos, Edge Functions
  - concepts/role-permissions.md — ROLE_PERMISSIONS, hasPermission, customPermissions
- index atualizado: 3 entradas em "Conceitos"; restantes (data-table, document-generators, totp-2fa, master-tier) marcados como candidatos
- descobertas marcadas inline:
  - SCOPED_PREFIXES ainda lista módulos removidos (webdesk/invoice/pdv/banking/transferencia/notificacao/inventory) — candidato a limpeza
  - master:user:* TODO documentado em supabase.js (mover criação pra Edge Function com claim is_super_admin)
  - gerente tem "config" em ROLE_PERMISSIONS mas é overridden pelo gate específico de Settings — armadilha
  - customPermissions: [] (array vazio) bloqueia tudo, ≠ undefined — armadilha

## [2026-05-10] config | Obsidian aponta pra raiz do projeto
- decisão: raiz do projeto (Frostapp-main/) = cofre Obsidian (sem cofre separado)
- humano abre Frostapp-main/ como vault → docs/wiki/ aparece como pasta normal
- wikilinks já estão relativos `[[../concepts/...]]` — Obsidian resolve nativo
- .gitignore: ignorado workspace*, cache, graph.json (estado UI pessoal)
- CLAUDE.md: nova subseção "Obsidian como IDE do wiki" abaixo de Bootstrap
- plugins recomendados (instalar manual no Obsidian): Dataview, Templater, Obsidian Git

## [2026-05-10] ingest | reverso de App.jsx → modules/
- gatilho: humano pediu "ingest reverso do App.jsx pra modules/"
- fonte: src/App.jsx (12.228 linhas) + CLAUDE.md (já corrigido)
- novas páginas (7): modules/dashboard.md, finance.md, process.md, schedule.md, cadastro.md, settings.md, tecnico-mobile.md
- index atualizado: 7 entradas em "Módulos"; candidatos listados em Conceitos/Fluxos/Decisões pra próximos ingests
- code_refs usam `src/App.jsx#FuncName` + linha (linha pode driftar; nome é estável)
- lacunas marcadas `[a expandir]` em cada página — não inventei detalhes que não verifiquei
- não criados ainda: pastas concepts/ flows/ decisions/ sources/ (lazy bootstrap quando primeira página dessas existir)

## [2026-05-10] lint | CLAUDE.md vs. App.jsx
- gatilho: humano observou módulos defasados na documentação
- discrepâncias encontradas em CLAUDE.md (corrigidas):
  - tamanho App.jsx: dizia ~7600, real 12.228 linhas
  - módulos: dizia 11, real 6 (Dashboard, Process, Schedule, Finance, Cadastro, Settings)
  - removidos do código (ainda listados): InventoryModule (→ folded em Cadastro), InvoiceModule (→ generateOrcamentoHTML/OSHTML/ReciboHTML), PDVModule, WebdeskModule, BankingModule, MessageCenter
  - "no test runner" → na verdade Vitest está configurado (npm run test, utils.test.js)
  - tech stack incompleto: faltavam animejs, qrcode, vite-plugin-pwa, vitest, @testing-library, happy-dom
  - faltavam seções inteiras: Master tier (multi-tenant), TOTP/2FA, escopo por empresa, audit trail, calendar feed serverless, document generators, ErrorBoundary/ModuleSwitcher
  - linhas de seção todas defasadas → reescritas com base em grep
- ação: CLAUDE.md atualizado em 3 blocos (Build/Tech Stack; Architecture inteira; Animation/Working with)
- preservado: Wiki do Projeto, Regras Obrigatórias, Supabase Sync section, idioma pt-BR, animation components

## [2026-05-10] ingest | concepts restantes + flow OS + ADRs 001-006
- gatilho: humano disse "pode fazer o que tem que ser feito" após outline
- fontes lidas: src/App.jsx (1571-1750 DataTable, 4385-4910 doc generators, 833-955 TOTP+hash, 2889-3320 MasterApp)
- novas páginas (10):
  - concepts/data-table.md — contrato, sort/pagination, armadilhas
  - concepts/document-generators.md — openHTMLDoc, _h XSS guard, _pixBlock defaults hardcoded, geração HTML imprimível
  - concepts/totp-2fa.md — PBKDF2 100k, RFC 6238 ±1 step, base32, migração lazy de hash legado
  - concepts/master-tier.md — schema master:user:*, MasterApp ações, exclusão cascata SCOPED_PREFIXES, TODO Edge Function
  - flows/os-tecnico-aprovacao.md — 8 etapas: criação→atribuição→chegada→exec→finalizar→revisão→backfill finance→docs
  - decisions/001-single-file-app.md — monolito até dor real
  - decisions/002-window-storage-sem-orm.md — KV + sync 1:1 Supabase
  - decisions/003-sem-router.md — useState(activeModule), sem deep-link
  - decisions/004-pt-br-no-codigo.md — UI/comentários/status pt-BR; sem i18n
  - decisions/005-modulos-removidos.md — Inventory/Invoice/PDV/Webdesk/Banking/MessageCenter consolidados; SCOPED_PREFIXES legado é defesa
  - decisions/006-master-tier-multi-tenant.md — dívida técnica documentada (XSS escala cross-tenant)
- index atualizado: 7 entradas em Conceitos, 1 em Fluxos, 6 em Decisões
- descobertas inline: PIX hardcoded em document-generators (THIAGO/Sicredi); _h XSS guard exigido em todo template literal; verifyTotp não tem throttling (lacuna); MasterApp bypassa DB.set por design (companyId null em sessão master)

## [2026-05-18] ingest | Agente IA WhatsApp v2 + Pos-Venda
- source: docs/superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md
- new pages: modules/pos-venda.md, modules/ia-atendimento.md, flows/whatsapp-ia-os.md, concepts/evolution-multitenant.md, decisions/007-ia-os-aprovacao-humana.md
- touched: index.md (2 Modulos, 1 Conceito, 1 Fluxo, 1 Decisao, 1 Fonte)
- contexto: v2 = audio Whisper + imagem vision + Storage ai-media + propose_os/aprovacao humana + multi-empresa por evolution_instance
