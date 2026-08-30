# Log

Append-only. Prefixo consistente para parsing: `## [YYYY-MM-DD] tipo | título`.

Tipos: `ingest` | `query` | `lint` | `bootstrap`.

## [2026-05-10] bootstrap | wiki inicializado
- criado: docs/raw/, docs/wiki/
- criado: docs/wiki/index.md (vazio com categorias)
- criado: docs/wiki/log.md (este arquivo)
- próximo passo: humano dropa primeira fonte em docs/raw/ e pede ingest

## [2026-07-22] feature | Travamento por aparelho — Fase 1
- spec: docs/superpowers/specs/2026-07-22-device-locking-servidor-terminais-design.md
- plan: docs/superpowers/plans/2026-07-22-device-locking-fase-1.md
- new pages: concepts/device-locking.md
- touched: index.md
- entregue: member_devices + device_sessions; edges device-enroll/verify/master-devices; painel Aparelhos no MasterApp; portão no login (soft)
- pendente: aplicar migration + deploy das edges (credenciais); Fases 2-5 (hardware, RLS total, rename Servidor/Terminais, offline)

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
- PENDENTE (a decidir com usuário): reagendamento automático de verdade (feature nova, precisa design)

## [2026-07-12] fix | dispatchers escopados por company_id (multi-empresa)
- gatilho: usuário aprovou corrigir a dívida #4 da auditoria do pós-venda
- pos-venda-dispatch: reestruturado de "1 config global + 1 evo + toda a fila" para iterar por empresa (pos_venda_config por company_id) e escopar ai_agent_config/fila/updates por company_id. Retorno agora { sent, failed, processados, skipped{company_id:motivo} }. `ativo` null preservado como ativo. Deploy MCP v14.
- lembrete-dispatch: fetch de ai_agent_config ganhou .eq("company_id", companyId) (mesmo germe). Deploy MCP v7.
- verificação: esbuild OK nos dois; SQL confirmou empresa ativa cmp_default (ativo, modo auto, 1 evo enabled, 11 na fila) → sem regressão. commit/push main efe369d.
- touched: supabase/functions/pos-venda-dispatch/index.ts, supabase/functions/lembrete-dispatch/index.ts, modules/pos-venda.md (seção dívida → corrigido)

## [2026-07-12] feat | reagendamento automático do pós-venda (propõe data, humano fecha)
- gatilho: usuário aprovou implementar o reagendamento (única pendência da auditoria); brainstorm → opção A (propor data + humano fecha), data = próxima visita
- spec: docs/superpowers/specs/2026-07-12-reagendamento-automatico-pos-venda-design.md
- App.jsx scheduleOSPosVenda: se enviar_reagendamento, pré-renderiza template reagendamento e grava metadata { data_sugerida, reagendamento_conteudo } na linha do lembrete
- PosVendaModule: toggle "Proposta de reagendamento" re-adicionado (hint verdadeiro) + volta ao payload
- whatsapp-webhook handlePosVendaReply: resposta positiva a lembrete → envia proposta na hora + grava linha reagendamento (enviada); idempotente por os_id, sem loop, pula ack; resposta a reagendamento → precisa_humano (Inbox)
- verificação: esbuild OK (webhook), build Vite OK. commit/push main 9a2ae96.
- DEPLOY: whatsapp-webhook deployado pelo usuário via CLI (`supabase functions deploy whatsapp-webhook --no-verify-jwt`) → v18, 2026-07-13. verify_jwt=false confirmado via MCP; conteúdo live == código commitado (deploy do arquivo real, sem transcrição). Frontend (App/PosVenda) via Vercel. Feature 100% no ar.
- Nota de operação: para o fluxo disparar, ligar o toggle "Proposta de reagendamento" em Pós-Venda → Configurações (só lembretes agendados DEPOIS carregam o metadata da proposta).
- touched: src/App.jsx, src/modules/PosVendaModule.jsx, supabase/functions/whatsapp-webhook/index.ts, specs/2026-07-12-reagendamento-automatico-pos-venda-design.md, modules/pos-venda.md

