---
title: ADR 006 — Master tier multi-tenant local-only
type: decision
updated: 2026-05-10
status: aceita-com-divida
sources: []
related:
  - ../concepts/master-tier.md
  - ../concepts/supabase-sync.md
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx#MasterApp
  - src/supabase.js
---

# ADR 006 — Master tier multi-tenant local-only

## Contexto

App passou a suportar múltiplas empresas (multi-tenant). Precisava de uma camada acima das companies pra criar/bloquear/excluir tenants. Não há backend custom — só Supabase.

## Decisão

Implementar **Master tier** como camada local com características:
- Prefixo `master:user:` separado
- Login separado (`?master=1` → `MasterLoginScreen`)
- Shell separado (`MasterApp`)
- **NÃO sincroniza** pro Supabase (`SENSITIVE_PREFIXES` em `supabase.js`)
- Audit log próprio (`master:audit:*`)
- Permissões hardcoded (acesso total ao MasterApp), **fora** de `ROLE_PERMISSIONS`

## Razões

- **Velocidade**: rolar Edge Function + tabela `super_admins` + RLS extra atrasaria a feature em semanas.
- **Risco de privilege escalation se sincronizado**: `master:user:*` em `kv_store` exposto via RLS por `company_id` seria desastroso. Admin de empresa que injetasse `master:user:hack` viraria super-admin de todos os tenants. Manter local elimina vetor.
- **Master é raro**: 1 master por instalação (empresa que vende o ERP). Não precisa de cross-device sync hoje.

## Trade-offs aceitos (dívida técnica explícita)

- **Sem cross-device**: master no celular não vê sessão do desktop. Re-login + re-2FA-enroll por device.
- **Sem recovery cloud**: se master perde device → perdeu acesso. Mitigação: backup manual do localStorage.
- **XSS → escalada cross-tenant**: documentado em [master-tier#segurança](../concepts/master-tier.md#segurança--todo-crítico). Vetor real se houver XSS em qualquer tenant.

## TODO declarado

`src/supabase.js` linha ~25 e `src/App.jsx:2714` documentam:

> Mover criação/auth de master pra Edge Function com claim JWT `is_super_admin` no `company_members`. RLS apropriado garante que admin de tenant não consegue inserir/ler `master:*`.

Plano alto nível:
1. Tabela `master_users` em Supabase (não em `kv_store`)
2. Edge Function `master-login` valida hash + emite JWT com claim `is_super_admin: true`
3. Edge Functions `master-create-company` / `master-delete-company` checam claim
4. Cliente armazena JWT em sessão; `MasterApp` chama Edge Functions em vez de `DB.set` direto
5. Migrar masters existentes (one-time): admin local exporta `master:user:*` → admin Supabase importa pra `master_users`

## Por que ainda não fez

- Carga de trabalho: outras prioridades de produto
- Risco aceito enquanto ataque XSS não materializa (mitigado por `_h` em document generators e validação de input)

## Quando virar bloqueante

- 1º incidente real de XSS em produção
- 1º cliente exigindo conformidade (LGPD/SOC2) que requer audit/RLS apropriado
- Master precisar operar de mais de 1 device (UX request)

## Histórico

- Implementação inicial: local-only desde o começo (não houve versão sincronizada)
- TODO documentado em `supabase.js` desde a introdução do prefix `SENSITIVE_PREFIXES`
