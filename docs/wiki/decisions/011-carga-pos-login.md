---
title: 011 — Carga pós-login — RLS por linha, hydrate duplo e auditoria inchada (2026-10-27)
type: decision
updated: 2026-10-27
sources: []
related:
  - 010-performance-abertura.md
  - ../concepts/supabase-sync.md
  - ../concepts/db-layer.md
  - ../concepts/migracoes-supabase.md
  - ../modules/finance.md
code_refs:
  - supabase/migrations/20261027134633_kv_store_rls_initplan.sql
  - src/supabase.js#hydrateFromSupabase
  - src/supabase.js#hydrateRecenteDe
  - src/supabase.js#fatoresMfaDaSessao
  - src/supabase.js#subscribeToChanges
  - src/App.jsx#podarAuditoriaLocal
  - src/App.jsx#syncOSToFinance
  - src/utils.js#recAtualizadoPelaOS
---

# 011 — Carga pós-login: o gargalo era o banco, não a tela

Reclamação do cliente (2026-10-27): "demora para o app entrar na interface". A [[010-performance-abertura]]
já tinha deixado a **tela de login** rápida; o tempo perdido estava **depois** de apertar "Entrar".

## O que os logs mostraram

Log de borda do Supabase, 2026-10-27 13:28 UTC, um Android 10, um único login:

| Hora | Requisição | Tempo na origem |
|---|---|---|
| 13:28:37 | hydrate do boot, página 1 | 4,8 s |
| 13:28:42 | hydrate do boot, página 2 | 3,9 s |
| 13:28:48 | hydrate do login, página 1 | 4,9 s |
| 13:28:54 | hydrate do login, página 2 | 4,5 s |

**~18 s só esperando o banco**, mais auth, `company_members`, `companies` e `/auth/v1/user`.

## As causas, em cadeia

1. **RLS do `kv_store` avaliada por linha.** As políticas chamavam `private.user_company_id()`,
   `private.kv_can_read(key)` (que chama `private.user_role()`) e `private.is_master_admin()` direto na
   expressão. Função `SECURITY DEFINER` não é inlinada: o Postgres rodava essas funções — cada uma com sua
   consulta em `company_members` — para **cada uma das 27 mil linhas**, inclusive as que o filtro do hydrate
   descartava depois. `EXPLAIN ANALYZE` como admin: **3.109 ms por página**. O advisor `auth_rls_initplan`
   do Supabase não pegou, porque o `auth.uid()` fica escondido dentro das funções.
2. **26 mil das 27 mil linhas eram auditoria — quase toda lixo.** O backfill do Financeiro
   (`loadTransactions` → `syncOSToFinance` para toda OS finalizada) regravava os ~70 lançamentos REC a
   cada abertura do módulo e a cada salvamento, sempre com `updatedAt` novo. Cada regravação = 1 upsert +
   1 linha de auditoria + 1 evento Realtime em cada aparelho conectado. De maio a outubro: 24,8 mil
   auditorias "finance update" (pico de 9,6 mil em julho) para 206 lançamentos. Rajada medida em
   2026-10-26 19:41: 140 POSTs no mesmo minuto, p50 772 ms.
3. **O login hidratava duas vezes.** O boot hidrata com a sessão Supabase guardada no aparelho enquanto a
   pessoa digita a senha; o `handleSubmit` esperava esse boot (`aguardarBoot`) e depois hidratava **de
   novo**, tudo em sequência.
4. **Toda auditoria acabava no localStorage de todo admin/gerente.** O handler do Realtime gravava qualquer
   linha do `kv_store` no aparelho, inclusive `erp:audit:*`, e o hydrate nunca limpava auditoria local.
   Resultado: milhares de chaves deixando cada `DB.list` mais lento (varre todas as chaves) e empurrando o
   storage para o limite de cota — com a cota cheia, o `setItem` do `DB.set` lança e a gravação some sem aviso.
5. **Distância.** O projeto Supabase está em **us-east-2 (Ohio)** e os clientes no Pará: cada ida e volta
   sequencial custa ~200–600 ms. Cada consulta a menos no caminho do login conta.

## Decisões

- **RLS com InitPlan** (migração `20261027134633_kv_store_rls_initplan`, aplicada via MCP em 2026-10-27):
  `(select private.user_company_id())`, `(select private.user_role())` e `(select private.is_master_admin())`
  rodam uma vez por consulta; a regra de prefixo por papel vem inline (CASE + LIKE). A mesma página do
  hydrate: **3.109 ms → 15,6 ms** em produção. Equivalência testada antes numa transação desfeita (ROLLBACK)
  com 8 papéis: mesmas chaves visíveis, mesmas permissões de escrita. A fonte da verdade das regras por
  papel passa a ser a política; `kv_can_read`/`kv_can_write` ficam no banco, sem uso. Espelho no cliente:
  `canWriteKey()` em `src/supabase.js`.
