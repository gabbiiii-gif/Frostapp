---
title: Dashboard
type: module
updated: 2026-08-27
sources: []
related:
  - ../concepts/db-layer.md
  - ./process.md
  - ./schedule.md
  - ./finance.md
code_refs:
  - src/App.jsx#Dashboard
  - src/lib/fechamento-mensal.js
  - src/constants.js#STATUS_OS_CONCLUIDAS
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

## Duas escalas de tempo (atualização 2026-08-27)

O Dashboard mistura, de propósito, dois recortes — e os rótulos na tela dizem qual é qual:

| Recorte | O que usa | Exemplos |
| --- | --- | --- |
| **Período** (barra de filtro) | `filterByDate` | OS abertas, concluídas, receita/despesa, taxa de conclusão, donut de status |
| **Estado atual** (sem filtro) | lista completa | OS em andamento, OS aguardando, agendamentos hoje, clientes ativos |
| **Mês corrente** (vira sozinho) | mês do relógio | card "Resumo do mês" |

"Em andamento" e "aguardando" ficam fora do filtro de propósito: uma OS aberta há três meses e
ainda em execução continua sendo trabalho em aberto hoje.

Concluídas contam pela **data de conclusão**, não pela de abertura — OS aberta em junho e
finalizada em julho é produção de julho.

### Dois bugs que zeravam a tela

1. **Status inexistentes.** Os cálculos comparavam `os.status` com `"em_andamento"`, `"pendente"` e
   `"concluido"`. O `ProcessModule` grava `aguardando → em_deslocamento → em_execucao → finalizado`
   (mais `em_servico`/`aguardando_finalizacao` vindos do app do técnico). Nenhum batia, então KPI e
   donut ficavam permanentemente em zero. Agora os agrupamentos são únicos e vivem em
   `src/constants.js` (`STATUS_OS_EM_ANDAMENTO`, `STATUS_OS_PENDENTES`, `STATUS_OS_CONCLUIDAS`,
   `STATUS_OS_EM_REVISAO`, `STATUS_OS_ENCERRADAS_SEM_SERVICO`) — os status legados seguem nas listas
   por causa de bases antigas e do seed da demo.
2. **`dateFilter` ignorado.** Chegava como prop e não era usado em lugar nenhum (o ESLint já
   apontava `defined but never used`); trocar 7/30/90/tudo/personalizado não mexia em nada.

## Fechamento mensal

`src/lib/fechamento-mensal.js` (puro, testado) + `ensureFechamentoMensal()` em `src/App.jsx`.

- Roda no boot, junto das outras migrações. Sela todo mês **encerrado** que ainda não tem registro
  em `erp:fechamento:<AAAA-MM>` — prefixo escopado por empresa, auditado e sincronizado como o resto.
- **Idempotente:** nunca reescreve mês já fechado (o snapshot vale como "o que era verdade na
  virada") e pula mês sem nenhum movimento.
- Efeito prático: no primeiro acesso de agosto, julho inteiro fica arquivado e o "Resumo do mês"
  recomeça do zero.
- Guarda: OS abertas/concluídas/canceladas, OS por status, valor e ticket médio, receita, despesas,
  saldo, a receber, receita e despesa por categoria, clientes novos, concluídas por técnico e o
  técnico destaque.
- `limitesDoMes` calcula o fim como "dia 0 do mês seguinte" — pega o último dia real sem assumir
  30/31 dias e sem tropeçar em fevereiro bissexto.

Vira a fonte **`fechamentos`** no registry de [[./relatorios]], então a busca e a pergunta em pt-BR
alcançam o histórico ("como foi julho?").
