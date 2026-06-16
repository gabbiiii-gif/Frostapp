---
title: Ponto — só entrada/saída, jornada por dia e almoço por janela
type: design
updated: 2026-06-16
related:
  - ../../wiki/modules/tecnico-mobile.md
code_refs:
  - src/lib/ponto.js
  - src/lib/banco-horas.js
  - src/modules/PontoModule.jsx
  - src/modules/PontoBancoHoras.jsx
---

# Ponto: só entrada/saída, jornada por dia e almoço por janela

## Contexto / problema

O ponto eletrônico hoje:

- **Bate 4 vezes** quando a jornada tem `intervalo_min > 0` (`proximaAcao` cicla entrada → intervalo_inicio → intervalo_fim → saída). Confunde o funcionário — querem **só entrada e saída**.
- **Carga horária única** (`horas_dia`) para todos os dias úteis (`dias_semana`). Não dá pra ter **sábado meio período** (alguns não trabalham sábado, outros meio período, outros sábado todo).
- **Almoço** só é descontado se houver as batidas de intervalo. Querem o almoço **configurável por funcionário** (não batido).

## Modelo de dados (jornada)

Chave existente `erp:jornada:<funcionarioId>`. Campos **novos** (retrocompatível):

```js
{
  // Carga esperada por dia da semana (0=dom .. 6=sáb), em HORAS.
  // 0 ou ausente = não trabalha nesse dia.
  horas_por_dia: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4 },

  // Janela fixa de almoço (HH:MM). Descontada automaticamente da jornada.
  // almoco_inicio/almoco_fim vazios (null/"") = funcionário sem almoço.
  almoco_inicio: "12:00",
  almoco_fim:    "13:00",

  tolerancia_min: 10,
  ativo: true,
}
```

Campos **legados** (`horas_dia`, `horas_semana`, `dias_semana`, `intervalo_min`,
`hora_entrada`, `hora_saida`) deixam de ser escritos pela UI nova, mas
continuam tolerados na leitura para migração.

### Migração (no `getJornada`)

Se o registro **não tem** `horas_por_dia`, derivar de campos legados:

- `horas_por_dia[d] = horas_dia` para cada `d` em `dias_semana`; demais dias `= 0`.
- Janela de almoço default a partir de `intervalo_min`: se `intervalo_min > 0`,
  `almoco_inicio = "12:00"`, `almoco_fim = "12:00" + intervalo_min`. Se
  `intervalo_min = 0`, sem almoço (janela vazia).

Migração é **só em memória** (no `getJornada`) — não reescreve o storage até o
admin salvar pela UI nova. `JORNADA_DEFAULT` passa a expor `horas_por_dia`
(seg–sex 8h, sáb/dom 0) + janela de almoço default `12:00`–`13:00`.

## Mudanças por arquivo

### `src/lib/ponto.js`

**`proximaAcao(registrosDia)`** — só entrada/saída:
- último = nenhum ou `saida` → `"entrada"`
- último = `entrada` → `"saida"`
- ignora `intervalo_inicio`/`intervalo_fim` (não são mais gerados).
- Parâmetro `jornada` deixa de ser usado (assinatura mantém compat: 2º arg ignorado).

**`minutosTrabalhadosDia(registrosDia, jornada)`** — passa a receber a jornada:
- **Se o dia tem batidas de intervalo** (`intervalo_inicio`/`intervalo_fim`) →
  usa o cálculo atual por pares (preserva histórico antigo).
- **Senão** → soma `(saida − entrada)` de cada par e **subtrai a sobreposição**
  de cada par com a janela de almoço da jornada naquele dia.
  - Sem janela de almoço → não desconta nada.
  - Par inteiro antes do almoço (meio período manhã) → sobreposição 0 → sem desconto.
- Helper interno `sobreposicaoAlmocoMin(entradaDate, saidaDate, jornada)` calcula
  os minutos de interseção entre `[entrada, saida]` e a janela
  `[almoco_inicio, almoco_fim]` no mesmo dia local.

`TIPOS_PONTO` mantém os 4 tipos (compat com dados/registro manual antigo), mas o
fluxo de batida normal só usa `entrada`/`saida`.

### `src/lib/banco-horas.js`

- `JORNADA_DEFAULT`: adiciona `horas_por_dia` (seg–sex 8h, sáb/dom 0),
  `almoco_inicio "12:00"`, `almoco_fim "13:00"`. Mantém campos legados para
  compat de leitura.
- `getJornada`: aplica a migração descrita acima (deriva `horas_por_dia` +
  janela de almoço quando ausentes).
- `ehDiaUtil(data, jornada)`: `(jornada.horas_por_dia?.[dow] || 0) > 0`.
- `calcularSaldoDia`: `esperado = Math.round((jornada.horas_por_dia[dow] || 0) * 60)`;
  passa a `jornada` para `minutosTrabalhadosDia`.
- `calcularSaldoPeriodo`: idem, repassa jornada.
- Relatório/print (linha ~471): troca `Jornada {horas_dia}h/dia` por resumo
  dos dias (ex.: "Seg–Sex 8h · Sáb 4h").

### `src/modules/PontoBancoHoras.jsx` — `ConfigJornadaModal`

- Remove input único de horas + checkboxes de dias.
- Adiciona **grade de 7 dias** (Dom–Sáb): cada linha com toggle "trabalha" +
  campo de horas (0–24, step 0.5). Editar horas habilita o dia; zerar/desligar = folga.
- Remove "Intervalo (min)". Adiciona **janela de almoço**: dois inputs `time`
  (início/fim) + checkbox "Sem almoço" que limpa a janela.
- Mantém "Tolerância (min)".
- Remove `hora_entrada`/`hora_saída` do modal (não entram em cálculo).
- `setJornada` salva `{ horas_por_dia, almoco_inicio, almoco_fim, tolerancia_min, ativo }`.
- Validação: pelo menos 1 dia com horas > 0; se almoço marcado, `fim > início`.

### `src/modules/PontoModule.jsx`

- Call-sites de `minutosTrabalhadosDia` passam a jornada do funcionário.
- `proximaAcao(registrosHoje)` — remove dependência de intervalo (sem mudança de
  call-site além do 2º arg ignorado).
- `BaterPontoModal`/labels: nenhum texto de "intervalo" no fluxo de batida.

### Testes

- `src/lib/ponto.test.js`:
  - `proximaAcao`: nenhum→entrada, entrada→saida, saida→entrada; ignora intervalo.
  - `minutosTrabalhadosDia`: entrada/saida cruzando janela de almoço (desconta);
    meio período antes do almoço (não desconta); sem janela (não desconta);
    dia legado com batidas de intervalo (usa pares antigos).
- `src/lib/banco-horas.test.js`:
  - `getJornada` migra legado → `horas_por_dia` + janela de almoço.
  - `ehDiaUtil`/`calcularSaldoDia` por dia: sábado meio período (esperado 4h),
    sábado folga (esperado 0), dia integral.

## Fora de escopo (YAGNI)

- Editar histórico de batidas antigas (intervalo continua valendo nelas).
- Almoço por duração/condicional (escolhido: janela fixa).
- Horário de entrada/saída como regra (atrasos/saída antecipada) — só carga diária.

## Deploy

Front-end via Vercel (merge na `main`). Sem mudança de Supabase/edge functions.
Dados de jornada existentes migram sozinhos na leitura; admin pode re-salvar pela
UI nova para persistir o formato novo.
