---
title: Módulo Relatórios
type: module
updated: 2026-08-05
sources:
  - ../../superpowers/specs/2026-08-04-modulo-relatorios-design.md
  - ../../superpowers/plans/2026-08-05-modulo-relatorios.md
related:
  - ../concepts/db-layer.md
  - ../concepts/role-permissions.md
  - ../concepts/document-generators.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/modules/RelatoriosModule.jsx
  - src/lib/relatorios/datasets.js
  - src/lib/relatorios/spec.js
  - src/lib/relatorios/engine.js
  - src/lib/relatorios/csv.js
  - src/lib/relatorios/html.js
  - src/lib/relatorios/salvos.js
  - src/lib/doc.js
  - supabase/functions/relatorio-nl/index.ts
  - supabase/functions/relatorio-whatsapp/index.ts
---

# Módulo Relatórios

Motor genérico de análise. Em vez de um catálogo fixo de relatórios prontos, o usuário monta
a consulta que quiser sobre qualquer entidade do sistema — por builder estruturado ou
perguntando em português.

## O que resolve

Antes, a capacidade de relatório vivia espalhada e engessada: relatórios imprimíveis fixos no
Financeiro, `ProductivityReport` para produtividade por técnico, banco de horas no Ponto,
contracheque e vale na Folha. Cada um respondia a uma pergunta pré-programada; não havia como
perguntar algo que ninguém tinha previsto.

## ReportSpec — o formato único

Builder, modo Pergunta e relatório salvo produzem e consomem o **mesmo** objeto:

```
{ fonte, periodo{campo,de,ate}, filtros[], agrupamento[], metricas[], ordenacao, limite, grafico }
```

Colunas derivadas seguem o contrato `<campo>_<agregacao>` (`valor_soma`), ou `contagem` quando
a métrica não tem campo. É esse nome que `ordenacao.campo` e `grafico.series` referenciam — o
engine, o CSV e o gráfico dependem dele.

`validarSpec` (`src/lib/relatorios/spec.js`) separa **regras duras** de **moles**:

- duras (bloqueiam a execução): fonte inexistente, campo que não existe na fonte, agregação
  incompatível com o tipo do campo, período ausente/invertido, zero métricas;
- moles (descartadas em silêncio, `ok` continua true): `ordenacao` apontando para coluna que o
  resultado não terá, `grafico` cujo eixo não está no agrupamento ou cujas séries não existem.

Não vale travar o relatório inteiro por causa de um gráfico inconsistente.

## Registry de fontes

`src/lib/relatorios/datasets.js` declara cada fonte: `prefixo` do kv_store, `campoData` (a data
que governa o filtro de período), lista de campos com `tipo`, e a flag `sensivel`.

14 fontes na v1: `os`, `clientes`, `agenda`, `financeiro`, `despesas_recorrentes`,
`funcionarios`, `ponto`, `ocorrencias`, `vales`, `contracheques`, `produtos`, `estoque`,
`fornecedores`, `servicos`. As quatro de pessoas (`ponto`, `ocorrencias`, `vales`,
`contracheques`) são `sensivel: true`.

**Adicionar fonte nova é acrescentar um objeto nesta lista** — o engine e a UI crescem
sozinhos. Duas armadilhas verificadas durante a implementação:

- os ids de campo têm que bater com o que o app **realmente grava**. Campo declarado que
  ninguém escreve vira coluna silenciosamente vazia. Ex.: movimentações de estoque vivem em
  `erp:stockMov:`, não em `erp:stock:` (esse guarda saldo por produto);
- `campoData` não pode apontar para campo frequentemente nulo. `contracheques` usa `criadoEm`
  e não `paidAt` de propósito: `paidAt` só existe depois de fechado, e como o período é
  obrigatório, um `campoData` nulável excluiria todo contracheque em aberto de qualquer
  relatório. `paidAt` fica disponível como campo filtrável.

Os status de OS não são duplicados aqui: vêm de `STATUS_OS_KEYS`, exportado por
`src/constants.js`. `STATUS_MAP` é o badge map **global** (OS + Agenda + Cadastros +
Financeiro) e conteria `ativo`/`pago`/`atrasado`, que não são status de OS.

## Engine puro