## [2026-08-05] ingest | Módulo Relatórios
- source: docs/superpowers/specs/2026-08-04-modulo-relatorios-design.md, docs/superpowers/plans/2026-08-05-modulo-relatorios.md
- new pages: modules/relatorios.md
- touched: index.md
- decisions: engine puro client-side (spec declarativo) em vez de SQL sobre kv_store; IA traduz a consulta e nao calcula; PDF binario entrou na v1 (html2pdf ja era dependencia); DataTable nao reusavel (import circular), modulo tem tabela propria

## [2026-08-27] feat | Frost Fase 4 no caminho vivo: propose_os, handoff_to_human e debounce
- gatilho: usuário pediu "terminar propose_os e handoff_to_human, e adicionar o debounce" + análise de erros
- contexto: a Fase 4 estava especificada pro n8n (CLAUDE.md) mas o agente vive na Edge `whatsapp-webhook` desde 2026-06-01. As 4 edge functions `frost-*` são órfãs (nada as chama) — implementado no caminho vivo, não nelas.
- propose_os: valida campos obrigatórios antes de gravar (espelha validateOSProposal, rótulos pt-BR pro modelo); idempotente por conversa (atualiza pendente + merge de media_urls em vez de duplicar); status='pending_approval' explícito; email pra admin/gerente via send-email.
- handoff_to_human: status='pending_human' + ai_handoff_reason gravados DENTRO da tool. BUG corrigido: o status era setado depois de `if (!resposta) return` — modelo que chamava a tool sem texto deixava a conversa 'active' com aviso na tela e a IA seguia respondendo por cima do atendente. Email pra admin/gerente.
- debounce: novo `debounce.ts` puro (janelaDebounceMs, souAUltimaMensagem) + 10 testes Vitest. Janela DEBOUNCE_SECONDS (padrão 12s, 0 desliga, teto 120s), posicionado entre Gate 1 e Gate 2; compara id de ai_messages (não timestamp).
- fotos da rajada: histórico anexa imagens de mensagens do cliente posteriores à última resposta do agente (teto 3), baixando do bucket privado ai-media com service_role (baixarImagemBase64). Sem isso o debounce regrediria o caso foto+texto.
- tarefasPosResposta: efeitos colaterais das tools (emails) rodam depois do envio ao cliente — não atrasam a conversa, não viram promessa órfã sob waitUntil.
- fixes de arrasto: last_message_at bumpado no upsert (default só vale no INSERT → Inbox nunca reordenava); unread_count incrementado (bumpUnread); notifyPosVendaHumano passou a escapar HTML do texto do cliente.
- verificação: esbuild OK; vitest 367/367 (22 arquivos, +10 novos); vite build OK.
- touched: supabase/functions/whatsapp-webhook/index.ts, supabase/functions/whatsapp-webhook/debounce.ts (novo), debounce.test.ts (novo), modules/ia-atendimento.md, CLAUDE.md
- PENDENTE OPERADOR: `supabase functions deploy whatsapp-webhook --no-verify-jwt`; (opcional) `supabase secrets set DEBOUNCE_SECONDS=12`. Sem deploy nada disso está no ar.
- PENDENTE (a decidir): as 4 edge functions frost-* órfãs — apagar ou corrigir. Bugs: frost-handoff grava status='handoff' que viola o CHECK de ai_conversations (500 sempre); frost-propose-os grava payload pt-BR que o painel de aprovação não lê; frost-conversation faz INSERT em conversa 'closed' violando o UNIQUE (company_id, customer_phone).

