// ─── Constantes globais do FrostERP ─────────────────────────────────────────
// Extraídas de App.jsx para reduzir o tamanho do arquivo principal e permitir
// reuso por módulos extraídos no futuro. Tudo aqui é declarativo (sem JSX).

// Detecta se a URL aponta para um arquivo de vídeo (preview do tecnico)
export const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|avi|mkv|ogv|3gp)(\?|$)/i;
export const isVideoUrl = (url) => typeof url === "string" && VIDEO_EXT_RE.test(url);

// Paleta compartilhada por gráficos e badges
export const COLORS = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

// Mapeamento global de status — usado pelo StatusBadge em OS, Agenda, Cadastros e Financeiro
export const STATUS_MAP = {
  ativo: { label: "Ativo", color: "bg-green-500" },
  inativo: { label: "Inativo", color: "bg-gray-500" },
  concluido: { label: "Concluído", color: "bg-green-500" },
  pendente: { label: "Pendente", color: "bg-yellow-500" },
  em_andamento: { label: "Em Andamento", color: "bg-blue-500" },
  cancelado: { label: "Cancelado", color: "bg-red-500" },
  agendado: { label: "Agendado", color: "bg-cyan-500" },
  confirmado: { label: "Confirmado", color: "bg-blue-500" },
  // Status do fluxo da OS (alinhados ao STATUS_FLOW de ProcessModule)
  aguardando: { label: "Aguardando", color: "bg-yellow-500" },
  em_deslocamento: { label: "Em Deslocamento", color: "bg-cyan-500" },
  em_execucao: { label: "Em Execução", color: "bg-blue-500" },
  finalizado: { label: "Finalizado", color: "bg-green-500" },
  // Novos status do fluxo Tech App → ERP
  em_servico: { label: "Em Serviço", color: "bg-blue-600" },
  aguardando_finalizacao: { label: "Aguardando Finalização", color: "bg-orange-500" },
  pago: { label: "Pago", color: "bg-green-500" },
  atrasado: { label: "Atrasado", color: "bg-red-500" },
  // OS recusada pelo cliente (não fechou) — mantida para captação/follow-up.
  nao_autorizada: { label: "Não autorizada", color: "bg-rose-700" },
};

// Matriz de permissões por role — inclui módulo financeiro
// Módulos novos:
//   ponto  — Ponto Eletrônico (todos os usuários internos batem o próprio
//            ponto; admin/gerente veem painel da equipe).
//   escola — Demandas escolares (Vanda) — isolado do financeiro.
//   cliente_escola é a role do portal externo da Vanda: vê APENAS o portal
//   de solicitação. Não tem acesso a nenhum outro módulo do ERP.
export const ROLE_PERMISSIONS = {
  admin: ["all"],
  gerente: ["dashboard", "clientes", "funcionarios", "financeiro", "os", "agenda", "config", "ia", "folha", "pos-venda", "ponto", "escola"],
  tecnico: ["dashboard", "os", "agenda", "ponto"],
  atendente: ["dashboard", "clientes", "os", "agenda", "ia", "pos-venda", "ponto"],
  // Role exclusiva do portal da Vanda. Único módulo: "escola-portal".
  // Render branch em App.jsx detecta esta role e mostra EscolaPortalVanda.
  cliente_escola: ["escola-portal"],
  // Funcionário que SÓ bate ponto (motorista, ajudante, administrativo que não
  // é técnico). Não vê a tela de técnico nem o ERP — só o Ponto Eletrônico.
  // Render branch em App.jsx detecta esta role e mostra o PontoShell.
  ponto: ["ponto"],
};

