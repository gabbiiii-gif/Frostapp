# Módulo Relatórios — Plano de Implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Entregar um módulo `relatorios` no FrostERP onde o usuário monta a análise que quiser — por builder estruturado ou por pergunta em português — sobre qualquer entidade do sistema, com export CSV/PDF, relatórios salvos e envio por WhatsApp.

**Architecture:** Três camadas isoladas. `src/lib/relatorios/` concentra o núcleo puro (registry de fontes, validação de spec, engine de agregação, geradores CSV e HTML) e é 100% testável com Vitest. `src/modules/RelatoriosModule.jsx` é a UI e a única camada que toca o `DB`. Duas Edge Functions cobrem o que não pode rodar no cliente: tradução de pergunta em `ReportSpec` (chave da Anthropic) e envio WhatsApp (CSP bloqueia fetch direto ao Evolution).

**Tech Stack:** React 19 (JSX, sem TypeScript), Vite 6, Tailwind 4, Recharts 3, Vitest 4 + happy-dom, Supabase (kv_store + Edge Functions Deno), html2pdf.js (já instalado).

## Global Constraints

- Toda UI, label, mensagem, categoria e comentário de código em **pt-BR**.
- Comentar os pontos importantes em pt-BR (Regra 2 do CLAUDE.md).
- Responsivo desktop + mobile (Regra 3).
- `role="tecnico"` nunca acessa este módulo (Regra 4). Não tocar em `TecnicoMobileApp`.
- Helper puro novo vai para `src/lib/` **com teste** — nunca para dentro do `App.jsx`.
- O engine nunca acessa `window.storage` nem `DB` — recebe arrays por parâmetro.
- Prefixo de storage do módulo: `erp:relatorio:` (com dois-pontos no fim).
- Teto do engine: `LIMITE_REGISTROS = 50000`.
- Período é obrigatório em todo `ReportSpec`; default é o mês corrente.
- Comando de teste: `npm run test`. Lint: `npm run lint`.
- Nomes de coluna derivada: `<campo>_<agregacao>`; contagem sem campo vira `contagem`.
- Spec de referência: `docs/superpowers/specs/2026-08-04-modulo-relatorios-design.md`.

## Estrutura de arquivos

| Arquivo | Responsabilidade |
| --- | --- |
| `src/lib/relatorios/datasets.js` | Registry: quais fontes existem, campos, tipos, labels, relações, flag `sensivel` |
| `src/lib/relatorios/spec.js` | `ReportSpec`: criação, normalização, validação contra o registry, resumo em pt-BR |
| `src/lib/relatorios/engine.js` | Filtro por período, filtros, agrupamento, agregação, ordenação, limite, resolução de referência |
| `src/lib/relatorios/csv.js` | Resultado → string CSV pt-BR (`;`, vírgula decimal, BOM) |
| `src/lib/relatorios/html.js` | Resultado → HTML imprimível reusando o visual dos documentos |
| `src/lib/pdf.js` | `gerarPDFDeHTML` extraído do `App.jsx` + `htmlParaPDFBase64` |
| `src/modules/RelatoriosModule.jsx` | UI: Builder, modo Pergunta, resultado, aba Salvos, exports |
| `supabase/functions/relatorio-nl/index.ts` | Pergunta pt-BR → `ReportSpec` via Claude |
| `supabase/functions/relatorio-whatsapp/index.ts` | Envia resumo + arquivo via Evolution |

## Tarefas

- Task 1 — Registry: infra + fontes `os`, `clientes`, `financeiro`
- Task 2 — Registry: as 10 fontes restantes (`funcionarios` foi antecipada para a Task 1)
- Task 3 — `spec.js`: criação, normalização, validação, resumo
- Task 4 — `engine.js`: período e filtros
- Task 5 — `engine.js`: agrupamento, agregação, ordenação, limite, referência
- Task 6 — `csv.js`
- Task 7 — `html.js`
- Task 8 — `src/lib/pdf.js` (extração do `App.jsx`)
- Task 9 — `RelatoriosModule.jsx`: Builder + resultado
- Task 10 — Registro no shell + permissões
- Task 11 — Relatórios salvos (`erp:relatorio:`)
- Task 12 — Exports na UI (CSV, PDF, impressão)
- Task 13 — Edge `relatorio-whatsapp` + botão de envio
- Task 14 — Edge `relatorio-nl` + modo Pergunta
- Task 15 — Wiki, CLAUDE.md e deploy

---

### Task 1: Registry — infra + fontes `os`, `clientes`, `financeiro`

**Files:**
- Create: `src/lib/relatorios/datasets.js`
- Test: `src/lib/relatorios/datasets.test.js`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `DATASETS` — array de objetos `{ id, label, prefixo, campoData, sensivel, campos }`
  - `campos[]` — `{ id, label, tipo, opcoes?, ref? }`, `tipo ∈ "texto"|"numero"|"data"|"moeda"|"enum"|"referencia"`
  - `getDataset(id)` → objeto do dataset ou `null`
  - `getCampo(datasetId, campoId)` → objeto do campo ou `null`
  - `listarDatasets({ podeVerSensivel })` → array de datasets filtrado
  - `registryCompacto()` → `[{ id, label, campos: [{ id, label, tipo }] }]` (payload da IA)
  - `TIPOS_CAMPO`, `AGREGACOES`, `OPERADORES`

- [ ] **Step 1: Confirmar os nomes reais de campo antes de escrever o registry**

Rode e leia a saída — os nomes abaixo foram verificados no código, esta etapa é a rede de proteção contra drift:

```bash
grep -n "DB.set(\"erp:os:\" +" -B 40 src/App.jsx | head -80
grep -n "DB.set(\"erp:client:\" +" -B 20 src/App.jsx | head -40
grep -n "DB.set(\"erp:finance:\" +" -B 18 src/App.jsx | head -60
```

Se algum campo divergir do que está no Step 3, use o nome real do código e ajuste também os testes do Step 2.

- [ ] **Step 2: Escrever o teste que falha**

`src/lib/relatorios/datasets.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  DATASETS, getDataset, getCampo, listarDatasets, registryCompacto, TIPOS_CAMPO,
} from "./datasets.js";

describe("datasets — integridade do registry", () => {
  it("todo dataset tem id, label, prefixo terminado em ':' e campos", () => {
    expect(DATASETS.length).toBeGreaterThan(0);
    for (const d of DATASETS) {
      expect(d.id).toBeTruthy();
      expect(d.label).toBeTruthy();
      expect(d.prefixo.endsWith(":")).toBe(true);
      expect(Array.isArray(d.campos)).toBe(true);
      expect(d.campos.length).toBeGreaterThan(0);
    }
  });

  it("todo campo tem tipo válido", () => {
    for (const d of DATASETS) {
      for (const c of d.campos) {
        expect(TIPOS_CAMPO).toContain(c.tipo);
      }
    }
  });

  it("campoData aponta para um campo existente do tipo data", () => {
    for (const d of DATASETS) {
      const campo = d.campos.find((c) => c.id === d.campoData);
      expect(campo, `dataset ${d.id} sem campoData válido`).toBeTruthy();
      expect(campo.tipo).toBe("data");
    }
  });

  it("campo do tipo referencia aponta para um dataset existente", () => {
    for (const d of DATASETS) {
      for (const c of d.campos.filter((x) => x.tipo === "referencia")) {
        expect(getDataset(c.ref), `${d.id}.${c.id} → ${c.ref}`).toBeTruthy();
      }
    }
  });

  it("não há id de dataset duplicado", () => {
    const ids = DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("datasets — acessores", () => {
  it("getDataset devolve null para id inexistente", () => {
    expect(getDataset("nao_existe")).toBeNull();
  });

  it("getCampo acha campo por dataset", () => {
    expect(getCampo("os", "valor").tipo).toBe("moeda");
    expect(getCampo("os", "nao_existe")).toBeNull();
  });

  it("listarDatasets esconde fontes sensíveis por padrão", () => {
    const visiveis = listarDatasets({ podeVerSensivel: false });
    expect(visiveis.every((d) => !d.sensivel)).toBe(true);
  });

  it("registryCompacto não vaza prefixo nem flag sensivel", () => {
    const r = registryCompacto();
    expect(r[0].prefixo).toBeUndefined();
    expect(r[0].sensivel).toBeUndefined();
    expect(r[0].campos[0].label).toBeTruthy();
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/datasets.test.js`
Expected: FAIL — `Failed to resolve import "./datasets.js"`.

- [ ] **Step 4: Implementar o registry**

`src/lib/relatorios/datasets.js`:

```js
// Registry de fontes de dados do módulo Relatórios.
// Cada entrada descreve UMA entidade do kv_store: onde ela mora (prefixo), qual
// campo de data governa o filtro de período, e quais campos podem ser filtrados,
// agrupados ou agregados. O engine e a UI leem só daqui — adicionar fonte nova
// é acrescentar um objeto nesta lista, sem tocar em engine nem em componente.

export const TIPOS_CAMPO = ["texto", "numero", "data", "moeda", "enum", "referencia"];

// Agregações suportadas pelo engine. `contagem` é a única que dispensa campo.
export const AGREGACOES = [
  { id: "soma", label: "Soma", tipos: ["numero", "moeda"] },
  { id: "media", label: "Média", tipos: ["numero", "moeda"] },
  { id: "contagem", label: "Contagem", tipos: [] },
  { id: "minimo", label: "Mínimo", tipos: ["numero", "moeda", "data"] },
  { id: "maximo", label: "Máximo", tipos: ["numero", "moeda", "data"] },
  { id: "contagem_distinta", label: "Contagem distinta", tipos: ["texto", "enum", "referencia", "numero"] },
];

// Operadores de filtro por tipo de campo.
export const OPERADORES = [
  { id: "igual", label: "é igual a", tipos: ["texto", "numero", "moeda", "data", "enum", "referencia"] },
  { id: "diferente", label: "é diferente de", tipos: ["texto", "numero", "moeda", "data", "enum", "referencia"] },
  { id: "contem", label: "contém", tipos: ["texto"] },
  { id: "maior", label: "maior que", tipos: ["numero", "moeda", "data"] },
  { id: "menor", label: "menor que", tipos: ["numero", "moeda", "data"] },
  { id: "entre", label: "entre", tipos: ["numero", "moeda", "data"] },
  { id: "vazio", label: "está vazio", tipos: ["texto", "numero", "moeda", "data", "enum", "referencia"] },
  { id: "nao_vazio", label: "não está vazio", tipos: ["texto", "numero", "moeda", "data", "enum", "referencia"] },
  { id: "em", label: "está na lista", tipos: ["texto", "enum", "referencia"] },
];

const STATUS_OS = [
  "aguardando", "agendado", "em_servico", "aguardando_finalizacao", "finalizado", "cancelado",
];

export const DATASETS = [
  {
    id: "os",
    label: "Ordens de Serviço",
    prefixo: "erp:os:",
    campoData: "dataAbertura",
    sensivel: false,
    campos: [
      { id: "numero", label: "Número", tipo: "numero" },
      { id: "status", label: "Status", tipo: "enum", opcoes: STATUS_OS },
      { id: "tipo", label: "Tipo de serviço", tipo: "texto" },
      { id: "clienteId", label: "Cliente", tipo: "referencia", ref: "clientes" },
      { id: "clienteNome", label: "Cliente (nome gravado)", tipo: "texto" },
      { id: "tecnicoId", label: "Técnico", tipo: "referencia", ref: "funcionarios" },
      { id: "tecnicoNome", label: "Técnico (nome gravado)", tipo: "texto" },
      { id: "valor", label: "Valor", tipo: "moeda" },
      { id: "equipamentoTipo", label: "Equipamento", tipo: "texto" },
      { id: "equipamentoModelo", label: "Modelo", tipo: "texto" },
      { id: "descricao", label: "Descrição", tipo: "texto" },
      { id: "observacoes", label: "Observações", tipo: "texto" },
      { id: "dataAbertura", label: "Data de abertura", tipo: "data" },
      { id: "dataAgendada", label: "Data agendada", tipo: "data" },
      { id: "dataConclusao", label: "Data de conclusão", tipo: "data" },
    ],
  },
  {
    id: "clientes",
    label: "Clientes",
    prefixo: "erp:client:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "nome", label: "Nome", tipo: "texto" },
      { id: "tipo", label: "Tipo", tipo: "enum", opcoes: ["pf", "pj"] },
      { id: "telefone", label: "Telefone", tipo: "texto" },
      { id: "email", label: "E-mail", tipo: "texto" },
      { id: "status", label: "Status", tipo: "enum", opcoes: ["ativo", "inativo"] },
      { id: "origem", label: "Origem", tipo: "texto" },
      { id: "createdAt", label: "Data de cadastro", tipo: "data" },
    ],
  },
  {
    id: "financeiro",
    label: "Financeiro",
    prefixo: "erp:finance:",
    campoData: "data",
    sensivel: false,
    campos: [
      { id: "numero", label: "Número", tipo: "texto" },
      { id: "descricao", label: "Descrição", tipo: "texto" },
      { id: "tipo", label: "Tipo", tipo: "enum", opcoes: ["receita", "despesa"] },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "valor", label: "Valor", tipo: "moeda" },
      { id: "status", label: "Status", tipo: "enum", opcoes: ["pendente", "pago", "atrasado"] },
      { id: "formaPagamento", label: "Forma de pagamento", tipo: "texto" },
      { id: "osId", label: "OS de origem", tipo: "referencia", ref: "os" },
      { id: "data", label: "Data", tipo: "data" },
      { id: "createdAt", label: "Data de criação", tipo: "data" },
    ],
  },
];

export function getDataset(id) {
  return DATASETS.find((d) => d.id === id) || null;
}

export function getCampo(datasetId, campoId) {
  const d = getDataset(datasetId);
  if (!d) return null;
  return d.campos.find((c) => c.id === campoId) || null;
}

// Fontes sensíveis (folha, ponto, vales) só aparecem para quem pode vê-las.
export function listarDatasets({ podeVerSensivel = false } = {}) {
  return DATASETS.filter((d) => podeVerSensivel || !d.sensivel);
}

// Payload enviado à IA: só metadados (id, label, tipo). Nenhum dado de cliente,
// nenhum prefixo de storage, nenhuma flag interna.
export function registryCompacto({ podeVerSensivel = false } = {}) {
  return listarDatasets({ podeVerSensivel }).map((d) => ({
    id: d.id,
    label: d.label,
    campoData: d.campoData,
    campos: d.campos.map((c) => ({
      id: c.id,
      label: c.label,
      tipo: c.tipo,
      ...(c.opcoes ? { opcoes: c.opcoes } : {}),
    })),
  }));
}
```

- [ ] **Step 5: Rodar o teste e ver passar**

Run: `npm run test -- src/lib/relatorios/datasets.test.js`
Expected: PASS, 10 testes.

- [ ] **Step 6: Commit**

```bash
git add src/lib/relatorios/datasets.js src/lib/relatorios/datasets.test.js
git commit -m "feat(relatorios): registry de datasets com OS, clientes e financeiro"
```

---

### Task 2: Registry — as 10 fontes restantes

> Ajuste durante a execução: `funcionarios` foi antecipada para a Task 1, porque `os.tecnicoId`
> já a referencia e o teste de integridade referencial da Task 1 exige que o alvo exista. A
> Task 2 acrescenta as 10 fontes restantes; o total continua 14.

**Files:**
- Modify: `src/lib/relatorios/datasets.js` (acrescentar entradas ao array `DATASETS`)
- Test: `src/lib/relatorios/datasets.test.js` (acrescentar bloco)

**Interfaces:**
- Consumes: `DATASETS`, `getDataset` da Task 1 (que já traz `os`, `clientes`, `financeiro` e `funcionarios`).
- Produces: `DATASETS` com 14 fontes: `os`, `clientes`, `agenda`, `financeiro`, `despesas_recorrentes`, `funcionarios`, `ponto`, `ocorrencias`, `vales`, `contracheques`, `produtos`, `estoque`, `fornecedores`, `servicos`.

- [ ] **Step 1: Confirmar nomes de campo de cada entidade**

```bash
grep -n "DB.set(\"erp:employee:\" +" -B 25 src/App.jsx | head -60
grep -n "DB.set(\"erp:product:\" +" -B 20 src/App.jsx | head -50
grep -n "DB.set(\"erp:stock:\" +" -B 20 src/App.jsx | head -50
grep -n "DB.set(\"erp:supplier:\" +" -B 20 src/App.jsx | head -50
grep -n "DB.set(\"erp:service:\" +" -B 18 src/App.jsx | head -40
grep -n "DB.set(\"erp:schedule:\" +" -B 18 src/App.jsx | head -40
grep -n "DB.set(\"erp:vale:\" +\|DB.set(\"erp:contracheque:\" +" -B 20 src/App.jsx | head -60
grep -rn "erp:ponto:\|erp:ocorrencia:" src/lib/ponto.js src/lib/ocorrencias.js | head -20
grep -n "despesa_recorrente" -A 15 src/App.jsx | grep -n "diaVencimento\|mesInicio\|categoria" | head
```

Ajuste os campos do Step 3 para bater com o que o código realmente grava. Campo que você não conseguir confirmar, **não declare** — fonte com campo fantasma gera relatório vazio silencioso.

- [ ] **Step 2: Escrever o teste que falha**

Acrescente ao fim de `src/lib/relatorios/datasets.test.js`:

```js
describe("datasets — cobertura das 14 fontes da v1", () => {
  const esperados = [
    "os", "clientes", "agenda", "financeiro", "despesas_recorrentes",
    "funcionarios", "ponto", "ocorrencias", "vales", "contracheques",
    "produtos", "estoque", "fornecedores", "servicos",
  ];

  it("todas as fontes da v1 estão registradas", () => {
    for (const id of esperados) {
      expect(getDataset(id), `faltou dataset ${id}`).toBeTruthy();
    }
    expect(DATASETS.length).toBe(esperados.length);
  });

  it("ponto, ocorrencias, vales e contracheques são sensíveis", () => {
    for (const id of ["ponto", "ocorrencias", "vales", "contracheques"]) {
      expect(getDataset(id).sensivel, `${id} deveria ser sensível`).toBe(true);
    }
  });

  it("fontes não sensíveis continuam visíveis sem privilégio", () => {
    const visiveis = listarDatasets({ podeVerSensivel: false }).map((d) => d.id);
    expect(visiveis).toContain("os");
    expect(visiveis).not.toContain("contracheques");
    expect(listarDatasets({ podeVerSensivel: true }).length).toBe(DATASETS.length);
  });
});
```

