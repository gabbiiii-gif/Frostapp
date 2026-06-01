---
title: 009 — Hardening de segurança (pentest interno 2026-05-19)
type: decision
updated: 2026-06-01
sources: []
related:
  - ../concepts/supabase-sync.md
  - ../concepts/master-tier.md
  - ../modules/pos-venda.md
code_refs:
  - src/supabase.js
  - supabase/functions/master-login
---

# 009 — Hardening de segurança (pentest interno 2026-05-19)

Review pentest do app (autorizado, repo do próprio dono). App = client burro; segurança vive em RLS/RPC no Postgres (prod `frostapp2.0` / `rbwzhglsztmjvwrcydcy`). Anon key vai no bundle (público por design) — entrada de todos os vetores.

## Vulnerabilidades achadas

| # | Sev | Vetor |
|---|-----|-------|
| 1 | 🔴 CRÍTICO | `master_lookup_by_email` SECURITY DEFINER executável por `anon`, retornava `password` (hash PBKDF2) + `session_token_hash`. Combinado com `master_set_session` (prova = igualdade de hash, que o passo anterior vazava) → takeover total do super-admin SEM login. `master_upsert` com `has_any=false` deixava anônimo criar 1º master. |
| 2 | 🔴 CRÍTICO | `kv_finance_dup_removed_20260518` e `kv_store_backup_dedupe_20260518` públicas SEM RLS — dump de todo o `kv_store` multi-tenant numa request anônima. |
| 3 | 🔴 CRÍTICO | Storage `os-fotos`: policy `anon_upload_os` (anon faz upload) + `anon_delete_os` (anon apaga qualquer foto), ambas sem autenticação. |
| 4 | 🟠 ALTO | `pos_venda_config`/`pos_venda_mensagens` policy `auth.role()='authenticated'` sem escopo — qualquer logado lê/edita/apaga fila (telefones+conteúdo) de todas as empresas. |
| 5 | 🟠 ALTO | `os_fotos_authenticated_read` SELECT amplo — qualquer autenticado lista fotos de OS de todas as empresas. |
| 6 | 🟡 MÉDIO | `set_updated_at` search_path mutável; `pg_net` no schema public; leaked password protection off; RPCs master executáveis por anon/authenticated em geral. |

## Aplicado (via MCP, migrações 2026-05-19)

- **#1**: `REVOKE EXECUTE` de `anon, authenticated` em `master_lookup_by_email`, `master_set_session`, `master_upsert`, `master_delete_authenticated`, `master_list_authenticated`. Login master suportado = Edge Function `master-login` (service_role). `master_count()` mantido (bootstrap; vaza só contagem — risco baixo aceito).
- **#2**: RLS habilitada + grants revogados nas 3 tabelas de backup (dados preservados; DROP fica como decisão posterior).
- **#3 + #5**: dropadas `anon_upload_os`, `anon_delete_os`, `os_fotos_authenticated_read`. Criadas `os_fotos_auth_insert` / `os_fotos_auth_delete` só para `authenticated`. SELECT não recriado (bucket público serve por URL direta).
- **#4**: coluna `company_id text default public.user_company_id()` em `pos_venda_*` (4 tabelas), backfill single-tenant, policy trocada para escopo `company_id = user_company_id()`. Dispatcher usa service_role (bypassa RLS) — smoke test 200 OK pós-mudança.
- **#6**: `set_updated_at` agora `set search_path = ''`.

## Residual (NÃO fechado — follow-up)

- **pg_net em public**: não movido — `ALTER EXTENSION` arriscava quebrar o cron Pós-Venda recém-criado. Aceito; mover exige re-agendar o cron.
- **Leaked password protection**: config de Auth, não SQL — ligar manual no dashboard (Auth → Password).
- **os-fotos sem escopo de empresa**: agora exige login, mas qualquer autenticado de qualquer tenant ainda lê (por URL)/apaga. Fix completo = convenção de path `companyId/...` + policy por path + ajuste no `uploadFotoOS`.
- ~~**Helpers `user_role/user_company_id/is_master_admin` executáveis por authenticated**: necessários dentro das policies RLS — não revogáveis. Vazam só dados do próprio caller. Aceito.~~ ✅ RESOLVIDO 2026-06-01 — ver adendo abaixo.
- **XSS print docs**: `generate*HTML` usam guard `_h`; auditoria por interpolação não feita. Área de risco se algum campo escapar do guard.
- **App client** ✅ RESOLVIDO: validado que `master-login` Edge usa service_role → não afetado pelo REVOKE (teste negativo: credencial inexistente → 401, não 500, prova que o select sob service_role funciona). Login master primário intacto. `src/supabase.js`: wrappers de RPC revogada (`lookupMasterByEmail`, `listMastersAuthenticated`, `upsertMasterRemote`, `setMasterSessionRemote`, `deleteMasterRemote`) viraram no-op documentado (Regra 2, pt-BR) — comportamento intencional, sem erro confuso no console. `FirstMasterSetup` comentado: criar master novo só persiste local (upsert revogado) — sem impacto hoje (já há master em prod, tela não aparece); follow-up real = Edge Function `master-create`.

## Consequência

Os 3 críticos não-autenticados estão fechados. Restam itens de defesa em profundidade e um ajuste de app (validar login master via Edge Function). Migrações ficam no histórico Supabase; sem mudança de código front nesta rodada.

## Adendo 2026-06-01 — Helpers RLS movidos para schema `private`

Re-rodado o linter (`get_advisors security`): 8 findings. Revisitado o residual dos helpers `user_role/user_company_id/is_master_admin`.

Correção da premissa anterior ("não revogáveis, aceito"): revogar `EXECUTE` realmente quebra o RLS (testado — `RLS_BROKE: permission denied for function helper`; o caller precisa de `EXECUTE` mesmo em `SECURITY DEFINER`). Mas há técnica melhor: **mover os helpers para um schema fora do conjunto exposto pelo PostgREST**. PostgREST só expõe `public`; em `private` os helpers somem do `/rest/v1/rpc` mas continuam chamáveis internamente.

- Migração `move_rls_helpers_to_private_schema`: `ALTER FUNCTION ... SET SCHEMA private` nos 3 helpers + `grant usage on schema private to authenticated, anon, service_role` + re-grant `EXECUTE`.
- **Por que não quebra**: políticas (17) e os defaults `company_id default user_company_id()` das `pos_venda_*` referenciam a função por **OID**, que não muda no `SET SCHEMA`. Verificado: nenhum corpo de função chama os helpers sem qualificação; frontend não os chama via rpc (só `promote_self_member_to_ativo` e `master_count`). Teste pós-migração: `SELECT` em `kv_store` como `authenticated` → OK (helper executou de `private`).
- **Resultado**: linter 8 → 5. Eliminados os 3 findings de helper.

### Residual remanescente após o adendo (5 findings — nenhum acionável sem trade-off)

- `master_count()` (anon/auth): por design (bootstrap, `supabase.js:730`). Mantido — ver #1 acima.
- `promote_self_member_to_ativo()` (auth): RPC self-service legítimo (`supabase.js:152`). Mantido.
- `pg_net` em public: `extrelocatable=false` + 24 requests ativos em `net._http_response` → drop+recreate quebraria webhooks/cron. Não movido.
- Leaked password protection: ainda OFF — ligar manual no dashboard (Auth → Password).