// ─── CARGOS de funcionários ──────────────────────────────────────────────────
// Lista canônica usada no cadastro e nos relatórios. Ao adicionar cargo novo,
// considere também atualizar a derivação de `tipo` em saveEmployee (técnico/
// gerente/administrativo controla quais módulos o user vê).
export const CARGOS_FUNCIONARIO = [
  "Técnico em Refrigeração",
  "Técnico de Central",
  "Técnico Auxiliar",
  "Ajudante",
  "Motorista",
  "Administrativo",
  "Gerente",
];
// Cargos considerados "técnicos" para gating de UI/relatórios.
// "Técnico Auxiliar" entra aqui → funcionário com esse cargo deriva tipo="tecnico"
// (vê o app do técnico e conta no relatório de produtividade).
export const CARGOS_TECNICOS = ["Técnico em Refrigeração", "Técnico de Central", "Técnico Auxiliar", "Técnico", "Ajudante"];
export const CARGOS_GERENCIA = ["Gerente"];

// Categorias separadas em receita (entradas) e despesa (saídas) para evitar
// confusão no relatório — o usuário só vê as categorias relevantes ao tipo
// selecionado no formulário de transação.
export const CATEGORIES_RECEITA = [
  "Instalação",
  "Manutenção",
  "Troca de Peças",
  "Solda",
  "Venda de Equipamento",
  "Venda de Peça",
  "Contrato de Manutenção",
  "Outros",
];

export const CATEGORIES_DESPESA = [
  "Peça/Material",
  "Combustível",
  "Aluguel",
  "Salário",
  "Imposto",
  "Ferramentas",
  "Veículo",
  "Marketing",
  "Outros",
];

export const PAYMENT_METHODS = [
  "PIX",
  "Cartão de Crédito",
  "Cartão de Débito",
  "Boleto",
  "Dinheiro",
  "Transferência",
];

// Tipos de equipamento usados no formulário de OS — define quais campos
// técnicos aparecem (refrigeração, climatização e linha branca).
export const EQUIPMENT_TYPES = {
  central: {
    label: "Central de Ar (Split/Janela)",
    capacityLabel: "Capacidade (BTUs)",
    capacityPlaceholder: "Ex: 12000",
    capacityKey: "equipamentoBTUs",
  },
  geladeira: {
    label: "Geladeira / Freezer",
    capacityLabel: "Capacidade (Litros)",
    capacityPlaceholder: "Ex: 450",
    capacityKey: "equipamentoLitros",
  },
  lavadora: {
    label: "Máquina de Lavar",
    capacityLabel: "Capacidade (Kg)",
    capacityPlaceholder: "Ex: 12",
    capacityKey: "equipamentoKg",
  },
  centrifuga: {
    label: "Centrífuga",
    capacityLabel: "Capacidade (Kg)",
    capacityPlaceholder: "Ex: 8",
    capacityKey: "equipamentoKg",
  },
  expositor: {
    label: "Expositor / Vitrine Refrigerada",
    capacityLabel: "Capacidade (Litros)",
    capacityPlaceholder: "Ex: 800",
    capacityKey: "equipamentoLitros",
  },
  bebedouro_industrial: {
    label: "Bebedouro Industrial",
    capacityLabel: "Capacidade (Litros/h)",
    capacityPlaceholder: "Ex: 100",
    capacityKey: "equipamentoLitros",
  },
  bebedouro_mesa: {
    label: "Bebedouro / Gelágua Mesa",
    capacityLabel: "Modelo",
    capacityPlaceholder: "Ex: Mesa 20L",
    capacityKey: "equipamentoModeloExtra",
  },
  bebedouro_coluna: {
    label: "Bebedouro / Gelágua Coluna",
    capacityLabel: "Modelo",
    capacityPlaceholder: "Ex: Coluna 20L",
    capacityKey: "equipamentoModeloExtra",
  },
  camara_fria: {
    label: "Câmara Fria",
    capacityLabel: "Volume (m³)",
    capacityPlaceholder: "Ex: 20",
    capacityKey: "equipamentoVolumeM3",
  },
  outro: {
    label: "Outro",
    capacityLabel: "Especificação",
    capacityPlaceholder: "Descreva",
    capacityKey: "equipamentoEspecificacao",
  },
};

// Lista usada no dropdown de serviços da OS e da Agenda
export const SERVICE_TYPES_OS = [
  "Instalação",
  "Manutenção",
  "Troca de Peças",
  "Solda",
  "Desinstalação",
];