## [2026-08-27] fix+feat | Dashboard (KPIs zerados + filtro de período) e Fechamento mensal
- gatilho: usuário relatou dashboard quase todo zerado, filtro 7/30/90/tudo/personalizado sem efeito, e pediu que o mês encerrado ficasse arquivado e consultável pelo Relatórios
- CAUSA RAIZ dos zeros: Dashboard comparava os.status com "em_andamento"/"pendente"/"concluido" — valores que o ProcessModule NUNCA grava (fluxo real: aguardando → em_deslocamento → em_execucao → finalizado, + em_servico/aguardando_finalizacao do app do técnico). O donut "OS por status" listava justamente os 3 inexistentes.
- correção: agrupamentos viraram fonte única em constants.js (STATUS_OS_EM_ANDAMENTO, STATUS_OS_PENDENTES, STATUS_OS_CONCLUIDAS, STATUS_OS_EM_REVISAO, STATUS_OS_ENCERRADAS_SEM_SERVICO), com legados inclusos p/ bases antigas e seed.
- CAUSA RAIZ do filtro morto: `dateFilter` chegava como prop e nunca era usado (ESLint já apontava "defined but never used"). Agora vale para OS abertas, concluídas (por dataConclusao, não abertura), receita/despesa, taxa de conclusão e donut. Rótulos estampam o recorte; "em andamento"/"aguardando" seguem sendo estado atual de propósito.
- taxa de conclusão: base era estado atual de todos os tempos misturado com recorte do mês; virou "das OS abertas no período, quantas fecharam".
- NOVO Fechamento mensal: src/lib/fechamento-mensal.js (puro, 21 testes — fronteira de mês, fevereiro bissexto, atribuição por data de conclusão). ensureFechamentoMensal() no boot sela cada mês encerrado em `erp:fechamento:<AAAA-MM>` (novo SCOPED_PREFIX → escopo por empresa + audit + sync). Idempotente, nunca reescreve, pula mês sem movimento.
- Relatórios: nova fonte "fechamentos" no registry (datasets.js) → busca e pergunta em pt-BR acham o histórico ("como foi julho?"). datasets.test.js atualizado (14 → 15 fontes).
- landing: seção Planos (3 cartões + tabela comparativa) entre FAQ e CTA + link no menu. Fonte: docs/raw/planos-frosterp.pdf (valores Bronze 79/65, Prata 159/129, Ouro 279/229; IA 150 atend/mês, excedente R$ 0,90).
- demo: load sem ?demo=1 encerra a demo na aba — a flag de sessão ficava presa e o app real na mesma aba caía sem sessão ("Sua sessão expirou"). Regressão introduzida pelo isolamento da demo do mesmo dia.
- chore: CLI do Supabase virou devDependency + scripts npm (sb:login, deploy:webhook, deploy:fn) — não estava instalado na máquina.
- verificação: vitest 388/388 (23 arquivos, +21 novos); vite build OK; markup da landing balanceado.
- touched: src/App.jsx, src/constants.js, src/demo.js, src/lib/fechamento-mensal.js (novo), src/lib/relatorios/datasets.js, landing/index.html, package.json, CLAUDE.md, modules/dashboard.md
- PENDENTE OPERADOR: `npm run sb:login` (uma vez) + `npm run deploy:webhook` — a Fase 4 do agente WhatsApp ainda não está no ar.

