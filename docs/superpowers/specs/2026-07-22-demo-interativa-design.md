# Design — Demo Interativa Self-Service (landing → experiência nos módulos)

**Data:** 2026-07-22
**Escopo:** Mudança #3 de 3. (As outras: #1 travamento por aparelho — spec + plano Fase 1 prontos; #2 pagamento parcial no financeiro — pendente.)
**Objetivo de negócio:** quando o prospect clica em "Ver uma demonstração" na landing, ele **entra e experimenta os módulos do FrostERP** (Dashboard, OS, Agenda, Financeiro, Cadastro) com dados de exemplo, e o **lead é capturado** para venda.

---

## 1. Resumo

Um **Modo Demonstração local** no próprio app. O botão da landing leva ao app com `?demo=1`. Antes de liberar, um **formulário curto** (nome + WhatsApp + email) captura o lead; ao enviar, o lead é registrado no Supabase e a equipe é notificada. Em seguida o app **semeia uma empresa fictícia** (reusando `seedDatabase()`) no `window.storage` do navegador do prospect e abre o shell do ERP com um **banner "Modo Demonstração"** e CTA de conversão.

Tudo roda **local no navegador do prospect** — isolado por visitante, sem custo de backend, auto-resetável, e **sem escrever dados reais** nem disparar WhatsApp/email/n8n de verdade.

## 2. Decisões travadas (do brainstorming)

| Tema | Decisão |
|------|---------|
| Tipo de demo | Self-service **interativa** — o prospect mexe nos módulos de verdade. |
| Arquitetura | **Local-only** (window.storage), reusando `seedDatabase()`. Sem provisionar backend por visitante. |
| Captura de lead | **Formulário antes** de liberar (nome + WhatsApp + email); lead registrado + equipe notificada. |
| Escopo | **Só o ERP (admin)** nesta fase. App do técnico fica para uma fase 2 se fizer sentido (YAGNI). |
| Isolamento | Por navegador do prospect (empresa demo dedicada `cmp_demo`); reset manual + automático. |
| Segurança de dados | Modo demo **desliga** sync Supabase e integrações externas; nada real é escrito/enviado. |

## 3. Arquitetura

### 3.1 Entrada
- Landing: os dois botões "Ver uma demonstração (15 min)" ([landing/index.html:474](../../../landing/index.html) e :569) passam a apontar para a URL do app com `?demo=1` (ex.: `https://app.frosterp.com.br/?demo=1`) — em vez do `wa.me`. (Mantemos o botão "Falar no WhatsApp" como está.)
- App detecta `?demo=1` no boot (antes do fluxo normal de auth) e entra no **fluxo de demo**.

### 3.2 Guarda de modo demo
- Um flag central `isDemoMode()` (lido de `sessionStorage`/URL) que:
  - **Curto-circuita** `syncToSupabase`, `deleteFromSupabase`, `hydrateFromSupabase` em `src/supabase.js` (nada vai/vem do Supabase para os dados do app).
  - **Desliga** integrações externas: `notifyOSStatusChange` (n8n/WhatsApp), `notifyOsCreated` (email), pushes, uploads de foto/assinatura — viram no-op no demo.
  - Faz o `DB` operar só em `window.storage`, escopado à empresa demo `cmp_demo`.

### 3.3 Semear a demo
- Reusar `seedDatabase()` ([src/App.jsx:1549](../../../src/App.jsx)) para popular clientes (`erp:client:*`), OS (`erp:os:*`), catálogos de serviços/produtos e finanças de exemplo — dando vida a todos os módulos.
- Criar um **usuário demo sintético** (role `admin`, "Servidor") só em memória/local, sem passar por Supabase Auth, para renderizar o shell do ERP.
- Escopo fixo `cmp_demo` para não colidir e para permitir limpeza determinística.

### 3.4 Experiência
- Shell normal do ERP (Dashboard, Processos/OS, Agenda, Financeiro, Cadastro). Fully editável — o prospect cria/edita OS, vê relatórios, etc.
- **Banner persistente "Modo Demonstração"** no topo, com botões **"Resetar demo"** (re-seed limpo) e **"Gostei — falar com a equipe"** (CTA → WhatsApp/contato).
- **Config/Settings** e ações destrutivas de conta ficam ocultas ou neutralizadas no demo (sem gestão de usuários real, sem backup/restore que exporte nada sensível).

