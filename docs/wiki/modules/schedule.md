---
title: Agenda (ScheduleModule)
type: module
updated: 2026-05-10
sources: []
related:
  - ./process.md
  - ./settings.md
  - ../concepts/db-layer.md
code_refs:
  - src/App.jsx#ScheduleModule
  - src/App.jsx:6548
  - api/calendar.js
---

# Agenda (ScheduleModule)

Calendário unificado: agendamentos próprios + OS aparecem juntos. Sidebar id: `agenda`.

## Stores

- `erp:schedule:<id>` — agendamento criado direto na Agenda (CRUD próprio)
- `erp:os:<id>` — somente leitura aqui (read-only no calendário; edita via [Process](./process.md))

## Schema agendamento

`{id, data, horaInicio, horaFim, clienteId, clienteNome, tecnicoId, tecnicoNome, tipo, endereco, observacoes, status, origem?}`.

`origem`: `agenda` (criado aqui) | `os` (derivado de OS).

## Conversão OS → item de calendário

`osAsAppointments` mapeia cada OS não-cancelada com `dataAgendada || dataAbertura` para o formato do calendário.

Cuidado importante: `dataAgendada` vem como `"YYYY-MM-DDT00:00:00.000Z"` (UTC 00:00) — extrai só `slice(0,10)` antes de remontar com hora local, **senão UTC 00:00 vira dia anterior em BRT**.

OS sem `dataAgendada` cai pra `dataAbertura` (timestamp real).

## allItems

```
allItems = appointments.map(a => ({...a, origem: a.origem || "agenda"}))
         + osAsAppointments
```

Lista única consumida por todos renderizadores (mês/semana/dia).

## Tipos de serviço

`SERVICE_TYPES_SCHEDULE = [...SERVICE_TYPES_OS, "Revisão"]` — Agenda tem "Revisão" extra (visita técnica), OS não.

## Cores e labels

`STATUS_COLORS_SCHEDULE` e `STATUS_LABELS_SCHEDULE` cobrem **dois conjuntos**:
- Status próprios da Agenda: `agendado, confirmado, em_andamento, concluido, cancelado, pendente`
- Status vindos da OS: `aguardando, em_deslocamento, em_execucao, finalizado`

Cores distintas por origem (ex: `em_andamento` da agenda = yellow-500, `em_execucao` da OS = blue-600) — separa visualmente quem é quem.

## Calendar Feed (iCal)

Token gerado em [Settings](./settings.md) (`erp:calendarFeedToken`) é consumido por `api/calendar.js` (Vercel serverless) que devolve iCal. Permite sync com Google Calendar / Outlook do celular.

## viewMode

`mes | semana | dia` — alternância no header.

## Lacunas

- [a expandir] Renderização célula/grid — código entre 6700+
- [a expandir] Drag-to-reschedule? — checar