## [2026-08-27] fix | Auditoria da demo: duplicação, módulos de IA, e correção de doc que causou o bug
- gatilho: usuário pediu auditoria da demo com atenção a erros; reportou clientes/funcionários duplicados
- CAUSA RAIZ da duplicação: resetDemoData() varria o storage por chaves com prefixo `cmp_cmp_demo:` — formato que o DB.set NUNCA produz. Só SCOPED_SINGLETONS são reescritos, e como SUFIXO (`erp:config:cmp_default`). Registros normais ficam com a chave literal e o escopo vem do CAMPO `companyId` (DB.set carimba, DB.list filtra). O reset não apagava nada, mas apagava `erp:seeded` → seedDatabase rodava de novo e empilhava um 2º lote.
- correção: em demo o window.storage já é Map em memória exclusivo → resetDemoData faz clear(). Guarda OBRIGATÓRIA `if (!isDemoMode()) return` — fora da demo esse objeto é o localStorage real e um clear() apagaria a empresa. Teste cobre os dois lados.
- ORIGEM DO BUG: CLAUDE.md afirmava que chaves escopadas viram `cmp_<id>:<key>`. Era falso e induziu o código. Seção "Multi-tenancy and scoping" reescrita com o comportamento real (campo vs. prefixo, sufixo nos singletons, coluna company_id no kv_store) + aviso explícito citando este bug. O wiki (concepts/db-layer.md) já estava correto — não precisou de mudança.
- módulos fora da demo: além de IA/Atendimento, agora Pós-venda, Lembrete e Relatórios — os três chamam a API do Claude e um visitante queimaria token à toa. Aviso virou componente DemoModuloIndisponivel (motivo específico por módulo + CTA pro WhatsApp da equipe).
- demo.test.js reescrito: cada caso reimporta demo.js via vi.resetModules(). markDemoStarted fixa a demo pro resto da vida do módulo (contrato intencional), e isso vazava entre testes.
- auditoria sem achados (documentado): outbox usa localStorage direto MAS syncToSupabase/deleteFromSupabase barram a demo antes de enfileirar; evolution-manage (verify_jwt=false) valida caller internamente; webhook n8n de status de OS não existe mais; edge functions verify_jwt=true dão 401 sem sessão; uploads de Storage barrados por RLS.
- PENDENTE (não feito, a decidir): ensureFechamentoMensal() não roda no boot da demo (caminho separado), então a fonte "Fechamentos mensais" fica vazia lá. Irrelevante enquanto Relatórios estiver fora da demo.
- verificação: vitest 396/396; vite build OK.
- touched: src/demo.js, src/demo.test.js, src/App.jsx, CLAUDE.md

## [2026-08-30] feature | Landing: entrada lateral no scroll, floco discreto e ScrollStack em #dores
- gatilho: usuário pediu (a) seção entrando pela lateral em fade preso ao scroll, (b) "o floco está atrapalhando ver essa seção", (c) o `<ScrollStack />` do React Bits na seção "O que custa caro hoje?"
- a landing é HTML estático + GSAP: `npx shadcn add` não tem onde instalar. ScrollStack foi PORTADO pra vanilla no fim do `scroll.js`, sem Lenis (brigaria com o ScrollTrigger da cena 3D), com `offsetTop` no lugar de `getBoundingClientRect` (o rect realimenta o próprio transform) e espaçador de 36vh (o `pinEnd` do original assume cartões de 20rem; com os nossos de ~104px o 3º cartão não encaixava em tela alta)
- floco: 2ª vez que cartão translúcido (`rgba(255,255,255,.025)`) deixa a cena 3D aparecer ATRAVÉS do conteúdo — antes só `.plano` tinha sido corrigido. Token `--card` agora vale pra `.pain`, `.mod`, `.mod-card`, `.faq-item`, `.glass`, `.car-arrow`; hover/active viram camada de tinta sobre a base opaca
- `frostScene.setDim(0..1)` novo: opacidade relativa do floco por seção, lida de `data-dim` na `.panel` (demo 0.22, planos 0.25, dores/solucao 0.6, faq 0.55)
- verificação: vitest 406/406; matemática do pin simulada de 640px a 1440px de altura (3 cartões encaixam em todas); IIFE do ScrollStack executada contra o DOM real via happy-dom sem erro
- touched: landing/index.html, landing/scroll.js, landing/scene3d.js, concepts/landing-scroll-3d.md (nova), index.md

