# Módulo Relatórios — Design

- **Data:** 2026-08-04
- **Status:** aprovado (aguardando plano de implementação)
- **Escopo:** novo módulo `relatorios` no FrostERP

## Problema

Hoje a capacidade de relatório do FrostERP está espalhada e engessada. O `FinanceModule`
tem relatórios imprimíveis fixos, o `ProductivityReport` cobre produtividade mensal por
técnico, `PontoBancoHoras` mostra banco de horas, e folha gera contracheque e vale em HTML.
Cada um responde a uma pergunta pré-definida. Não existe forma de o usuário perguntar algo
que ninguém programou antes.

O objetivo do módulo é o oposto disso: uma capacidade **geral** de analisar e gerar
informação a partir de qualquer dado do sistema, com a pergunta definida pelo usuário e não
pelo desenvolvedor.

## Decisões tomadas

| Decisão | Escolha | Alternativas descartadas |
| --- | --- | --- |
| Interação | Híbrido com toggle: Builder estruturado ou Pergunta em linguagem natural, à escolha do usuário | Só builder (exige conhecer o modelo de dados); só IA (não reproduz, difícil auditar, custo por consulta) |
| Onde roda o cálculo | Client-side, sobre arrays vindos de `DB.list` | SQL sobre `kv_store` JSONB via RPC — sem índice por campo, RLS complexa, mata o offline |
| Papel da IA | Traduz pergunta em `ReportSpec`. Não vê dados, não calcula | IA processando os dados e devolvendo resultado pronto |
| Entrega | CSV, HTML imprimível, salvar relatório, envio por WhatsApp | Email agendado (fica pra depois), PDF binário (fica pra depois) |
| Acesso | Admin e gerente. Atendente só via `customPermissions`. Técnico nunca | Atendente liberado por padrão; só admin |

## Arquitetura

Três camadas, nenhuma dentro de `App.jsx`:

```
src/lib/relatorios/
  datasets.js      # registry de fontes: campos, tipos, labels, relações
  engine.js        # aplica ReportSpec sobre arrays → { linhas, colunas, totais }
  csv.js           # resultado → string CSV (formato pt-BR)
  html.js          # resultado → HTML imprimível
  datasets.test.js
  engine.test.js
  csv.test.js

src/modules/RelatoriosModule.jsx        # UI: toggle Builder|Pergunta, preview, ações, aba Salvos

supabase/functions/relatorio-nl/        # pergunta PT-BR → ReportSpec (Claude)
supabase/functions/relatorio-whatsapp/  # envia resumo + CSV via Evolution
```

O `src/modules/` já é o padrão do projeto para módulo extraído: `PontoModule`,
`LembreteModule` e `PosVendaModule` moram lá. `App.jsx` recebe apenas o import e o registro
do módulo.

### Regra de isolamento do engine

O engine **nunca** acessa `window.storage` nem o `DB` diretamente. O módulo carrega os dados
com `DB.list(prefixo)` e entrega arrays prontos. Consequências:

- o engine é puro e testável com Vitest, como manda a convenção do projeto para helpers;
- o escopo multi-tenant continua resolvido em um lugar só (a camada `DB` aplica `cmp_<id>:`);
- trocar a origem dos dados no futuro não obriga a reescrever o engine.

## ReportSpec

Formato único de consulta. O Builder produz um `ReportSpec`, a IA produz um `ReportSpec`, e
"salvar relatório" persiste um `ReportSpec`.

```js
{
  fonte: "os",
  periodo: { campo: "dataAgendada", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [{ campo: "status", op: "igual", valor: "finalizado" }],
  agrupamento: ["tecnicoId"],
  metricas: [
    { campo: "valor", agregacao: "soma" },
    { agregacao: "contagem" }
  ],
  ordenacao: { campo: "valor_soma", direcao: "desc" },
  limite: 100,
  grafico: { tipo: "barra", eixoX: "tecnicoId", series: ["valor_soma"] }
}
```

**Agregações:** `soma`, `media`, `contagem`, `minimo`, `maximo`, `contagem_distinta`.

**Operadores de filtro:** `igual`, `diferente`, `contem`, `maior`, `menor`, `entre`, `vazio`,
`nao_vazio`, `em`.

**Nome das colunas derivadas:** `<campo>_<agregacao>` (ex.: `valor_soma`). A contagem sem
campo vira `contagem`. É esse nome que `ordenacao` e `grafico.series` referenciam.

**Tipos de gráfico:** `barra`, `linha`, `pizza`, `area` — todos já cobertos pelo Recharts,
que o projeto usa no Dashboard e no Financeiro. `grafico` é opcional; sem ele o resultado sai
só como tabela.

**`periodo` é obrigatório.** Default: mês corrente. Sem ele, uma empresa com anos de OS
trava o navegador.

## Registry de datasets

Cada fonte declara:

