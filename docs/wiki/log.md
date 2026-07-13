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

## [2026-05-18] ingest | Pós-Venda: Vercel Cron → Supabase pg_cron
- gatilho: deploy Vercel falhou no merge da v2 — plano Hobby limita Cron Jobs a 1x/dia, `*/15 * * * *` rejeitado
- ação: removido bloco `crons` do vercel.json; criado docs/ai-agent/04-pos-venda-pg-cron.sql (pg_cron + pg_net chamam pos-venda-dispatch, x-dispatch-key via Vault)
- new pages: decisions/008-pos-venda-pg-cron-vs-vercel-cron.md
- touched: modules/pos-venda.md (componentes + code_refs + frontmatter), index.md (1 Decisao)
- pendente operador: rodar o .sql no SQL Editor do Supabase prod (substituir <PROJECT_REF>/<DISPATCH_KEY>)

## [2026-05-19] config | Pós-Venda pg_cron aplicado via MCP + auth por Vault
- gatilho: deploy Vercel verde; usuário rodou SQL no projeto errado (frostApp INACTIVE) → pediu "faça tudo via MCP"
- prod confirmado: frostapp2.0 (ref rbwzhglsztmjvwrcydcy); frostApp (hewsltabdygpwcfdcczg) INACTIVE/pausado
- auth mudou: chave via Vault (RPC public.pos_venda_dispatch_key, security definer/service_role) em vez de só env — Edge Function v2 redeployada (expected = env ?? rpc)
- aplicado via MCP: extensões pg_cron+pg_net, vault secret, RPC, cron.job jobid=1 (*/15, active)
- smoke test: 200 {"skipped":"evolution_nao_configurada","sent":0} — auth Vault OK
- touched: supabase/functions/pos-venda-dispatch/index.ts, docs/ai-agent/04-pos-venda-pg-cron.sql, decisions/008, modules/pos-venda.md
- nenhum passo manual pendente; segredo real só no Vault (não no repo)

## [2026-05-19] config | Hardening de segurança (pentest interno)
- gatilho: usuário pediu review pentest do próprio app
- achados: 3 críticos não-auth (master takeover via master_lookup_by_email+master_set_session; tabelas backup públicas sem RLS; storage os-fotos anon upload/delete) + alto (pos_venda sem escopo, os-fotos listagem) + médios
- aplicado via MCP (migrações sec_*): REVOKE master_* de anon/authenticated; RLS lockdown backups; storage policies só authenticated; pos_venda_* company_id default user_company_id()+policy escopada; set_updated_at search_path
- residual aceito/follow-up: pg_net em public (não movido p/ não quebrar cron), leaked-pwd protection (manual Auth), os-fotos sem escopo por empresa, XSS print docs não auditado, validar login master via Edge no app
- new pages: decisions/009-hardening-seguranca-2026-05-19.md; touched: index.md
- verificação: dispatcher smoke 200 pós-RLS; anon_can_master_lookup=0; policies trocadas confirmadas

## [2026-05-21] ingest | integração WhatsApp — Edge Function + envio de OS
- gatilho: implementação do spec 2026-05-20-whatsapp-webhook-edge-function-design.md
- mudança: n8n substituído pela Edge Function whatsapp-webhook (Claude Haiku 4.5)
- infra: VPS Hetzner Evolution API v2.3.7 (162.55.58.199), tabela ai_os_proposals,
  bucket ai-media, coluna ai_agent_config.metadata, linha cmp_default/frost-minas
- novo: src/App.jsx botões "Enviar orçamento/OS (WhatsApp)", helper
  buildOSWhatsAppResumo (utils.js), sendWhatsAppMedia (platform.js)
- touched: concepts/evolution-multitenant.md, flows/whatsapp-ia-os.md

## [2026-05-21] ingest | módulos por empresa (MasterApp)
- gatilho: implementação do spec 2026-05-21-modulos-por-empresa-design.md
- novo: campo company.allowedModules; helper isModuleEnabledForCompany (utils.js);
  TOGGLEABLE_MODULES + filtro navItems + fallback activeModule (App.jsx);
  checkboxes no formulário de empresa do MasterApp
- touched: concepts/role-permissions.md