## [2026-08-30] feature | Landing: CardSwap com telas do app na seção "Veja como funciona"
- gatilho: usuário pediu o `<CardSwap />` do React Bits na seção e mandou 11 capturas de tela do app
- mesma história do ScrollStack: landing é HTML estático, `npx shadcn add` não aplica. Portado pra vanilla no `scroll.js`. O CardSwap já depende de GSAP (que a landing carrega), então a matemática dos slots veio inteira
- PRIVACIDADE: 3 das 11 capturas tinham dado real — IA/Atendimento e Pós-Venda com nome e telefone de clientes da MINAS REFRIGERAÇÃO, Folha de Pagamento com nomes de funcionários e valores. Sinalizado ao usuário, que mandou tirar. Ficaram 8 telas. `landing/screens/README.md` registra a regra (capturar sempre em `?demo=1`)
- as imagens ainda NÃO estão no repo: só o README. O JS pré-carrega cada `data-src` e a vitrine se apaga sozinha enquanto não houver 2 telas — dá pra ir soltando os PNGs sem quebrar a seção no ar
- bug pego no teste: o código checava `"IntersectionObserver" in window` mas chamava o identificador solto. Passa no browser por acaso (é global) e explode em qualquer contexto onde só o `window` tem a propriedade. Trocado por `window.IntersectionObserver`
- layout: uma coluna é o estado BASE do `.demo-top`; a 2ª só aparece via `:has(.demo-shots.ready)`. Sem `:has()` ou sem imagens, fica coluna única — que é o layout mobile e funciona
- verificação: vitest 406/406; CardSwap executado contra o DOM real via happy-dom com GSAP dublado — 8 telas declaradas viram pilha de 5, `.ready` só liga depois da carga, timeline com 6 `to` (1 queda + 4 promoções + 1 retorno), rodízio troca a tela do cartão caído. Caso de degradação testado à parte: sem nenhuma imagem os cartões somem e o carrossel/heading continuam
- NÃO verificado: aparência. Sem browser headless no projeto — posições e escalas do `CFG` são chute informado
- touched: landing/index.html, landing/scroll.js, landing/screens/README.md (novo), concepts/landing-scroll-3d.md

## [2026-08-30] fix | Landing: modo `?preview=1` pra ver o CardSwap sem as telas
- gatilho: usuário reportou "não tem as telas, aparentemente nada mudou"
- diagnóstico por curl: o deploy ESTAVA no ar (index.html e scroll.js publicados com todos os marcadores novos); as 8 imagens em /screens/ dão 404 porque nunca foram para o repo. A vitrine se escondendo era o fail-soft funcionando
- limitação de fundo: as capturas foram coladas no chat, não existem como arquivo. Não há como o agente gravar os bytes em disco — só o usuário pode pôr os PNGs em `landing/screens/`
- `?preview=1` desenha cartões de mentira (sidebar + cabeçalho falsos + nome do módulo) no lugar das telas ausentes, pra conferir geometria e ritmo da pilha ANTES de exportar 8 imagens. Visitante sem o parâmetro continua caindo no caminho normal (vitrine escondida)
- verificação: happy-dom nos dois caminhos — sem parâmetro 0 cartões e `.ready` false; com `?preview=1` pilha de 5 mocks, `.ready` true e a nota trocada pra "PRÉVIA"
- touched: landing/scroll.js, landing/index.html

## [2026-08-30] feature | Landing: as 8 telas do CardSwap entraram no repo
- usuário soltou 11 JPEGs em `landing/screens/` com nome de WhatsApp. Identificadas uma a uma abrindo cada arquivo; renomeadas pros nomes que o `index.html` espera
- 3 ficaram FORA: IA/Atendimento e Pós-Venda (nome + telefone de clientes reais) e Folha de Pagamento (nomes de funcionários e valores). Movidas pra `docs/raw/telas-com-dados-reais/`, que entrou no `.gitignore`
- por que mover e não só deixar de referenciar: a Vercel serve TUDO que está em `landing/`. Arquivo parado ali vira URL pública mesmo sem estar no HTML — bastava alguém adivinhar o nome
- formato: as capturas vieram JPEG (WhatsApp), não PNG. `data-src` trocado de `.png` pra `.jpg`
- altura do cartão 264px → 240px: as capturas são 1600×~750 (~2,1:1) e com `object-fit:cover` a 264px o recorte comia 18% da direita; a 240px cai pra ~10%
- verificação: os 8 `data-src` batem com arquivo existente em disco; happy-dom confirma pilha de 5 com os `.jpg` certos e rodízio entrando em Relatórios; `git diff --cached` confirma que nenhuma das 3 telas sensíveis foi pro commit
- touched: landing/screens/ (8 jpg novos + README), landing/index.html, .gitignore

