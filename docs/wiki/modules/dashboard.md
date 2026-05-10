---
title: Dashboard
type: module
updated: 2026-05-10
sources: []
related:
  - ../concepts/db-layer.md
  - ./process.md
  - ./schedule.md
  - ./finance.md
code_refs:
  - src/App.jsx#Dashboard
  - src/App.jsx:3564
---

# Dashboard

Tela inicial após login (role != tecnico). KPIs, gráfico semanal de OS concluídas e lista de próximas atividades.

## Responsabilidade

Visão consolidada read-only: **não cria, não edita** — só agrega dados de outros módulos. Botões de KPI navegam (`onNavigate`) para o módulo correspondente.

## Stores consumidos

- `erp:os:` — Ordens de Serviço (Process)
- `erp:schedule:` — Agendamentos (Schedule)
- `erp:client:` — Clientes (Cadastro)
- `erp:finance:` — Transações (Finance)

Tudo via `DB.list(prefix)`.

## KPIs

| KPI | Cálculo |
|---|---|
| Receita realizada do mês | Soma de `erp:finance:` com `tipo=receita` E `status=pago` E mês/ano corrente |
| OS em andamento | Count `status=em_andamento` |
| OS pendentes | Count `status=pendente` |
| OS concluídas no mês | Count `status=concluido` E `dataConclusao` no mês corrente |
| Agendamentos hoje | Schedule do dia + OS do dia (não concluídas/canceladas) — visão **unificada** |
| Clientes ativos | Count `status != inativo` |

## Charts

- **Linha**: OS concluídas por semana (últimas 8 semanas) via Recharts. Buckets `S1..S8`.
- **Próximas atividades**: merge `erp:schedule:` + OS futuras não concluídas/canceladas, ordenadas por data.

## Decisões importantes

- **Receita "realizada" vs "pipeline"**: Dashboard só mostra `pago` para não inflar com receita ainda não efetivada. Lógica espelhada em [Finance](./finance.md).
- **`now` memoizado** (`useMemo(() => new Date(), [])`) pra não invalidar memos a cada render.
- **OS no calendário do dia**: contadas além dos agendamentos — reflete visão unificada que [Schedule](./schedule.md) também usa.

## Lacunas

- [a expandir] Componentes de gráfico Recharts não documentados em detalhe — ver `App.jsx:3700+`
