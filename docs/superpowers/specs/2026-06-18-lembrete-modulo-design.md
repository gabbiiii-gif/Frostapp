---
title: Módulo de Lembrete (aba dedicada)
type: design
updated: 2026-06-18
related:
  - 2026-06-18-lembrete-proximos-servicos-design.md
code_refs:
  - src/modules/PosVendaModule.jsx
  - src/lib/lembrete.js
  - supabase/functions/lembrete-dispatch/index.ts
---

# Módulo de Lembrete (aba dedicada)

## Objetivo

Consolidar o Lembrete numa aba própria da sidebar: configuração + listas dos
próximos serviços + histórico + seção do dono. Substitui o painel atual em
Settings (que vira único no módulo).

## Registro do módulo

- Novo arquivo `src/modules/LembreteModule.jsx` (padrão do `PosVendaModule`),
  importado em `src/App.jsx`.
- `ALL_MODULES`: adicionar `{ id: "lembrete", label: "Lembrete" }`.
- `navItems` (sidebar, ≈ App.jsx:16187): `{ id: "lembrete", label: "Lembrete", iconName: "agenda", module: "lembrete" }`, gated por `hasPermission(user, "lembrete")`.
- `ModuleSwitcher` (≈ App.jsx:12200): renderizar `<LembreteModule .../>` quando `activeModule === "lembrete"`.
- `ROLE_PERMISSIONS` (constants.js): incluir `"lembrete"` em `admin` e `gerente`.
- `TOGGLEABLE_MODULES`: adicionar `{ id: "lembrete", label: "Lembrete" }` (Master liga/desliga por empresa).
- Remover `LembreteConfigPanel` do `SettingsModule` (config passa a viver só no módulo).

## Sub-abas do módulo

Estado `aba` (useState): `config | proximas | agendadas | historico | dono`.

### Config
Mesmos controles do painel atual (ativo, manutencao_ativa, intervalo_pj_dias,
intervalo_pf_dias, antecedencia_dias, agendados_ativo, lookahead_dias, canais,
para_cliente/para_admin, template_cliente). Usa `getLembreteConfig` /
`saveLembreteConfig` (já existem). Carrega 1x ao abrir o módulo; compartilha o
objeto `cfg` com as outras abas (pra computar as listas com os parâmetros certos).

### Próximas manutenções (client-side)
Calculada localmente — sem rede — a partir de `DB.list("erp:client:")` +
`DB.list("erp:os:")` e da lib `src/lib/lembrete.js`:
- por cliente: `ultimaVisitaCliente(os, clienteId)`; se houver,
  `intervaloEfetivo(cliente, cfg)` → `proximaManutencao(ultima, intervalo)` →
  `manutencaoDue(proxima, hoje, cfg.antecedencia_dias)`.
- Mostra os due numa `DataTable`: cliente, tipo (PJ/PF), última visita, próxima,
  dias restantes, telefone. Ordenado por dias restantes.

### Visitas agendadas (client-side)
`DB.list("erp:os:")` filtrando `status not in (finalizado, cancelado)` e
`dataAgendada` em `[hoje, hoje + cfg.lookahead_dias]`. Tabela: cliente, data,
hora, equipamento, técnico. Ordenado por data.

### Histórico
Novo helper `getLembreteEnviados(companyId, limit=200)` em `src/supabase.js`
(`select * from lembrete_enviado order by enviado_em desc limit N`). Tabela:
data, tipo, cliente_id, destinatário, canal, status. (RLS já permite leitura
admin/gerente.)

### Dono
Seção específica das mensagens do dono:
- Campos: `dono_telefone`, `resumo_hora`, toggle `para_dono` (salvam via `saveLembreteConfig`).
- **Botão "Enviar resumo agora"** → helper `sendLembreteResumoDono()` que invoca a
  edge function `lembrete-teste` (verify_jwt=true). Mostra toast com o resultado.
- Texto explicando: o resumo é escrito pela IA (Claude Sonnet) e enviado no
  WhatsApp do dono no horário configurado (1×/dia).

## Backend

### Fix de fuso no `lembrete-dispatch` (resumo do dono)
Hoje `alvo` é montado com `new Date(hojeStr+'T00:00:00')` (interpretado em UTC no
Deno) + `setHours(hh,mm)` → o horário do resumo é comparado em UTC, não em
Brasília (erra ~3h). Corrigir: calcular o "agora em Brasília" (HH:MM via
`toLocaleString`/`Intl` com `timeZone: TZ`) e comparar `resumo_hora` contra esse
HH:MM de Brasília, com janela de `JANELA_MIN`. Redeploy.

### Nova edge function `lembrete-teste` (verify_jwt=true)
- Valida JWT do caller; confere que é `admin`/`gerente` da empresa (via
  `company_members`, igual `notify-os-created`).
- Monta o resumo do dono (mesma lógica da Parte C: lista de clientes vencendo) e
  envia via WhatsApp pro `dono_telefone` da `lembrete_config` da empresa.
- **Ignora** janela de horário e dedupe (é teste sob demanda).
- Retorna `{ ok, sent_to?, error? }`.
- Reusa Evolution (`ai_agent_config.metadata.evolution_apikey`) + Claude Sonnet
  (`ANTHROPIC_API_KEY`).

### Helpers em `src/supabase.js`
- `getLembreteEnviados(companyId, limit)` → array.
- `sendLembreteResumoDono()` → invoca `lembrete-teste` com o JWT da sessão.

## Testes
- A lib `src/lib/lembrete.js` já tem cobertura Vitest (funções usadas pelas listas).
- Edge `lembrete-teste`: teste manual (botão na UI → dono recebe WhatsApp).
- Sem novos testes de UI (segue o padrão do projeto: módulos não têm teste de render).

## Fora de escopo (YAGNI)
- Push (continua fase 2).
- Editar/disparar lembrete de cliente individual pela UI (o cron cuida).
- Manutenções já VENCIDAS (passado) — só as vencendo na janela. Fácil somar depois.

## Deploy
- Front-end: merge na `main` → Vercel.
- Edge: redeploy `lembrete-dispatch` (fix fuso) + deploy `lembrete-teste`.