## [2026-08-30] fix | Landing: pilha do CardSwap saía da moldura em tela estreita
- gatilho: usuário mandou print com os cartões cortados na direita — "joga mais pra trás ou pra cima"
- causa: a geometria era fixa (cardDistance 56 em qualquer largura) e a pilha se abre PRA DIREITA. Em moldura estreita a caixa passava da borda e o `overflow:hidden` cortava
- `measure()` novo: lê `clientWidth/Height` da moldura e `offsetWidth/Height` do cartão, escolhe a faixa por media query e então APLICA UMA TRAVA — `distX ≤ (moldura − cartão − 16)/span`. Não tem largura em que estoure
- em tela estreita a pilha agora RECUA (z) e SOBE (y) em vez de abrir pro lado, que era o pedido. Por isso `z` foi separado de `x`: no React Bits z é sempre `distX*1.5`, então encolher o avanço lateral encolhia junto a profundidade e a pilha virava um cartão só
- o JS passou a ser dono do `transform` do palco (o CSS só guarda a `perspective`). A base do cartão da frente é assentada em 80% da altura da moldura: a máscara esvai a partir de 82% e o cartão que se lê não pode cair dentro dela
- `stackSize` 5 → 3. Simulação em 16 resoluções mostrou que com 4+ a separação vertical cai abaixo de 28px em laptop e a pilha achata. Com 3 fica entre 32 e 46px em todas
- breakpoint por ALTURA (`max-height:820px` e `660px`) além dos de largura: 1366×768 é largo mas baixo, e a moldura é 50vh — cartão alto demais não deixava os degraus aparecerem
- `resize` refaz as contas e reassenta a pilha (girar o celular)
- verificação: geometria simulada em 16 resoluções de 320×568 a 1920×1080 — todas cabem na horizontal e na vertical, com a base do cartão da frente acima da linha de fade; happy-dom confirma pilha de 3 e rodízio
- touched: landing/scroll.js, landing/index.html

## [2026-08-30] feature | Landing: carrossel de módulos vira ScrollStack (e ganha os 4 que faltavam)
- gatilho: "quero tirar o peso do usuário ter que clicar para ver sobre o módulo, faça igual na seção custa caro hoje"
- o carrossel escondia conteúdo atrás de uma descoberta ("dá pra clicar"): quem só rolava via 1 módulo de 13. Trocado pelo mesmo ScrollStack da seção de dores
- ACHADO no meio do caminho, apontado pelo usuário: a lista da landing estava desatualizada em 4 — Lembrete, Folha de Pagamento, Ponto Eletrônico e Relatórios existem no `navItems` de `src/App.jsx` e não apareciam. Agora são 13 cartões (12 do ERP + a oferta sob medida), conferidos um a um contra o `navItems`
- descrições dos 4 novos escritas a partir do código, não inventadas: Ponto (facial + geofence + banco de horas + ocorrências), Folha (INSS/IRRF/FGTS por tabela 2026, vale descontado no mês seguinte), Relatórios (motor genérico, builder ou pergunta pt-BR, CSV/imprimível/WhatsApp), Lembrete (90d PJ / 180d PF, aviso antes de vencer)
- efeito colateral bom: os módulos passaram a existir no HTML estático. Antes viviam só no objeto `MODS` do `scroll.js` e entravam por `innerHTML` — invisíveis pra buscador e pra quem está sem JS
- `CFG` do ScrollStack virou `PADRAO` + `cfgDe(root)` lendo `data-*`. 3 cartões baixos e 13 altos não aceitam os mesmos números
- duas travas que os 13 impuseram: `itemScale` caiu pra 0.008 (a fórmula `baseScale + i*itemScale` do React Bits passaria de 1 com 0.03, deixando o cartão do topo MAIOR que o da frente) e o desfoque ganhou teto `blurMax` (`profundidade * blurAmount` é ilimitado no original; com 12 níveis o fundo virava mancha)
- removidos: IIFE do carrossel no `scroll.js` (MODS, renderDetail, initCarousel) e o CSS de `.carousel/.car-track/.car-arrow/.mod-card`. A base do pill subiu de `.mod-card .tag` pra `.tag` — o painel de detalhe usava `.tag` sem casar com aquele seletor e o rótulo saía como texto solto
- verificação: vitest 406/406; happy-dom confirma 2 pilhas independentes (dores no padrão, demo com config própria) e os 13 cartões com 4 itens cada; cross-check automático contra o `navItems` do App.jsx não acusa módulo faltando; pin math simulada de 640px a 1080px de altura — os 13 encaixam e a pilha cabe na tela mesmo com cartão de 300px (mobile)
- touched: landing/index.html, landing/scroll.js, concepts/landing-scroll-3d.md

