---
title: 012 — Multiempresa — um banco para todas as empresas, chave (empresa, chave) e o que falta antes da 2ª empresa
type: decision
updated: 2026-10-27
sources: []
related:
  - 011-carga-pos-login.md
  - 013-migracao-sao-paulo.md
  - ../concepts/db-layer.md
  - ../concepts/supabase-sync.md
  - ../concepts/master-tier.md
  - ../concepts/migracoes-supabase.md
code_refs:
  - supabase/migrations/20261027142316_kv_store_unique_empresa_chave.sql
  - src/supabase.js#upsertKv
  - src/App.jsx#seedDatabase
  - supabase/functions/whatsapp-webhook/index.ts#kvList
  - supabase/functions/master-companies/index.ts
---

# 012 — Multiempresa

Pergunta do Gabriel (2026-10-27): "vou ter que fazer um banco de dados para cada empresa cadastrada?
Quero vender para outras empresas sem conflito de dados."

## Decisão: um banco só, isolado por empresa

**Não** é preciso um banco por empresa. O FrostERP já é multiempresa num banco só: toda linha do
`kv_store` (e das tabelas de IA/pós-venda/lembrete) tem `company_id`, e a RLS só deixa cada usuário ver e
gravar linhas da própria empresa (`company_members` → `private.user_company_id()`). É o modelo padrão de
SaaS: um deploy, uma migração, um custo. Banco por empresa multiplicaria custo (um projeto Supabase por
cliente), deploy das ~25 Edge Functions, migrações e o painel Master — só se justifica com exigência
contratual de isolamento físico.

## O que foi verificado (transação desfeita com ROLLBACK, 2026-10-27)

"Empresa 2" de teste com um gerente movido para ela:

| Teste | Resultado |
|---|---|
| Empresa 2 lê o `kv_store` | **0 linhas** da empresa 1 |
| Mesmo pedindo `company_id = 'cmp_default'` explicitamente | **0 linhas** |
| Empresa 2 grava registro próprio | OK |
| Empresa 2 grava `erp:seeded`, `erp:credentialsCleared_v1`, `erp:catalogSeeded_v1`, `erp:fechamento:2026-09`, `erp:theme` | **BLOQUEADO** (RLS) |
| Linhas da empresa 1 depois das tentativas | intactas |

Isolamento de leitura e escrita: **correto**. O problema é outro: chaves sem id próprio.

## Problemas encontrados

1. **Chaves "globais" presas à 1ª empresa.** A chave primária do `kv_store` era só `key`. Chaves sem id
   — `erp:seeded`, `erp:credentialsCleared_v1`, `erp:catalogSeeded_v1`, `erp:theme`, `erp:pushSent`,
   `erp:notifDismissed`, `erp:calendarFeedToken` (legada) e `erp:fechamento:<AAAA-MM>` — pertencem à
   `cmp_default`. A 2ª empresa não consegue gravá-las e o app descarta o erro em silêncio. Efeitos:
   - **`erp:credentialsCleared_v1`** → `seedDatabase` rodaria `purgeAllUsers()` a cada abertura do app da
     empresa 2, **apagando os `erp:user:*` dela no aparelho e no Supabase** (a flag nunca ficava salva).
   - **`erp:fechamento:<mês>`** → o fechamento mensal da empresa 2 nunca seria gravado.
   - **`erp:catalogSeeded_v1`** → o catálogo padrão seria re-semeado a cada abertura (itens que a empresa
     excluísse voltariam).
   - `erp:pushSent` / `erp:notifDismissed` / `erp:theme` → notificações repetidas, preferências perdidas.
2. **IA do WhatsApp lia clientes e OS de todas as empresas.** `kvList` em `whatsapp-webhook` (service
   role, que ignora a RLS) caía numa consulta **sem filtro de empresa**: `get_customer` e `get_recent_os`
   achariam, pelo telefone, o cliente ou a OS de outra empresa — vazamento de dados pessoais (LGPD). Latente
   hoje (só há 1 empresa).
3. **Um usuário = uma empresa.** `private.user_company_id()`/`user_role()` usam `LIMIT 1` em
   `company_members`. O mesmo email não pode ser membro de duas empresas. Restrição de produto, não bug —
   documentar na venda.

## O que foi feito

- **Fase 0 (aplicada em produção):** índice único `(company_id, key)` — aditivo, nada muda para a
  empresa atual. `supabase/migrations/20261027142316_kv_store_unique_empresa_chave.sql`.
- **Fase 1 (código):** todo upsert do app no `kv_store` passa por `upsertKv` (`src/supabase.js`), com
  `onConflict: 'company_id,key'` e volta automática para `'key'` se o banco responder 42P10 (sem o índice).
  `master-companies` também grava por `company_id,key`. Testado em `src/supabase.sync.test.js`.
- **`purgeAllUsers` só no app local puro** (sem Supabase). Com Supabase o usuário mora em
  `company_members`/auth; a limpeza era resto de uma migração antiga de usuários demo.
- **`kvList` do `whatsapp-webhook` sempre filtra `company_id`** (e o de `lembrete-*` perdeu a consulta
  inútil ao formato `<empresa>:erp:...`, que nunca existiu).

## Checklist antes de cadastrar a 2ª empresa

- [ ] App novo publicado e em uso em **todos** os aparelhos (o PWA troca de versão na 2ª abertura). Conferir
      nos logs de borda: nenhum `kv_store?on_conflict=key` nas últimas 48 h.
- [ ] Publicar as Edge Functions alteradas: `npm run deploy:webhook` e
      `npm run deploy:fn -- master-companies` (e `lembrete-dispatch`, `lembrete-teste`).
- [ ] **Fase 2:** trocar a chave primária para `(company_id, key)` (bloco no fim da migração de fase 0).
      Sem ela, a 2ª empresa ainda esbarra na PK antiga.
- [ ] Assinar o plano **Pro** do Supabase (o Free não tem backup automático) — ver [[013-migracao-sao-paulo]].
- [ ] Teste ponta a ponta com uma empresa de teste criada pelo Master: login, cadastro de cliente, OS,
      fechamento, IA no WhatsApp com um número da empresa de teste.

## Regras daqui para frente

- Chave nova no `kv_store` pode ter qualquer formato: a unicidade é por `(company_id, key)`.
- **Toda Edge Function com service role filtra `company_id`** em qualquer leitura/gravação do `kv_store`
  e das tabelas de IA. Service role ignora a RLS: o filtro é a única barreira.
- Nunca usar chave com prefixo de empresa (`cmp_<id>:...`) — não existe e não deve passar a existir.