```js
{
  id: "os",
  label: "Ordens de Serviço",
  prefixo: "erp:os:",
  campoData: "dataAgendada",       // usado pelo filtro de período por default
  sensivel: false,
  campos: [
    { id: "numero", label: "Número", tipo: "numero" },
    { id: "status", label: "Status", tipo: "enum", opcoes: [...] },
    { id: "valor", label: "Valor", tipo: "moeda" },
    { id: "tecnicoId", label: "Técnico", tipo: "referencia", ref: "funcionarios" },
    ...
  ]
}
```

Tipos de campo: `texto`, `numero`, `data`, `moeda`, `enum`, `referencia`.

Campos `referencia` são resolvidos pelo engine — o resultado mostra "João Silva", não o id.
A resolução é um lookup simples por id na fonte referenciada; não é um join genérico.

### Fontes na v1

| id | prefixo | sensível |
| --- | --- | --- |
| `os` | `erp:os:` | não |
| `clientes` | `erp:client:` | não |
| `agenda` | `erp:schedule:` | não |
| `financeiro` | `erp:finance:` | não |
| `despesas_recorrentes` | `erp:despesa_recorrente:` | não |
| `funcionarios` | `erp:employee:` | não |
| `ponto` | `erp:ponto:` | sim |
| `ocorrencias` | `erp:ocorrencia:` | sim |
| `vales` | `erp:vale:` | sim |
| `contracheques` | `erp:contracheque:` | sim |
| `produtos` | `erp:product:` | não |
| `estoque` | `erp:stock:` | não |
| `fornecedores` | `erp:supplier:` | não |
| `servicos` | `erp:service:` | não |

### Fontes fora da v1

Auditoria (`erp:audit:`), IA/atendimento (conversas e propostas), pós-venda, escola
(`erp:escola:`) e LGPD (`erp:consent:`, `erp:exclusao:`). Registrar depois, quando houver
demanda concreta — o registry foi desenhado para aceitar fonte nova sem tocar no engine.

## Modo Builder

Fluxo em coluna: **Fonte → Período → Filtros → Agrupamento → Métricas → Gráfico**.

Cada seletor lê o registry, então adicionar dataset novo faz a UI crescer sozinha. Filtros
são adicionados em lista; o operador disponível depende do tipo do campo (`contem` só em
texto, `entre` só em número/data, e assim por diante).

O botão Gerar só habilita quando o spec tem fonte, período e ao menos uma métrica.

## Modo Pergunta (IA)

Toggle no topo do módulo: **Builder** (default) | **Pergunta**. Os dois modos escrevem no
mesmo `ReportSpec` — trocar de modo não perde o trabalho.

1. Usuário digita em português: *"faturamento por técnico em março, só OS finalizadas"*.
2. O frontend chama `relatorio-nl` (verify_jwt=true) com a pergunta e o registry compacto
   (ids, labels e tipos dos campos). **Nenhum dado de cliente é enviado — só metadados.**
3. A Edge Function chama Claude com uma tool de schema estrito, forçando a resposta no
   formato `ReportSpec`.
4. O cliente **valida o spec contra o registry** antes de executar: a fonte existe? os campos
   existem nessa fonte? a agregação combina com o tipo do campo? o operador do filtro é
   válido? Spec inválido nunca chega ao engine.
5. O spec traduzido aparece **preenchido no Builder**, junto de um resumo em português
   (*"OS · março/2026 · status = finalizado · agrupado por técnico · soma de valor"*).
   O usuário confere, ajusta se quiser, e clica Gerar.

Se a validação falhar, a UI mostra o motivo e mantém no Builder o que deu para aproveitar.
Se `relatorio-nl` estiver indisponível ou sem `ANTHROPIC_API_KEY`, o toggle Pergunta aparece
desabilitado com aviso e o Builder segue funcionando normalmente.

Manter a IA fora do cálculo é o que garante custo baixo (uma chamada curta por pergunta),
resultado auditável e reprodutível, e nenhum dado de cliente trafegando para o modelo.

## Entrega

### Tela

Tabela própria do módulo para o resultado, gráfico Recharts quando o spec traz `grafico`, e
uma faixa de KPIs com os totais gerais.

> Ajuste em relação ao desenho original: o `DataTable` do `App.jsx` **não** é reusável aqui.
> Ele não é exportado, e importá-lo de `src/modules/` criaria import circular — o `App.jsx`
> importa os módulos. `LembreteModule` e `PontoModule` já renderizam tabela própria pelo mesmo
> motivo; o módulo segue esse padrão.

### CSV

Gerado no cliente por `csv.js`. Formato pt-BR para o Excel abrir sem estragar: separador `;`,
decimal com vírgula, BOM UTF-8. Valores com `;`, aspas ou quebra de linha são escapados com
aspas duplas.

### Documento imprimível e PDF

`html.js` monta o documento no mesmo visual dos documentos de OS/orçamento (logo e dados da
empresa) e abre via `openHTMLDoc`.

