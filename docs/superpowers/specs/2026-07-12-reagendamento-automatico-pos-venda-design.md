# Reagendamento automático (Pós-Venda) — Design

**Data:** 2026-07-12
**Escopo:** Propor uma data ao cliente e deixar o humano fechar (opção A do brainstorm).

## Problema

O módulo Pós-Venda tinha um toggle "Proposta de reagendamento", um template `reagendamento` e o tipo `reagendamento` — mas **nenhum código gerava** mensagem desse tipo. A promessa "após resposta positiva ao lembrete, propõe nova data" nunca foi implementada. O toggle foi removido no fix de 2026-07-12 para não enganar. Este design implementa a automação de verdade.

## Fluxo

1. Lembrete de visita (`lembrete_visita`) é enviado ao cliente (já existe).
2. Cliente responde positivo (`confirma` ou `reagenda`).
3. O `whatsapp-webhook` envia **na hora** a mensagem de reagendamento propondo a **data prevista** (a mesma que o lembrete mencionava) e grava a linha `tipo=reagendamento` com `status=enviada`.
4. Cliente responde à proposta ("pode ser") → o webhook casa com a linha `reagendamento` → marca **`precisa_humano`** → cai no **Inbox** para o operador fechar o agendamento/OS.

O humano continua sendo quem cria o agendamento/OS (preserva a Regra 4).

## Decisão de arquitetura: renderização no App.jsx

A mensagem de reagendamento é **pré-renderizada no `App.jsx` (`scheduleOSPosVenda`)** no momento em que o lembrete é agendado — é o único ponto com todas as variáveis (`cliente_nome`, `empresa_nome`, `equipamento`, `data_sugerida`). O texto pronto + a data ficam no `metadata` da linha do lembrete. O webhook fica burro: só lê `metadata.reagendamento_conteudo` e dispara.

Vantagem: o webhook (edge) não precisa buscar template, nome da empresa nem equipamento. Desvantagem aceita: se o template mudar depois do lembrete agendado, o texto guardado fica levemente stale (o lembrete é enviado ~3 dias antes da resposta, então a janela é curta).

## Mudanças

### 1. `src/App.jsx` — `scheduleOSPosVenda`
Na criação da linha `lembrete_visita`, se `config.enviar_reagendamento` estiver ligado:
- pré-renderiza o template `reagendamento` (via `aplicarVars`, que já resolve `{{data_sugerida}}`);
- grava `metadata: { data_sugerida: proximaVisita.toISOString(), reagendamento_conteudo: <texto> }` na linha.

### 2. `src/modules/PosVendaModule.jsx` — `ConfigTab`
Re-adiciona o toggle "Proposta de reagendamento" (removido no fix), agora com hint verdadeiro, e volta `enviar_reagendamento` ao payload do `salvar`.

### 3. `supabase/functions/whatsapp-webhook` — `handlePosVendaReply`
- Após classificar e atualizar a linha: se `alvo.tipo === "lembrete_visita"` **e** `cls.intencao ∈ {confirma, reagenda}` **e** `alvo.metadata.reagendamento_conteudo` existe **e** ainda não há linha `reagendamento` para `alvo.os_id` → envia o texto pela Evolution + insere linha `tipo=reagendamento, status=enviada, agendada_para=now`. Quando isso ocorre, **pula o ack genérico** (a proposta é a resposta).
- `precisaHumano` passa a incluir `alvo.tipo === "reagendamento"` → qualquer resposta a uma proposta cai no Inbox.

## Garantias

- **Idempotência:** só 1 reagendamento por `os_id` (checa antes de inserir). Gated por `enviar_reagendamento` (via presença de `reagendamento_conteudo`).
- **Sem loop:** proposta só nasce de resposta a `lembrete_visita`, nunca de resposta a `reagendamento`.
- **Sem mensagem duplicada:** quando manda o reagendamento, pula o ack genérico.
- **Envio imediato:** não passa pela fila/aprovação (`modo_disparo`) — é uma resposta conversacional; sai na hora, como o ack.
- **Multi-empresa:** todas as queries escopadas por `company_id` (segue o fix dos dispatchers).

## Não muda

NPS, lembretes ao cliente, opt-out, dispatchers, e o fluxo de criação de OS (Regra 4 — humano fecha).

## Testes / verificação

As partes tocadas são edge (webhook) e client-side não-puro (`scheduleOSPosVenda`) — sem cobertura de unit test hoje. Verificação: build Vite (App/PosVenda), esbuild syntax (webhook), e revisão da idempotência/no-loop. Deploy do webhook via MCP; frontend via `main`→Vercel.