- **Backfill do Financeiro só grava o que mudou** — `recAtualizadoPelaOS` (`src/utils.js`, com teste)
  devolve `null` quando o REC já reflete a OS. Regras preservadas: descrição/categoria sempre acompanham a
  OS; REC pago mantém valor e data. Mudança deliberada: OS sem data de conclusão mantém a data já gravada
  (antes virava "agora" a cada abertura e o lançamento nunca envelhecia). O backfill lê `erp:finance:` uma
  vez só, em vez de uma varredura do storage por OS.
- **Login sem o segundo hydrate** quando o boot acabou de hidratar com o **mesmo usuário, mesma empresa e
  mesmo papel** há menos de 5 min (`hydrateRecenteDe`). Nesse caso entra direto e um hydrate de fundo roda
  1 s depois que o Dashboard abre, para pegar o que mudou enquanto a pessoa digitava — sem limpeza do local
  (`limparLocal: false`). Usuário diferente, hydrate do boot velho ou que falhou → hydrate completo antes de
  entrar, como antes (ele também re-escopa o cache para o papel de quem entrou).
- **Foto velha não sobrescreve dado novo.** O hydrate guarda o instante em que a consulta saiu; chave
  alterada depois disso — evento Realtime ou gravação local (`syncToSupabase`/`deleteFromSupabase`) — não é
  sobrescrita nem apagada pela resposta (`_tocadas` em `src/supabase.js`). Coberto por testes com cliente
  falso (`src/supabase.hydrate.test.js`), que falham se a proteção for desligada.
- **Hydrate sem sessão Supabase não roda.** Com o membro em cache e a sessão perdida, a RLS devolvia zero
  linhas sem erro e o cleanup apagava o cache local inteiro.
- **Auditoria fica no Supabase.** O Realtime ignora `erp:audit:*`; o boot poda a auditoria local para as
  200 mais recentes (em lotes, sem travar a tela). O painel de Auditoria já lia as 500 mais recentes do
  servidor ao abrir. App sem Supabase (local puro) não poda: lá o storage é a única cópia.
- **Login com menos idas ao servidor:** membro + flags da empresa numa consulta só (embed
  `companies(...)` pela FK, com volta ao formato antigo se o embed falhar) e fatores de 2FA lidos da sessão
  que o login acabou de receber (`fatoresMfaDaSessao`), sem a chamada a `/auth/v1/user` (~450 ms). É a
  mesma fonte que o próprio supabase-js usa em `mfa.getAuthenticatorAssuranceLevel()`.
- **Hydrate não baixa mais `erp:autoBackup:*`** (nunca era gravado no local; ~35 KB por backup).

## O que ficou de fora (e por quê)

- **Apagar as 26 mil auditorias "finance update" antigas.** Com a RLS nova elas custam ~15 ms numa varredura;
  apagar histórico de auditoria é decisão do dono, não otimização. Se quiser, o critério seguro é "rajadas
  de 10+ updates de finance no mesmo minuto" (assinatura do backfill).
- **Mudar a região do projeto Supabase** (us-east-2 → sa-east-1): ganho real em toda requisição, mas é
  migração de infraestrutura, com janela de manutenção. Fica como recomendação.
- **Páginas do hydrate em paralelo:** economizaria ~1 ida e volta (~200 ms); paginação por offset em
  paralelo tem o mesmo risco de pular/duplicar linha do sequencial, e o ganho ficou pequeno depois da RLS.
- **`lembrete-dispatch`/`lembrete-teste`:** o `kvList` tenta primeiro `like 'cmp_<id>:erp:client:%'`
  (formato de chave que não existe) e só então o formato certo. Funciona, mas desperdiça uma varredura
  por execução (0,4–1,1 s a cada 15 min). Corrigir exige redeploy das funções.
- **Outras políticas com `auth.uid()` por linha** (`ai_conversations`, `ai_messages`, `ai_os_proposals`,
  `push_subscriptions`, `pos_venda_*`): tabelas pequenas hoje; o advisor `auth_rls_initplan` lista todas.
- **Papel `cliente_escola`:** o produto não usa mais, mas o CHECK de `company_members.role` ainda aceita.
  A política manteve o ramo dele de propósito: tirar só o ramo faria um membro com esse papel cair na regra
  geral (ver tudo menos financeiro). Limpeza certa = migração própria, CHECK primeiro.

## Como medir de novo

- Banco: `EXPLAIN (ANALYZE, BUFFERS)` da consulta do hydrate com `set local role authenticated` e
  `request.jwt.claims` de um admin, dentro de `begin … rollback`.
- Ponta a ponta: logs de borda (`edge_logs`) filtrando `kv_store` com `not.like.erp:audit` na URL —
  `response.origin_time` por página.
