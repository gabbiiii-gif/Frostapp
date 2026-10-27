-- ============================================================================
-- Performance do kv_store: RLS avaliada UMA vez por consulta, não por linha
-- ----------------------------------------------------------------------------
-- POR QUÊ (medido em produção em 2026-10-27)
--   As políticas do kv_store chamavam private.user_company_id(),
--   private.kv_can_read(key)/kv_can_write(key) (que chamam private.user_role())
--   e private.is_master_admin() direto na expressão. Função SECURITY DEFINER
--   não é "inlinada" pelo planner: o Postgres executava essas funções — cada
--   uma com a sua consulta em company_members — para CADA linha da tabela.
--   Com 27 mil linhas (26 mil de auditoria), a página do hydrate (1000 linhas)
--   levava 3,1 s no banco e 4–5 s no celular. Um login fazia 4 dessas
--   consultas: ~18 s esperando o banco (log de 2026-10-27 13:28 UTC, Android).
--
-- O QUE MUDA
--   - (select private.user_company_id()), (select private.user_role()) e
--     (select private.is_master_admin()) viram InitPlan: rodam uma vez por
--     consulta e o resultado é reaproveitado em todas as linhas.
--   - A regra de prefixo por papel (que morava em kv_can_read/kv_can_write)
--     vem inline na política: CASE sobre o papel já resolvido + LIKE na chave.
--     O custo por linha cai para alguns LIKEs. A mesma página: 3,1 s → 28 ms.
--   - Semântica idêntica: mesmas funções de empresa/papel e os mesmos prefixos
--     das funções em 20260728120000_baseline_rls_security_snapshot.sql.
--
-- FONTE DA VERDADE
--   As funções private.kv_can_read/kv_can_write continuam existindo (nenhuma
--   outra política nem função as usa — conferido em pg_policies e pg_proc),
--   mas a regra que vale passa a ser ESTAS políticas. Mudou um prefixo aqui?
--   Mude também canWriteKey() em src/supabase.js (espelho no cliente).
--
-- COMO APLICAR
--   SQL Editor do dashboard (ou MCP). NUNCA `supabase db push` neste projeto:
--   ver docs/wiki/concepts/migracoes-supabase.md.
--   APLICADA em produção em 2026-10-27 via MCP (apply_migration), registrada no
--   histórico remoto como 20261027134633 / kv_store_rls_initplan — o nome deste
--   arquivo usa a mesma versão. Antes de aplicar, a equivalência foi testada numa
--   transação desfeita (ROLLBACK): 8 papéis (admin, gerente, técnico, atendente,
--   cliente_escola, ponto, master, não-membro) com as mesmas chaves visíveis e
--   as mesmas permissões de insert/update/delete antes e depois.
--
-- REVERSÃO
--   Bloco comentado no fim do arquivo (volta exatamente às expressões antigas).
-- ============================================================================

begin;

-- ─── Leitura (membro da empresa) ─────────────────────────────────────────────
alter policy kv_select_own on public.kv_store
  using (
    company_id = (select private.user_company_id())
    and case (select private.user_role())
      when 'admin'   then true
      when 'gerente' then true
      -- Portal externo da Vanda: SÓ demandas/eventos de escola. Nada do ERP.
      when 'cliente_escola' then (key like 'erp:escola:%' or key like 'erp:evento_escola:%')
      -- Funcionário que só bate ponto: SÓ dados de ponto.
      when 'ponto' then (key like 'erp:ponto:%' or key like 'erp:jornada:%' or key like 'erp:ocorrencia:%')
      -- Demais internos (técnico, atendente, …): tudo MENOS financeiro/segredos/auditoria.
      else not (
        key like 'erp:finance:%'           or
        key like 'erp:transaction:%'       or
        key like 'erp:banking:%'           or
        key like 'erp:transferencia:%'     or
        key like 'erp:vale:%'              or
        key like 'erp:calendarFeedToken:%' or
        key like 'erp:audit:%'
      )
    end
  );

-- ─── Escrita (membro da empresa) — mais restrita que a leitura ───────────────
-- Protege também config/user/employee para quem não é admin/gerente.
alter policy kv_insert_own on public.kv_store
  with check (
    company_id = (select private.user_company_id())
    and case (select private.user_role())
      when 'admin'   then true
      when 'gerente' then true
      when 'cliente_escola' then (key like 'erp:escola:%' or key like 'erp:evento_escola:%')
      when 'ponto' then (key like 'erp:ponto:%' or key like 'erp:jornada:%' or key like 'erp:ocorrencia:%')
      else not (
        key like 'erp:finance:%'           or
        key like 'erp:transaction:%'       or
        key like 'erp:banking:%'           or
        key like 'erp:transferencia:%'     or
        key like 'erp:vale:%'              or
        key like 'erp:calendarFeedToken:%' or
        key like 'erp:config:%'            or
        key like 'erp:user:%'              or
        key like 'erp:employee:%'
      )
    end
  );