- [ ] **Step 3: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/datasets.test.js`
Expected: FAIL — `faltou dataset agenda`.

- [ ] **Step 4: Acrescentar as fontes ao registry**

Insira estes objetos no array `DATASETS` de `src/lib/relatorios/datasets.js`, depois de `financeiro`:

```js
  {
    id: "agenda",
    label: "Agenda",
    prefixo: "erp:schedule:",
    campoData: "data",
    sensivel: false,
    campos: [
      { id: "titulo", label: "Título", tipo: "texto" },
      { id: "tipo", label: "Tipo", tipo: "texto" },
      { id: "data", label: "Data", tipo: "data" },
      { id: "hora", label: "Hora", tipo: "texto" },
      { id: "clienteId", label: "Cliente", tipo: "referencia", ref: "clientes" },
      { id: "responsavelId", label: "Responsável", tipo: "referencia", ref: "funcionarios" },
      { id: "descricao", label: "Descrição", tipo: "texto" },
      { id: "status", label: "Status", tipo: "texto" },
    ],
  },
  {
    id: "despesas_recorrentes",
    label: "Despesas recorrentes",
    prefixo: "erp:despesa_recorrente:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "descricao", label: "Descrição", tipo: "texto" },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "valor", label: "Valor", tipo: "moeda" },
      { id: "diaVencimento", label: "Dia de vencimento", tipo: "numero" },
      { id: "mesInicio", label: "Mês de início", tipo: "texto" },
      { id: "ativo", label: "Ativo", tipo: "enum", opcoes: [true, false] },
      { id: "createdAt", label: "Data de criação", tipo: "data" },
    ],
  },
  {
    id: "ponto",
    label: "Ponto — batidas",
    prefixo: "erp:ponto:",
    campoData: "datahora",
    sensivel: true,
    campos: [
      { id: "employee_id", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "tipo", label: "Tipo de batida", tipo: "texto" },
      { id: "datahora", label: "Data e hora", tipo: "data" },
      { id: "origem", label: "Origem", tipo: "texto" },
      { id: "manual_motivo", label: "Motivo (edição manual)", tipo: "texto" },
    ],
  },
  {
    id: "ocorrencias",
    label: "Ponto — ocorrências",
    prefixo: "erp:ocorrencia:",
    campoData: "data_ref",
    sensivel: true,
    campos: [
      { id: "employee_id", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "tipo", label: "Tipo", tipo: "texto" },
      { id: "status", label: "Status", tipo: "enum", opcoes: ["pendente", "aprovado", "rejeitado"] },
      { id: "data_ref", label: "Data de referência", tipo: "data" },
      { id: "observacao", label: "Observação", tipo: "texto" },
    ],
  },
  {
    id: "vales",
    label: "Vales",
    prefixo: "erp:vale:",
    campoData: "data",
    sensivel: true,
    campos: [
      { id: "employeeId", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "valor", label: "Valor", tipo: "moeda" },
      { id: "data", label: "Data", tipo: "data" },
      { id: "descricao", label: "Descrição", tipo: "texto" },
      { id: "status", label: "Status", tipo: "texto" },
    ],
  },
  {
    id: "contracheques",
    label: "Contracheques",
    prefixo: "erp:contracheque:",
    campoData: "data",
    sensivel: true,
    campos: [
      { id: "employeeId", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "competencia", label: "Competência", tipo: "texto" },
      { id: "salarioBase", label: "Salário base", tipo: "moeda" },
      { id: "descontos", label: "Descontos", tipo: "moeda" },
      { id: "liquido", label: "Líquido", tipo: "moeda" },
      { id: "data", label: "Data", tipo: "data" },
    ],
  },
  {
    id: "produtos",
    label: "Produtos",
    prefixo: "erp:product:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "nome", label: "Nome", tipo: "texto" },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "precoVenda", label: "Preço de venda", tipo: "moeda" },
      { id: "precoCusto", label: "Preço de custo", tipo: "moeda" },
      { id: "quantidade", label: "Quantidade", tipo: "numero" },
      { id: "estoqueMinimo", label: "Estoque mínimo", tipo: "numero" },
      { id: "fornecedorId", label: "Fornecedor", tipo: "referencia", ref: "fornecedores" },
      { id: "createdAt", label: "Data de cadastro", tipo: "data" },
    ],
  },
  {
    id: "estoque",
    label: "Movimentações de estoque",
    prefixo: "erp:stock:",
    campoData: "data",
    sensivel: false,
    campos: [
      { id: "produtoId", label: "Produto", tipo: "referencia", ref: "produtos" },
      { id: "tipo", label: "Tipo", tipo: "enum", opcoes: ["entrada", "saida"] },
      { id: "quantidade", label: "Quantidade", tipo: "numero" },
      { id: "motivo", label: "Motivo", tipo: "texto" },
      { id: "data", label: "Data", tipo: "data" },
    ],
  },
  {
    id: "fornecedores",
    label: "Fornecedores",
    prefixo: "erp:supplier:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "nome", label: "Nome", tipo: "texto" },
      { id: "cnpj", label: "CNPJ", tipo: "texto" },
      { id: "telefone", label: "Telefone", tipo: "texto" },
      { id: "email", label: "E-mail", tipo: "texto" },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "createdAt", label: "Data de cadastro", tipo: "data" },
    ],
  },
  {
    id: "servicos",
    label: "Serviços",
    prefixo: "erp:service:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "nome", label: "Nome", tipo: "texto" },
      { id: "categoria", label: "Categoria", tipo: "texto" },
      { id: "preco", label: "Preço", tipo: "moeda" },
      { id: "duracao", label: "Duração (min)", tipo: "numero" },
      { id: "createdAt", label: "Data de cadastro", tipo: "data" },
    ],
  },
```

- [ ] **Step 5: Rodar todos os testes**

Run: `npm run test -- src/lib/relatorios/datasets.test.js`
Expected: PASS. Se `campoData aponta para um campo existente do tipo data` falhar, o campo de data declarado não existe na entidade — volte ao Step 1 e corrija com o nome real.

- [ ] **Step 6: Commit**

```bash
git add src/lib/relatorios/datasets.js src/lib/relatorios/datasets.test.js
git commit -m "feat(relatorios): registrar as 14 fontes de dados da v1"
```

---

### Task 3: `spec.js` — criação, normalização, validação e resumo

**Files:**
- Create: `src/lib/relatorios/spec.js`
- Test: `src/lib/relatorios/spec.test.js`

**Interfaces:**
- Consumes: `getDataset`, `getCampo`, `AGREGACOES`, `OPERADORES` de `./datasets.js`.
- Produces:
  - `specVazio(datasetId, hoje = new Date())` → `ReportSpec` com período do mês corrente
  - `colunaMetrica(metrica)` → `"valor_soma"` | `"contagem"`
  - `validarSpec(spec)` → `{ ok: boolean, erros: string[], spec: ReportSpec|null }` (spec normalizado quando `ok`)
  - `resumoSpec(spec)` → string pt-BR de uma linha
  - `primeiroEUltimoDiaDoMes(data)` → `{ de: "YYYY-MM-DD", ate: "YYYY-MM-DD" }`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/relatorios/spec.test.js`:

```js
import { describe, it, expect } from "vitest";
import { specVazio, validarSpec, resumoSpec, colunaMetrica, primeiroEUltimoDiaDoMes } from "./spec.js";

const specOk = {
  fonte: "os",
  periodo: { campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [{ campo: "status", op: "igual", valor: "finalizado" }],
  agrupamento: ["tecnicoId"],
  metricas: [{ campo: "valor", agregacao: "soma" }, { agregacao: "contagem" }],
  ordenacao: { campo: "valor_soma", direcao: "desc" },
  limite: 100,
  grafico: { tipo: "barra", eixoX: "tecnicoId", series: ["valor_soma"] },
};

describe("spec.primeiroEUltimoDiaDoMes", () => {
  it("cobre o mês inteiro em datas locais", () => {
    expect(primeiroEUltimoDiaDoMes(new Date(2026, 1, 15))).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(primeiroEUltimoDiaDoMes(new Date(2024, 1, 10)).ate).toBe("2024-02-29");
  });
});

describe("spec.specVazio", () => {
  it("usa o campoData do dataset e o mês corrente", () => {
    const s = specVazio("os", new Date(2026, 2, 10));
    expect(s.fonte).toBe("os");
    expect(s.periodo).toEqual({ campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" });
    expect(s.metricas).toEqual([{ agregacao: "contagem" }]);
    expect(s.filtros).toEqual([]);
  });
});

describe("spec.colunaMetrica", () => {
  it("nomeia campo_agregacao e contagem pura", () => {
    expect(colunaMetrica({ campo: "valor", agregacao: "soma" })).toBe("valor_soma");
    expect(colunaMetrica({ agregacao: "contagem" })).toBe("contagem");
  });
});

describe("spec.validarSpec", () => {
  it("aceita um spec completo e válido", () => {
    const r = validarSpec(specOk);
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
  });

  it("rejeita fonte inexistente", () => {
    const r = validarSpec({ ...specOk, fonte: "planilha_magica" });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("planilha_magica");
  });

  it("rejeita campo que não existe na fonte", () => {
    const r = validarSpec({ ...specOk, agrupamento: ["cor_favorita"] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("cor_favorita");
  });

  it("rejeita soma sobre campo de texto", () => {
    const r = validarSpec({ ...specOk, metricas: [{ campo: "descricao", agregacao: "soma" }] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("soma");
  });

  it("rejeita operador incompatível com o tipo do campo", () => {
    const r = validarSpec({ ...specOk, filtros: [{ campo: "valor", op: "contem", valor: "x" }] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("contem");
  });

  it("exige período", () => {
    const r = validarSpec({ ...specOk, periodo: null });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("Período");
  });

  it("exige ao menos uma métrica", () => {
    const r = validarSpec({ ...specOk, metricas: [] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("métrica");
  });

  it("normaliza limite ausente para 500 e corta acima de 5000", () => {
    expect(validarSpec({ ...specOk, limite: undefined }).spec.limite).toBe(500);
    expect(validarSpec({ ...specOk, limite: 999999 }).spec.limite).toBe(5000);
  });

  it("descarta gráfico cujo eixo não está no agrupamento", () => {
    const r = validarSpec({ ...specOk, grafico: { tipo: "barra", eixoX: "status", series: ["valor_soma"] } });
    expect(r.ok).toBe(true);
    expect(r.spec.grafico).toBeNull();
  });

  it("descarta ordenação por coluna que o resultado não terá", () => {
    const r = validarSpec({ ...specOk, ordenacao: { campo: "nao_existe", direcao: "asc" } });
    expect(r.ok).toBe(true);
    expect(r.spec.ordenacao).toBeNull();
  });
});

describe("spec.resumoSpec", () => {
  it("descreve o spec em português", () => {
    const texto = resumoSpec(specOk);
    expect(texto).toContain("Ordens de Serviço");
    expect(texto).toContain("01/03/2026");
    expect(texto).toContain("Técnico");
    expect(texto).toContain("Soma de Valor");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/spec.test.js`
Expected: FAIL — `Failed to resolve import "./spec.js"`.

- [ ] **Step 3: Implementar `spec.js`**

`src/lib/relatorios/spec.js`:

```js
// ReportSpec — o formato único de consulta do módulo Relatórios.
// Builder, modo Pergunta (IA) e "relatório salvo" produzem e consomem o MESMO
// objeto. Nada roda no engine sem passar por validarSpec: é aqui que a saída da
// IA é conferida contra o registry antes de virar cálculo.

import { getDataset, getCampo, AGREGACOES, OPERADORES } from "./datasets.js";

const LIMITE_PADRAO = 500;
const LIMITE_MAXIMO = 5000;
const TIPOS_GRAFICO = ["barra", "linha", "pizza", "area"];

// "YYYY-MM-DD" no fuso LOCAL — mesma escolha do toISODate do App.jsx: à noite no
// Brasil (UTC-3) o UTC já virou o dia seguinte e o período sairia deslocado.
function iso(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function primeiroEUltimoDiaDoMes(data = new Date()) {
  const d = data instanceof Date ? data : new Date(data);
  const primeiro = new Date(d.getFullYear(), d.getMonth(), 1);
  // Dia 0 do mês seguinte = último dia do mês atual (cobre fevereiro bissexto).
  const ultimo = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return { de: iso(primeiro), ate: iso(ultimo) };
}

export function specVazio(datasetId, hoje = new Date()) {
  const ds = getDataset(datasetId);
  if (!ds) return null;
  const { de, ate } = primeiroEUltimoDiaDoMes(hoje);
  return {
    fonte: ds.id,
    periodo: { campo: ds.campoData, de, ate },
    filtros: [],
    agrupamento: [],
    metricas: [{ agregacao: "contagem" }],
    ordenacao: null,
    limite: LIMITE_PADRAO,
    grafico: null,
  };
}

export function colunaMetrica(metrica) {
  if (!metrica || !metrica.agregacao) return "";
  if (!metrica.campo) return metrica.agregacao;
  return `${metrica.campo}_${metrica.agregacao}`;
}

function labelAgregacao(id) {
  return (AGREGACOES.find((a) => a.id === id) || {}).label || id;
}

function fmtData(s) {
  if (!s) return "—";
  const [y, m, d] = String(s).split("-");
  return d ? `${d}/${m}/${y}` : String(s);
}

// Valida um ReportSpec inteiro contra o registry e devolve a versão normalizada.
// Regras "duras" (fonte, campo, tipo, período, métrica) viram erro e barram a
// execução. Regras "moles" (gráfico ou ordenação inconsistente) são descartadas
// silenciosamente — não vale travar o relatório inteiro por causa do gráfico.
export function validarSpec(specEntrada) {
  const erros = [];
  const spec = specEntrada && typeof specEntrada === "object" ? { ...specEntrada } : null;
  if (!spec) return { ok: false, erros: ["Consulta vazia."], spec: null };

  const ds = getDataset(spec.fonte);
  if (!ds) {
    return { ok: false, erros: [`Fonte de dados desconhecida: "${spec.fonte}".`], spec: null };
  }

  // ─── Período (obrigatório) ───
  const p = spec.periodo;
  if (!p || !p.de || !p.ate) {
    erros.push("Período é obrigatório (data inicial e final).");
  } else {
    const campoP = getCampo(ds.id, p.campo) || getCampo(ds.id, ds.campoData);
    if (!campoP || campoP.tipo !== "data") {
      erros.push(`Campo de data inválido no período: "${p.campo}".`);
    } else {
      spec.periodo = { campo: campoP.id, de: String(p.de), ate: String(p.ate) };
      if (spec.periodo.de > spec.periodo.ate) {
        erros.push("A data inicial do período é maior que a final.");
      }
    }
  }

  // ─── Filtros ───
  const filtros = Array.isArray(spec.filtros) ? spec.filtros : [];
  spec.filtros = [];
  for (const f of filtros) {
    const campo = getCampo(ds.id, f?.campo);
    if (!campo) { erros.push(`Campo de filtro inexistente em ${ds.label}: "${f?.campo}".`); continue; }
    const op = OPERADORES.find((o) => o.id === f.op);
    if (!op) { erros.push(`Operador de filtro desconhecido: "${f.op}".`); continue; }
    if (!op.tipos.includes(campo.tipo)) {
      erros.push(`Operador "${f.op}" não vale para o campo ${campo.label} (${campo.tipo}).`);
      continue;
    }
    spec.filtros.push({ campo: campo.id, op: op.id, valor: f.valor ?? null });
  }

  // ─── Agrupamento ───
  const agrupamento = Array.isArray(spec.agrupamento) ? spec.agrupamento : [];
  spec.agrupamento = [];
  for (const g of agrupamento) {
    const campo = getCampo(ds.id, g);
    if (!campo) { erros.push(`Campo de agrupamento inexistente: "${g}".`); continue; }
    spec.agrupamento.push(campo.id);
  }

  // ─── Métricas ───
  const metricas = Array.isArray(spec.metricas) ? spec.metricas : [];
  spec.metricas = [];
  for (const m of metricas) {
    const ag = AGREGACOES.find((a) => a.id === m?.agregacao);
    if (!ag) { erros.push(`Agregação desconhecida: "${m?.agregacao}".`); continue; }
    if (ag.id === "contagem") { spec.metricas.push({ agregacao: "contagem" }); continue; }
    const campo = getCampo(ds.id, m.campo);
    if (!campo) { erros.push(`Campo de métrica inexistente: "${m.campo}".`); continue; }
    if (!ag.tipos.includes(campo.tipo)) {
      erros.push(`Não dá para calcular ${ag.label.toLowerCase()} ("${ag.id}") sobre ${campo.label} (${campo.tipo}).`);
      continue;
    }
    spec.metricas.push({ campo: campo.id, agregacao: ag.id });
  }
  if (spec.metricas.length === 0) erros.push("Escolha ao menos uma métrica.");

  // ─── Limite ───
  const lim = Number(spec.limite);
  spec.limite = !isFinite(lim) || lim <= 0 ? LIMITE_PADRAO : Math.min(Math.floor(lim), LIMITE_MAXIMO);

  // Colunas que o resultado vai ter — base para validar ordenação e gráfico.
  const colunasResultado = [...spec.agrupamento, ...spec.metricas.map(colunaMetrica)];

  // ─── Ordenação (regra mole) ───
  if (spec.ordenacao && colunasResultado.includes(spec.ordenacao.campo)) {
    spec.ordenacao = {
      campo: spec.ordenacao.campo,
      direcao: spec.ordenacao.direcao === "asc" ? "asc" : "desc",
    };
  } else {
    spec.ordenacao = null;
  }

  // ─── Gráfico (regra mole) ───
  const g = spec.grafico;
  const serieOk = g && Array.isArray(g.series) && g.series.length > 0
    && g.series.every((s) => colunasResultado.includes(s));
  if (g && TIPOS_GRAFICO.includes(g.tipo) && spec.agrupamento.includes(g.eixoX) && serieOk) {
    spec.grafico = { tipo: g.tipo, eixoX: g.eixoX, series: [...g.series] };
  } else {
    spec.grafico = null;
  }

  return { ok: erros.length === 0, erros, spec: erros.length === 0 ? spec : null };
}

// Frase única em pt-BR descrevendo o que o relatório faz. Usada no cabeçalho do
// documento impresso, no card do relatório salvo e na confirmação do modo Pergunta.
export function resumoSpec(spec) {
  const ds = getDataset(spec?.fonte);
  if (!ds) return "Consulta inválida.";
  const partes = [ds.label];
  if (spec.periodo) partes.push(`${fmtData(spec.periodo.de)} a ${fmtData(spec.periodo.ate)}`);
  for (const f of spec.filtros || []) {
    const campo = getCampo(ds.id, f.campo);
    const op = OPERADORES.find((o) => o.id === f.op);
    const valor = Array.isArray(f.valor) ? f.valor.join(", ") : (f.valor ?? "");
    partes.push(`${campo?.label || f.campo} ${op?.label || f.op} ${valor}`.trim());
  }
  if ((spec.agrupamento || []).length) {
    partes.push("agrupado por " + spec.agrupamento
      .map((g) => getCampo(ds.id, g)?.label || g).join(" e "));
  }
  const mets = (spec.metricas || []).map((m) => (
    m.campo ? `${labelAgregacao(m.agregacao)} de ${getCampo(ds.id, m.campo)?.label || m.campo}`
            : labelAgregacao(m.agregacao)
  ));
  if (mets.length) partes.push(mets.join(", "));
  return partes.join(" · ");
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test -- src/lib/relatorios/spec.test.js`
Expected: PASS, 15 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/spec.js src/lib/relatorios/spec.test.js
git commit -m "feat(relatorios): ReportSpec com validacao contra o registry"
```

---

### Task 4: `engine.js` — período e filtros

**Files:**
- Create: `src/lib/relatorios/engine.js`
- Test: `src/lib/relatorios/engine.test.js`

**Interfaces:**
- Consumes: `getDataset`, `getCampo` de `./datasets.js`.
- Produces:
  - `LIMITE_REGISTROS` = `50000`
  - `filtrarPorPeriodo(itens, campo, de, ate)` → array
  - `aplicarFiltros(itens, filtros, datasetId)` → array
  - `valorComparavel(v, tipo)` → number | string (uso interno, exportado para teste)

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/relatorios/engine.test.js`:

