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
      { id: "tecnicoId", label: "Técnico", tipo: "referencia", ref: "employees" },
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
    id: "employees",
    label: "Funcionários",
    prefixo: "erp:employee:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "nome", label: "Nome", tipo: "texto" },
      { id: "tipo", label: "Tipo", tipo: "enum", opcoes: ["tecnico", "administrativo", "gerente", "outro"] },
      { id: "cargo", label: "Cargo", tipo: "texto" },
      { id: "telefone", label: "Telefone", tipo: "texto" },
      { id: "email", label: "E-mail", tipo: "texto" },
      { id: "salario", label: "Salário", tipo: "moeda" },
      { id: "dataAdmissao", label: "Data de admissão", tipo: "data" },
      { id: "status", label: "Status", tipo: "enum", opcoes: ["ativo", "inativo"] },
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