## [2026-06-01] ingest | IA WhatsApp: Sonnet 4.6 + reconhecer cliente + descontos + aviso de aprovação
- gatilho: usuário pediu (1) nome primeiro + primeiro nome sempre; (2) corrigir desconto de aniversário dado fora do mês; (3) saber se cliente já contatou antes; (4) WhatsApp ao aprovar OS; (5) desconto p/ cliente novo. Também: subir versão do modelo.
- modelo: whatsapp-webhook MODEL claude-haiku-4-5 → claude-sonnet-4-6 (deploy v9)
- tools: nova get_customer (lookup cliente por telefone no kv_store); discount_note no propose_os
- fix kv_store: get_recent_os/get_customer usam kvList() (escopado + fallback bare). Prefixo antigo `${company_id}:erp:os:` nunca achava nada (dados de prod são bare `erp:os:`). frost-update-birthday tem o mesmo bug de prefixo (cmp_cmp_default) — marcado, não corrigido (órfão).
- desconto aniversário (bug): calculado em código (aniversarioMesAtual, fuso Brasília) + data de hoje injetada no prompt (== CONTEXTO ATUAL ==). Prompt só oferece se aniversario_mes_atual=true.
- descontos: aniversariante e 1º serviço, ambos 15% à vista, não acumulam. discount_note → observacoes da OS (createOSFromProposal).
- system_prompt (ai_agent_config, cmp_default): reescrito — nome primeiro, get_customer no início, regras de desconto corretas.
- aprovação: nova Edge frost-notify-approval (verify_jwt=true, valida admin/gerente ativo) envia WhatsApp ao cliente + grava em ai_messages. approveProposal (App.jsx) invoca fire-and-forget.
- testes: utils.test.js +2 (discount_note); 60/60 verdes. build Vite OK.
- touched: modules/ia-atendimento.md, CLAUDE.md (tabela Edge Functions), src/utils.js, src/utils.test.js, src/App.jsx, supabase/functions/whatsapp-webhook, supabase/functions/frost-notify-approval
- PENDENTE OPERADOR: deploy do frontend na Vercel (mudanças em App.jsx/utils.js não estão num repo git aqui). Edge functions + system_prompt já estão live.

## [2026-06-01] ingest | handoff humano pelo WhatsApp (sem app)
- gatilho: usuário quer que o operador assuma a conversa respondendo direto no WhatsApp, sem entrar no app, sem conflito de resposta com a IA
- mecanismo: webhook passou a tratar eventos fromMe (handleOperatorMessage). Operador responde manual → status='pending_human' (Gate 1 já pausava a IA). Comando '#ia' (REENABLE_COMMAND) → status='active'. Eco da própria IA/aprovação reconhecido por comparação de texto com as últimas 5 msgs role=agent (a resposta é gravada antes do envio → eco chega depois, sem race).
- sem mudança de schema: reusa ai_conversations.status + whatsapp_processed_messages. Backup: botão "Reativar IA" no app.
- deploy: whatsapp-webhook v10. commit/push main.
- touched: supabase/functions/whatsapp-webhook/index.ts, modules/ia-atendimento.md

## [2026-07-12] ingest | resumo do dono geral + fixes Pós-Venda + auditoria multi-empresa
- gatilho: usuário pediu (1) resumo do dono virar panorama geral sem inventar dados; (2) auditar o Pós-Venda e ver se é eficaz
- resumo do dono (Lembrete): montarFatosDono() em lembrete-dispatch + lembrete-teste — OS abertas por status + manutenções vencendo + visitas agendadas (sempre, independe de agendados_ativo) + total de clientes. IA recebe só os fatos com instrução de não inventar; fallback determinístico. Deploy MCP: lembrete-dispatch v6 (verify_jwt=false), lembrete-teste v5 (verify_jwt=true). commit/push main.
- fix Pós-Venda #1: scheduleOSPosVenda não roda mais na criação de OS da IA (criarOSdeProposta) — NPS caía em now+24h antes do serviço. Só na finalização. commit/push main → Vercel.
- fix Pós-Venda #2: removido toggle "Proposta de reagendamento" da UI (ConfigTab) — nenhum gerador cria mensagens tipo reagendamento; era promessa vazia. Intenção reagenda continua indo pro Inbox.
- auditoria #4 (verificado via MCP, prod rbwzhglsztmjvwrcydcy): tabelas pos_venda_* têm company_id mas pos-venda-dispatch ignora em todas as queries (config .maybeSingle sem filtro; ai_agent_config .limit(1); fila sem company_id). Bug LATENTE — hoje 1 empresa com pós-venda + 1 ai_agent_config enabled (2 existem). Quebra quando 2ª empresa ligar. NÃO corrigido (fora do escopo "investigar"). lembrete-dispatch tem o mesmo germe no fetch de ai_agent_config.
- touched: modules/pos-venda.md (scheduleOSPosVenda + nova seção "Dívida: dispatcher não é multi-empresa"), src/App.jsx, src/modules/PosVendaModule.jsx, supabase/functions/lembrete-dispatch, supabase/functions/lembrete-teste
- PENDENTE (a decidir com usuário): corrigir escopo multi-empresa do dispatcher; reagendamento automático de verdade (feature nova, precisa design)