alter policy kv_update_own on public.kv_store
  using (
    company_id = (select private.user_company_id())
    and case (select private.user_role())
      when 'admin'   then true
      when 'gerente' then true
      when 'cliente_escola' then (key like 'erp:escola:%' or key like 'erp:evento_escola:%')
      when 'ponto' then (key like 'erp:ponto:%' or key like 'erp:jornada:%' or key like 'erp:ocorrencia:%')
      else not (
        key like 'erp:finance:%'           or
        key like 'erp:transaction:%'       or
        key like 'erp:banking:%'           or
        key like 'erp:transferencia:%'     or
        key like 'erp:vale:%'              or
        key like 'erp:calendarFeedToken:%' or
        key like 'erp:config:%'            or
        key like 'erp:user:%'              or
        key like 'erp:employee:%'
      )
    end
  )
  with check (
    company_id = (select private.user_company_id())
    and case (select private.user_role())
      when 'admin'   then true
      when 'gerente' then true
      when 'cliente_escola' then (key like 'erp:escola:%' or key like 'erp:evento_escola:%')
      when 'ponto' then (key like 'erp:ponto:%' or key like 'erp:jornada:%' or key like 'erp:ocorrencia:%')
      else not (
        key like 'erp:finance:%'           or
        key like 'erp:transaction:%'       or
        key like 'erp:banking:%'           or
        key like 'erp:transferencia:%'     or
        key like 'erp:vale:%'              or
        key like 'erp:calendarFeedToken:%' or
        key like 'erp:config:%'            or
        key like 'erp:user:%'              or
        key like 'erp:employee:%'
      )
    end
  );

alter policy kv_delete_own on public.kv_store
  using (
    company_id = (select private.user_company_id())
    and case (select private.user_role())
      when 'admin'   then true
      when 'gerente' then true
      when 'cliente_escola' then (key like 'erp:escola:%' or key like 'erp:evento_escola:%')
      when 'ponto' then (key like 'erp:ponto:%' or key like 'erp:jornada:%' or key like 'erp:ocorrencia:%')
      else not (
        key like 'erp:finance:%'           or
        key like 'erp:transaction:%'       or
        key like 'erp:banking:%'           or
        key like 'erp:transferencia:%'     or
        key like 'erp:vale:%'              or
        key like 'erp:calendarFeedToken:%' or
        key like 'erp:config:%'            or
        key like 'erp:user:%'              or
        key like 'erp:employee:%'
      )
    end
  );

-- ─── Master tier: flag do JWT, agora avaliada uma vez por consulta ───────────
alter policy kv_master_select on public.kv_store
  using ((select private.is_master_admin()));

alter policy kv_master_insert on public.kv_store
  with check ((select private.is_master_admin()));

alter policy kv_master_update on public.kv_store
  using ((select private.is_master_admin()))
  with check ((select private.is_master_admin()));

alter policy kv_master_delete on public.kv_store
  using ((select private.is_master_admin()));

commit;

-- ─── REVERSÃO (rodar só se precisar voltar ao estado anterior) ───────────────
-- begin;
-- alter policy kv_select_own on public.kv_store
--   using ((company_id = private.user_company_id()) and private.kv_can_read(key));
-- alter policy kv_insert_own on public.kv_store
--   with check ((company_id = private.user_company_id()) and private.kv_can_write(key));
-- alter policy kv_update_own on public.kv_store
--   using ((company_id = private.user_company_id()) and private.kv_can_write(key))
--   with check ((company_id = private.user_company_id()) and private.kv_can_write(key));
-- alter policy kv_delete_own on public.kv_store
--   using ((company_id = private.user_company_id()) and private.kv_can_write(key));
-- alter policy kv_master_select on public.kv_store using (private.is_master_admin());
-- alter policy kv_master_insert on public.kv_store with check (private.is_master_admin());
-- alter policy kv_master_update on public.kv_store
--   using (private.is_master_admin()) with check (private.is_master_admin());
-- alter policy kv_master_delete on public.kv_store using (private.is_master_admin());
-- commit;