`src/lib/relatorios/engine.js` **não conhece** `window.storage`, `DB` nem React: recebe arrays
por parâmetro. O módulo carrega com `DB.list(prefixo)` e entrega. Isso mantém o escopo
multi-tenant resolvido num lugar só (a camada DB aplica `cmp_<id>:`) e deixa o engine testável
direto no Vitest.

Ordem de execução: recorte por período → filtros (E lógico) → teto de 50.000 registros →
agrupamento → agregação → ordenação → limite. Totais saem de **todos** os registros usados,
não das linhas exibidas: cortar por limite não pode mudar o rodapé.

Duas decisões que valem lembrar:

- **vazio numérico não é zero.** `Number(null)` e `Number("")` valem `0` em JS. Sem guarda, um
  campo em branco entraria como zero de verdade — puxaria a média para baixo, viraria mínimo
  falso, e casaria com filtros como "menor que 50". Tanto `valorComparavel` quanto a agregação
  filtram vazios antes de coagir;
- **datas são comparadas como string local "YYYY-MM-DD"**, derivada de `getFullYear/Month/Date`.
  `toISOString()` está proibido no caminho de data: à noite no Brasil (UTC-3) o UTC já virou o
  dia seguinte e o período sairia deslocado.

## Modo Pergunta (IA)

Toggle no topo: **Builder** (default) | **Pergunta**. O usuário escolhe — o builder é
determinístico e sem custo; a pergunta é conveniência.

A edge function `relatorio-nl` chama o Claude com uma tool de schema estrito e recebe de volta
um `ReportSpec`. Dois limites deliberados:

1. a IA recebe **só metadados** (ids, labels, tipos, opções de enum) — nenhum dado de cliente
   sai do dispositivo;
2. a IA **não calcula nada** — quem executa é o engine, depois de o cliente validar o spec
   contra o registry.

Isso mantém o custo em uma chamada curta por pergunta, o resultado reproduzível, e o spec
auditável. Spec inválido não vira relatório: os erros aparecem e o usuário cai no Builder.
Sem `ANTHROPIC_API_KEY`, o Builder continua funcionando normalmente.

## Saídas

- **CSV** — dialeto Excel pt-BR: separador `;`, vírgula decimal, BOM UTF-8. Sem isso o arquivo
  abre como coluna única e com acento quebrado nas máquinas dos clientes.
- **Documento imprimível / PDF** — `relatorioHTML` monta o documento com cabeçalho da empresa
  (lido do `erp:config`) e `src/lib/doc.js` abre ou gera o PDF. `openHTMLDoc` e
  `gerarPDFDeHTML` foram extraídos do `App.jsx` para cá, porque `src/modules/` não pode
  importar o `App.jsx` (ele importa os módulos — ciclo).
- **WhatsApp** — edge `relatorio-whatsapp` envia resumo com os totais (`sendText`) e o CSV
  anexado (`sendMedia`) pela instância Evolution da empresa. Passa pelo servidor por dois
  motivos: a CSP de produção só libera `connect-src` para `*.supabase.co`, e a apikey da
  instância não pode chegar ao navegador. Anexo cortado em 5.000 linhas.
- **Salvos** — `erp:relatorio:<id>` guarda a **configuração**, nunca o resultado; reabrir
  recalcula com os dados atuais. Escrito pela camada DB, então ganha escopo por empresa, audit
  trail e sync de graça.

## Permissões

`hasPermission(user, "relatorios")`. Admin (`all`) e gerente por padrão; atendente só via
`customPermissions`. Técnico nunca — o `TecnicoMobileApp` não tem sidebar (Regra 4). O módulo
entra em `TOGGLEABLE_MODULES`, então o Master liga/desliga por empresa.

A flag `sensivel` filtra fontes de pessoas para quem não é admin/gerente. Hoje é redundante
(só esses dois papéis entram no módulo) — existe para que liberar o atendente amanhã seja uma
mudança de permissão, e não uma brecha.

## Limites conhecidos

- Sem join real entre fontes: apenas resolução de referência id → nome (`tecnicoId` vira
  "João Silva").
- Teto de 50.000 registros por execução; acima disso o resultado volta `truncado: true` e a UI
  pede período mais estreito.
- Período é obrigatório em todo relatório (default: mês corrente).
- Gráfico mostra as 30 primeiras categorias; a tabela traz todas.
- Fora da v1: agendamento de envio, dashboards customizáveis, e as fontes auditoria,
  IA/atendimento, pós-venda, escola e LGPD.
