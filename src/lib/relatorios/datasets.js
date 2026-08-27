// Registry de fontes de dados do módulo Relatórios.
// Cada entrada descreve UMA entidade do kv_store: onde ela mora (prefixo), qual
// campo de data governa o filtro de período, e quais campos podem ser filtrados,
// agrupados ou agregados. O engine e a UI leem só daqui — adicionar fonte nova
// é acrescentar um objeto nesta lista, sem tocar em engine nem em componente.

import { STATUS_OS_KEYS } from "../../constants.js";

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

export const DATASETS = [
  {
    id: "os",
    label: "Ordens de Serviço",
    prefixo: "erp:os:",
    campoData: "dataAbertura",
    sensivel: false,
    campos: [
      { id: "numero", label: "Número", tipo: "numero" },
      { id: "status", label: "Status", tipo: "enum", opcoes: STATUS_OS_KEYS },
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
    // Fechamento mensal: um registro por mês ENCERRADO, gravado automaticamente
    // na virada (ensureFechamentoMensal em App.jsx). É a fonte para perguntas
    // do tipo "como foi julho?" — o Dashboard só mostra o mês corrente, e sem
    // isto o histórico teria que ser reconstruído OS por OS.
    id: "fechamentos",
    label: "Fechamentos mensais",
    prefixo: "erp:fechamento:",
    campoData: "data",
    sensivel: false,
    campos: [
      { id: "mes", label: "Mês (AAAA-MM)", tipo: "texto" },
      { id: "data", label: "Início do mês", tipo: "data" },
      { id: "osAbertas", label: "OS abertas", tipo: "numero" },
      { id: "osConcluidas", label: "OS concluídas", tipo: "numero" },
      { id: "osCanceladas", label: "OS canceladas/não autorizadas", tipo: "numero" },
      { id: "valorConcluidas", label: "Valor das OS concluídas", tipo: "moeda" },
      { id: "ticketMedio", label: "Ticket médio", tipo: "moeda" },
      { id: "receita", label: "Receita recebida", tipo: "moeda" },
      { id: "despesas", label: "Despesas pagas", tipo: "moeda" },
      { id: "saldo", label: "Saldo do mês", tipo: "moeda" },
      { id: "aReceber", label: "A receber", tipo: "moeda" },
      { id: "clientesNovos", label: "Clientes novos", tipo: "numero" },
      { id: "tecnicoDestaque", label: "Técnico destaque", tipo: "texto" },
      { id: "geradoEm", label: "Arquivado em", tipo: "data" },
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
    id: "funcionarios",
    label: "Funcionários",
    prefixo: "erp:employee:",
    campoData: "createdAt",
    sensivel: false,
    campos: [
      { id: "nome", label: "Nome", tipo: "texto" },
      { id: "cargo", label: "Cargo", tipo: "texto" },
      { id: "tipo", label: "Tipo", tipo: "texto" },
      { id: "telefone", label: "Telefone", tipo: "texto" },
      { id: "email", label: "E-mail", tipo: "texto" },
      { id: "status", label: "Status", tipo: "enum", opcoes: ["ativo", "inativo"] },
      { id: "createdAt", label: "Data de admissão no sistema", tipo: "data" },
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
      { id: "dataFim", label: "Data de término", tipo: "data" },
      { id: "clienteId", label: "Cliente", tipo: "referencia", ref: "clientes" },
      { id: "tecnicoId", label: "Técnico", tipo: "referencia", ref: "funcionarios" },
      { id: "status", label: "Status", tipo: "texto" },
      { id: "observacoes", label: "Observações", tipo: "texto" },
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
      { id: "funcionario_id", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "tipo", label: "Tipo de batida", tipo: "texto" },
      { id: "datahora", label: "Data e hora", tipo: "data" },
      { id: "metodo", label: "Método", tipo: "texto" },
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
      { id: "funcionario_id", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "tipo", label: "Tipo", tipo: "texto" },
      { id: "status", label: "Status", tipo: "enum", opcoes: ["pendente", "aprovado", "rejeitado"] },
      { id: "data_ref", label: "Data de referência", tipo: "data" },
      { id: "descricao", label: "Descrição", tipo: "texto" },
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
      { id: "data", label: "Data do vale", tipo: "data" },
      { id: "motivo", label: "Motivo", tipo: "texto" },
      { id: "status", label: "Status", tipo: "texto" },
      { id: "criadoEm", label: "Data de criação", tipo: "data" },
    ],
  },
  {
    id: "contracheques",
    label: "Contracheques",
    prefixo: "erp:contracheque:",
    campoData: "criadoEm", // Mantém criadoEm (sempre presente) não paidAt (nullable até fechar). paidAt disponível para filtros explícitos.
    sensivel: true,
    campos: [
      { id: "employeeId", label: "Funcionário", tipo: "referencia", ref: "funcionarios" },
      { id: "mesRef", label: "Competência", tipo: "texto" },
      { id: "salarioBase", label: "Salário base", tipo: "moeda" },
      { id: "totalDescontos", label: "Descontos", tipo: "moeda" },
      { id: "liquido", label: "Líquido", tipo: "moeda" },
      { id: "criadoEm", label: "Data de criação", tipo: "data" },
      { id: "paidAt", label: "Data de pagamento", tipo: "data" },
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
      { id: "fornecedorId", label: "Fornecedor", tipo: "referencia", ref: "fornecedores" },
      { id: "createdAt", label: "Data de cadastro", tipo: "data" },
    ],
  },
  {
    id: "estoque",
    label: "Movimentações de estoque",
    prefixo: "erp:stockMov:",
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
      { id: "precoBase", label: "Preço", tipo: "moeda" },
      { id: "duracaoMin", label: "Duração (min)", tipo: "numero" },
      { id: "createdAt", label: "Data de cadastro", tipo: "data" },
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