### 3.5 Reset
- **Manual:** botão "Resetar demo" limpa `cmp_demo` do window.storage e re-semeia.
- **Automático:** nova sessão/navegador começa limpo; ao entrar em demo, sempre re-semeia do zero (estado previsível).

## 4. Captura de lead

### 4.1 Formulário
- Tela intermediária antes do app: campos **Nome**, **WhatsApp**, **Email** (validação simples; WhatsApp ou email obrigatório).
- Copy: "Preencha para iniciar sua demonstração do FrostERP." + consentimento LGPD curto ("Ao continuar, você concorda em ser contatado sobre o FrostERP.").

### 4.2 Registro + notificação
- Ao enviar → chama edge **`demo-lead`** (verify_jwt=false, anon key), que:
  1. Insere em nova tabela **`demo_leads`** (`id, nome, whatsapp, email, origem, user_agent, created_at`).
  2. Notifica a equipe. **Default: email** via `send-email` (reusa infra existente, zero setup). **Opcional (a confirmar):** WhatsApp via Evolution para o número da equipe.
- Falha de rede **não bloqueia** a demo: registra o que der e libera a experiência (o lead é "best effort"; a experiência é o principal).
- Este canal é **isolado** dos dados locais do app — o lead vai ao Supabase; o app demo continua local-only.

### 4.3 Schema (migração `demo_leads`)
- `demo_leads` (`id uuid pk`, `nome text`, `whatsapp text`, `email text`, `origem text default 'landing_demo'`, `user_agent text`, `created_at timestamptz default now()`) — RLS ligada sem policies (acesso só via edge service_role).

## 5. Componentes / arquivos (visão de alto nível)

- `landing/index.html` — trocar `href` dos 2 botões de demo para `?demo=1`.
- `src/demo.js` (novo) — `isDemoMode()`, `enterDemoMode()`, `resetDemo()`, constante `DEMO_COMPANY_ID='cmp_demo'`, guardas de no-op para integrações.
- `src/supabase.js` — curto-circuito por `isDemoMode()` em sync/hydrate/notify.
- `src/App.jsx` — detectar `?demo=1` no boot; tela `DemoLeadForm`; `DemoBanner`; injeção do usuário demo; ocultar Settings no demo.
- `supabase/functions/demo-lead/index.ts` (novo) — registra lead + notifica.
- `supabase/migrations/*_demo_leads.sql` (novo) — tabela `demo_leads`.

## 6. Testes

- **TDD (Vitest):** `isDemoMode()` (URL/sessionStorage), guardas de no-op (sync/notify viram no-op no demo), `resetDemo()` limpa e re-semeia o escopo `cmp_demo`, validação do formulário de lead.
- **Manual/E2E:** clicar o botão da landing → formulário → preencher → entrar → navegar todos os módulos com dados → "Resetar demo" → confirmar estado limpo; confirmar que **nada** foi para o Supabase kv_store real e **nenhum** WhatsApp/email de OS foi disparado; confirmar que o **lead chegou** (tabela + notificação).

## 7. Riscos e mitigações

- **Vazar dados demo para o Supabase real** → guarda `isDemoMode()` curto-circuitando toda a camada de sync ANTES de qualquer `DB.set`. Teste dedicado.
- **Disparar integrações reais (WhatsApp/email) a partir da demo** → no-op explícito de `notifyOSStatusChange`/`notifyOsCreated`/pushes no demo. Teste dedicado.
- **Colisão de estado** → escopo fixo `cmp_demo` + re-seed determinístico a cada entrada.
- **Spam no formulário de lead** → validação simples + rate-limit leve na edge (cooldown por IP/user_agent). Não é crítico na fase 1.

## 8. Fora de escopo (deste spec)

- Visão do **app do técnico** na demo (fase 2, se fizer sentido).
- Multi-idioma, analytics avançado de funil, A/B do formulário.
- Mudanças #1 (travamento por aparelho) e #2 (pagamento parcial) — specs próprios.

## 9. Entrega em fases

1. **Guarda + seed + shell demo** (`src/demo.js`, curto-circuito no `supabase.js`, detecção `?demo=1`, banner, reuso de `seedDatabase`) — já entrega a experiência.
2. **Lead capture** (`DemoLeadForm` + edge `demo-lead` + tabela + notificação por email).
3. **Landing** — trocar os botões para `?demo=1` e publicar.
4. (Opcional) WhatsApp na notificação de lead; visão do técnico.