```js
import { describe, it, expect } from "vitest";
import { filtrarPorPeriodo, aplicarFiltros, LIMITE_REGISTROS } from "./engine.js";

const oss = [
  { id: "1", status: "finalizado", valor: 300, dataAbertura: "2026-03-05T10:00:00.000Z", tecnicoId: "t1", descricao: "Limpeza de split" },
  { id: "2", status: "cancelado", valor: 0, dataAbertura: "2026-03-20", tecnicoId: "t2", descricao: "Troca de gás" },
  { id: "3", status: "finalizado", valor: 700, dataAbertura: "2026-04-02", tecnicoId: "t1", descricao: "Instalação" },
  { id: "4", status: "finalizado", valor: 150, dataAbertura: null, tecnicoId: "", descricao: "" },
];

describe("engine.filtrarPorPeriodo", () => {
  it("mantém só o que está dentro do intervalo, inclusive nas bordas", () => {
    const r = filtrarPorPeriodo(oss, "dataAbertura", "2026-03-01", "2026-03-20");
    expect(r.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("aceita ISO com hora e compara pela data local", () => {
    const r = filtrarPorPeriodo(oss, "dataAbertura", "2026-03-05", "2026-03-05");
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });

  it("descarta registro sem data no campo escolhido", () => {
    const r = filtrarPorPeriodo(oss, "dataAbertura", "2000-01-01", "2100-01-01");
    expect(r.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
});

describe("engine.aplicarFiltros", () => {
  it("igual e diferente", () => {
    expect(aplicarFiltros(oss, [{ campo: "status", op: "igual", valor: "finalizado" }], "os").length).toBe(3);
    expect(aplicarFiltros(oss, [{ campo: "status", op: "diferente", valor: "finalizado" }], "os").length).toBe(1);
  });

  it("contem é case-insensitive", () => {
    const r = aplicarFiltros(oss, [{ campo: "descricao", op: "contem", valor: "SPLIT" }], "os");
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });

  it("maior, menor e entre em campo numérico", () => {
    expect(aplicarFiltros(oss, [{ campo: "valor", op: "maior", valor: 200 }], "os").map((x) => x.id)).toEqual(["1", "3"]);
    expect(aplicarFiltros(oss, [{ campo: "valor", op: "menor", valor: 200 }], "os").map((x) => x.id)).toEqual(["2", "4"]);
    expect(aplicarFiltros(oss, [{ campo: "valor", op: "entre", valor: [100, 400] }], "os").map((x) => x.id)).toEqual(["1", "4"]);
  });

  it("vazio e nao_vazio tratam string vazia e null", () => {
    expect(aplicarFiltros(oss, [{ campo: "tecnicoId", op: "vazio" }], "os").map((x) => x.id)).toEqual(["4"]);
    expect(aplicarFiltros(oss, [{ campo: "tecnicoId", op: "nao_vazio" }], "os").length).toBe(3);
  });

  it("em aceita lista de valores", () => {
    const r = aplicarFiltros(oss, [{ campo: "tecnicoId", op: "em", valor: ["t2", "t1"] }], "os");
    expect(r.length).toBe(3);
  });

  it("filtros se acumulam com E lógico", () => {
    const r = aplicarFiltros(oss, [
      { campo: "status", op: "igual", valor: "finalizado" },
      { campo: "valor", op: "maior", valor: 200 },
    ], "os");
    expect(r.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("lista sem filtro volta intacta", () => {
    expect(aplicarFiltros(oss, [], "os").length).toBe(4);
  });
});

describe("engine — constantes", () => {
  it("teto de leitura é 50000", () => {
    expect(LIMITE_REGISTROS).toBe(50000);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/engine.test.js`
Expected: FAIL — `Failed to resolve import "./engine.js"`.

- [ ] **Step 3: Implementar período e filtros**

`src/lib/relatorios/engine.js`:

```js
// Engine de relatórios — puro. Recebe arrays já carregados pelo módulo e devolve
// o resultado agregado. NÃO conhece window.storage, DB nem React: é o que
// permite testá-lo direto no Vitest e trocar a origem dos dados no futuro.

import { getCampo } from "./datasets.js";

// Teto de registros lidos por execução. Estourar não é erro: o resultado volta
// com truncado=true e a UI pede um período mais estreito. Renderizar um número
// errado em silêncio seria pior.
export const LIMITE_REGISTROS = 50000;

// Data em "YYYY-MM-DD" local, aceitando "2026-03-05" e ISO com hora.
function dataLocalISO(v) {
  if (!v) return null;
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const dia = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${dia}`;
}

export function filtrarPorPeriodo(itens, campo, de, ate) {
  if (!campo || !de || !ate) return itens || [];
  return (itens || []).filter((item) => {
    const d = dataLocalISO(item?.[campo]);
    if (!d) return false;
    return d >= de && d <= ate;
  });
}

function vazio(v) {
  return v === null || v === undefined || v === "" ||
    (Array.isArray(v) && v.length === 0);
}

// Converte para algo comparável de acordo com o tipo declarado no registry.
export function valorComparavel(v, tipo) {
  if (tipo === "numero" || tipo === "moeda") {
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  if (tipo === "data") return dataLocalISO(v);
  return v === null || v === undefined ? "" : String(v);
}

function comparaFiltro(valorItem, filtro, tipo) {
  const { op, valor } = filtro;
  if (op === "vazio") return vazio(valorItem);
  if (op === "nao_vazio") return !vazio(valorItem);

  const a = valorComparavel(valorItem, tipo);

  if (op === "em") {
    const lista = (Array.isArray(valor) ? valor : [valor]).map((x) => valorComparavel(x, tipo));
    return lista.includes(a);
  }
  if (op === "entre") {
    const [ini, fim] = Array.isArray(valor) ? valor : [null, null];
    const vi = valorComparavel(ini, tipo);
    const vf = valorComparavel(fim, tipo);
    if (a === null || vi === null || vf === null) return false;
    return a >= vi && a <= vf;
  }

  const b = valorComparavel(valor, tipo);
  if (op === "igual") return a === b;
  if (op === "diferente") return a !== b;
  if (op === "contem") return String(a).toLowerCase().includes(String(b).toLowerCase());
  if (a === null || b === null) return false;
  if (op === "maior") return a > b;
  if (op === "menor") return a < b;
  return true;
}

// E lógico entre todos os filtros — é o comportamento que o usuário espera ao
// empilhar condições no builder ("finalizadas E acima de R$200").
export function aplicarFiltros(itens, filtros, datasetId) {
  if (!Array.isArray(filtros) || filtros.length === 0) return itens || [];
  return (itens || []).filter((item) => filtros.every((f) => {
    const campo = getCampo(datasetId, f.campo);
    if (!campo) return true; // campo desconhecido já foi barrado em validarSpec
    return comparaFiltro(item?.[f.campo], f, campo.tipo);
  }));
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test -- src/lib/relatorios/engine.test.js`
Expected: PASS, 10 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/engine.js src/lib/relatorios/engine.test.js
git commit -m "feat(relatorios): engine — filtro de periodo e operadores"
```

---

### Task 5: `engine.js` — agrupamento, agregação, ordenação, limite e referência

**Files:**
- Modify: `src/lib/relatorios/engine.js`
- Test: `src/lib/relatorios/engine.test.js` (acrescentar blocos)

**Interfaces:**
- Consumes: `filtrarPorPeriodo`, `aplicarFiltros` (Task 4); `colunaMetrica` de `./spec.js`; `getDataset`, `getCampo` de `./datasets.js`.
- Produces:
  - `executarRelatorio(spec, { dados, refs })` → `{ colunas, linhas, totais, lidos, truncado }`
    - `dados`: array da fonte principal
    - `refs`: objeto `{ [datasetId]: array }` com as fontes referenciadas
    - `colunas`: `[{ id, label, tipo }]` — agrupamentos primeiro, métricas depois
    - `linhas`: `[{ [colunaId]: valor }]` — referência já resolvida em nome
    - `totais`: `{ [colunaId]: number }` só para métricas numéricas
  - `indexarPorId(itens)` → `Map`

- [ ] **Step 1: Escrever o teste que falha**

Acrescente a `src/lib/relatorios/engine.test.js`:

```js
import { executarRelatorio } from "./engine.js";

const dadosOS = [
  { id: "1", status: "finalizado", valor: 300, dataAbertura: "2026-03-05", tecnicoId: "t1" },
  { id: "2", status: "finalizado", valor: 500, dataAbertura: "2026-03-06", tecnicoId: "t1" },
  { id: "3", status: "finalizado", valor: 200, dataAbertura: "2026-03-07", tecnicoId: "t2" },
  { id: "4", status: "cancelado", valor: 999, dataAbertura: "2026-03-08", tecnicoId: "t2" },
  { id: "5", status: "finalizado", valor: 100, dataAbertura: "2026-04-01", tecnicoId: "t1" },
];
const funcionarios = [
  { id: "t1", nome: "João Silva" },
  { id: "t2", nome: "Maria Souza" },
];
const base = {
  fonte: "os",
  periodo: { campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [{ campo: "status", op: "igual", valor: "finalizado" }],
  agrupamento: ["tecnicoId"],
  metricas: [{ campo: "valor", agregacao: "soma" }, { agregacao: "contagem" }],
  ordenacao: { campo: "valor_soma", direcao: "desc" },
  limite: 100,
  grafico: null,
};

describe("engine.executarRelatorio — agrupado", () => {
  const r = executarRelatorio(base, { dados: dadosOS, refs: { funcionarios } });

  it("agrupa, soma e conta", () => {
    expect(r.linhas.length).toBe(2);
    expect(r.linhas[0]).toMatchObject({ tecnicoId: "João Silva", valor_soma: 800, contagem: 2 });
    expect(r.linhas[1]).toMatchObject({ tecnicoId: "Maria Souza", valor_soma: 200, contagem: 1 });
  });

  it("resolve referência para o nome, não o id", () => {
    expect(r.linhas.map((l) => l.tecnicoId)).toEqual(["João Silva", "Maria Souza"]);
  });

  it("ordena desc pela coluna pedida", () => {
    expect(r.linhas[0].valor_soma).toBeGreaterThan(r.linhas[1].valor_soma);
  });

  it("monta colunas com label do registry", () => {
    expect(r.colunas.map((c) => c.id)).toEqual(["tecnicoId", "valor_soma", "contagem"]);
    expect(r.colunas[0].label).toBe("Técnico");
    expect(r.colunas[1].label).toBe("Soma de Valor");
  });

  it("totaliza as métricas numéricas", () => {
    expect(r.totais.valor_soma).toBe(1000);
    expect(r.totais.contagem).toBe(3);
  });

  it("não vem truncado em volume pequeno", () => {
    expect(r.truncado).toBe(false);
    expect(r.lidos).toBe(5);
  });
});

describe("engine.executarRelatorio — sem agrupamento", () => {
  it("devolve uma linha só com os totais gerais", () => {
    const r = executarRelatorio({ ...base, agrupamento: [], ordenacao: null }, { dados: dadosOS, refs: {} });
    expect(r.linhas.length).toBe(1);
    expect(r.linhas[0].valor_soma).toBe(1000);
    expect(r.linhas[0].contagem).toBe(3);
  });
});

describe("engine.executarRelatorio — agregações", () => {
  const mk = (metricas) => executarRelatorio(
    { ...base, agrupamento: [], ordenacao: null, metricas },
    { dados: dadosOS, refs: {} },
  ).linhas[0];

  it("media", () => {
    expect(mk([{ campo: "valor", agregacao: "media" }]).valor_media).toBeCloseTo(333.333, 2);
  });
  it("minimo e maximo", () => {
    expect(mk([{ campo: "valor", agregacao: "minimo" }]).valor_minimo).toBe(200);
    expect(mk([{ campo: "valor", agregacao: "maximo" }]).valor_maximo).toBe(500);
  });
  it("contagem_distinta ignora repetidos", () => {
    expect(mk([{ campo: "tecnicoId", agregacao: "contagem_distinta" }]).tecnicoId_contagem_distinta).toBe(2);
  });
});

describe("engine.executarRelatorio — agrupamento múltiplo e limite", () => {
  it("agrupa por dois campos", () => {
    const r = executarRelatorio(
      { ...base, filtros: [], agrupamento: ["tecnicoId", "status"], ordenacao: null },
      { dados: dadosOS, refs: { funcionarios } },
    );
    expect(r.linhas.length).toBe(3);
  });

  it("limite corta o número de linhas devolvidas", () => {
    const r = executarRelatorio(
      { ...base, filtros: [], agrupamento: ["tecnicoId", "status"], ordenacao: null, limite: 2 },
      { dados: dadosOS, refs: { funcionarios } },
    );
    expect(r.linhas.length).toBe(2);
  });
});

describe("engine.executarRelatorio — teto de registros", () => {
  it("marca truncado quando passa de LIMITE_REGISTROS", () => {
    const muitos = Array.from({ length: LIMITE_REGISTROS + 10 }, (_, i) => ({
      id: String(i), status: "finalizado", valor: 1, dataAbertura: "2026-03-10", tecnicoId: "t1",
    }));
    const r = executarRelatorio({ ...base, ordenacao: null }, { dados: muitos, refs: { funcionarios } });
    expect(r.truncado).toBe(true);
    expect(r.linhas[0].contagem).toBe(LIMITE_REGISTROS);
  });
});

describe("engine.executarRelatorio — vazio", () => {
  it("período sem registro devolve linhas vazias sem quebrar", () => {
    const r = executarRelatorio(
      { ...base, periodo: { campo: "dataAbertura", de: "2020-01-01", ate: "2020-01-31" } },
      { dados: dadosOS, refs: { funcionarios } },
    );
    expect(r.linhas).toEqual([]);
    expect(r.totais.valor_soma).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/engine.test.js`
Expected: FAIL — `executarRelatorio is not a function`.

- [ ] **Step 3: Implementar a agregação**

Acrescente a `src/lib/relatorios/engine.js` (mantendo os imports existentes; adicione `getDataset` ao import de `./datasets.js` e importe `colunaMetrica`):

```js
import { getDataset, getCampo, AGREGACOES } from "./datasets.js";
import { colunaMetrica } from "./spec.js";

// Índice id → registro. Referência é resolvida por lookup em Map, não por
// varredura por linha: sem isso, agrupar OS por técnico vira O(n*m).
export function indexarPorId(itens) {
  const m = new Map();
  for (const it of itens || []) {
    if (it && it.id !== undefined && it.id !== null) m.set(String(it.id), it);
  }
  return m;
}

// Nome legível de um registro referenciado. Cobre as entidades da v1: pessoas e
// clientes usam `nome`, produtos idem, OS usa o número.
function rotuloRef(registro, fallback) {
  if (!registro) return fallback;
  return registro.nome || registro.razaoSocial || registro.titulo ||
    (registro.numero ? `#${registro.numero}` : null) || fallback;
}

function agregar(valores, agregacao) {
  if (agregacao === "contagem") return valores.length;
  if (agregacao === "contagem_distinta") {
    return new Set(valores.filter((v) => v !== null && v !== undefined && v !== "")).size;
  }
  const nums = valores.map((v) => Number(v)).filter((n) => isFinite(n));
  if (nums.length === 0) return 0;
  if (agregacao === "soma") return nums.reduce((a, b) => a + b, 0);
  if (agregacao === "media") return nums.reduce((a, b) => a + b, 0) / nums.length;
  if (agregacao === "minimo") return Math.min(...nums);
  if (agregacao === "maximo") return Math.max(...nums);
  return 0;
}

function labelMetrica(dsId, metrica) {
  const ag = AGREGACOES.find((a) => a.id === metrica.agregacao);
  if (!metrica.campo) return ag?.label || metrica.agregacao;
  const campo = getCampo(dsId, metrica.campo);
  return `${ag?.label || metrica.agregacao} de ${campo?.label || metrica.campo}`;
}

// Executa um ReportSpec JÁ VALIDADO. `dados` é a lista da fonte principal;
// `refs` traz as listas das fontes referenciadas, indexadas por id de dataset.
export function executarRelatorio(spec, { dados = [], refs = {} } = {}) {
  const ds = getDataset(spec.fonte);
  if (!ds) return { colunas: [], linhas: [], totais: {}, lidos: 0, truncado: false };

  // 1) Recorte por período antes de qualquer coisa — é o que segura a memória.
  const noPeriodo = filtrarPorPeriodo(dados, spec.periodo?.campo, spec.periodo?.de, spec.periodo?.ate);
  // 2) Filtros do usuário.
  const filtrados = aplicarFiltros(noPeriodo, spec.filtros, ds.id);
  // 3) Teto de leitura.
  const truncado = filtrados.length > LIMITE_REGISTROS;
  const usados = truncado ? filtrados.slice(0, LIMITE_REGISTROS) : filtrados;

  // Índices das fontes referenciadas usadas no agrupamento.
  const indices = {};
  for (const campoId of spec.agrupamento || []) {
    const campo = getCampo(ds.id, campoId);
    if (campo?.tipo === "referencia") indices[campoId] = indexarPorId(refs[campo.ref]);
  }

  const colunas = [
    ...(spec.agrupamento || []).map((g) => {
      const campo = getCampo(ds.id, g);
      return { id: g, label: campo?.label || g, tipo: campo?.tipo === "referencia" ? "texto" : (campo?.tipo || "texto") };
    }),
    ...(spec.metricas || []).map((m) => ({
      id: colunaMetrica(m),
      label: labelMetrica(ds.id, m),
      tipo: m.agregacao === "contagem" || m.agregacao === "contagem_distinta"
        ? "numero"
        : (getCampo(ds.id, m.campo)?.tipo || "numero"),
    })),
  ];

  // Sem agrupamento: uma linha só, com os totais gerais.
  const chaveDe = (item) => (spec.agrupamento || [])
    .map((g) => {
      const bruto = item?.[g];
      const idx = indices[g];
      const rotulo = idx ? rotuloRef(idx.get(String(bruto)), bruto || "—") : (bruto ?? "—");
      return rotulo === "" || rotulo === null || rotulo === undefined ? "—" : String(rotulo);
    })
    .join(" ▸ ");

  const grupos = new Map();
  for (const item of usados) {
    const chave = (spec.agrupamento || []).length ? chaveDe(item) : "__total__";
    if (!grupos.has(chave)) grupos.set(chave, []);
    grupos.get(chave).push(item);
  }

  let linhas = [];
  for (const [chave, itens] of grupos) {
    const linha = {};
    const partes = chave.split(" ▸ ");
    (spec.agrupamento || []).forEach((g, i) => { linha[g] = partes[i]; });
    for (const m of spec.metricas || []) {
      const valores = m.campo ? itens.map((it) => it?.[m.campo]) : itens;
      linha[colunaMetrica(m)] = agregar(valores, m.agregacao);
    }
    linhas.push(linha);
  }

  if (spec.ordenacao) {
    const { campo, direcao } = spec.ordenacao;
    const sinal = direcao === "asc" ? 1 : -1;
    linhas.sort((a, b) => {
      const va = a[campo]; const vb = b[campo];
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * sinal;
      return String(va).localeCompare(String(vb), "pt-BR") * sinal;
    });
  }

  if (spec.limite && linhas.length > spec.limite) linhas = linhas.slice(0, spec.limite);

  // Totais são calculados sobre TODOS os registros usados, não sobre as linhas
  // exibidas — cortar por limite não pode alterar o total do rodapé.
  const totais = {};
  for (const m of spec.metricas || []) {
    const valores = m.campo ? usados.map((it) => it?.[m.campo]) : usados;
    totais[colunaMetrica(m)] = agregar(valores, m.agregacao);
  }

  return { colunas, linhas, totais, lidos: dados.length, truncado };
}
```

- [ ] **Step 4: Rodar a suíte inteira**

Run: `npm run test`
Expected: PASS em tudo, incluindo os testes pré-existentes de `src/lib/` e `src/utils.test.js`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/engine.js src/lib/relatorios/engine.test.js
git commit -m "feat(relatorios): engine — agrupamento, agregacoes, ordenacao e teto de leitura"
```

---

### Task 6: `csv.js`

**Files:**
- Create: `src/lib/relatorios/csv.js`
- Test: `src/lib/relatorios/csv.test.js`

**Interfaces:**
- Consumes: resultado do `executarRelatorio` (`{ colunas, linhas, totais }`).
- Produces:
  - `paraCSV({ colunas, linhas, totais }, { incluirTotais = true })` → string com BOM
  - `nomeArquivoCSV(nomeRelatorio, data)` → `"faturamento-por-tecnico-2026-03-05.csv"`
  - `baixarCSV(nomeArquivo, conteudo)` → void (browser; sem teste automatizado)

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/relatorios/csv.test.js`:

```js
import { describe, it, expect } from "vitest";
import { paraCSV, nomeArquivoCSV } from "./csv.js";

const resultado = {
  colunas: [
    { id: "tecnicoId", label: "Técnico", tipo: "texto" },
    { id: "valor_soma", label: "Soma de Valor", tipo: "moeda" },
    { id: "contagem", label: "Contagem", tipo: "numero" },
  ],
  linhas: [
    { tecnicoId: "João Silva", valor_soma: 1234.5, contagem: 3 },
    { tecnicoId: 'Empresa "X"; Ltda', valor_soma: 0, contagem: 1 },
  ],
  totais: { valor_soma: 1234.5, contagem: 4 },
};

describe("csv.paraCSV", () => {
  const csv = paraCSV(resultado);
  const linhas = csv.replace(/^﻿/, "").trim().split("\r\n");

  it("começa com BOM UTF-8 para o Excel não quebrar acento", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa ponto-e-vírgula como separador", () => {
    expect(linhas[0]).toBe("Técnico;Soma de Valor;Contagem");
  });

  it("usa vírgula decimal em números", () => {
    expect(linhas[1]).toContain("1234,50");
  });

  it("escapa aspas e ponto-e-vírgula com aspas duplas", () => {
    expect(linhas[2]).toContain('"Empresa ""X""; Ltda"');
  });

  it("acrescenta linha de totais no fim", () => {
    expect(linhas[linhas.length - 1]).toBe("TOTAL;1234,50;4");
  });

  it("respeita incluirTotais=false", () => {
    const semTotais = paraCSV(resultado, { incluirTotais: false }).trim().split("\r\n");
    expect(semTotais.length).toBe(3);
  });

  it("resultado vazio devolve só o cabeçalho", () => {
    const vazio = paraCSV({ colunas: resultado.colunas, linhas: [], totais: {} });
    expect(vazio.replace(/^﻿/, "").trim()).toBe("Técnico;Soma de Valor;Contagem");
  });
});

