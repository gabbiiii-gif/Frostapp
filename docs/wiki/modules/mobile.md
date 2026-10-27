---
title: FrostERP Mobile (casca do ERP no celular)
type: module
updated: 2026-10-27
sources:
  - Handoff do Claude Design "FrostERP Mobile" (FrostERP Mobile.dc.html + chat), 2026-10-27
related:
  - ./tecnico-mobile.md
  - ./dashboard.md
  - ./process.md
  - ./finance.md
  - ./schedule.md
  - ./cadastro.md
  - ../concepts/role-permissions.md
  - ../concepts/demo-mode.md
code_refs:
  - src/mobile/MobileApp.jsx
  - src/mobile/dados.js
  - src/mobile/formularios.jsx
  - src/mobile/useEhCelular.js
  - src/App.jsx#renderModulo
  - src/App.jsx#API_MOBILE
---

# FrostERP Mobile

Layout próprio do ERP para celular. Quando a tela tem **menos de 768px** (`useEhCelular`),
o `App` troca sidebar + header pela casca de `src/mobile/`. **O desktop não muda**: o JSX dos
módulos foi só extraído para `renderModulo(modulo)`, usado pelos dois layouts (conferido com
print pixel a pixel em 1366px: Dashboard, OS, Financeiro e Cadastros iguais ao anterior).

Não confundir com o [App do Técnico](./tecnico-mobile.md): `role="tecnico"` continua no
`TecnicoMobileApp` e `role="ponto"` no `PontoShell` — a casca mobile é só para admin, gerente
e atendente.

## Estrutura

- **Topo**: menu, logo/nome da empresa, tema, sino (notificações do App), avatar → Configurações.
- **Barra inferior**: Início, OS, Clientes, Financeiro + "Mais". A bolha (`.fm-pill`) desliza
  até a aba ativa; "Mais" acende com o menu aberto e nas telas que só existem no menu. Abas sem
  permissão somem e a grade se ajusta.
- **Menu lateral**: módulos na ordem do app real, **sem Ponto Eletrônico** (decisão do Gabriel no
  design: "esses são os módulos que tenho funcionando"). Filtrado pelo `navItems` do App.
- **Formulários em tela cheia**: Nova OS (3 etapas), Novo lançamento, Novo cliente, Movimentar
  estoque, Agendar. "Novo cliente" aberto de dentro da Nova OS/Agendar fica por cima e devolve
  o cliente criado.
- **Modo completo**: abre o módulo do desktop por cima da tela (editar OS com várias peças,
  revisar OS do técnico, pagamento parcial, configurações). Fechar volta para onde estava.

## Telas

| Tela | Própria do mobile? | Observação |
|---|---|---|
| Início | sim | receita realizada do período em destaque; 4 KPIs de OS; agenda de hoje; concluídas por semana do mês; estoque baixo; aviso de OS em revisão |
| OS (lista + detalhe) | sim | abas Ativas/Revisão/Histórico, chips Hoje/Semana/Sem técnico; detalhe com stepper, contato, mapa, fotos e botão que avança o status |
| Agenda | sim | Dia (faixa da semana), Semana (agrupada), Mês (grade); toque no agendamento: confirmar/concluir/cancelar/contato |
| Cadastros | sim | clientes, fornecedores, funcionários (só admin/gerente); toque: ligar, WhatsApp, nova OS, agendar |
| Estoque | sim | alerta de mínimo, filtro por categoria, toque → entrada/saída/ajuste |
| Financeiro | sim | saldo do mês, a receber/a pagar/vencidos, lista por prioridade; toque → quitar |
| Notificações | sim | mesmo motor do sino do desktop, agrupado por prioridade |
| Configurações | sim | tema, notificações do aparelho, atalhos para o SettingsModule, "layout clássico", sair |
| IA, Pós-Venda, Lembrete, Folha, Relatórios | **não (fase 2)** | componente do desktop dentro da casca |

## Regras que o mobile reaproveita (não reimplementa)

Gravação no **mesmo formato** dos módulos do desktop, sempre pelo `DB` do App (auditoria,
sync com Supabase e e-mail de OS criada continuam iguais):

- Nova OS = `handleSave` do ProcessModule (um serviço, sem peças/desconto), numeração por
  `getNextNumber("OS", …)`.
- Avançar status = `changeStatus`: finalizar grava `dataConclusao`, chama `syncOSToFinance` e
  `scheduleOSPosVenda`. OS em `aguardando_finalizacao` **não** é aprovada pelo celular — vai
  para a revisão do ERP (Regra 4).
- Quitar lançamento = `markAsPaid`; totais por `computePaymentState`/`totaisFinanceiro`.
- Ao abrir o Financeiro, `API_MOBILE.prepararFinanceiro()` faz o mesmo preparo do FinanceModule
  (receita de OS finalizada + despesas fixas do mês; ambos idempotentes).
- Movimentar estoque = `handleSaveMov` (+ `erp:stockMov`). Opcional, desligado por padrão:
  "Gerar conta a pagar" cria uma despesa pendente com o custo da entrada.
- Agendar = `handleSave` do ScheduleModule, mesma checagem de conflito por técnico.
- Novo cliente = `saveClient` do CadastroModule (+ `data_nascimento`, usado pela IA no aniversário).
  CEP pelo ViaCEP (público); se falhar, digita à mão.

Funções de domínio que moram no `App.jsx` chegam por `API_MOBILE` (prop `api`). Lógica pura
nova em `src/mobile/dados.js`, coberta por `dados.test.js`.

## Detalhes que já morderam

- **`min-height: 44px` global** (`index.css`, telas de toque) deformava chips e o interruptor.
  Reset só dentro de `.fm` e fora de `.fm-legacy` (os módulos legados mantêm os 44px).
- **Flexbox encolhendo listas**: item com `overflow:hidden` dentro de contêiner rolável em coluna
  era espremido a 0px (lista de clientes sumia no Agendar, linhas do detalhe da OS cortadas).
  `.scroll-y > *` tem `flex-shrink: 0`.
- **`osTecnicoNomes` devolve "—"** sem técnico; para lógica use `nomesEquipe` (string vazia).
- **Botão voltar**: uma pilha única (`usePilhaVoltar`) para menu, formulários, detalhe e modo
  completo. Estados de history que não são da casca (`{modal:true}` dos Modais do desktop) são
  ignorados — fechar um Modal dentro do modo completo não derruba a camada de baixo. Fora do
  Início, o primeiro "voltar" leva ao Início em vez de sair do app.
- **Demo**: o `DemoBanner` do desktop é fixo no rodapé e cobriria a barra; no celular vira uma
  faixa acima da barra.

## Válvula de escape

Se a casca quebrar, `ErroMobile` mostra "Tentar novamente" ou "Usar layout clássico". O clássico
fica salvo no aparelho (`localStorage` `frost_layout_classico`) e o header antigo ganha um botão
"Novo layout" (só < 768px) para voltar. Configurações → "Usar layout clássico neste aparelho".

## Pendências

- Fase 2: telas próprias para IA/Atendimento, Pós-Venda, Lembrete, Folha e Relatórios.
- O que o design tinha e ficou fora por não existir no dado: prioridade da OS, fotos na abertura
  da OS, toggle "avisar cliente por WhatsApp", toggle de lembrete por cliente, leitor de código
  de barras no estoque.
- Conferir em aparelho real (iPhone com notch, Android com barra de gestos): safe-area do topo
  e da barra inferior.