> Ajuste em relação ao desenho original: **PDF binário entra na v1.** `html2pdf.js` já é
> dependência do projeto e `gerarPDFDeHTML()` já existe no `App.jsx` — o custo é extrair as
> duas funções para `src/lib/doc.js` (o módulo não pode importar do `App.jsx` sem criar ciclo)
> e chamar. `_docStyles`/`_docHeader` continuam no `App.jsx` e não são reusáveis pelo mesmo
> motivo, então `html.js` carrega o próprio CSS, deliberadamente parecido.

### Salvar relatório

Persiste em `erp:relatorio:<id>` via `DB.set`, o que já garante escopo por empresa, registro
no audit trail e sync com o Supabase. Registro:

```js
{ id, nome, descricao, spec, criadoPor, criadoEm, atualizadoEm }
```

Aba "Salvos" lista, executa, edita, duplica e exclui. O prefixo `erp:relatorio:` precisa
entrar em `SCOPED_PREFIXES` e `AUDITED_PREFIXES`.

### Envio por WhatsApp

Botão "Enviar no WhatsApp" disponível em relatório já gerado. O frontend chama
`relatorio-whatsapp` (verify_jwt=true) com `{ companyId, telefone, nomeRelatorio, resumo,
csvBase64 }`. A Edge Function:

1. valida que o caller é admin ou gerente da `companyId`;
2. busca `evolution_url`, `evolution_instance` e apikey da empresa — mesmo lookup usado por
   `lembrete-dispatch`;
3. envia `sendText` com o resumo dos totais;
4. envia `sendMedia` com o CSV anexado.

A Global API Key do Evolution nunca vai para o cliente. O telefone default vem do cadastro
da empresa e é editável no diálogo de envio. Se o CSV passar de ~1 MB, é cortado nas
primeiras 5.000 linhas e a mensagem avisa o corte.

## Permissões e segurança

- Gate por `hasPermission(user, "relatorios")`. Admin e gerente por default em
  `ROLE_PERMISSIONS`; atendente apenas se o admin liberar em `customPermissions`.
- Técnico nunca acessa: o `TecnicoMobileApp` não tem sidebar e não é alterado (Regra 4).
- `relatorios` entra em `ALL_MODULES` e em `TOGGLEABLE_MODULES`, para o Master ligar ou
  desligar por empresa.
- Datasets marcados `sensivel: true` (ponto, ocorrências, vales, contracheques) são filtrados
  da lista de fontes quando o usuário não é admin nem gerente. Na v1 esse gate é redundante,
  porque só admin e gerente entram no módulo — existe para que liberar o atendente no futuro
  seja uma mudança de permissão, não uma brecha de vazamento.

## Performance

- Período obrigatório, com default do mês corrente: o engine filtra por data antes de agrupar.
- Teto de 50.000 registros lidos por execução. Ao estourar, o engine devolve `truncado: true`
  e a UI avisa pedindo período mais estreito. Avisar é melhor que renderizar errado em
  silêncio.
- A resolução de campos `referencia` carrega a fonte referenciada uma vez e monta um índice
  por id, em vez de varrer a lista por linha.

## Erros

- `ModuleErrorBoundary` já isola crash do módulo ativo.
- Spec inválido é barrado na validação, antes do engine.
- Resultado vazio mostra `EmptyState` com o motivo ("nenhum registro no período").
- Falha de rede no envio WhatsApp gera toast de erro e preserva o relatório gerado na tela.

## Testes

Vitest, sobre as camadas puras:

- `engine.test.js` — cada agregação, cada operador de filtro, agrupamento por mais de um
  campo, resolução de referência, recorte por período, teto de 50k com `truncado: true`.
- `csv.test.js` — escape de `;`, aspas e quebra de linha; decimal pt-BR; BOM UTF-8.
- `datasets.test.js` — todo dataset tem prefixo válido e `campoData` que existe na lista de
  campos.

UI e Edge Functions ficam sem teste automatizado: o projeto não tem essa infraestrutura hoje
e este não é o momento de criá-la.

## Fora de escopo

- Agendamento automático de envio (diário/semanal/mensal).
- Dashboards customizáveis / fixar relatório no Dashboard.
- Join real entre duas fontes. A v1 resolve apenas referência simples id → nome.
- As fontes extras listadas em "Fontes fora da v1".

## Integração com o resto do projeto

- Registro do módulo em `ALL_MODULES`, `TOGGLEABLE_MODULES`, `navItems`, `ModuleSwitcher`, e
  ícone novo em `FrostIcons.jsx`.
- `erp:relatorio:` adicionado a `SCOPED_PREFIXES` e `AUDITED_PREFIXES`.
- Duas Edge Functions novas a deployar: `relatorio-nl` e `relatorio-whatsapp`.
- Secret novo: `ANTHROPIC_API_KEY` para `relatorio-nl`.
- Wiki (Regra 5): criar `docs/wiki/modules/relatorios.md`, adicionar a linha em
  `docs/wiki/index.md` e registrar a entrada em `docs/wiki/log.md` ao fim da implementação.
- Deploy contínuo (Regra 1): commit e deploy na Vercel.