describe("csv.nomeArquivoCSV", () => {
  it("gera slug com data", () => {
    expect(nomeArquivoCSV("Faturamento por Técnico", new Date(2026, 2, 5)))
      .toBe("faturamento-por-tecnico-2026-03-05.csv");
  });
  it("cai em 'relatorio' quando o nome é vazio", () => {
    expect(nomeArquivoCSV("", new Date(2026, 2, 5))).toBe("relatorio-2026-03-05.csv");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/csv.test.js`
Expected: FAIL — `Failed to resolve import "./csv.js"`.

- [ ] **Step 3: Implementar o CSV**

`src/lib/relatorios/csv.js`:

```js
// Exportação CSV no dialeto que o Excel pt-BR abre sem pedir nada ao usuário:
// separador ";", vírgula decimal e BOM UTF-8. CSV "padrão" (vírgula + ponto)
// abre como uma coluna só e com acento quebrado nas máquinas dos clientes.

const SEP = ";";
const EOL = "\r\n";

function ehNumero(v) {
  return typeof v === "number" && isFinite(v);
}

function formatarCelula(valor, tipo) {
  if (valor === null || valor === undefined) return "";
  if (ehNumero(valor)) {
    const casas = tipo === "moeda" || !Number.isInteger(valor) ? 2 : 0;
    return valor.toFixed(casas).replace(".", ",");
  }
  return String(valor);
}

// Campo entra entre aspas se contiver separador, aspas ou quebra de linha.
// Aspas internas são duplicadas — regra do RFC 4180.
function escapar(texto) {
  const s = String(texto);
  if (s.includes(SEP) || s.includes('"') || s.includes("\n") || s.includes("\r")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

export function paraCSV({ colunas = [], linhas = [], totais = {} } = {}, { incluirTotais = true } = {}) {
  const out = [];
  out.push(colunas.map((c) => escapar(c.label)).join(SEP));
  for (const linha of linhas) {
    out.push(colunas.map((c) => escapar(formatarCelula(linha[c.id], c.tipo))).join(SEP));
  }
  const temTotais = incluirTotais && Object.keys(totais).length > 0 && linhas.length > 0;
  if (temTotais) {
    out.push(colunas.map((c, i) => (
      i === 0 ? "TOTAL" : escapar(formatarCelula(totais[c.id], c.tipo))
    )).join(SEP));
  }
  // BOM na frente: sem ele o Excel no Windows lê o arquivo como ANSI.
  return "﻿" + out.join(EOL) + EOL;
}

function slug(texto) {
  return String(texto || "")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function nomeArquivoCSV(nomeRelatorio, data = new Date()) {
  const y = data.getFullYear();
  const m = String(data.getMonth() + 1).padStart(2, "0");
  const d = String(data.getDate()).padStart(2, "0");
  return `${slug(nomeRelatorio) || "relatorio"}-${y}-${m}-${d}.csv`;
}

// Dispara o download no browser. Fora do escopo de teste (depende de DOM/Blob).
export function baixarCSV(nomeArquivo, conteudo) {
  const blob = new Blob([conteudo], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = nomeArquivo;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test -- src/lib/relatorios/csv.test.js`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/csv.js src/lib/relatorios/csv.test.js
git commit -m "feat(relatorios): exportacao CSV no dialeto pt-BR"
```

---

### Task 7: `html.js` — documento imprimível

**Files:**
- Create: `src/lib/relatorios/html.js`
- Test: `src/lib/relatorios/html.test.js`

**Interfaces:**
- Consumes: resultado do `executarRelatorio`.
- Produces:
  - `relatorioHTML({ nome, resumo, colunas, linhas, totais, truncado, empresa })` → string HTML completa, com `<title>`, `<style>` inline e barra de ações com os ids `btn-pdf`, `btn-print`, `btn-close`
  - `empresa` → `{ nome, cnpj, telefone, endereco, logo }` (qualquer campo pode faltar)

Nota: `_docStyles` e `_docHeader` moram dentro do `App.jsx` e não são exportáveis (importar do módulo criaria ciclo). `html.js` carrega o próprio CSS, deliberadamente parecido com o dos documentos de OS.

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/relatorios/html.test.js`:

```js
import { describe, it, expect } from "vitest";
import { relatorioHTML } from "./html.js";

const entrada = {
  nome: "Faturamento por técnico",
  resumo: "Ordens de Serviço · 01/03/2026 a 31/03/2026 · agrupado por Técnico",
  colunas: [
    { id: "tecnicoId", label: "Técnico", tipo: "texto" },
    { id: "valor_soma", label: "Soma de Valor", tipo: "moeda" },
  ],
  linhas: [{ tecnicoId: "João Silva", valor_soma: 1234.5 }],
  totais: { valor_soma: 1234.5 },
  truncado: false,
  empresa: { nome: "Frost Refrigeração", cnpj: "12.345.678/0001-90" },
};

describe("html.relatorioHTML", () => {
  const html = relatorioHTML(entrada);

  it("é um documento completo com title", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Faturamento por técnico</title>");
  });

  it("traz os ids da barra de ações que o abridor liga", () => {
    expect(html).toContain('id="btn-pdf"');
    expect(html).toContain('id="btn-print"');
    expect(html).toContain('id="btn-close"');
  });

  it("mostra empresa, nome e resumo do relatório", () => {
    expect(html).toContain("Frost Refrigeração");
    expect(html).toContain("12.345.678/0001-90");
    expect(html).toContain("agrupado por Técnico");
  });

  it("monta cabeçalho e células da tabela", () => {
    expect(html).toContain("<th>Técnico</th>");
    expect(html).toContain("João Silva");
  });

  it("formata moeda em pt-BR", () => {
    expect(html).toMatch(/1\.234,50/);
  });

  it("tem linha de total", () => {
    expect(html).toContain("TOTAL");
  });

  it("escapa HTML vindo dos dados", () => {
    const perigoso = relatorioHTML({
      ...entrada,
      linhas: [{ tecnicoId: '<script>alert(1)</script>', valor_soma: 0 }],
    });
    expect(perigoso).not.toContain("<script>alert(1)</script>");
    expect(perigoso).toContain("&lt;script&gt;");
  });

  it("avisa quando o resultado foi truncado", () => {
    const t = relatorioHTML({ ...entrada, truncado: true });
    expect(t).toContain("limite");
  });

  it("resultado vazio não quebra", () => {
    const v = relatorioHTML({ ...entrada, linhas: [], totais: {} });
    expect(v).toContain("Nenhum registro");
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/html.test.js`
Expected: FAIL — `Failed to resolve import "./html.js"`.

- [ ] **Step 3: Implementar o gerador de HTML**

`src/lib/relatorios/html.js`:

```js
// Documento imprimível do relatório. Mesmo padrão dos documentos de OS/orçamento:
// HTML autocontido, aberto em janela nova, com barra de ações que o app liga por
// fora (a CSP proíbe script dentro do documento). O CSS é duplicado de propósito —
// _docStyles vive no App.jsx e importá-lo daqui criaria import circular.

function esc(v) {
  return String(v ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function fmtCelula(valor, tipo) {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (typeof valor === "number" && isFinite(valor)) {
    if (tipo === "moeda") {
      return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(valor);
    }
    return new Intl.NumberFormat("pt-BR", {
      minimumFractionDigits: Number.isInteger(valor) ? 0 : 2,
      maximumFractionDigits: 2,
    }).format(valor);
  }
  return esc(valor);
}

const ESTILOS = `
  * { box-sizing: border-box; }
  body { margin:0; font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; color:#111; background:#f3f4f6; }
  main.page { background:#fff; width:794px; max-width:100%; margin:16px auto; padding:32px; }
  header.doc { display:flex; justify-content:space-between; align-items:flex-start; border-bottom:2px solid #1d4ed8; padding-bottom:12px; margin-bottom:20px; gap:16px; }
  header.doc img { max-height:56px; }
  .empresa { font-size:12px; color:#4b5563; line-height:1.5; }
  .empresa strong { display:block; font-size:16px; color:#111; }
  h1 { font-size:20px; margin:0 0 4px; color:#1d4ed8; }
  .resumo { font-size:12px; color:#4b5563; margin-bottom:16px; }
  table { width:100%; border-collapse:collapse; font-size:12px; }
  th, td { padding:8px 10px; border-bottom:1px solid #e5e7eb; text-align:left; }
  th { background:#f3f4f6; font-weight:600; }
  td.num, th.num { text-align:right; font-variant-numeric: tabular-nums; }
  tr.total td { font-weight:700; border-top:2px solid #1d4ed8; background:#f9fafb; }
  .aviso { background:#fef3c7; border:1px solid #f59e0b; color:#92400e; padding:8px 12px; font-size:12px; margin-bottom:12px; border-radius:6px; }
  .vazio { text-align:center; color:#6b7280; padding:40px 0; font-size:13px; }
  footer.doc { margin-top:24px; font-size:10px; color:#9ca3af; text-align:center; }
  .actionbar { position:fixed; top:0; left:0; right:0; background:#111827; padding:8px; display:flex; gap:8px; justify-content:center; }
  .actionbar button { padding:6px 14px; font-size:13px; border:0; border-radius:6px; background:#2563eb; color:#fff; cursor:pointer; }
  .actionbar button:disabled { opacity:.6; cursor:default; }
  body { padding-top:44px; }
  @media print {
    .actionbar { display:none !important; }
    body { background:#fff; padding-top:0; }
    main.page { margin:0; width:auto; padding:0; }
  }
`;

export function relatorioHTML({
  nome = "Relatório", resumo = "", colunas = [], linhas = [], totais = {},
  truncado = false, empresa = {},
} = {}) {
  const geradoEm = new Date().toLocaleString("pt-BR");
  const alinhaNum = (tipo) => (tipo === "moeda" || tipo === "numero" ? ' class="num"' : "");

  const cabecalho = colunas.map((c) => `<th${alinhaNum(c.tipo)}>${esc(c.label)}</th>`).join("");
  const corpo = linhas.map((l) => (
    `<tr>${colunas.map((c) => `<td${alinhaNum(c.tipo)}>${fmtCelula(l[c.id], c.tipo)}</td>`).join("")}</tr>`
  )).join("");
  const temTotais = linhas.length > 0 && Object.keys(totais).length > 0;
  const rodapeTabela = temTotais
    ? `<tr class="total">${colunas.map((c, i) => (
        i === 0 ? "<td>TOTAL</td>" : `<td${alinhaNum(c.tipo)}>${fmtCelula(totais[c.id], c.tipo)}</td>`
      )).join("")}</tr>`
    : "";

  const tabela = linhas.length === 0
    ? `<p class="vazio">Nenhum registro encontrado para os critérios escolhidos.</p>`
    : `<table><thead><tr>${cabecalho}</tr></thead><tbody>${corpo}${rodapeTabela}</tbody></table>`;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(nome)}</title>
<style>${ESTILOS}</style>
</head>
<body>
  <div class="actionbar" role="toolbar" aria-label="Ações do documento">
    <button id="btn-pdf" type="button" aria-label="Baixar arquivo PDF">Baixar PDF</button>
    <button id="btn-print" type="button" aria-label="Imprimir documento">Imprimir</button>
    <button id="btn-close" type="button" aria-label="Fechar janela">Fechar</button>
  </div>
  <main class="page">
    <header class="doc">
      <div class="empresa">
        <strong>${esc(empresa.nome || "FrostERP")}</strong>
        ${empresa.cnpj ? `CNPJ: ${esc(empresa.cnpj)}<br/>` : ""}
        ${empresa.telefone ? `${esc(empresa.telefone)}<br/>` : ""}
        ${empresa.endereco ? `${esc(empresa.endereco)}` : ""}
      </div>
      ${empresa.logo ? `<img src="${esc(empresa.logo)}" alt="Logo da empresa" />` : ""}
    </header>
    <h1>${esc(nome)}</h1>
    <p class="resumo">${esc(resumo)}</p>
    ${truncado ? `<p class="aviso">Resultado parcial: o limite de 50.000 registros foi atingido. Estreite o período para um número exato.</p>` : ""}
    ${tabela}
    <footer class="doc">Gerado pelo FrostERP em ${esc(geradoEm)}</footer>
  </main>
</body>
</html>`;
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test -- src/lib/relatorios/html.test.js`
Expected: PASS, 9 testes.

- [ ] **Step 5: Commit**

```bash
git add src/lib/relatorios/html.js src/lib/relatorios/html.test.js
git commit -m "feat(relatorios): documento HTML imprimivel do resultado"
```

---

### Task 8: `src/lib/doc.js` — extrair abridor de documento e geração de PDF

**Files:**
- Create: `src/lib/doc.js`
- Modify: `src/App.jsx` (remover `openHTMLDoc` e `gerarPDFDeHTML`, importar de `./lib/doc.js`)

**Interfaces:**
- Consumes: `html2pdf.js` (já em `package.json`).
- Produces:
  - `openHTMLDoc(html)` → void — abre janela, escreve o HTML, liga `btn-pdf`/`btn-print`/`btn-close`
  - `gerarPDFDeHTML(html, filename)` → `Promise<void>` — baixa o PDF
  - `htmlParaPDFBase64(html)` → `Promise<string>` — base64 puro, **sem** o prefixo `data:`; usado no envio por WhatsApp

Motivo da extração: `RelatoriosModule.jsx` precisa das duas funções, e importá-las do `App.jsx` criaria import circular (o `App.jsx` importa o módulo).

- [ ] **Step 1: Localizar o código atual**

```bash
grep -n "^function openHTMLDoc\|^async function gerarPDFDeHTML\|^function _actionBar" src/App.jsx
grep -n "openHTMLDoc(\|gerarPDFDeHTML(" src/App.jsx | wc -l
```

Anote os números de linha e a contagem de chamadas — depois da mudança a contagem de chamadas tem que continuar a mesma.

- [ ] **Step 2: Criar `src/lib/doc.js` movendo o código**

`src/lib/doc.js` — copie o corpo atual de `gerarPDFDeHTML` (hoje em `src/App.jsx`, procure por `async function gerarPDFDeHTML`) e de `openHTMLDoc`, adicionando `export`:

```js
// Abertura e geração de documentos imprimíveis (OS, orçamento, recibo, relatório).
// Extraído do App.jsx para poder ser usado também por src/modules/ sem criar
// import circular — o App.jsx importa os módulos, então os módulos não podem
// importar o App.jsx.

import html2pdf from "html2pdf.js";

// Gera e baixa um PDF a partir do HTML completo de um documento. Roda no
// contexto do app (html2pdf empacotado = permitido pela CSP 'self'). Renderiza
// o conteúdo num container fora da tela porque o html2canvas precisa medir o
// elemento.
export async function gerarPDFDeHTML(html, filename) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:794px";
  document.body.appendChild(container);
  try {
    const alvo = container.querySelector("main.page") || container;
    await html2pdf().set({
      margin: 0,
      filename: (filename || "documento") + ".pdf",
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    }).from(alvo).save();
  } finally {
    document.body.removeChild(container);
  }
}

// Mesma renderização, mas devolve o PDF em base64 puro (sem "data:...;base64,").
// É o formato que a Evolution API espera no campo `media` do sendMedia.
export async function htmlParaPDFBase64(html) {
  const container = document.createElement("div");
  container.innerHTML = html;
  container.style.cssText = "position:fixed;left:-9999px;top:0;width:794px";
  document.body.appendChild(container);
  try {
    const alvo = container.querySelector("main.page") || container;
    const dataUri = await html2pdf().set({
      margin: 0,
      image: { type: "jpeg", quality: 0.98 },
      html2canvas: { scale: 2, useCORS: true },
      jsPDF: { unit: "mm", format: "a4", orientation: "portrait" },
    }).from(alvo).output("datauristring");
    return String(dataUri).split(",")[1] || "";
  } finally {
    document.body.removeChild(container);
  }
}

// Abre a janela vazia e escreve o HTML direto. Evita window.open(blobURL):
// ali o w.document inicial é o about:blank (readyState "complete"), e ligar
// os botões nesse momento erra o documento real que ainda vai carregar.
export function openHTMLDoc(html) {
  const w = window.open("", "_blank");
  if (!w) {
    alert("Permita popups para gerar documentos.");
    return;
  }
  w.document.open();
  w.document.write(html);
  w.document.close();

  const titulo = (html.match(/<title>([^<]*)<\/title>/i)?.[1] || "documento").trim();
  const filename = titulo.replace(/[^a-zA-Z0-9-_]+/g, "-") || "documento";

  // Liga os botões da barra de ações pelo contexto do app (a CSP impede
  // scripts dentro do próprio documento).
  try {
    const doc = w.document;
    const btnPrint = doc.getElementById("btn-print");
    const btnClose = doc.getElementById("btn-close");
    const btnPdf = doc.getElementById("btn-pdf");
    if (btnPrint) btnPrint.addEventListener("click", () => w.print());
    if (btnClose) btnClose.addEventListener("click", () => w.close());
    if (btnPdf) btnPdf.addEventListener("click", async () => {
      const orig = btnPdf.textContent;
      btnPdf.disabled = true;
      btnPdf.textContent = "Gerando...";
      try {
        await gerarPDFDeHTML(html, filename);
      } catch (e) {
        console.error("[openHTMLDoc] PDF:", e);
        alert("Falha ao gerar o PDF. Use Imprimir como alternativa.");
      } finally {
        btnPdf.disabled = false;
        btnPdf.textContent = orig;
      }
    });
  } catch (e) {
    console.error("[openHTMLDoc] não foi possível ligar a barra de ações:", e);
  }
}
```

- [ ] **Step 3: Remover as duas funções do `App.jsx` e importar do novo módulo**

Em `src/App.jsx`:
1. Apague o bloco `function openHTMLDoc(html) { … }` inteiro.
2. Apague o bloco `async function gerarPDFDeHTML(html, filename) { … }` inteiro.
3. Troque `import html2pdf from "html2pdf.js";` por:

```js
// Abertura de documento imprimível + geração de PDF client-side (extraídos para
// src/lib/doc.js porque src/modules/ também precisa deles).
import { openHTMLDoc, gerarPDFDeHTML, htmlParaPDFBase64 } from "./lib/doc.js";
```

4. Se `html2pdf` ainda for referenciado em outro ponto do `App.jsx` (`enviarDocWhatsApp` usa html2canvas direto?), confirme com:

```bash
grep -n "html2pdf" src/App.jsx
```

Se sobrar alguma chamada, mantenha o import de `html2pdf.js` também; se não sobrar nenhuma, o import pode sair.

- [ ] **Step 4: Verificar que nada quebrou**

```bash
npm run lint
npm run build
```

Expected: build conclui sem erro. `npm run lint` não pode ganhar erro novo — se `htmlParaPDFBase64` aparecer como import não usado no `App.jsx`, remova-o do import (ele será usado só pelo módulo, que importa direto de `./lib/doc.js`).

- [ ] **Step 5: Testar manualmente a impressão de uma OS**

Rode `npm run dev`, abra uma OS existente e clique em imprimir/gerar documento. A janela precisa abrir com os três botões funcionando (Baixar PDF, Imprimir, Fechar). Essa é a única checagem de que a extração não quebrou o fluxo existente — não há teste automatizado de DOM aqui.

- [ ] **Step 6: Commit**

```bash
git add src/lib/doc.js src/App.jsx
git commit -m "refactor(doc): extrair openHTMLDoc e gerarPDFDeHTML para src/lib/doc.js"
```

---

### Task 9: `RelatoriosModule.jsx` — Builder e resultado

**Files:**
- Create: `src/modules/RelatoriosModule.jsx`

**Interfaces:**
- Consumes: `listarDatasets`, `getDataset`, `getCampo`, `AGREGACOES`, `OPERADORES` (`../lib/relatorios/datasets.js`); `specVazio`, `validarSpec`, `resumoSpec`, `colunaMetrica` (`../lib/relatorios/spec.js`); `executarRelatorio` (`../lib/relatorios/engine.js`).
- Produces: `export default function RelatoriosModule({ user, db, addToast, companyId, empresa })`
  - `db` — o objeto `DB` do `App.jsx` (usa só `db.list`, `db.get`, `db.set`, `db.delete`)
  - `empresa` — `{ nome, cnpj, telefone, endereco, logo }` vindo de `erp:config`, usado no documento impresso

- [ ] **Step 1: Escrever o componente**

`src/modules/RelatoriosModule.jsx`:

```jsx
import { useState, useMemo, useCallback } from "react";
import {
  listarDatasets, getDataset, getCampo, AGREGACOES, OPERADORES,
} from "../lib/relatorios/datasets.js";
import { specVazio, validarSpec, resumoSpec, colunaMetrica } from "../lib/relatorios/spec.js";
import { executarRelatorio } from "../lib/relatorios/engine.js";
import {
  BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// Módulo Relatórios — motor genérico de análise.
// O usuário monta a consulta (ReportSpec) no Builder ou pergunta em português;
// os dois caminhos produzem o MESMO objeto, que é validado contra o registry e
// executado pelo engine puro. Este componente é a única camada que toca o DB.

const CORES = ["#3b82f6", "#22c55e", "#f59e0b", "#ef4444", "#a855f7", "#14b8a6", "#eab308", "#ec4899"];

const fmtNum = (v, tipo) => {
  if (typeof v !== "number" || !isFinite(v)) return v ?? "—";
  if (tipo === "moeda") return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  return v.toLocaleString("pt-BR", { maximumFractionDigits: 2 });
};

export default function RelatoriosModule({ user, db, addToast, companyId, empresa = {} }) {
  // Fontes sensíveis (folha, ponto, vales) só para admin/gerente. Hoje só esses
  // dois papéis entram no módulo — o gate existe para o dia em que o atendente
  // for liberado, para que isso seja mudança de permissão e não vazamento.
  const podeVerSensivel = user?.role === "admin" || user?.role === "gerente";
  const datasets = useMemo(() => listarDatasets({ podeVerSensivel }), [podeVerSensivel]);

  const [spec, setSpec] = useState(() => specVazio("os"));
  const [resultado, setResultado] = useState(null);
  const [erros, setErros] = useState([]);
  const [gerando, setGerando] = useState(false);

  const ds = getDataset(spec.fonte);
  const campos = ds?.campos || [];

  // ─── Mutadores do spec ───
  const trocarFonte = useCallback((fonteId) => {
    // Fonte nova zera filtros/agrupamento/métricas: campos da fonte anterior não
    // existem aqui e virariam erro de validação em cima do usuário.
    setSpec(specVazio(fonteId));
    setResultado(null);
    setErros([]);
  }, []);

  const upd = (patch) => setSpec((s) => ({ ...s, ...patch }));
  const updPeriodo = (patch) => setSpec((s) => ({ ...s, periodo: { ...s.periodo, ...patch } }));

  const addFiltro = () => {
    const campo = campos[0];
    const op = OPERADORES.find((o) => o.tipos.includes(campo.tipo));
    setSpec((s) => ({ ...s, filtros: [...s.filtros, { campo: campo.id, op: op.id, valor: "" }] }));
  };
  const updFiltro = (i, patch) => setSpec((s) => ({
    ...s, filtros: s.filtros.map((f, idx) => (idx === i ? { ...f, ...patch } : f)),
  }));
  const rmFiltro = (i) => setSpec((s) => ({ ...s, filtros: s.filtros.filter((_, idx) => idx !== i) }));

  const toggleAgrupamento = (campoId) => setSpec((s) => ({
    ...s,
    agrupamento: s.agrupamento.includes(campoId)
      ? s.agrupamento.filter((g) => g !== campoId)
      : [...s.agrupamento, campoId],
  }));

  const addMetrica = () => setSpec((s) => ({ ...s, metricas: [...s.metricas, { agregacao: "contagem" }] }));
  const updMetrica = (i, patch) => setSpec((s) => ({
    ...s, metricas: s.metricas.map((m, idx) => (idx === i ? { ...m, ...patch } : m)),
  }));
  const rmMetrica = (i) => setSpec((s) => ({ ...s, metricas: s.metricas.filter((_, idx) => idx !== i) }));

  // ─── Execução ───
  // Carrega a fonte e as fontes referenciadas pelo agrupamento, valida e roda o
  // engine. Nada de cálculo aqui — este componente só orquestra.
  const gerar = useCallback(() => {
    setGerando(true);
    setErros([]);
    try {
      const v = validarSpec(spec);
      if (!v.ok) {
        setErros(v.erros);
        setResultado(null);
        return;
      }
      const dsAtual = getDataset(v.spec.fonte);
      const dados = db.list(dsAtual.prefixo) || [];

      // Só carrega as fontes de referência realmente usadas no agrupamento.
      const refs = {};
      for (const g of v.spec.agrupamento) {
        const campo = getCampo(dsAtual.id, g);
        if (campo?.tipo === "referencia" && !refs[campo.ref]) {
          const refDs = getDataset(campo.ref);
          if (refDs) refs[campo.ref] = db.list(refDs.prefixo) || [];
        }
      }

      const r = executarRelatorio(v.spec, { dados, refs });
      setSpec(v.spec);
      setResultado({ ...r, spec: v.spec, resumo: resumoSpec(v.spec) });
      if (r.truncado) {
        addToast("Resultado parcial: limite de 50.000 registros atingido. Estreite o período.", "info");
      }
    } catch (e) {
      console.error("[Relatorios] falha ao gerar:", e);
      addToast("Não foi possível gerar o relatório.", "error");
    } finally {
      setGerando(false);
    }
  }, [spec, db, addToast]);

  // ─── UI ───
  const inputCls = "w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white focus:border-blue-500 outline-none";
  const labelCls = "block text-xs font-medium text-gray-400 mb-1";
  const cardCls = "bg-gray-800 border border-gray-700 rounded-xl p-4";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-white">Relatórios</h2>
          <p className="text-sm text-gray-400">Monte a análise que quiser sobre qualquer dado do sistema.</p>
        </div>
      </div>

      {/* ─── Builder ─── */}
      <div className={cardCls}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div>
            <label className={labelCls} htmlFor="rel-fonte">Fonte de dados</label>
            <select id="rel-fonte" className={inputCls} value={spec.fonte} onChange={(e) => trocarFonte(e.target.value)}>
              {datasets.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
            </select>
          </div>
          <div>
            <label className={labelCls} htmlFor="rel-de">Período — de</label>
            <input id="rel-de" type="date" className={inputCls} value={spec.periodo?.de || ""}
              onChange={(e) => updPeriodo({ de: e.target.value })} />
          </div>
          <div>
            <label className={labelCls} htmlFor="rel-ate">Período — até</label>
            <input id="rel-ate" type="date" className={inputCls} value={spec.periodo?.ate || ""}
              onChange={(e) => updPeriodo({ ate: e.target.value })} />
          </div>
        </div>

        <div className="mt-3">
          <label className={labelCls} htmlFor="rel-campo-data">Campo de data usado no período</label>
          <select id="rel-campo-data" className={inputCls} value={spec.periodo?.campo || ""}
            onChange={(e) => updPeriodo({ campo: e.target.value })}>
            {campos.filter((c) => c.tipo === "data").map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
        </div>

        {/* Filtros */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-300">Filtros</span>
            <button type="button" onClick={addFiltro}
              className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">+ Filtro</button>
          </div>
          {spec.filtros.length === 0 && <p className="text-xs text-gray-500">Nenhum filtro — todos os registros do período entram.</p>}
          <div className="space-y-2">
            {spec.filtros.map((f, i) => {
              const campo = getCampo(spec.fonte, f.campo);
              const ops = OPERADORES.filter((o) => o.tipos.includes(campo?.tipo));
              const precisaValor = f.op !== "vazio" && f.op !== "nao_vazio";
              return (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_1fr_auto] gap-2">
                  <select className={inputCls} value={f.campo} aria-label="Campo do filtro"
                    onChange={(e) => {
                      const novo = getCampo(spec.fonte, e.target.value);
                      const opOk = OPERADORES.find((o) => o.tipos.includes(novo.tipo));
                      updFiltro(i, { campo: e.target.value, op: opOk.id, valor: "" });
                    }}>
                    {campos.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                  <select className={inputCls} value={f.op} aria-label="Operador do filtro"
                    onChange={(e) => updFiltro(i, { op: e.target.value })}>
                    {ops.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                  </select>
                  {precisaValor ? (
                    campo?.opcoes ? (
                      <select className={inputCls} value={f.valor ?? ""} aria-label="Valor do filtro"
                        onChange={(e) => updFiltro(i, { valor: e.target.value })}>
                        <option value="">—</option>
                        {campo.opcoes.map((o) => <option key={String(o)} value={o}>{String(o)}</option>)}
                      </select>
                    ) : (
                      <input className={inputCls} value={f.valor ?? ""} aria-label="Valor do filtro"
                        type={campo?.tipo === "data" ? "date" : (campo?.tipo === "numero" || campo?.tipo === "moeda" ? "number" : "text")}
                        onChange={(e) => updFiltro(i, { valor: e.target.value })} />
                    )
                  ) : <div />}
                  <button type="button" onClick={() => rmFiltro(i)} aria-label="Remover filtro"
                    className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:text-red-400 hover:bg-gray-600 text-sm">✕</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Agrupamento */}
        <div className="mt-4">
          <span className="text-sm font-semibold text-gray-300 block mb-2">Agrupar por</span>
          <div className="flex flex-wrap gap-2">
            {campos.filter((c) => c.tipo !== "moeda").map((c) => (
              <button key={c.id} type="button" onClick={() => toggleAgrupamento(c.id)}
                className={`px-2.5 py-1 rounded-full text-xs border transition ${
                  spec.agrupamento.includes(c.id)
                    ? "bg-blue-600 border-blue-500 text-white"
                    : "bg-gray-900 border-gray-700 text-gray-400 hover:border-gray-500"}`}>
                {c.label}
              </button>
            ))}
          </div>
          {spec.agrupamento.length === 0 && (
            <p className="text-xs text-gray-500 mt-2">Sem agrupamento o relatório traz uma linha só, com os totais gerais.</p>
          )}
        </div>

        {/* Métricas */}
        <div className="mt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-semibold text-gray-300">Métricas</span>
            <button type="button" onClick={addMetrica}
              className="text-xs px-2 py-1 rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">+ Métrica</button>
          </div>
          <div className="space-y-2">
            {spec.metricas.map((m, i) => {
              const agsValidas = AGREGACOES;
              const camposDaAgregacao = campos.filter((c) => (
                (AGREGACOES.find((a) => a.id === m.agregacao)?.tipos || []).includes(c.tipo)
              ));
              return (
                <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2">
                  <select className={inputCls} value={m.agregacao} aria-label="Agregação"
                    onChange={(e) => {
                      const ag = AGREGACOES.find((a) => a.id === e.target.value);
                      const campoOk = campos.find((c) => ag.tipos.includes(c.tipo));
                      updMetrica(i, { agregacao: ag.id, campo: ag.id === "contagem" ? undefined : campoOk?.id });
                    }}>
                    {agsValidas.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                  </select>
                  {m.agregacao === "contagem" ? <div className="text-xs text-gray-500 self-center">conta registros</div> : (
                    <select className={inputCls} value={m.campo || ""} aria-label="Campo da métrica"
                      onChange={(e) => updMetrica(i, { campo: e.target.value })}>
                      {camposDaAgregacao.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                    </select>
                  )}
                  <button type="button" onClick={() => rmMetrica(i)} aria-label="Remover métrica"
                    className="px-3 py-2 rounded-lg bg-gray-700 text-gray-300 hover:text-red-400 hover:bg-gray-600 text-sm">✕</button>
                </div>
              );
            })}
          </div>
        </div>

        {/* Gráfico */}
        {spec.agrupamento.length > 0 && (
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={labelCls} htmlFor="rel-graf-tipo">Gráfico</label>
              <select id="rel-graf-tipo" className={inputCls} value={spec.grafico?.tipo || ""}
                onChange={(e) => upd({
                  grafico: e.target.value
                    ? { tipo: e.target.value, eixoX: spec.agrupamento[0], series: [colunaMetrica(spec.metricas[0])] }
                    : null,
                })}>
                <option value="">Sem gráfico</option>
                <option value="barra">Barras</option>
                <option value="linha">Linha</option>
                <option value="area">Área</option>
                <option value="pizza">Pizza</option>
              </select>
            </div>
            {spec.grafico && (
              <div>
                <label className={labelCls} htmlFor="rel-graf-serie">Série do gráfico</label>
                <select id="rel-graf-serie" className={inputCls} value={spec.grafico.series[0] || ""}
                  onChange={(e) => upd({ grafico: { ...spec.grafico, series: [e.target.value] } })}>
                  {spec.metricas.map((m) => {
                    const id = colunaMetrica(m);
                    return <option key={id} value={id}>{id}</option>;
                  })}
                </select>
              </div>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button type="button" onClick={gerar} disabled={gerando}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50">
            {gerando ? "Gerando..." : "Gerar relatório"}
          </button>
          <span className="text-xs text-gray-500">{resumoSpec(spec)}</span>
        </div>

        {erros.length > 0 && (
          <ul className="mt-3 text-xs text-red-400 list-disc list-inside space-y-1">
            {erros.map((e, i) => <li key={i}>{e}</li>)}
          </ul>
        )}
      </div>

      {/* ─── Resultado ─── */}
      {resultado && <ResultadoRelatorio resultado={resultado} />}
    </div>
  );
}

// Tabela + KPIs + gráfico do resultado. Tabela própria (e não o DataTable do
// App.jsx) porque aquele componente não é exportado e importá-lo daqui criaria
// import circular.
function ResultadoRelatorio({ resultado }) {
  const { colunas, linhas, totais, truncado, spec, resumo } = resultado;
  const metricas = colunas.filter((c) => !(spec.agrupamento || []).includes(c.id));

  if (linhas.length === 0) {
    return (
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-10 text-center">
        <div className="text-4xl mb-3 opacity-50">📊</div>
        <h3 className="text-gray-300 font-semibold mb-1">Nenhum registro encontrado</h3>
        <p className="text-sm text-gray-500">{resumo}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {truncado && (
        <div className="bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm rounded-lg px-4 py-3">
          Resultado parcial: o limite de 50.000 registros foi atingido. Estreite o período para um número exato.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {metricas.map((c) => (
          <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-gray-400 text-xs mb-1">{c.label}</p>
            <p className="text-xl font-bold text-white">{fmtNum(totais[c.id], c.tipo)}</p>
          </div>
        ))}
      </div>

      {spec.grafico && <GraficoRelatorio spec={spec} linhas={linhas} />}

      <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-900/60">
              <tr>
                {colunas.map((c) => (
                  <th key={c.id} className={`px-4 py-3 text-xs font-semibold text-gray-400 ${
                    c.tipo === "moeda" || c.tipo === "numero" ? "text-right" : "text-left"}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {linhas.map((l, i) => (
                <tr key={i} className="border-t border-gray-700/60 hover:bg-gray-700/20">
                  {colunas.map((c) => (
                    <td key={c.id} className={`px-4 py-2.5 text-gray-200 ${
                      c.tipo === "moeda" || c.tipo === "numero" ? "text-right tabular-nums" : "text-left"}`}>
                      {fmtNum(l[c.id], c.tipo)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-blue-500/50 bg-gray-900/40">
                {colunas.map((c, i) => (
                  <td key={c.id} className={`px-4 py-2.5 font-bold text-white ${
                    c.tipo === "moeda" || c.tipo === "numero" ? "text-right tabular-nums" : "text-left"}`}>
                    {i === 0 ? "TOTAL" : fmtNum(totais[c.id], c.tipo)}
                  </td>
                ))}
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </div>
  );
}

function GraficoRelatorio({ spec, linhas }) {
  const { tipo, eixoX, series } = spec.grafico;
  const serie = series[0];
  const dados = linhas.slice(0, 30); // gráfico com 500 fatias é ilegível

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-4" style={{ height: 320 }}>
      <ResponsiveContainer width="100%" height="100%">
        {tipo === "pizza" ? (
          <PieChart>
            <Pie data={dados} dataKey={serie} nameKey={eixoX} outerRadius={110} label>
              {dados.map((_, i) => <Cell key={i} fill={CORES[i % CORES.length]} />)}
            </Pie>
            <Tooltip />
            <Legend />
          </PieChart>
        ) : tipo === "linha" ? (
          <LineChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey={eixoX} stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip />
            <Line type="monotone" dataKey={serie} stroke={CORES[0]} strokeWidth={2} />
          </LineChart>
        ) : tipo === "area" ? (
          <AreaChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey={eixoX} stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip />
            <Area type="monotone" dataKey={serie} stroke={CORES[0]} fill={CORES[0]} fillOpacity={0.3} />
          </AreaChart>
        ) : (
          <BarChart data={dados}>
            <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
            <XAxis dataKey={eixoX} stroke="#9ca3af" fontSize={11} />
            <YAxis stroke="#9ca3af" fontSize={11} />
            <Tooltip />
            <Bar dataKey={serie} fill={CORES[0]} radius={[4, 4, 0, 0]} />
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 2: Verificar que compila e passa no lint**

```bash
npm run lint
npm run build
```

Expected: sem erro. Warnings de hook exaustivo em `useCallback` são aceitáveis se o projeto já os tem; erro novo, não.

- [ ] **Step 3: Commit**

```bash
git add src/modules/RelatoriosModule.jsx
git commit -m "feat(relatorios): modulo com builder, tabela, KPIs e grafico"
```

---

### Task 10: Registro no shell e permissões

**Files:**
- Modify: `src/constants.js` (ROLE_PERMISSIONS)
- Modify: `src/App.jsx` (import, `ALL_MODULES`, `TOGGLEABLE_MODULES`, `navItems`, `ModuleSwitcher`, `SCOPED_PREFIXES`, `AUDITED_PREFIXES`, `summarizeRecord`)
- Modify: `src/FrostIcons.jsx` (ícone `relatorios`)

**Interfaces:**
- Consumes: `RelatoriosModule` (Task 9).
- Produces: módulo acessível na sidebar com `hasPermission(user, "relatorios")`; prefixo `erp:relatorio:` com escopo por empresa e auditado.

- [ ] **Step 1: Liberar o módulo no `ROLE_PERMISSIONS`**

Em `src/constants.js`, na linha do `gerente`, acrescente `"relatorios"` ao array (o `admin` já tem `["all"]`, não precisa de mudança). `tecnico`, `atendente` e `ponto` **não** recebem — o atendente entra só via `customPermissions`:

```js
  gerente: ["dashboard", "clientes", "funcionarios", "financeiro", "os", "agenda", "config", "ia", "folha", "pos-venda", "ponto", "lembrete", "relatorios"],
```

- [ ] **Step 2: Registrar o módulo nas listas do `App.jsx`**

Em `src/App.jsx`:

1. No import dos módulos verticais (perto de `import PontoModule from "./modules/PontoModule.jsx";`):

```jsx
// Relatórios: motor genérico de análise sobre qualquer entidade do sistema.
import RelatoriosModule from "./modules/RelatoriosModule.jsx";
```

2. Em `ALL_MODULES`, antes de `config`:

```js
  { id: "relatorios", label: "Relatórios" },
```

3. Em `TOGGLEABLE_MODULES`, depois de `lembrete`:

```js
  { id: "relatorios", label: "Relatórios" },
```

4. Em `SCOPED_PREFIXES`, junto dos demais prefixos `erp:`:

```js
  // Relatórios salvos: configuração (ReportSpec) por empresa, sem dado agregado.
  "erp:relatorio:",
```

5. Em `AUDITED_PREFIXES`:

```js
  // Relatórios salvos: criar/editar/excluir relatório da empresa fica no log.
  "erp:relatorio:",
```

6. Em `summarizeRecord`, antes do `return value.id || "";` final:

```js
  if (prefix === "erp:relatorio:") return `${value.nome || "Relatório"} (${value.spec?.fonte || "—"})`;
```

7. Em `navItems`, antes do item `config`:

```jsx
      { id: "relatorios", label: "Relatórios", iconName: "relatorios", module: "relatorios" },
```

8. No bloco do `ModuleSwitcher`, junto dos demais `activeModule === …`:

```jsx
            {activeModule === "relatorios" && (
              <RelatoriosModule
                user={user}
                db={DB}
                addToast={addToast}
                companyId={getActiveCompanyId()}
                empresa={{
                  nome: config?.empresa || config?.nomeEmpresa,
                  cnpj: config?.cnpj,
                  telefone: config?.telefone,
                  endereco: config?.endereco,
                  logo: config?.logo,
                }}
              />
            )}
```

Confirme os nomes reais dos campos de `erp:config` antes de escrever o `empresa={{…}}`:

```bash
grep -n "DB.set(\"erp:config\"" -B 20 src/App.jsx | head -40
```

- [ ] **Step 3: Acrescentar o ícone**

Em `src/FrostIcons.jsx`, dentro do objeto `IC`, ao lado de `lembrete` e `ponto`:

```jsx
  relatorios: {
    minimal: ({ c }) => (
      <>
        <rect x="4" y="4" width="16" height="16" rx="2" stroke={c} strokeWidth="1" fill="none" />
        <path d="M8 16V11" stroke={c} strokeWidth="1" strokeLinecap="round" />
        <path d="M12 16V8" stroke={c} strokeWidth="1" strokeLinecap="round" />
        <path d="M16 16v-3" stroke={c} strokeWidth="1" strokeLinecap="round" />
      </>
    ),
  },
```

- [ ] **Step 4: Verificar o gate de permissão**

```bash
npm run lint
npm run build
npm run test
```

Depois, com `npm run dev`:
1. Logue como **admin** → "Relatórios" aparece na sidebar e abre.
2. Logue como **técnico** → continua indo direto para o `TecnicoMobileApp`, sem sidebar (nada pode ter mudado aqui).
3. Logue como **atendente** → "Relatórios" **não** aparece.

- [ ] **Step 5: Commit**

```bash
git add src/constants.js src/App.jsx src/FrostIcons.jsx
git commit -m "feat(relatorios): registrar modulo no shell, permissoes e prefixo auditado"
```

---

### Task 11: Relatórios salvos (`erp:relatorio:`)

**Files:**
- Modify: `src/modules/RelatoriosModule.jsx`
- Create: `src/lib/relatorios/salvos.js`
- Test: `src/lib/relatorios/salvos.test.js`

**Interfaces:**
- Consumes: `db` (`list`/`get`/`set`/`delete`), `genId` de `../utils.js`, `validarSpec` de `./spec.js`.
- Produces (em `salvos.js`, todas puras exceto pelo `db` recebido por parâmetro):
  - `PREFIXO_RELATORIO` = `"erp:relatorio:"`
  - `montarRegistroSalvo({ id, nome, descricao, spec, usuarioNome, agora })` → objeto persistível
  - `listarSalvos(db)` → array ordenado por `atualizadoEm` desc
  - `salvarRelatorio(db, registro)` → registro gravado
  - `excluirRelatorio(db, id)` → void
  - `duplicarRegistro(registro, { novoId, agora })` → novo registro com nome `"<nome> (cópia)"`

- [ ] **Step 1: Escrever o teste que falha**

`src/lib/relatorios/salvos.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  PREFIXO_RELATORIO, montarRegistroSalvo, listarSalvos, salvarRelatorio,
  excluirRelatorio, duplicarRegistro,
} from "./salvos.js";

// DB falso com a mesma superfície usada pelo módulo (list/get/set/delete).
function fakeDB(inicial = []) {
  const mapa = new Map(inicial.map((r) => [PREFIXO_RELATORIO + r.id, r]));
  return {
    list: (prefixo) => [...mapa.entries()].filter(([k]) => k.startsWith(prefixo)).map(([, v]) => v),
    get: (k) => mapa.get(k) || null,
    set: (k, v) => { mapa.set(k, v); },
    delete: (k) => { mapa.delete(k); },
    _mapa: mapa,
  };
}

const spec = {
  fonte: "os",
  periodo: { campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [], agrupamento: ["tecnicoId"],
  metricas: [{ agregacao: "contagem" }],
  ordenacao: null, limite: 500, grafico: null,
};

describe("salvos.montarRegistroSalvo", () => {
  it("monta o registro com carimbos e autor", () => {
    const agora = "2026-03-05T12:00:00.000Z";
    const r = montarRegistroSalvo({ id: "r1", nome: "Faturamento", descricao: "mensal", spec, usuarioNome: "Ana", agora });
    expect(r).toMatchObject({
      id: "r1", nome: "Faturamento", descricao: "mensal",
      criadoPor: "Ana", criadoEm: agora, atualizadoEm: agora,
    });
    expect(r.spec.fonte).toBe("os");
  });

  it("preserva criadoEm em edição", () => {
    const r = montarRegistroSalvo({
      id: "r1", nome: "Novo nome", spec, usuarioNome: "Ana",
      agora: "2026-04-01T00:00:00.000Z", criadoEm: "2026-03-05T12:00:00.000Z",
    });
    expect(r.criadoEm).toBe("2026-03-05T12:00:00.000Z");
    expect(r.atualizadoEm).toBe("2026-04-01T00:00:00.000Z");
  });
});

describe("salvos — CRUD", () => {
  it("salva sob o prefixo certo", () => {
    const db = fakeDB();
    salvarRelatorio(db, montarRegistroSalvo({ id: "r1", nome: "A", spec, usuarioNome: "Ana", agora: "2026-01-01T00:00:00.000Z" }));
    expect(db.get("erp:relatorio:r1").nome).toBe("A");
  });

  it("lista ordenando do mais recente para o mais antigo", () => {
    const db = fakeDB([
      { id: "a", nome: "Antigo", spec, atualizadoEm: "2026-01-01T00:00:00.000Z" },
      { id: "b", nome: "Novo", spec, atualizadoEm: "2026-05-01T00:00:00.000Z" },
    ]);
    expect(listarSalvos(db).map((r) => r.nome)).toEqual(["Novo", "Antigo"]);
  });

  it("descarta registro corrompido sem spec", () => {
    const db = fakeDB([{ id: "x", nome: "Quebrado" }]);
    expect(listarSalvos(db)).toEqual([]);
  });

  it("exclui pelo id", () => {
    const db = fakeDB([{ id: "a", nome: "A", spec, atualizadoEm: "2026-01-01T00:00:00.000Z" }]);
    excluirRelatorio(db, "a");
    expect(listarSalvos(db)).toEqual([]);
  });
});

describe("salvos.duplicarRegistro", () => {
  it("gera cópia com id e nome novos", () => {
    const orig = montarRegistroSalvo({ id: "r1", nome: "Faturamento", spec, usuarioNome: "Ana", agora: "2026-01-01T00:00:00.000Z" });
    const copia = duplicarRegistro(orig, { novoId: "r2", agora: "2026-02-01T00:00:00.000Z" });
    expect(copia.id).toBe("r2");
    expect(copia.nome).toBe("Faturamento (cópia)");
    expect(copia.criadoEm).toBe("2026-02-01T00:00:00.000Z");
    expect(copia.spec).toEqual(orig.spec);
  });
});
```

- [ ] **Step 2: Rodar o teste e ver falhar**

Run: `npm run test -- src/lib/relatorios/salvos.test.js`
Expected: FAIL — `Failed to resolve import "./salvos.js"`.

- [ ] **Step 3: Implementar `salvos.js`**

`src/lib/relatorios/salvos.js`:

```js
// Persistência dos relatórios salvos. O que é gravado é a CONFIGURAÇÃO
// (ReportSpec), nunca o resultado: reabrir o relatório recalcula com os dados
// atuais. Escrever via DB dá de graça escopo por empresa, audit trail e sync
// com o Supabase — por isso nada aqui fala com window.storage direto.

export const PREFIXO_RELATORIO = "erp:relatorio:";

export function montarRegistroSalvo({ id, nome, descricao = "", spec, usuarioNome = "", agora, criadoEm }) {
  const ts = agora || new Date().toISOString();
  return {
    id,
    nome: String(nome || "Relatório sem nome").trim(),
    descricao: String(descricao || "").trim(),
    spec,
    criadoPor: usuarioNome,
    criadoEm: criadoEm || ts,
    atualizadoEm: ts,
  };
}

// Registro sem spec é lixo de versão antiga ou gravação parcial: ignorar é
// melhor que renderizar um card que quebra ao abrir.
export function listarSalvos(db) {
  const itens = (db.list(PREFIXO_RELATORIO) || []).filter((r) => r && r.id && r.spec);
  return itens.sort((a, b) => String(b.atualizadoEm || "").localeCompare(String(a.atualizadoEm || "")));
}

export function salvarRelatorio(db, registro) {
  db.set(PREFIXO_RELATORIO + registro.id, registro);
  return registro;
}

export function excluirRelatorio(db, id) {
  db.delete(PREFIXO_RELATORIO + id);
}

export function duplicarRegistro(registro, { novoId, agora }) {
  const ts = agora || new Date().toISOString();
  return {
    ...registro,
    id: novoId,
    nome: `${registro.nome} (cópia)`,
    criadoEm: ts,
    atualizadoEm: ts,
  };
}
```

- [ ] **Step 4: Rodar o teste e ver passar**

Run: `npm run test -- src/lib/relatorios/salvos.test.js`
Expected: PASS, 8 testes.

- [ ] **Step 5: Ligar a aba "Salvos" na UI**

Em `src/modules/RelatoriosModule.jsx`:

1. Acrescente os imports:

```jsx
import { genId } from "../utils.js";
import {
  listarSalvos, salvarRelatorio, excluirRelatorio, duplicarRegistro, montarRegistroSalvo,
} from "../lib/relatorios/salvos.js";
```

2. Acrescente o estado, logo abaixo de `const [gerando, setGerando] = useState(false);`:

```jsx
  const [aba, setAba] = useState("novo");          // "novo" | "salvos"
  const [salvos, setSalvos] = useState(() => listarSalvos(db));
  const [editandoId, setEditandoId] = useState(null); // id do salvo aberto, se houver
  const [nomeSalvar, setNomeSalvar] = useState("");
  const [dialogoSalvar, setDialogoSalvar] = useState(false);
```

3. Acrescente as ações, depois de `gerar`:

```jsx
  // Salva a CONFIGURAÇÃO atual. Se veio de um salvo aberto, atualiza no lugar.
  const confirmarSalvar = useCallback(() => {
    const v = validarSpec(spec);
    if (!v.ok) { setErros(v.erros); return; }
    const anterior = editandoId ? db.get(`erp:relatorio:${editandoId}`) : null;
    const registro = montarRegistroSalvo({
      id: editandoId || genId(),
      nome: nomeSalvar,
      descricao: resumoSpec(v.spec),
      spec: v.spec,
      usuarioNome: user?.nome || user?.email || "",
      agora: new Date().toISOString(),
      criadoEm: anterior?.criadoEm,
    });
    salvarRelatorio(db, registro);
    setSalvos(listarSalvos(db));
    setEditandoId(registro.id);
    setDialogoSalvar(false);
    addToast("Relatório salvo.", "success");
  }, [spec, editandoId, nomeSalvar, db, user, addToast]);

  const abrirSalvo = useCallback((registro) => {
    setSpec(registro.spec);
    setEditandoId(registro.id);
    setNomeSalvar(registro.nome);
    setAba("novo");
    setResultado(null);
    setErros([]);
  }, []);

  const removerSalvo = useCallback((registro) => {
    excluirRelatorio(db, registro.id);
    setSalvos(listarSalvos(db));
    if (editandoId === registro.id) setEditandoId(null);
    addToast("Relatório excluído.", "success");
  }, [db, editandoId, addToast]);

  const duplicarSalvo = useCallback((registro) => {
    salvarRelatorio(db, duplicarRegistro(registro, { novoId: genId(), agora: new Date().toISOString() }));
    setSalvos(listarSalvos(db));
    addToast("Cópia criada.", "success");
  }, [db, addToast]);
```

4. Logo abaixo do cabeçalho `<h2>Relatórios</h2>`, acrescente as abas:

```jsx
        <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1">
          {[["novo", "Novo relatório"], ["salvos", `Salvos (${salvos.length})`]].map(([id, label]) => (
            <button key={id} type="button" onClick={() => setAba(id)}
              className={`px-3 py-1.5 text-sm rounded-md transition ${
                aba === id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
              {label}
            </button>
          ))}
        </div>
```

5. Envolva o card do Builder e o `<ResultadoRelatorio…>` em `{aba === "novo" && (<> … </>)}` e acrescente a lista de salvos:

```jsx
      {aba === "salvos" && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
          {salvos.length === 0 && (
            <p className="text-sm text-gray-500 col-span-full">
              Nenhum relatório salvo ainda. Monte um em "Novo relatório" e clique em Salvar.
            </p>
          )}
          {salvos.map((r) => (
            <div key={r.id} className="bg-gray-800 border border-gray-700 rounded-xl p-4 flex flex-col gap-2">
              <div>
                <h3 className="text-white font-semibold text-sm">{r.nome}</h3>
                <p className="text-xs text-gray-500 mt-1">{r.descricao}</p>
              </div>
              <p className="text-[11px] text-gray-600">
                {r.criadoPor ? `por ${r.criadoPor} · ` : ""}
                atualizado em {new Date(r.atualizadoEm).toLocaleDateString("pt-BR")}
              </p>
              <div className="flex flex-wrap gap-2 mt-auto pt-2">
                <button type="button" onClick={() => abrirSalvo(r)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700">Abrir</button>
                <button type="button" onClick={() => duplicarSalvo(r)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Duplicar</button>
                <button type="button" onClick={() => removerSalvo(r)}
                  className="px-2.5 py-1 text-xs rounded-lg bg-gray-700 text-red-400 hover:bg-gray-600">Excluir</button>
              </div>
            </div>
          ))}
        </div>
      )}
```

6. Acrescente o botão Salvar ao lado do "Gerar relatório", e o diálogo de nome:

```jsx
          <button type="button" onClick={() => { setNomeSalvar(nomeSalvar || ""); setDialogoSalvar(true); }}
            className="px-4 py-2 rounded-lg bg-gray-700 text-gray-200 text-sm hover:bg-gray-600">
            {editandoId ? "Salvar alterações" : "Salvar relatório"}
          </button>
```

```jsx
      {dialogoSalvar && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-3">Salvar relatório</h3>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="rel-nome">Nome</label>
            <input id="rel-nome" className={inputCls} value={nomeSalvar} autoFocus
              onChange={(e) => setNomeSalvar(e.target.value)} placeholder="Ex.: Faturamento por técnico" />
            <p className="text-xs text-gray-500 mt-2">{resumoSpec(spec)}</p>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setDialogoSalvar(false)}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">Cancelar</button>
              <button type="button" onClick={confirmarSalvar} disabled={!nomeSalvar.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50">Salvar</button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 6: Testar manualmente**

`npm run dev`, como admin: monte um relatório, salve, veja aparecer na aba Salvos, abra de novo, duplique, exclua. Depois abra Configurações → auditoria e confirme que as gravações apareceram no log (o prefixo foi adicionado a `AUDITED_PREFIXES` na Task 10).

- [ ] **Step 7: Commit**

```bash
git add src/lib/relatorios/salvos.js src/lib/relatorios/salvos.test.js src/modules/RelatoriosModule.jsx
git commit -m "feat(relatorios): biblioteca de relatorios salvos por empresa"
```

---

### Task 12: Exports na UI — CSV, PDF e impressão

**Files:**
- Modify: `src/modules/RelatoriosModule.jsx`

**Interfaces:**
- Consumes: `paraCSV`, `nomeArquivoCSV`, `baixarCSV` (`../lib/relatorios/csv.js`); `relatorioHTML` (`../lib/relatorios/html.js`); `openHTMLDoc`, `gerarPDFDeHTML` (`../lib/doc.js`).
- Produces: barra de ações do resultado com **Baixar CSV**, **Abrir documento** e **Baixar PDF**.

- [ ] **Step 1: Acrescentar imports e ações**

Em `src/modules/RelatoriosModule.jsx`:

```jsx
import { paraCSV, nomeArquivoCSV, baixarCSV } from "../lib/relatorios/csv.js";
import { relatorioHTML } from "../lib/relatorios/html.js";
import { openHTMLDoc, gerarPDFDeHTML } from "../lib/doc.js";
```

Dentro do componente, depois das ações de salvar:

```jsx
  // Nome usado nos arquivos exportados: o do relatório salvo, ou o resumo da
  // consulta quando é um relatório ainda não nomeado.
  const nomeExibicao = nomeSalvar?.trim() || (resultado ? `Relatório de ${getDataset(spec.fonte)?.label}` : "Relatório");

  const montarHTML = useCallback(() => relatorioHTML({
    nome: nomeExibicao,
    resumo: resultado?.resumo || resumoSpec(spec),
    colunas: resultado?.colunas || [],
    linhas: resultado?.linhas || [],
    totais: resultado?.totais || {},
    truncado: resultado?.truncado || false,
    empresa,
  }), [resultado, spec, nomeExibicao, empresa]);

  const exportarCSV = useCallback(() => {
    if (!resultado) return;
    baixarCSV(nomeArquivoCSV(nomeExibicao), paraCSV(resultado));
    addToast("CSV baixado.", "success");
  }, [resultado, nomeExibicao, addToast]);

  const abrirDocumento = useCallback(() => {
    if (!resultado) return;
    openHTMLDoc(montarHTML());
  }, [resultado, montarHTML]);

  const baixarPDF = useCallback(async () => {
    if (!resultado) return;
    try {
      addToast("Gerando PDF...", "info");
      await gerarPDFDeHTML(montarHTML(), nomeArquivoCSV(nomeExibicao).replace(/\.csv$/, ""));
    } catch (e) {
      console.error("[Relatorios] PDF:", e);
      addToast("Falha ao gerar o PDF. Use 'Abrir documento' e imprima.", "error");
    }
  }, [resultado, montarHTML, nomeExibicao, addToast]);
```

- [ ] **Step 2: Acrescentar a barra de ações ao resultado**

Passe as ações para `ResultadoRelatorio`:

```jsx
      {aba === "novo" && resultado && (
        <ResultadoRelatorio
          resultado={resultado}
          acoes={{ exportarCSV, abrirDocumento, baixarPDF }}
        />
      )}
```

E no componente `ResultadoRelatorio`, mude a assinatura para `({ resultado, acoes })` e insira a barra antes dos KPIs:

```jsx
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={acoes.exportarCSV}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Baixar CSV</button>
        <button type="button" onClick={acoes.abrirDocumento}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Abrir documento</button>
        <button type="button" onClick={acoes.baixarPDF}
          className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600">Baixar PDF</button>
      </div>
```

Faça a mesma inserção no ramo de resultado vazio? **Não** — sem linhas não há o que exportar; a barra só aparece quando há resultado.

- [ ] **Step 3: Testar manualmente os três caminhos**

`npm run dev`, como admin, com um relatório gerado:
1. **Baixar CSV** → abra no Excel/LibreOffice: colunas separadas, acento correto, decimal com vírgula, linha TOTAL no fim.
2. **Abrir documento** → janela nova com cabeçalho da empresa, tabela e os três botões da barra funcionando.
3. **Baixar PDF** → arquivo A4 legível, sem a barra de ações na página.

- [ ] **Step 4: Verificar build**

```bash
npm run lint
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/modules/RelatoriosModule.jsx
git commit -m "feat(relatorios): exportar CSV, abrir documento imprimivel e baixar PDF"
```

---

### Task 13: Edge `relatorio-whatsapp` + envio na UI

**Files:**
- Create: `supabase/functions/relatorio-whatsapp/index.ts`
- Modify: `src/supabase.js` (helper `enviarRelatorioWhatsApp`)
- Modify: `src/modules/RelatoriosModule.jsx` (botão + diálogo de envio)

**Interfaces:**
- Consumes: tabela `ai_agent_config` (`evolution_url`, `evolution_instance`, `metadata.evolution_apikey`), tabela `company_members`.
- Produces:
  - Edge `relatorio-whatsapp` — POST `{ companyId, telefone, nomeRelatorio, resumo, arquivoBase64, arquivoNome, mimetype }` → `{ ok, error? }`
  - `enviarRelatorioWhatsApp(payload)` em `src/supabase.js` → `{ ok, error? }`
  - `paraBase64(texto)` em `src/lib/relatorios/csv.js` → base64 UTF-8 seguro

Por que Edge Function e não `fetch` direto do cliente: a CSP de produção (`vite.config.js`) só libera `connect-src` para `'self'` e `*.supabase.co`. Uma chamada direta ao host do Evolution é bloqueada no navegador — e ainda exporia a apikey.

- [ ] **Step 1: Acrescentar o conversor base64 ao `csv.js` + teste**

Em `src/lib/relatorios/csv.js`:

```js
// Base64 de texto UTF-8. btoa() sozinho estoura em acento ("ç", "ã"), por isso
// o texto passa por TextEncoder antes.
export function paraBase64(texto) {
  const bytes = new TextEncoder().encode(String(texto));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
```

Em `src/lib/relatorios/csv.test.js`:

```js
import { paraBase64 } from "./csv.js";

describe("csv.paraBase64", () => {
  it("codifica ASCII", () => {
    expect(paraBase64("abc")).toBe("YWJj");
  });
  it("não quebra com acento", () => {
    const b64 = paraBase64("ação");
    expect(typeof b64).toBe("string");
    expect(b64.length).toBeGreaterThan(0);
  });
});
```

Run: `npm run test -- src/lib/relatorios/csv.test.js`
Expected: PASS, 11 testes.

- [ ] **Step 2: Escrever a Edge Function**

`supabase/functions/relatorio-whatsapp/index.ts`:

```ts
// Edge Function: relatorio-whatsapp
// ─────────────────────────────────────────────────────────────────────────────
// Envia um relatório gerado no app para um número de WhatsApp via Evolution API:
// primeiro o resumo em texto, depois o arquivo como documento.
//
// Roda no servidor por dois motivos: a CSP do app bloqueia fetch para o host do
// Evolution, e a apikey da instância não pode chegar ao navegador.
//
// Caller: cliente front-end logado, admin ou gerente da companyId alvo.
//
// Deploy: supabase functions deploy relatorio-whatsapp
// Auth: verify_jwt = true.
//
// Payload (POST JSON):
//   {
//     companyId: string,
//     telefone: string,             // com ou sem DDI; normalizado aqui
//     nomeRelatorio: string,
//     resumo: string,               // texto da mensagem
//     arquivoBase64: string,        // conteúdo do arquivo, sem prefixo data:
//     arquivoNome: string,          // ex.: "faturamento-2026-03-05.csv"
//     mimetype?: string             // default "text/csv"
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Normaliza telefone brasileiro: só dígitos, sem zero à esquerda, com DDI 55.
function normalizaTelefone(bruto: string): string {
  const n = String(bruto).replace(/\D/g, "").replace(/^0+/, "");
  return n.startsWith("55") ? n : "55" + n;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // ─── 1. Identifica o caller pelo JWT ───
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !callerData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const callerId = callerData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const companyId = String(body.companyId || "").trim();
  const telefone = String(body.telefone || "").trim();
  const nomeRelatorio = String(body.nomeRelatorio || "Relatório").trim();
  const resumo = String(body.resumo || "").trim();
  const arquivoBase64 = String(body.arquivoBase64 || "");
  const arquivoNome = String(body.arquivoNome || "relatorio.csv");
  const mimetype = String(body.mimetype || "text/csv");
  if (!companyId || !telefone || !arquivoBase64) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── 2. Caller precisa ser admin ou gerente DESTA empresa ───
  const { data: membro } = await admin
    .from("company_members")
    .select("role, is_super_admin, status")
    .eq("user_id", callerId)
    .eq("company_id", companyId)
    .maybeSingle();

  const autorizado = membro && membro.status === "ativo" &&
    (membro.is_super_admin || membro.role === "admin" || membro.role === "gerente");
  if (!autorizado) return json({ ok: false, error: "forbidden" }, 403);

  // ─── 3. Instância Evolution da empresa ───
  const { data: cfg } = await admin
    .from("ai_agent_config")
    .select("evolution_url, evolution_instance, metadata")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!cfg?.evolution_url || !cfg?.evolution_instance) {
    return json({ ok: false, error: "evolution_nao_configurada" }, 400);
  }
  const apikey = String((cfg.metadata as Record<string, unknown> | null)?.evolution_apikey || "")
    || Deno.env.get("EVOLUTION_APIKEY") || "";
  const base = String(cfg.evolution_url).replace(/\/$/, "");
  const numero = normalizaTelefone(telefone);

  // ─── 4. Texto primeiro, arquivo depois ───
  // Se o texto falhar, não faz sentido mandar um anexo sem contexto — aborta.
  const texto = `📊 *${nomeRelatorio}*\n\n${resumo}\n\n_Enviado pelo FrostERP._`;
  const respTexto = await fetch(`${base}/message/sendText/${cfg.evolution_instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!respTexto.ok) {
    const detalhe = await respTexto.text().catch(() => "");
    return json({ ok: false, error: `evolution_text_${respTexto.status}`, detalhe: detalhe.slice(0, 200) }, 502);
  }

  const respMedia = await fetch(`${base}/message/sendMedia/${cfg.evolution_instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify({
      number: numero,
      mediatype: "document",
      mimetype,
      media: arquivoBase64,
      fileName: arquivoNome,
      caption: nomeRelatorio,
    }),
  });
  if (!respMedia.ok) {
    const detalhe = await respMedia.text().catch(() => "");
    return json({ ok: false, error: `evolution_media_${respMedia.status}`, detalhe: detalhe.slice(0, 200) }, 502);
  }

  return json({ ok: true });
});
```

- [ ] **Step 3: Helper no `src/supabase.js`**

Acrescente perto dos demais helpers de Edge Function:

```js
// ─── Relatórios — envio por WhatsApp ────────────────────────────────────────
// O envio passa pela Edge Function porque a CSP do app não libera fetch para o
// host do Evolution e a apikey da instância não pode chegar ao navegador.
export async function enviarRelatorioWhatsApp(payload) {
  if (!supabase) return { ok: false, error: "supabase_desabilitado" };
  try {
    const { data, error } = await supabase.functions.invoke("relatorio-whatsapp", { body: payload });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: "resposta_vazia" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 4: Botão e diálogo na UI**

Em `src/modules/RelatoriosModule.jsx`:

```jsx
import { enviarRelatorioWhatsApp } from "../supabase.js";
import { paraBase64 } from "../lib/relatorios/csv.js";
```

Estado e ação:

```jsx
  const [dialogoWhats, setDialogoWhats] = useState(false);
  const [telefoneWhats, setTelefoneWhats] = useState(empresa?.telefone || "");
  const [enviandoWhats, setEnviandoWhats] = useState(false);

  // Envia o CSV do relatório para um WhatsApp. Limite defensivo: acima de ~1 MB
  // o Evolution costuma recusar o anexo, então cortamos e avisamos na mensagem.
  const enviarWhatsApp = useCallback(async () => {
    if (!resultado) return;
    setEnviandoWhats(true);
    try {
      const MAX_LINHAS = 5000;
      const cortado = resultado.linhas.length > MAX_LINHAS;
      const paraExportar = cortado
        ? { ...resultado, linhas: resultado.linhas.slice(0, MAX_LINHAS) }
        : resultado;
      const csv = paraCSV(paraExportar);
      const resumoMsg = [
        resultado.resumo,
        ...resultado.colunas
          .filter((c) => typeof resultado.totais[c.id] === "number")
          .map((c) => `${c.label}: ${fmtNum(resultado.totais[c.id], c.tipo)}`),
        cortado ? `(anexo limitado às primeiras ${MAX_LINHAS} linhas)` : "",
      ].filter(Boolean).join("\n");

      const r = await enviarRelatorioWhatsApp({
        companyId,
        telefone: telefoneWhats,
        nomeRelatorio: nomeExibicao,
        resumo: resumoMsg,
        arquivoBase64: paraBase64(csv),
        arquivoNome: nomeArquivoCSV(nomeExibicao),
        mimetype: "text/csv",
      });
      if (r.ok) {
        addToast("Relatório enviado no WhatsApp.", "success");
        setDialogoWhats(false);
      } else {
        addToast(
          r.error === "evolution_nao_configurada"
            ? "WhatsApp não configurado para esta empresa."
            : `Falha no envio: ${r.error}`,
          "error",
        );
      }
    } finally {
      setEnviandoWhats(false);
    }
  }, [resultado, companyId, telefoneWhats, nomeExibicao, addToast]);
```

Botão (acrescente ao objeto `acoes` passado para `ResultadoRelatorio` e ao JSX da barra):

```jsx
        acoes={{ exportarCSV, abrirDocumento, baixarPDF, abrirWhats: () => setDialogoWhats(true) }}
```

```jsx
        <button type="button" onClick={acoes.abrirWhats}
          className="px-3 py-1.5 text-sm rounded-lg bg-green-700 text-white hover:bg-green-600">Enviar no WhatsApp</button>
```

Diálogo:

```jsx
      {dialogoWhats && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,0.6)" }}>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 w-full max-w-sm">
            <h3 className="text-white font-semibold mb-1">Enviar no WhatsApp</h3>
            <p className="text-xs text-gray-500 mb-3">O destinatário recebe o resumo em texto e o CSV como anexo.</p>
            <label className="block text-xs text-gray-400 mb-1" htmlFor="rel-tel">Telefone</label>
            <input id="rel-tel" className={inputCls} value={telefoneWhats}
              onChange={(e) => setTelefoneWhats(e.target.value)} placeholder="(11) 99999-9999" />
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setDialogoWhats(false)}
                className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">Cancelar</button>
              <button type="button" onClick={enviarWhatsApp} disabled={enviandoWhats || !telefoneWhats.trim()}
                className="px-3 py-1.5 text-sm rounded-lg bg-green-700 text-white hover:bg-green-600 disabled:opacity-50">
                {enviandoWhats ? "Enviando..." : "Enviar"}
              </button>
            </div>
          </div>
        </div>
      )}
```

- [ ] **Step 5: Deploy e teste real**

```bash
supabase functions deploy relatorio-whatsapp
npm run lint
npm run build
```

Com `npm run dev`, gere um relatório e envie para um número de teste. Confirme que chegam **duas** mensagens: o resumo e o anexo CSV. Se voltar `evolution_nao_configurada`, a empresa não tem instância em `ai_agent_config` — teste em uma empresa que tenha.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/relatorio-whatsapp/index.ts src/supabase.js src/modules/RelatoriosModule.jsx src/lib/relatorios/csv.js src/lib/relatorios/csv.test.js
git commit -m "feat(relatorios): envio do relatorio por WhatsApp via edge function"
```

---

### Task 14: Edge `relatorio-nl` + modo Pergunta

**Files:**
- Create: `supabase/functions/relatorio-nl/index.ts`
- Modify: `src/supabase.js` (helper `traduzirPerguntaRelatorio`)
- Modify: `src/modules/RelatoriosModule.jsx` (toggle Builder | Pergunta)

**Interfaces:**
- Consumes: `registryCompacto` (`../lib/relatorios/datasets.js`), `validarSpec` (`../lib/relatorios/spec.js`), secret `ANTHROPIC_API_KEY`.
- Produces:
  - Edge `relatorio-nl` — POST `{ pergunta, registry, hoje }` → `{ ok, spec }` ou `{ ok: false, error }`
  - `traduzirPerguntaRelatorio({ pergunta, registry, hoje })` em `src/supabase.js` → `{ ok, spec?, error? }`

A IA recebe **apenas metadados** (ids, labels, tipos, opções de enum). Nenhum registro de cliente sai do dispositivo. Ela também não calcula nada: devolve o `ReportSpec`, que o cliente valida contra o registry antes de executar.

- [ ] **Step 1: Escrever a Edge Function**

`supabase/functions/relatorio-nl/index.ts`:

```ts
// Edge Function: relatorio-nl
// ─────────────────────────────────────────────────────────────────────────────
// Traduz uma pergunta em português para um ReportSpec do módulo Relatórios.
// A IA recebe SÓ metadados (fontes, campos, tipos) — nenhum dado de cliente — e
// não calcula nada: quem executa é o engine no cliente, depois de validar o spec.
//
// Deploy: supabase functions deploy relatorio-nl
// Auth: verify_jwt = true.
// Secret necessário: ANTHROPIC_API_KEY
//
// Payload (POST JSON): { pergunta: string, registry: object[], hoje: "YYYY-MM-DD" }
// Resposta: { ok: true, spec } | { ok: false, error }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Schema da tool. Forçar tool_choice faz o modelo responder SEMPRE neste
// formato — sem texto solto para o cliente ter que adivinhar.
const FERRAMENTA = {
  name: "montar_relatorio",
  description: "Monta a consulta (ReportSpec) que responde à pergunta do usuário.",
  input_schema: {
    type: "object",
    properties: {
      fonte: { type: "string", description: "id da fonte de dados escolhida" },
      periodo: {
        type: "object",
        properties: {
          campo: { type: "string", description: "id do campo de data usado no recorte" },
          de: { type: "string", description: "data inicial YYYY-MM-DD" },
          ate: { type: "string", description: "data final YYYY-MM-DD" },
        },
        required: ["campo", "de", "ate"],
      },
      filtros: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campo: { type: "string" },
            op: {
              type: "string",
              enum: ["igual", "diferente", "contem", "maior", "menor", "entre", "vazio", "nao_vazio", "em"],
            },
            valor: { description: "valor do filtro; lista para 'entre' e 'em'" },
          },
          required: ["campo", "op"],
        },
      },
      agrupamento: { type: "array", items: { type: "string" } },
      metricas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campo: { type: "string", description: "omitir quando a agregação for contagem" },
            agregacao: {
              type: "string",
              enum: ["soma", "media", "contagem", "minimo", "maximo", "contagem_distinta"],
            },
          },
          required: ["agregacao"],
        },
      },
      ordenacao: {
        type: "object",
        properties: {
          campo: { type: "string", description: "nome da coluna do resultado, ex: valor_soma" },
          direcao: { type: "string", enum: ["asc", "desc"] },
        },
      },
      limite: { type: "number" },
      grafico: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["barra", "linha", "pizza", "area"] },
          eixoX: { type: "string" },
          series: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["fonte", "periodo", "metricas"],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!API_KEY) return json({ ok: false, error: "ia_nao_configurada" }, 503);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const pergunta = String(body.pergunta || "").trim();
  const registry = body.registry;
  const hoje = String(body.hoje || new Date().toISOString().slice(0, 10));
  if (!pergunta || !Array.isArray(registry) || registry.length === 0) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (pergunta.length > 500) return json({ ok: false, error: "pergunta_muito_longa" }, 400);

  const system = [
    "Você monta consultas para o módulo de relatórios de um ERP brasileiro de refrigeração.",
    "Use SOMENTE as fontes e campos do catálogo fornecido — nunca invente id de campo.",
    `Hoje é ${hoje}. Traduza expressões como "março", "este mês", "últimos 30 dias" em datas YYYY-MM-DD.`,
    "Período é obrigatório. Na dúvida sobre o recorte, use o mês corrente.",
    "Escolha a agregação compatível com o tipo do campo: soma/média só em numero ou moeda.",
    "Em ordenacao.campo e grafico.series use o nome da coluna do resultado: <campo>_<agregacao>, ou 'contagem'.",
    "Responda chamando a ferramenta montar_relatorio. Não escreva texto fora dela.",
  ].join(" ");

  const resp = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1024,
      system,
      tools: [FERRAMENTA],
      tool_choice: { type: "tool", name: "montar_relatorio" },
      messages: [{
        role: "user",
        content: `Catálogo de fontes:\n${JSON.stringify(registry)}\n\nPergunta: ${pergunta}`,
      }],
    }),
  });

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    return json({ ok: false, error: `anthropic_${resp.status}`, detalhe: detalhe.slice(0, 200) }, 502);
  }

  const data = await resp.json();
  const bloco = (data.content || []).find((c: Record<string, unknown>) => c.type === "tool_use");
  if (!bloco?.input) return json({ ok: false, error: "sem_resposta_estruturada" }, 502);

  return json({ ok: true, spec: bloco.input });
});
```

- [ ] **Step 2: Helper no `src/supabase.js`**

```js
// ─── Relatórios — pergunta em linguagem natural → ReportSpec ────────────────
// Envia SÓ metadados do registry (ids, labels, tipos). Nenhum dado de cliente
// sai do dispositivo. A validação do spec devolvido acontece no cliente.
export async function traduzirPerguntaRelatorio({ pergunta, registry, hoje }) {
  if (!supabase) return { ok: false, error: "supabase_desabilitado" };
  try {
    const { data, error } = await supabase.functions.invoke("relatorio-nl", {
      body: { pergunta, registry, hoje },
    });
    if (error) return { ok: false, error: error.message };
    return data || { ok: false, error: "resposta_vazia" };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
```

- [ ] **Step 3: Toggle Builder | Pergunta na UI**

Em `src/modules/RelatoriosModule.jsx`:

```jsx
import { registryCompacto } from "../lib/relatorios/datasets.js";
import { traduzirPerguntaRelatorio } from "../supabase.js";
```

Estado:

```jsx
  const [modo, setModo] = useState("builder");     // "builder" | "pergunta"
  const [pergunta, setPergunta] = useState("");
  const [traduzindo, setTraduzindo] = useState(false);
```

Ação:

```jsx
  // A IA só monta a consulta. O spec devolvido é validado contra o registry
  // ANTES de virar cálculo — spec inválido nunca chega ao engine.
  const traduzirPergunta = useCallback(async () => {
    if (!pergunta.trim()) return;
    setTraduzindo(true);
    setErros([]);
    try {
      const hoje = new Date();
      const iso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
      const r = await traduzirPerguntaRelatorio({
        pergunta,
        registry: registryCompacto({ podeVerSensivel }),
        hoje: iso,
      });
      if (!r.ok) {
        addToast(
          r.error === "ia_nao_configurada"
            ? "A tradução por IA não está configurada nesta instalação."
            : `Não consegui interpretar: ${r.error}`,
          "error",
        );
        return;
      }
      const v = validarSpec(r.spec);
      if (!v.ok) {
        // Não descarta tudo: leva o usuário ao Builder com os erros à vista.
        setErros(["A IA montou uma consulta inválida:", ...v.erros]);
        setModo("builder");
        return;
      }
      setSpec(v.spec);
      setModo("builder");
      addToast("Consulta montada. Confira e clique em Gerar.", "success");
    } finally {
      setTraduzindo(false);
    }
  }, [pergunta, podeVerSensivel, addToast]);
```

Toggle e campo, acima do card do Builder:

```jsx
      <div className="flex gap-1 bg-gray-800 border border-gray-700 rounded-lg p-1 w-fit">
        {[["builder", "Builder"], ["pergunta", "Pergunta"]].map(([id, label]) => (
          <button key={id} type="button" onClick={() => setModo(id)}
            className={`px-3 py-1.5 text-sm rounded-md transition ${
              modo === id ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}>
            {label}
          </button>
        ))}
      </div>

      {modo === "pergunta" && (
        <div className={cardCls}>
          <label className={labelCls} htmlFor="rel-pergunta">Pergunte em português</label>
          <textarea id="rel-pergunta" rows={2} className={inputCls} value={pergunta}
            onChange={(e) => setPergunta(e.target.value)} maxLength={500}
            placeholder="Ex.: faturamento por técnico em março, só OS finalizadas" />
          <div className="flex items-center gap-2 mt-3">
            <button type="button" onClick={traduzirPergunta} disabled={traduzindo || !pergunta.trim()}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm hover:bg-blue-700 disabled:opacity-50">
              {traduzindo ? "Interpretando..." : "Montar consulta"}
            </button>
            <span className="text-xs text-gray-500">
              A consulta montada abre no Builder para você conferir antes de gerar.
            </span>
          </div>
        </div>
      )}
```

O card do Builder passa a renderizar sob `{modo === "builder" && ( … )}` — mas **o resultado continua fora dessa condição**, para não sumir ao alternar de modo.

- [ ] **Step 4: Deploy e configuração do secret**

```bash
supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxx
supabase functions deploy relatorio-nl
```

- [ ] **Step 5: Testar as três situações**

Com `npm run dev`, como admin:
1. Pergunta boa: *"faturamento por técnico em março, só OS finalizadas"* → volta preenchida no Builder com o resumo correto.
2. Pergunta impossível: *"quantos unicórnios entregamos"* → toast de erro ou lista de erros de validação; o Builder continua utilizável.
3. Sem `ANTHROPIC_API_KEY` (ou Supabase offline) → toast explicando, Builder segue funcionando normalmente.

- [ ] **Step 6: Commit**

```bash
git add supabase/functions/relatorio-nl/index.ts src/supabase.js src/modules/RelatoriosModule.jsx
git commit -m "feat(relatorios): modo Pergunta traduzindo linguagem natural em ReportSpec"
```

---

### Task 15: Wiki, CLAUDE.md e deploy

**Files:**
- Create: `docs/wiki/modules/relatorios.md`
- Modify: `docs/wiki/index.md`, `docs/wiki/log.md`, `CLAUDE.md`

**Interfaces:**
- Consumes: tudo que foi construído nas Tasks 1–14.
- Produces: documentação conforme a Regra 5 do CLAUDE.md.

- [ ] **Step 1: Escrever a página do wiki**

`docs/wiki/modules/relatorios.md`, com o frontmatter do padrão do projeto:

```markdown
---
title: Módulo Relatórios
type: module
updated: 2026-08-05
sources:
  - ../../superpowers/specs/2026-08-04-modulo-relatorios-design.md
related:
  - ../concepts/db-layer.md
  - ../concepts/role-permissions.md
  - ../concepts/document-generators.md
  - ../concepts/supabase-sync.md
code_refs:
  - src/modules/RelatoriosModule.jsx
  - src/lib/relatorios/datasets.js
  - src/lib/relatorios/engine.js
  - supabase/functions/relatorio-nl/index.ts
  - supabase/functions/relatorio-whatsapp/index.ts
---
```

O corpo cobre, em pt-BR e sem colar código: o que é o `ReportSpec` e por que ele é o formato único; o papel do registry e como registrar fonte nova; a fronteira do engine (puro, recebe arrays); por que a IA não vê dados nem calcula; as três formas de saída (CSV, documento imprimível/PDF, WhatsApp); o gate de permissão e a flag `sensivel`; os limites conhecidos (teto de 50k, período obrigatório, sem join real entre fontes).

- [ ] **Step 2: Atualizar o índice**

Em `docs/wiki/index.md`, na seção `## Módulos`:

```markdown
- [Relatórios](modules/relatorios.md) — motor genérico de análise: builder + pergunta em pt-BR, export CSV/PDF/WhatsApp
```

- [ ] **Step 3: Registrar no log**

Acrescente ao fim de `docs/wiki/log.md`:

```markdown
## [2026-08-05] ingest | Módulo Relatórios
- source: docs/superpowers/specs/2026-08-04-modulo-relatorios-design.md
- new pages: modules/relatorios.md
- touched: index.md
- decisions: engine puro client-side (spec declarativo) em vez de SQL sobre kv_store; IA traduz consulta e não calcula
```

- [ ] **Step 4: Atualizar o `CLAUDE.md`**

Duas mudanças pequenas, na linha do assunto correspondente:
1. Na tabela de Edge Functions, acrescente `relatorio-nl` (verify_jwt=true) e `relatorio-whatsapp` (verify_jwt=true).
2. Na lista de módulos renderizados na sidebar, inclua `relatorios` → `RelatoriosModule`.

- [ ] **Step 5: Verificação final**

```bash
npm run test
npm run lint
npm run build
```

Expected: suíte inteira passando, sem erro novo de lint, build concluído.

- [ ] **Step 6: Commit e deploy (Regra 1)**

```bash
git add docs/ CLAUDE.md
git commit -m "docs(relatorios): pagina de wiki, indice, log e CLAUDE.md"
git push
```

O deploy na Vercel dispara pelo push. As duas Edge Functions são deployadas à parte (`supabase functions deploy relatorio-nl` e `relatorio-whatsapp`), o que já foi feito nas Tasks 13 e 14.

---

## Notas de execução

- **Este projeto ainda não é um repositório git** (`git rev-parse` falha). Antes da Task 1, rode `git init` e faça um commit inicial, ou aponte o trabalho para o clone real do repositório. Sem isso, os passos de commit de cada tarefa não têm onde rodar.
- Os números de linha do `App.jsx` mudam a cada edição. Sempre localize por nome (`grep -n "function openHTMLDoc"`), nunca por linha.
- A ordem das tarefas importa: 1→2 (registry), 3 (spec) antes de 4→5 (engine importa `colunaMetrica`), 8 antes de 12 (exports dependem do `doc.js` extraído).