## [2026-08-30] feature | Landing: TextType digitando o h1 do hero (e adeus anime.js)
- gatilho: usuário pediu o `<TextType />` do React Bits apontando o título do hero
- terceiro porte vanilla da série (depois de ScrollStack e CardSwap). A máquina de estados veio igual; o que era efeito com setState virou laço de setTimeout. GSAP só pisca o cursor
- substituiu a animação de palavras do anime.js no MESMO `<h1>` — as duas brigariam pelo elemento. Era o único uso de anime.js na landing, então a tag `<script>` da CDN saiu junto (~17KB e uma requisição a menos)
- FANTASMA: digitar letra a letra muda a quebra de linha e o h1 tem 2 linhas; sem reservar a caixa, lead e botões pulariam a cada caractere. Cópia da frase mais longa com `visibility:hidden` segura o espaço e a camada digitada vai por cima em absolute
- degrada sem JS: a frase real fica no HTML e só some quando o script assume (classe `.tt-on`). É o h1 da página, não pode depender de JS
- uma frase só não entra em laço (digita e para). Apagar e redigitar a mesma frase num hero é irritante. Com 2+ o laço liga sozinho
- a11y: `aria-label` no h1 com a frase pronta, `aria-hidden` nas camadas visuais — leitor de tela não acompanha a digitação
- configuração por `data-*` no elemento: `data-type-text` (JSON array), `-speed`, `-delay`, `-pause`, `-delete`, `-blink`, `-cursor` (`"none"` remove) e `-variable="min,max"` (o `variableSpeed` do original)
- verificação: vitest 406/406; happy-dom em 3 cenários — normal (começa vazio e chega à frase exata em 42 passos), `prefers-reduced-motion` (frase inteira na hora, sem cursor) e SEM GSAP (digita igual, só não pisca). Laço multi-frase testado à parte: alterna, volta e o fantasma escolhe a frase mais longa
- touched: landing/index.html, landing/scroll.js, concepts/landing-scroll-3d.md

## [2026-08-30] fix | Landing: título digitado vazava por cima do lead
- gatilho: print do usuário — "em planilha." desenhado por cima do parágrafo — mais "tá muito rápido"
- causa: o fantasma reservava a caixa, mas a camada viva era `position:absolute; inset:0`. Com absolute a altura da camada é a do h1, e o conteúdo que não couber TRANSBORDA em vez de empurrar. A camada viva pede mais linha que o fantasma porque leva o cursor `inline-block` junto, e `text-wrap:balance` (que o `.h-hero` usa) reequilibra diferente com ele
- correção: fantasma e camada viva empilhados na MESMA célula de grid (`display:grid` + `grid-area:1/1`) em vez de absolute. A linha do grid cresce pelo maior dos dois — não existe transbordo, seja qual for a causa. Escolhido por ser robusto à causa, não por depender do diagnóstico estar certo
- `white-space:pre-wrap` no `.text-type__content` (estava no CSS original do React Bits e eu tinha deixado de fora): sem ele o espaço no fim do trecho digitado colapsa e o texto treme a cada palavra
- velocidade: 52ms → 92ms, faixa variável 38–95 → 68–145. A frase passa de ~3,2s para ~4,8s
- verificação: happy-dom confirma a estrutura montada e o texto final igual ao fantasma; asserções de regex garantem que o `position:absolute` saiu e o grid entrou. O empilhamento em si é CSS — não dá pra verificar sem browser
- touched: landing/index.html
