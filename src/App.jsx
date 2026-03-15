import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  BarChart, Bar, LineChart, Line, PieChart, Pie,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, Cell
} from "recharts";
import { hydrateFromSupabase, uploadAllToSupabase, syncToSupabase, deleteFromSupabase } from "./supabase.js";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────────

const COLORS = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

const CATEGORIES_RECEITA = [
  "Instalação", "Manutenção", "Venda de Equipamento", "Venda de Peça",
  "Higienização", "Reparo", "Contrato de Manutenção", "Outros"
];

const CATEGORIES_DESPESA = [
  "Material", "Combustível", "Aluguel", "Salário", "Imposto",
  "Ferramentas", "Veículo", "Marketing", "Outros"
];

const STATUS_MAP = {
  ativo: { label: "Ativo", color: "bg-green-500" },
  inativo: { label: "Inativo", color: "bg-gray-500" },
  concluido: { label: "Concluído", color: "bg-green-500" },
  pendente: { label: "Pendente", color: "bg-yellow-500" },
  em_andamento: { label: "Em Andamento", color: "bg-blue-500" },
  cancelado: { label: "Cancelado", color: "bg-red-500" },
  atrasado: { label: "Atrasado", color: "bg-red-500" },
  pago: { label: "Pago", color: "bg-green-500" },
  agendado: { label: "Agendado", color: "bg-cyan-500" },
  aberto: { label: "Aberto", color: "bg-yellow-500" },
  fechado: { label: "Fechado", color: "bg-gray-500" },
  orcamento: { label: "Orçamento", color: "bg-purple-500" },
};

const ROLE_PERMISSIONS = {
  admin: ["all"],
  gerente: ["dashboard", "clientes", "funcionarios", "financeiro", "estoque", "os", "agenda", "tickets", "relatorios", "config"],
  tecnico: ["dashboard", "os", "agenda", "estoque_view", "tickets"],
  atendente: ["dashboard", "clientes", "os", "agenda", "tickets"],
};

const MSG_TEMPLATES = {
  os_criada: (num) => `Ordem de Serviço ${num} criada com sucesso.`,
  os_concluida: (num) => `Ordem de Serviço ${num} concluída.`,
  cliente_criado: (nome) => `Cliente ${nome} cadastrado com sucesso.`,
  item_baixo: (nome) => `Estoque baixo: ${nome}. Reabastecer.`,
  ticket_aberto: (num) => `Ticket #${num} aberto.`,
  pagamento_registrado: (desc) => `Pagamento registrado: ${desc}.`,
};

const PAYMENT_METHODS = ["PIX", "Cartão de Crédito", "Cartão de Débito", "Boleto", "Dinheiro", "Transferência"];

// ─── DB LAYER ───────────────────────────────────────────────────────────────────

// Use localStorage if available, otherwise fall back to in-memory store
try {
  window.storage = localStorage;
} catch {
  // localStorage unavailable (e.g. sandboxed iframe)
}
if (!window.storage) {
  const _store = new Map();
  window.storage = {
    getItem(key) { return _store.has(key) ? _store.get(key) : null; },
    setItem(key, value) { _store.set(key, value); },
    removeItem(key) { _store.delete(key); },
    get length() { return _store.size; },
    key(i) { return Array.from(_store.keys())[i] || null; },
    clear() { _store.clear(); },
  };
}

const DB = {
  get(key) {
    try {
      const raw = window.storage.getItem(key);
      if (raw === null || raw === undefined) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      window.storage.setItem(key, JSON.stringify(value));
      syncToSupabase(key, value);
      return true;
    } catch {
      return false;
    }
  },

  delete(key) {
    try {
      window.storage.removeItem(key);
      deleteFromSupabase(key);
      return true;
    } catch {
      return false;
    }
  },

  list(prefix) {
    try {
      const results = [];
      const len = window.storage.length;
      for (let i = 0; i < len; i++) {
        const key = window.storage.key(i);
        if (key && key.startsWith(prefix)) {
          const val = DB.get(key);
          if (val !== null) results.push(val);
        }
      }
      return results;
    } catch {
      return [];
    }
  },
};

// ─── UTILITY FUNCTIONS ─────────────────────────────────────────────────────────

function genId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
  }).format(value || 0);
}

function formatDate(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR");
  } catch {
    return dateStr;
  }
}

function formatDateTime(dateStr) {
  if (!dateStr) return "—";
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString("pt-BR") + " " + d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  } catch {
    return dateStr;
  }
}

function formatCPF(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return d.slice(0, 3) + "." + d.slice(3);
  if (d.length <= 9) return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6);
  return d.slice(0, 3) + "." + d.slice(3, 6) + "." + d.slice(6, 9) + "-" + d.slice(9);
}

function formatCNPJ(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 14);
  if (d.length <= 2) return d;
  if (d.length <= 5) return d.slice(0, 2) + "." + d.slice(2);
  if (d.length <= 8) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5);
  if (d.length <= 12) return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8);
  return d.slice(0, 2) + "." + d.slice(2, 5) + "." + d.slice(5, 8) + "/" + d.slice(8, 12) + "-" + d.slice(12);
}

function formatPhone(v) {
  const d = (v || "").replace(/\D/g, "").slice(0, 11);
  if (d.length <= 2) return "(" + d;
  if (d.length <= 7) return "(" + d.slice(0, 2) + ") " + d.slice(2);
  if (d.length <= 10) return "(" + d.slice(0, 2) + ") " + d.slice(2, 6) + "-" + d.slice(6);
  return "(" + d.slice(0, 2) + ") " + d.slice(2, 7) + "-" + d.slice(7);
}

function filterByDate(items, dateField, dateFilter) {
  if (!dateFilter || dateFilter.period === "all") return items;
  const now = new Date();
  let start, end;

  if (dateFilter.period === "custom" && dateFilter.startDate && dateFilter.endDate) {
    start = new Date(dateFilter.startDate + "T00:00:00");
    end = new Date(dateFilter.endDate + "T23:59:59");
  } else {
    end = new Date(now);
    end.setHours(23, 59, 59, 999);
    start = new Date(now);
    start.setHours(0, 0, 0, 0);
    const days = { hoje: 0, "7dias": 7, "30dias": 30, "90dias": 90 };
    const d = days[dateFilter.period] || 0;
    start.setDate(start.getDate() - d);
  }

  return items.filter((item) => {
    const itemDate = new Date(item[dateField]);
    return itemDate >= start && itemDate <= end;
  });
}

function hashPassword(pwd) {
  return btoa(pwd);
}

function checkPassword(plain, hashed) {
  return btoa(plain) === hashed;
}

function getNextNumber(prefix, items) {
  let max = 0;
  items.forEach((item) => {
    if (item.numero) {
      const parts = item.numero.split("-");
      const n = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(n) && n > max) max = n;
    }
  });
  return prefix + "-" + String(max + 1).padStart(3, "0");
}

function hasPermission(user, module) {
  if (!user || !user.role) return false;
  const perms = ROLE_PERMISSIONS[user.role] || [];
  return perms.includes("all") || perms.includes(module);
}

function toISODate(date) {
  const d = date instanceof Date ? date : new Date(date);
  return d.toISOString().split("T")[0];
}

function daysFromNow(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

function monthsAgo(n) {
  const d = new Date();
  d.setMonth(d.getMonth() - n);
  return toISODate(d);
}

// ─── SEED DATA ──────────────────────────────────────────────────────────────────

function seedDatabase() {
  if (DB.get("erp:seeded")) return;

  // Users
  const users = [
    {
      id: genId(), email: "biel.atm11@gmail.com", nome: "Gabriel Admin",
      password: hashPassword("gabb0089"), role: "admin",
      avatar: "CA", createdAt: new Date().toISOString(), status: "ativo",
    },
    {
      id: genId(), email: "gerente@frosterp.com.br", nome: "Fernanda Gestora",
      password: hashPassword("gerente123"), role: "gerente",
      avatar: "FG", createdAt: new Date().toISOString(), status: "ativo",
    },
    {
      id: genId(), email: "tecnico@frosterp.com.br", nome: "Ricardo Técnico",
      password: hashPassword("tecnico123"), role: "tecnico",
      avatar: "RT", createdAt: new Date().toISOString(), status: "ativo",
    },
    {
      id: genId(), email: "atendente@frosterp.com.br", nome: "Juliana Atendente",
      password: hashPassword("atend123"), role: "atendente",
      avatar: "JA", createdAt: new Date().toISOString(), status: "ativo",
    },
  ];
  users.forEach((u) => DB.set("erp:user:" + u.id, u));

  // Clients
  const clients = [
    {
      id: genId(), nome: "Maria Silva Santos", tipo: "pf", cpf: "123.456.789-00",
      telefone: "(11) 98765-4321", email: "maria.silva@email.com",
      endereco: { rua: "Rua das Flores, 123", bairro: "Jardim Primavera", cidade: "São Paulo", estado: "SP", cep: "01234-567" },
      createdAt: monthsAgo(2) + "T10:00:00.000Z", status: "ativo", observacoes: "Cliente preferencial",
    },
    {
      id: genId(), nome: "João Pedro Oliveira", tipo: "pf", cpf: "987.654.321-00",
      telefone: "(11) 91234-5678", email: "joao.oliveira@email.com",
      endereco: { rua: "Av. Brasil, 456", bairro: "Centro", cidade: "São Paulo", estado: "SP", cep: "01000-100" },
      createdAt: monthsAgo(1) + "T14:00:00.000Z", status: "ativo", observacoes: "",
    },
    {
      id: genId(), nome: "Restaurante Sabor & Arte Ltda", tipo: "pj", cnpj: "12.345.678/0001-90",
      telefone: "(11) 3456-7890", email: "contato@saborarte.com.br",
      endereco: { rua: "Rua Augusta, 789", bairro: "Consolação", cidade: "São Paulo", estado: "SP", cep: "01305-100" },
      createdAt: monthsAgo(3) + "T09:00:00.000Z", status: "ativo", observacoes: "Contrato mensal de manutenção",
    },
    {
      id: genId(), nome: "Clínica Bem Estar", tipo: "pj", cnpj: "98.765.432/0001-10",
      telefone: "(11) 2345-6789", email: "admin@clinicabemestar.com.br",
      endereco: { rua: "Rua Oscar Freire, 321", bairro: "Pinheiros", cidade: "São Paulo", estado: "SP", cep: "05409-010" },
      createdAt: monthsAgo(2) + "T11:00:00.000Z", status: "ativo", observacoes: "3 unidades de atendimento",
    },
    {
      id: genId(), nome: "Ana Carolina Ferreira", tipo: "pf", cpf: "456.789.123-00",
      telefone: "(11) 97654-3210", email: "ana.ferreira@email.com",
      endereco: { rua: "Rua Harmonia, 55", bairro: "Vila Madalena", cidade: "São Paulo", estado: "SP", cep: "05435-000" },
      createdAt: monthsAgo(1) + "T16:00:00.000Z", status: "ativo", observacoes: "",
    },
  ];
  clients.forEach((c) => DB.set("erp:client:" + c.id, c));

  // Employees
  const employees = [
    {
      id: genId(), nome: "Ricardo Souza", cargo: "Técnico em Refrigeração",
      tipo: "tecnico", telefone: "(11) 99876-5432", email: "ricardo@frosterp.com.br",
      salario: 3500, dataAdmissao: "2023-03-15", status: "ativo",
      especialidades: ["Split", "Multi-split", "VRF"], crea: "SP-123456",
      createdAt: new Date().toISOString(),
    },
    {
      id: genId(), nome: "Paulo Henrique Lima", cargo: "Técnico em Refrigeração",
      tipo: "tecnico", telefone: "(11) 99765-4321", email: "paulo@frosterp.com.br",
      salario: 3200, dataAdmissao: "2023-06-01", status: "ativo",
      especialidades: ["Split", "Janela", "Higienização"], crea: "SP-789012",
      createdAt: new Date().toISOString(),
    },
    {
      id: genId(), nome: "Camila Rodrigues", cargo: "Assistente Administrativo",
      tipo: "administrativo", telefone: "(11) 98654-3210", email: "camila@frosterp.com.br",
      salario: 2800, dataAdmissao: "2024-01-10", status: "ativo",
      especialidades: [], crea: "",
      createdAt: new Date().toISOString(),
    },
  ];
  employees.forEach((e) => DB.set("erp:employee:" + e.id, e));

  // Inventory
  const inventory = [
    { id: genId(), nome: "Split Hi-Wall 9000 BTUs Inverter", categoria: "Equipamento", sku: "EQ-001", unidade: "un", quantidade: 8, quantidadeMinima: 3, precoCompra: 1450, precoVenda: 2200, fornecedor: "Samsung", localizacao: "Galpão A1", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Split Hi-Wall 12000 BTUs Inverter", categoria: "Equipamento", sku: "EQ-002", unidade: "un", quantidade: 5, quantidadeMinima: 3, precoCompra: 1800, precoVenda: 2800, fornecedor: "LG", localizacao: "Galpão A1", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Split Hi-Wall 18000 BTUs Inverter", categoria: "Equipamento", sku: "EQ-003", unidade: "un", quantidade: 3, quantidadeMinima: 2, precoCompra: 2600, precoVenda: 3900, fornecedor: "Daikin", localizacao: "Galpão A2", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Split Hi-Wall 24000 BTUs Inverter", categoria: "Equipamento", sku: "EQ-004", unidade: "un", quantidade: 2, quantidadeMinima: 2, precoCompra: 3200, precoVenda: 4800, fornecedor: "Fujitsu", localizacao: "Galpão A2", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Tubo de Cobre 1/4\" x 3/8\" (rolo 15m)", categoria: "Material", sku: "MT-001", unidade: "rolo", quantidade: 12, quantidadeMinima: 5, precoCompra: 280, precoVenda: 420, fornecedor: "Eluma", localizacao: "Prateleira B1", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Suporte para Condensadora 500mm", categoria: "Acessório", sku: "AC-001", unidade: "par", quantidade: 15, quantidadeMinima: 5, precoCompra: 45, precoVenda: 85, fornecedor: "Gallant", localizacao: "Prateleira C1", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Gás Refrigerante R410a (11.3kg)", categoria: "Material", sku: "MT-002", unidade: "cilindro", quantidade: 4, quantidadeMinima: 3, precoCompra: 520, precoVenda: 780, fornecedor: "Chemours", localizacao: "Depósito D1", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Fita Autofusão 19mm x 10m", categoria: "Material", sku: "MT-003", unidade: "rolo", quantidade: 25, quantidadeMinima: 10, precoCompra: 12, precoVenda: 25, fornecedor: "3M", localizacao: "Prateleira B2", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Tubo Dreno PVC 1/2\" (barra 6m)", categoria: "Material", sku: "MT-004", unidade: "barra", quantidade: 18, quantidadeMinima: 8, precoCompra: 8, precoVenda: 18, fornecedor: "Tigre", localizacao: "Prateleira B3", createdAt: new Date().toISOString(), status: "ativo" },
    { id: genId(), nome: "Cabo Elétrico PP 3x2.5mm (rolo 50m)", categoria: "Material", sku: "MT-005", unidade: "rolo", quantidade: 6, quantidadeMinima: 3, precoCompra: 185, precoVenda: 290, fornecedor: "Prysmian", localizacao: "Prateleira B4", createdAt: new Date().toISOString(), status: "ativo" },
  ];
  inventory.forEach((item) => DB.set("erp:inventory:" + item.id, item));

  // Service Orders
  const clientIds = clients.map((c) => c.id);
  const empIds = employees.filter((e) => e.tipo === "tecnico").map((e) => e.id);

  const serviceOrders = [
    {
      id: genId(), numero: "OS-001", clienteId: clientIds[0], clienteNome: clients[0].nome,
      tecnicoId: empIds[0], tecnicoNome: employees[0].nome,
      tipo: "Instalação", descricao: "Instalação de Split 12000 BTUs na sala de estar",
      endereco: "Rua das Flores, 123 - Jardim Primavera, São Paulo/SP",
      valor: 450, status: "concluido",
      dataAbertura: monthsAgo(1) + "T08:00:00.000Z",
      dataConclusao: monthsAgo(1) + "T17:00:00.000Z",
      observacoes: "Instalação concluída sem intercorrências. Cliente satisfeita.",
      itensUtilizados: [{ itemId: inventory[4].id, nome: inventory[4].nome, quantidade: 1 }],
      createdAt: monthsAgo(1) + "T08:00:00.000Z",
    },
    {
      id: genId(), numero: "OS-002", clienteId: clientIds[2], clienteNome: clients[2].nome,
      tecnicoId: empIds[1], tecnicoNome: employees[1].nome,
      tipo: "Manutenção", descricao: "Manutenção preventiva em 3 equipamentos do salão principal",
      endereco: "Rua Augusta, 789 - Consolação, São Paulo/SP",
      valor: 350, status: "em_andamento",
      dataAbertura: daysFromNow(-2) + "T09:00:00.000Z",
      dataConclusao: null,
      observacoes: "Equipamento 1 e 2 concluídos. Falta equipamento 3.",
      itensUtilizados: [],
      createdAt: daysFromNow(-2) + "T09:00:00.000Z",
    },
    {
      id: genId(), numero: "OS-003", clienteId: clientIds[4], clienteNome: clients[4].nome,
      tecnicoId: empIds[0], tecnicoNome: employees[0].nome,
      tipo: "Reparo", descricao: "Ar condicionado não liga. Verificar placa eletrônica.",
      endereco: "Rua Harmonia, 55 - Vila Madalena, São Paulo/SP",
      valor: 280, status: "pendente",
      dataAbertura: daysFromNow(0) + "T10:00:00.000Z",
      dataConclusao: null,
      observacoes: "Agendado para amanhã pela manhã.",
      itensUtilizados: [],
      createdAt: daysFromNow(0) + "T10:00:00.000Z",
    },
  ];
  serviceOrders.forEach((os) => DB.set("erp:os:" + os.id, os));

  // Financial Transactions
  const transactions = [
    {
      id: genId(), descricao: "Instalação Split 12000 BTUs - Maria Silva",
      valor: 2800 + 450, tipo: "receita", categoria: "Instalação",
      data: monthsAgo(1) + "T00:00:00.000Z", status: "pago",
      formaPagamento: "PIX", observacoes: "Equipamento + mão de obra",
      osId: serviceOrders[0].id, numero: "NF-001",
      createdAt: monthsAgo(1) + "T00:00:00.000Z",
    },
    {
      id: genId(), descricao: "Manutenção preventiva - Restaurante Sabor & Arte",
      valor: 350, tipo: "receita", categoria: "Manutenção",
      data: daysFromNow(-2) + "T00:00:00.000Z", status: "pendente",
      formaPagamento: "Boleto", observacoes: "Faturar ao final do serviço",
      osId: serviceOrders[1].id, numero: "NF-002",
      createdAt: daysFromNow(-2) + "T00:00:00.000Z",
    },
    {
      id: genId(), descricao: "Compra de 2 cilindros Gás R410a",
      valor: 1040, tipo: "despesa", categoria: "Material",
      data: monthsAgo(0) + "T00:00:00.000Z", status: "pago",
      formaPagamento: "Transferência", observacoes: "Fornecedor Chemours",
      osId: null, numero: "DP-001",
      createdAt: monthsAgo(0) + "T00:00:00.000Z",
    },
    {
      id: genId(), descricao: "Aluguel do galpão - mês atual",
      valor: 3500, tipo: "despesa", categoria: "Aluguel",
      data: monthsAgo(0) + "T00:00:00.000Z", status: "pago",
      formaPagamento: "Boleto", observacoes: "Ref. mês corrente",
      osId: null, numero: "DP-002",
      createdAt: monthsAgo(0) + "T00:00:00.000Z",
    },
    {
      id: genId(), descricao: "Venda Split 9000 BTUs - João Pedro",
      valor: 2200, tipo: "receita", categoria: "Venda de Equipamento",
      data: monthsAgo(0) + "T00:00:00.000Z", status: "pago",
      formaPagamento: "Cartão de Crédito", observacoes: "Parcela única",
      osId: null, numero: "NF-003",
      createdAt: monthsAgo(0) + "T00:00:00.000Z",
    },
  ];
  transactions.forEach((t) => DB.set("erp:finance:" + t.id, t));

  // Schedule
  const scheduleEntries = [
    {
      id: genId(), titulo: "Instalação Split - Ana Carolina",
      data: daysFromNow(1) + "T09:00:00.000Z", dataFim: daysFromNow(1) + "T12:00:00.000Z",
      tipo: "instalacao", tecnicoId: empIds[0], tecnicoNome: employees[0].nome,
      clienteId: clientIds[4], clienteNome: clients[4].nome,
      endereco: "Rua Harmonia, 55 - Vila Madalena", status: "agendado",
      observacoes: "Levar Split 9000 BTUs e materiais de instalação",
      createdAt: new Date().toISOString(),
    },
    {
      id: genId(), titulo: "Manutenção preventiva - Clínica Bem Estar",
      data: daysFromNow(2) + "T08:00:00.000Z", dataFim: daysFromNow(2) + "T17:00:00.000Z",
      tipo: "manutencao", tecnicoId: empIds[1], tecnicoNome: employees[1].nome,
      clienteId: clientIds[3], clienteNome: clients[3].nome,
      endereco: "Rua Oscar Freire, 321 - Pinheiros", status: "agendado",
      observacoes: "5 equipamentos para manutenção",
      createdAt: new Date().toISOString(),
    },
    {
      id: genId(), titulo: "Revisão pós-instalação - Maria Silva",
      data: daysFromNow(5) + "T14:00:00.000Z", dataFim: daysFromNow(5) + "T15:30:00.000Z",
      tipo: "revisao", tecnicoId: empIds[0], tecnicoNome: employees[0].nome,
      clienteId: clientIds[0], clienteNome: clients[0].nome,
      endereco: "Rua das Flores, 123 - Jardim Primavera", status: "agendado",
      observacoes: "Revisão 30 dias após instalação",
      createdAt: new Date().toISOString(),
    },
  ];
  scheduleEntries.forEach((s) => DB.set("erp:schedule:" + s.id, s));

  // Tickets
  const tickets = [
    {
      id: genId(), numero: "TK-001", titulo: "Ar condicionado fazendo barulho estranho",
      assunto: "Barulho na unidade externa",
      descricao: "Cliente relata que o equipamento instalado há 2 semanas começou a fazer um barulho de vibração na unidade externa.",
      clienteId: clientIds[0], clienteNome: clients[0].nome,
      prioridade: "media", status: "aberto", categoria: "Reclamação",
      dataAbertura: daysFromNow(-1) + "T10:30:00.000Z",
      responsavelId: empIds[0], responsavelNome: employees[0].nome,
      mensagens: [
        { id: genId(), autor: clients[0].nome, texto: "O barulho aumenta quando liga o compressor.", data: daysFromNow(-1) + "T10:35:00.000Z" },
        { id: genId(), autor: employees[0].nome, texto: "Vamos agendar uma visita para verificar. Pode ser folga no suporte.", data: daysFromNow(-1) + "T11:00:00.000Z" },
      ],
      createdAt: daysFromNow(-1) + "T10:30:00.000Z",
    },
    {
      id: genId(), numero: "TK-002", titulo: "Solicitar orçamento para sistema VRF",
      assunto: "Orçamento sistema VRF 200m²",
      descricao: "Empresa solicita orçamento para instalação de sistema VRF em escritório de 200m² com 8 evaporadoras.",
      clienteId: clientIds[3], clienteNome: clients[3].nome,
      prioridade: "alta", status: "aberto", categoria: "Orçamento",
      dataAbertura: daysFromNow(0) + "T09:00:00.000Z",
      responsavelId: null, responsavelNome: null,
      mensagens: [
        { id: genId(), autor: clients[3].nome, texto: "Precisamos do orçamento até sexta-feira, por favor.", data: daysFromNow(0) + "T09:05:00.000Z" },
      ],
      createdAt: daysFromNow(0) + "T09:00:00.000Z",
    },
  ];
  tickets.forEach((t) => DB.set("erp:ticket:" + t.id, t));

  // Company Config
  DB.set("erp:config", {
    nomeEmpresa: "FrostERP Refrigeração",
    cnpj: "11.222.333/0001-44",
    telefone: "(11) 3333-4444",
    email: "contato@frosterp.com.br",
    endereco: "Rua da Refrigeração, 100 - Barra Funda, São Paulo/SP",
    logo: null,
    corPrimaria: "#3b82f6",
    corSecundaria: "#06b6d4",
  });

  DB.set("erp:seeded", true);
}

// ─── CSS STYLE COMPONENT ───────────────────────────────────────────────────────

function StyleSheet() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700&display=swap');

      * { font-family: 'DM Sans', sans-serif; }

      @media print {
        .no-print { display: none !important; }
        .print-only { display: block !important; }
        body { background: white !important; color: black !important; }
        .print-report {
          width: 210mm;
          min-height: 297mm;
          padding: 20mm;
          margin: 0 auto;
          background: white;
          color: #111;
          font-size: 12px;
        }
        .print-report table { width: 100%; border-collapse: collapse; }
        .print-report th, .print-report td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
        .print-report th { background: #f3f4f6; font-weight: 600; }
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes slideIn {
        from { opacity: 0; transform: translateY(-20px) scale(0.97); }
        to { opacity: 1; transform: translateY(0) scale(1); }
      }

      @keyframes slideDown {
        from { opacity: 0; transform: translateY(-10px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes toastIn {
        from { opacity: 0; transform: translateX(100%); }
        to { opacity: 1; transform: translateX(0); }
      }

      ::-webkit-scrollbar { width: 6px; height: 6px; }
      ::-webkit-scrollbar-track { background: #1f2937; border-radius: 3px; }
      ::-webkit-scrollbar-thumb { background: #4b5563; border-radius: 3px; }
      ::-webkit-scrollbar-thumb:hover { background: #6b7280; }

      @keyframes spin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }

      @keyframes gradientShift {
        0%, 100% { background-position: 0% center; }
        50% { background-position: 200% center; }
      }

      @keyframes floatParticle {
        0%, 100% { transform: translateY(0) rotate(0deg); opacity: 0.15; }
        50% { transform: translateY(-30px) rotate(180deg); opacity: 0.3; }
      }

      .animate-fadeIn { animation: fadeIn 0.3s ease-out; }
      .animate-slideIn { animation: slideIn 0.3s ease-out; }
      .animate-slideDown { animation: slideDown 0.2s ease-out; }
      .animate-toastIn { animation: toastIn 0.4s ease-out; }

      .print-only { display: none; }

      input[type="date"]::-webkit-calendar-picker-indicator {
        filter: invert(0.7);
        cursor: pointer;
      }
    `}</style>
  );
}

// ─── BASE UI COMPONENTS ─────────────────────────────────────────────────────────

function Modal({ isOpen, title, children, onClose, size = "md" }) {
  const sizeMap = { sm: "max-w-md", md: "max-w-2xl", lg: "max-w-4xl", xl: "max-w-6xl" };
  const ref = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 animate-fadeIn"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        ref={ref}
        className={`bg-gray-800 rounded-xl shadow-2xl w-full ${sizeMap[size]} max-h-[90vh] flex flex-col animate-slideIn border border-gray-700`}
      >
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">{title}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition p-1 rounded-lg hover:bg-gray-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
      </div>
    </div>
  );
}

function ToastContainer({ toasts, removeToast }) {
  return (
    <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 no-print">
      {toasts.map((t) => (
        <Toast key={t.id} toast={t} onDismiss={() => removeToast(t.id)} />
      ))}
    </div>
  );
}

function Toast({ toast, onDismiss }) {
  useEffect(() => {
    const timer = setTimeout(onDismiss, toast.duration || 4000);
    return () => clearTimeout(timer);
  }, [onDismiss, toast.duration]);

  const typeStyles = {
    success: "bg-green-600 border-green-500",
    error: "bg-red-600 border-red-500",
    warning: "bg-yellow-600 border-yellow-500",
    info: "bg-blue-600 border-blue-500",
  };

  const icons = {
    success: "✓",
    error: "✕",
    warning: "⚠",
    info: "ℹ",
  };

  return (
    <div className={`animate-toastIn flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg border text-white text-sm min-w-[300px] ${typeStyles[toast.type] || typeStyles.info}`}>
      <span className="text-lg">{icons[toast.type] || icons.info}</span>
      <span className="flex-1">{toast.message}</span>
      <button onClick={onDismiss} className="text-white/70 hover:text-white ml-2 text-lg">&times;</button>
    </div>
  );
}

function StatusBadge({ status }) {
  const info = STATUS_MAP[status] || { label: status, color: "bg-gray-500" };
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${info.color}`}>
      {info.label}
    </span>
  );
}

function KPICard({ title, value, icon, trend, onClick }) {
  return (
    <div
      onClick={onClick}
      className={`bg-gray-800 border border-gray-700 rounded-xl p-5 transition-all duration-200 ${onClick ? "cursor-pointer hover:border-blue-500 hover:shadow-lg hover:shadow-blue-500/10 hover:-translate-y-0.5" : ""}`}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-gray-400 text-sm mb-1">{title}</p>
          <p className="text-2xl font-bold text-white">{value}</p>
          {trend !== undefined && trend !== null && (
            <p className={`text-xs mt-2 flex items-center gap-1 ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
              {trend >= 0 ? "↑" : "↓"} {Math.abs(trend)}%
              <span className="text-gray-500 ml-1">vs mês anterior</span>
            </p>
          )}
        </div>
        {icon && (
          <div className="text-2xl w-10 h-10 flex items-center justify-center rounded-lg bg-gray-700/50">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

function DataTable({ columns, data, onEdit, onDelete, actions, pagination = true, emptyMessage = "Nenhum registro encontrado." }) {
  const [sortKey, setSortKey] = useState(null);
  const [sortDir, setSortDir] = useState("asc");
  const [page, setPage] = useState(1);
  const perPage = 10;

  useEffect(() => { setPage(1); }, [data.length]);

  const handleSort = useCallback((key) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  }, [sortKey]);

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      let va = a[sortKey], vb = b[sortKey];
      if (va == null) va = "";
      if (vb == null) vb = "";
      if (typeof va === "number" && typeof vb === "number") {
        return sortDir === "asc" ? va - vb : vb - va;
      }
      const sa = String(va).toLowerCase(), sb = String(vb).toLowerCase();
      if (sa < sb) return sortDir === "asc" ? -1 : 1;
      if (sa > sb) return sortDir === "asc" ? 1 : -1;
      return 0;
    });
  }, [data, sortKey, sortDir]);

  const totalPages = Math.max(1, Math.ceil(sorted.length / perPage));
  const paginated = pagination ? sorted.slice((page - 1) * perPage, page * perPage) : sorted;
  const startIdx = (page - 1) * perPage + 1;
  const endIdx = Math.min(page * perPage, sorted.length);

  if (data.length === 0) {
    return (
      <div className="bg-gray-800 rounded-xl border border-gray-700 p-12 text-center">
        <p className="text-gray-400">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700">
              {columns.map((col) => (
                <th
                  key={col.key}
                  onClick={() => col.sortable !== false && handleSort(col.key)}
                  className={`px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider ${col.sortable !== false ? "cursor-pointer hover:text-white select-none" : ""} ${col.width || ""}`}
                >
                  <div className="flex items-center gap-1">
                    {col.label}
                    {sortKey === col.key && (
                      <span className="text-blue-400">{sortDir === "asc" ? "↑" : "↓"}</span>
                    )}
                  </div>
                </th>
              ))}
              {(onEdit || onDelete || actions) && (
                <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wider w-28">Ações</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-700/50">
            {paginated.map((row, idx) => (
              <tr key={row.id || idx} className="hover:bg-gray-700/30 transition-colors even:bg-gray-800/50">
                {columns.map((col) => (
                  <td key={col.key} className="px-4 py-3 text-gray-300 whitespace-nowrap">
                    {col.render ? col.render(row[col.key], row) : (row[col.key] ?? "—")}
                  </td>
                ))}
                {(onEdit || onDelete || actions) && (
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1">
                      {actions && actions(row)}
                      {onEdit && (
                        <button onClick={() => onEdit(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition" title="Editar">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                      )}
                      {onDelete && (
                        <button onClick={() => onDelete(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition" title="Excluir">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && sorted.length > perPage && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-700">
          <p className="text-sm text-gray-400">
            {startIdx}-{endIdx} de {sorted.length}
          </p>
          <div className="flex gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Anterior
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <button
                key={p}
                onClick={() => setPage(p)}
                className={`px-3 py-1.5 text-sm rounded-lg transition ${p === page ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                {p}
              </button>
            ))}
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition"
            >
              Próximo
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function DateFilterBar({ dateFilter, setDateFilter }) {
  const periods = [
    { value: "hoje", label: "Hoje" },
    { value: "7dias", label: "7 dias" },
    { value: "30dias", label: "30 dias" },
    { value: "90dias", label: "90 dias" },
    { value: "all", label: "Tudo" },
    { value: "custom", label: "Personalizado" },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2">
      {periods.map((p) => (
        <button
          key={p.value}
          onClick={() => setDateFilter({ ...dateFilter, period: p.value })}
          className={`px-3 py-1.5 text-sm rounded-lg transition ${dateFilter.period === p.value ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
        >
          {p.label}
        </button>
      ))}
      {dateFilter.period === "custom" && (
        <div className="flex items-center gap-2 ml-2">
          <input
            type="date"
            value={dateFilter.startDate || ""}
            onChange={(e) => setDateFilter({ ...dateFilter, startDate: e.target.value })}
            aria-label="Data inicial"
            name="startDate"
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <span className="text-gray-400">até</span>
          <input
            type="date"
            value={dateFilter.endDate || ""}
            onChange={(e) => setDateFilter({ ...dateFilter, endDate: e.target.value })}
            aria-label="Data final"
            name="endDate"
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white focus:outline-none focus:border-blue-500"
          />
        </div>
      )}
    </div>
  );
}

function SearchInput({ value, onChange, placeholder = "Buscar..." }) {
  const [local, setLocal] = useState(value || "");
  const timerRef = useRef(null);

  useEffect(() => { setLocal(value || ""); }, [value]);

  const handleChange = useCallback((e) => {
    const v = e.target.value;
    setLocal(v);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => onChange(v), 300);
  }, [onChange]);

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); }, []);

  return (
    <div className="relative">
      <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        type="text"
        value={local}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
      />
      {local && (
        <button
          onClick={() => { setLocal(""); onChange(""); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-white"
        >
          &times;
        </button>
      )}
    </div>
  );
}

/* Diálogo de confirmação com suporte a digitação obrigatória para ações destrutivas */
function ConfirmDialog({ message, onConfirm, onCancel, requireType = null }) {
  const [typed, setTyped] = useState("");
  const confirmed = requireType ? typed === requireType : true;

  return (
    <div
      className="fixed inset-0 z-[55] flex items-center justify-center p-4 animate-fadeIn"
      style={{ backgroundColor: "rgba(0,0,0,0.6)", backdropFilter: "blur(4px)" }}
      role="dialog"
      aria-modal="true"
      aria-label="Confirmação"
    >
      <div className="bg-gray-800 rounded-xl shadow-2xl border border-gray-700 p-6 max-w-sm w-full animate-slideIn">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-full bg-red-500/20 flex items-center justify-center text-red-400 text-xl" aria-hidden="true">⚠</div>
          <h3 className="text-white font-semibold">Confirmar</h3>
        </div>
        <p className="text-gray-300 text-sm mb-4">{message}</p>
        {requireType && (
          <div className="mb-4">
            <p className="text-gray-400 text-xs mb-2">Digite <strong className="text-red-400">{requireType}</strong> para confirmar:</p>
            <input
              type="text"
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={requireType}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-red-500 transition"
              autoFocus
              aria-label={`Digite ${requireType} para confirmar`}
            />
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button onClick={onCancel} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={!confirmed}
            className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Confirmar
          </button>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon, title, description, actionLabel, onAction }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      {icon && <div className="text-5xl mb-4 opacity-50">{icon}</div>}
      <h3 className="text-lg font-semibold text-gray-300 mb-2">{title}</h3>
      {description && <p className="text-gray-500 text-sm mb-6 max-w-sm">{description}</p>}
      {actionLabel && onAction && (
        <button onClick={onAction} className="px-4 py-2 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700 transition">
          {actionLabel}
        </button>
      )}
    </div>
  );
}

function LoadingSkeleton({ rows = 5 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="animate-pulse flex gap-4">
          <div className="h-4 bg-gray-700 rounded flex-1" />
          <div className="h-4 bg-gray-700 rounded w-24" />
          <div className="h-4 bg-gray-700 rounded w-16" />
        </div>
      ))}
    </div>
  );
}

// ─── LOGIN SCREEN ───────────────────────────────────────────────────────────────

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback((e) => {
    e.preventDefault();
    setError("");

    if (!email.trim() || !password.trim()) {
      setError("Preencha todos os campos.");
      return;
    }

    setLoading(true);
    setTimeout(() => {
      const users = DB.list("erp:user:");
      const found = users.find(
        (u) => u.email === email.trim().toLowerCase() && checkPassword(password, u.password)
      );

      if (found) {
        onLogin(found);
      } else {
        setError("Email ou senha incorretos.");
      }
      setLoading(false);
    }, 600);
  }, [email, password, onLogin]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-slideIn">
        <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 p-8">
          <div className="text-center mb-8">
            <div className="text-6xl mb-3">❄️</div>
            <h2 className="text-2xl font-bold text-white">FrostERP</h2>
            <p className="text-gray-400 text-sm mt-1">Sistema de Gestão Integrada</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                placeholder="seu@email.com.br"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                autoFocus
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
              <input
                type="password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="••••••••"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm animate-slideDown">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Entrando...
                </>
              ) : (
                "Entrar"
              )}
            </button>
          </form>

          <div className="mt-6 pt-6 border-t border-gray-700">
            <p className="text-gray-500 text-xs text-center">
              Admin: biel.atm11@gmail.com / gabb0089
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ──────────────────────────────────────────────────────────────────

function Dashboard({ user, dateFilter, onNavigate }) {
  const [data, setData] = useState({
    transactions: [],
    serviceOrders: [],
    schedule: [],
    inventory: [],
    tickets: [],
  });

  const loadData = useCallback(() => {
    setData({
      transactions: DB.list("erp:finance:"),
      serviceOrders: DB.list("erp:os:"),
      schedule: DB.list("erp:schedule:"),
      inventory: DB.list("erp:inventory:"),
      tickets: DB.list("erp:ticket:"),
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { transactions, serviceOrders, schedule, inventory, tickets } = data;

  const now = new Date();
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();

  const thisMonthTx = useMemo(
    () => transactions.filter((t) => {
      const d = new Date(t.data);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear;
    }),
    [transactions, currentMonth, currentYear]
  );

  const faturamentoMes = useMemo(
    () => thisMonthTx.filter((t) => t.tipo === "receita").reduce((s, t) => s + (t.valor || 0), 0),
    [thisMonthTx]
  );

  const despesasMes = useMemo(
    () => thisMonthTx.filter((t) => t.tipo === "despesa").reduce((s, t) => s + (t.valor || 0), 0),
    [thisMonthTx]
  );

  const servicosRealizados = useMemo(
    () => serviceOrders.filter((os) => os.status === "concluido").length,
    [serviceOrders]
  );

  const todayStr = toISODate(now);
  const agendamentosHoje = useMemo(
    () => schedule.filter((s) => s.data && s.data.startsWith(todayStr)).length,
    [schedule, todayStr]
  );

  const estoqueAlerta = useMemo(
    () => inventory.filter((i) => i.quantidade <= i.quantidadeMinima).length,
    [inventory]
  );

  const ticketsAbertos = useMemo(
    () => tickets.filter((t) => t.status === "aberto").length,
    [tickets]
  );

  // Chart data: Faturamento últimos 6 meses
  const barChartData = useMemo(() => {
    const months = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(currentYear, currentMonth - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      const monthNames = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
      const receitas = transactions
        .filter((t) => t.tipo === "receita" && new Date(t.data).getMonth() === m && new Date(t.data).getFullYear() === y)
        .reduce((s, t) => s + (t.valor || 0), 0);
      const despesas = transactions
        .filter((t) => t.tipo === "despesa" && new Date(t.data).getMonth() === m && new Date(t.data).getFullYear() === y)
        .reduce((s, t) => s + (t.valor || 0), 0);
      months.push({ name: monthNames[m], receitas, despesas });
    }
    return months;
  }, [transactions, currentMonth, currentYear]);

  // Line chart: OS concluídas por semana (últimas 8 semanas)
  const lineChartData = useMemo(() => {
    const weeks = [];
    for (let i = 7; i >= 0; i--) {
      const weekStart = new Date(now);
      weekStart.setDate(weekStart.getDate() - i * 7);
      const weekEnd = new Date(weekStart);
      weekEnd.setDate(weekEnd.getDate() + 7);
      const count = serviceOrders.filter((os) => {
        if (os.status !== "concluido" || !os.dataConclusao) return false;
        const d = new Date(os.dataConclusao);
        return d >= weekStart && d < weekEnd;
      }).length;
      weeks.push({ name: `S${8 - i}`, concluidas: count });
    }
    return weeks;
  }, [serviceOrders, now]);

  // Pie chart: distribuição receita por categoria
  const pieChartData = useMemo(() => {
    const catMap = {};
    transactions
      .filter((t) => t.tipo === "receita")
      .forEach((t) => {
        const cat = t.categoria || "Outros";
        catMap[cat] = (catMap[cat] || 0) + (t.valor || 0);
      });
    return Object.entries(catMap).map(([name, value]) => ({ name, value }));
  }, [transactions]);

  // Próximas atividades
  const proximasAtividades = useMemo(() => {
    return schedule
      .filter((s) => new Date(s.data) >= now && s.status === "agendado")
      .sort((a, b) => new Date(a.data) - new Date(b.data))
      .slice(0, 5);
  }, [schedule, now]);

  // Alertas
  const alertas = useMemo(() => {
    const list = [];
    inventory.filter((i) => i.quantidade <= i.quantidadeMinima).forEach((i) => {
      list.push({ tipo: "estoque", icon: "📦", text: `Estoque baixo: ${i.nome} (${i.quantidade} ${i.unidade})`, severity: "warning" });
    });
    transactions.filter((t) => t.status === "pendente" && t.tipo === "receita").forEach((t) => {
      list.push({ tipo: "financeiro", icon: "💰", text: `Pagamento pendente: ${t.descricao} - ${formatCurrency(t.valor)}`, severity: "warning" });
    });
    tickets.filter((t) => t.status === "aberto").forEach((t) => {
      list.push({ tipo: "ticket", icon: "🎫", text: `Ticket aberto: ${t.titulo}`, severity: "info" });
    });
    return list;
  }, [inventory, transactions, tickets]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-gray-400 text-sm mt-1">Bem-vindo, {user.nome.split(" ")[0]}!</p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="Faturamento do Mês"
          value={formatCurrency(faturamentoMes)}
          icon="💰"
          onClick={() => onNavigate("financeiro")}
        />
        <KPICard
          title="Serviços Realizados"
          value={servicosRealizados}
          icon="🔧"
          onClick={() => onNavigate("os")}
        />
        <KPICard
          title="Agendamentos Hoje"
          value={agendamentosHoje}
          icon="📅"
          onClick={() => onNavigate("agenda")}
        />
        <KPICard
          title="Estoque em Alerta"
          value={estoqueAlerta}
          icon="📦"
          onClick={() => onNavigate("estoque")}
        />
        <KPICard
          title="Tickets Abertos"
          value={ticketsAbertos}
          icon="🎫"
          onClick={() => onNavigate("tickets")}
        />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Bar Chart - Faturamento */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Faturamento Últimos 6 Meses</h3>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={barChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} tickFormatter={(v) => `R$${(v / 1000).toFixed(0)}k`} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px", color: "#fff" }}
                formatter={(value) => [formatCurrency(value)]}
              />
              <Legend />
              <Bar dataKey="receitas" name="Receitas" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="despesas" name="Despesas" fill="#ef4444" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Line Chart - OS concluídas */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">OS Concluídas por Semana</h3>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={lineChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#374151" />
              <XAxis dataKey="name" stroke="#9ca3af" fontSize={12} />
              <YAxis stroke="#9ca3af" fontSize={12} allowDecimals={false} />
              <Tooltip
                contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px", color: "#fff" }}
              />
              <Line type="monotone" dataKey="concluidas" name="Concluídas" stroke="#06b6d4" strokeWidth={2} dot={{ fill: "#06b6d4", r: 4 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Pie Chart + Próximas Atividades */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Pie Chart */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Distribuição de Receita por Categoria</h3>
          {pieChartData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <PieChart>
                <Pie
                  data={pieChartData}
                  cx="50%"
                  cy="50%"
                  innerRadius={60}
                  outerRadius={100}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {pieChartData.map((_, idx) => (
                    <Cell key={idx} fill={COLORS[idx % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: "8px", color: "#fff" }}
                  formatter={(value) => [formatCurrency(value)]}
                />
              </PieChart>
            </ResponsiveContainer>
          ) : (
            <div className="flex items-center justify-center h-[280px] text-gray-500">Sem dados de receita</div>
          )}
        </div>

        {/* Próximas Atividades */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Próximas Atividades</h3>
          {proximasAtividades.length > 0 ? (
            <div className="space-y-3">
              {proximasAtividades.map((ativ) => (
                <div key={ativ.id} className="flex items-start gap-3 p-3 rounded-lg bg-gray-700/30 hover:bg-gray-700/50 transition">
                  <div className="w-10 h-10 rounded-lg bg-cyan-500/20 flex items-center justify-center text-cyan-400 text-sm flex-shrink-0">
                    📅
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{ativ.titulo}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{formatDateTime(ativ.data)}</p>
                    <p className="text-gray-500 text-xs">{ativ.tecnicoNome} • {ativ.clienteNome}</p>
                  </div>
                  <StatusBadge status={ativ.status} />
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-gray-500 text-sm">
              Nenhuma atividade agendada
            </div>
          )}
        </div>
      </div>

      {/* Alertas + Resumo Financeiro */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Alertas */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Alertas</h3>
          {alertas.length > 0 ? (
            <div className="space-y-2">
              {alertas.map((alerta, idx) => (
                <div
                  key={idx}
                  className={`flex items-center gap-3 p-3 rounded-lg border ${
                    alerta.severity === "warning"
                      ? "bg-yellow-500/5 border-yellow-500/20"
                      : "bg-blue-500/5 border-blue-500/20"
                  }`}
                >
                  <span className="text-lg">{alerta.icon}</span>
                  <p className="text-gray-300 text-sm flex-1">{alerta.text}</p>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[120px] text-green-400 text-sm">
              ✓ Nenhum alerta no momento
            </div>
          )}
        </div>

        {/* Resumo Financeiro */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Resumo Financeiro do Mês</h3>
          <div className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-green-500/10 border border-green-500/20 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-green-400 text-lg">↑</span>
                <span className="text-gray-300 text-sm">Receitas</span>
              </div>
              <span className="text-green-400 font-semibold">{formatCurrency(faturamentoMes)}</span>
            </div>
            <div className="flex items-center justify-between p-3 bg-red-500/10 border border-red-500/20 rounded-lg">
              <div className="flex items-center gap-3">
                <span className="text-red-400 text-lg">↓</span>
                <span className="text-gray-300 text-sm">Despesas</span>
              </div>
              <span className="text-red-400 font-semibold">{formatCurrency(despesasMes)}</span>
            </div>
            <div className="border-t border-gray-700 pt-3">
              <div className="flex items-center justify-between p-3 bg-gray-700/30 rounded-lg">
                <span className="text-gray-300 text-sm font-medium">Saldo</span>
                <span className={`font-bold text-lg ${faturamentoMes - despesasMes >= 0 ? "text-green-400" : "text-red-400"}`}>
                  {formatCurrency(faturamentoMes - despesasMes)}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── FINANCE MODULE ─────────────────────────────────────────────────────────────

function PrintableFinanceReport({ transactions, dateFilter }) {
  const receitas = transactions.filter((t) => t.tipo === "receita");
  const despesas = transactions.filter((t) => t.tipo === "despesa");
  const totalReceitas = receitas.reduce((s, t) => s + (t.valor || 0), 0);
  const totalDespesas = despesas.reduce((s, t) => s + (t.valor || 0), 0);

  return (
    <div className="print-only print-report">
      <div style={{ textAlign: "center", marginBottom: "20px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "bold" }}>FrostERP Refrigeração</h2>
        <h2 style={{ fontSize: "14px", color: "#555" }}>Relatório Financeiro</h2>
        <p style={{ fontSize: "11px", color: "#888" }}>Gerado em: {formatDateTime(new Date().toISOString())}</p>
      </div>

      <div style={{ display: "flex", gap: "20px", marginBottom: "20px" }}>
        <div style={{ flex: 1, padding: "10px", border: "1px solid #ccc", borderRadius: "6px" }}>
          <p style={{ fontSize: "11px", color: "#666" }}>Total Receitas</p>
          <p style={{ fontSize: "16px", fontWeight: "bold", color: "#16a34a" }}>{formatCurrency(totalReceitas)}</p>
        </div>
        <div style={{ flex: 1, padding: "10px", border: "1px solid #ccc", borderRadius: "6px" }}>
          <p style={{ fontSize: "11px", color: "#666" }}>Total Despesas</p>
          <p style={{ fontSize: "16px", fontWeight: "bold", color: "#dc2626" }}>{formatCurrency(totalDespesas)}</p>
        </div>
        <div style={{ flex: 1, padding: "10px", border: "1px solid #ccc", borderRadius: "6px" }}>
          <p style={{ fontSize: "11px", color: "#666" }}>Saldo</p>
          <p style={{ fontSize: "16px", fontWeight: "bold", color: totalReceitas - totalDespesas >= 0 ? "#16a34a" : "#dc2626" }}>
            {formatCurrency(totalReceitas - totalDespesas)}
          </p>
        </div>
      </div>

      <h3 style={{ fontSize: "13px", fontWeight: "bold", marginBottom: "8px" }}>Transações</h3>
      <table>
        <thead>
          <tr>
            <th>Data</th>
            <th>Descrição</th>
            <th>Categoria</th>
            <th>Tipo</th>
            <th>Forma Pgto</th>
            <th>Status</th>
            <th style={{ textAlign: "right" }}>Valor</th>
          </tr>
        </thead>
        <tbody>
          {transactions.sort((a, b) => new Date(b.data) - new Date(a.data)).map((t) => (
            <tr key={t.id}>
              <td>{formatDate(t.data)}</td>
              <td>{t.descricao}</td>
              <td>{t.categoria}</td>
              <td>{t.tipo === "receita" ? "Receita" : "Despesa"}</td>
              <td>{t.formaPagamento}</td>
              <td>{STATUS_MAP[t.status]?.label || t.status}</td>
              <td style={{ textAlign: "right", color: t.tipo === "receita" ? "#16a34a" : "#dc2626" }}>
                {formatCurrency(t.valor)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function FinanceModule({ user, dateFilter, addToast }) {
  const [transactions, setTransactions] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const loadTransactions = useCallback(() => {
    setTransactions(DB.list("erp:finance:"));
  }, []);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const emptyForm = {
    descricao: "", valor: "", tipo: "receita", categoria: "",
    data: toISODate(new Date()), status: "pendente", formaPagamento: "PIX", observacoes: "",
  };

  const [form, setForm] = useState(emptyForm);

  const filteredTransactions = useMemo(() => {
    let list = filterByDate(transactions, "data", dateFilter);
    if (filterType !== "all") list = list.filter((t) => t.tipo === filterType);
    if (filterCategory !== "all") list = list.filter((t) => t.categoria === filterCategory);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.descricao || "").toLowerCase().includes(s) ||
          (t.categoria || "").toLowerCase().includes(s) ||
          (t.numero || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.data) - new Date(a.data));
  }, [transactions, dateFilter, filterType, filterCategory, search]);

  const totalReceitas = useMemo(
    () => filteredTransactions.filter((t) => t.tipo === "receita").reduce((s, t) => s + (t.valor || 0), 0),
    [filteredTransactions]
  );
  const totalDespesas = useMemo(
    () => filteredTransactions.filter((t) => t.tipo === "despesa").reduce((s, t) => s + (t.valor || 0), 0),
    [filteredTransactions]
  );

  const allCategories = useMemo(() => {
    const cats = new Set();
    transactions.forEach((t) => { if (t.categoria) cats.add(t.categoria); });
    return [...cats].sort();
  }, [transactions]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((row) => {
    setEditing(row);
    setForm({
      descricao: row.descricao || "",
      valor: row.valor || "",
      tipo: row.tipo || "receita",
      categoria: row.categoria || "",
      data: row.data ? row.data.split("T")[0] : toISODate(new Date()),
      status: row.status || "pendente",
      formaPagamento: row.formaPagamento || "PIX",
      observacoes: row.observacoes || "",
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.descricao.trim() || !form.valor || !form.data) {
      addToast("Preencha os campos obrigatórios.", "error");
      return;
    }

    const valor = parseFloat(String(form.valor).replace(",", "."));
    if (isNaN(valor) || valor <= 0) {
      addToast("Informe um valor válido.", "error");
      return;
    }

    if (editing) {
      const updated = {
        ...editing,
        descricao: form.descricao.trim(),
        valor,
        tipo: form.tipo,
        categoria: form.categoria,
        data: form.data + "T00:00:00.000Z",
        status: form.status,
        formaPagamento: form.formaPagamento,
        observacoes: form.observacoes,
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:finance:" + updated.id, updated);
      addToast("Transação atualizada com sucesso.", "success");
    } else {
      const prefix = form.tipo === "receita" ? "NF" : "DP";
      const numero = getNextNumber(prefix, transactions);
      const newTx = {
        id: genId(),
        numero,
        descricao: form.descricao.trim(),
        valor,
        tipo: form.tipo,
        categoria: form.categoria,
        data: form.data + "T00:00:00.000Z",
        status: form.status,
        formaPagamento: form.formaPagamento,
        observacoes: form.observacoes,
        osId: null,
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:finance:" + newTx.id, newTx);
      addToast(MSG_TEMPLATES.pagamento_registrado(newTx.descricao), "success");
    }

    setModalOpen(false);
    loadTransactions();
  }, [form, editing, transactions, loadTransactions, addToast]);

  const handleDelete = useCallback((row) => {
    if (!hasPermission(user, "financeiro") && user.role !== "admin" && user.role !== "gerente") {
      addToast("Sem permissão para excluir transações.", "error");
      return;
    }
    setConfirmDelete(row);
  }, [user, addToast]);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:finance:" + confirmDelete.id);
      addToast("Transação excluída.", "success");
      setConfirmDelete(null);
      loadTransactions();
    }
  }, [confirmDelete, loadTransactions, addToast]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const columns = [
    { key: "numero", label: "Nº", width: "w-20" },
    { key: "data", label: "Data", render: (v) => formatDate(v) },
    { key: "descricao", label: "Descrição" },
    { key: "categoria", label: "Categoria" },
    {
      key: "tipo", label: "Tipo",
      render: (v) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${v === "receita" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
          {v === "receita" ? "Receita" : "Despesa"}
        </span>
      ),
    },
    { key: "formaPagamento", label: "Forma Pgto" },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
    {
      key: "valor", label: "Valor",
      render: (v, row) => (
        <span className={`font-medium ${row.tipo === "receita" ? "text-green-400" : "text-red-400"}`}>
          {row.tipo === "despesa" ? "- " : ""}{formatCurrency(v)}
        </span>
      ),
    },
  ];

  const canDelete = user.role === "admin" || user.role === "gerente";

  return (
    <div className="space-y-6">
      <PrintableFinanceReport transactions={filteredTransactions} dateFilter={dateFilter} />

      <div className="flex items-center justify-between no-print">
        <div>
          <h2 className="text-2xl font-bold text-white">Financeiro</h2>
          <p className="text-gray-400 text-sm mt-1">Gestão de receitas e despesas</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handlePrint} className="px-4 py-2 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 transition text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
            Imprimir
          </button>
          <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Nova Transação
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 no-print">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <p className="text-gray-400 text-sm">Total Receitas</p>
          <p className="text-2xl font-bold text-green-400 mt-1">{formatCurrency(totalReceitas)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <p className="text-gray-400 text-sm">Total Despesas</p>
          <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(totalDespesas)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <p className="text-gray-400 text-sm">Saldo</p>
          <p className={`text-2xl font-bold mt-1 ${totalReceitas - totalDespesas >= 0 ? "text-green-400" : "text-red-400"}`}>
            {formatCurrency(totalReceitas - totalDespesas)}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar transação..." />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todos os tipos</option>
          <option value="receita">Receitas</option>
          <option value="despesa">Despesas</option>
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todas as categorias</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="no-print">
        <DataTable
          columns={columns}
          data={filteredTransactions}
          onEdit={openEdit}
          onDelete={canDelete ? handleDelete : undefined}
          emptyMessage="Nenhuma transação encontrada."
        />
      </div>

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} title={editing ? "Editar Transação" : "Nova Transação"} onClose={() => setModalOpen(false)} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição *</label>
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: Instalação Split 12000 BTUs"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Valor (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                placeholder="0,00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value, categoria: "" })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="receita">Receita</option>
                <option value="despesa">Despesa</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
              <select
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Selecione...</option>
                {(form.tipo === "receita" ? CATEGORIES_RECEITA : CATEGORIES_DESPESA).map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Data *</label>
              <input
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="pendente">Pendente</option>
                <option value="pago">Pago</option>
                <option value="atrasado">Atrasado</option>
                <option value="cancelado">Cancelado</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Forma de Pagamento</label>
              <select
                value={form.formaPagamento}
                onChange={(e) => setForm({ ...form, formaPagamento: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {PAYMENT_METHODS.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              rows={3}
              placeholder="Observações adicionais..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button
              onClick={() => setModalOpen(false)}
              className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
            >
              Cancelar
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              {editing ? "Salvar Alterações" : "Criar Transação"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Tem certeza que deseja excluir a transação "${confirmDelete.descricao}"? Esta ação não pode ser desfeita.`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── INVENTORY MODULE ────────────────────────────────────────────────────────

function InventoryModule({ user, addToast }) {
  const [items, setItems] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [movementModal, setMovementModal] = useState(null);
  const [historyModal, setHistoryModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");

  const INVENTORY_CATEGORIES = ["Equipamento", "Peça", "Material", "Ferramenta", "Consumível"];

  const loadItems = useCallback(() => {
    setItems(DB.list("erp:inventory:"));
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const emptyForm = {
    nome: "", sku: "", categoria: "Equipamento", quantidade: "",
    quantidadeMinima: "", precoCompra: "", precoVenda: "", descricao: "",
  };

  const [form, setForm] = useState(emptyForm);

  const [movementForm, setMovementForm] = useState({
    tipo: "entrada", quantidade: "", motivo: "",
  });

  const getStockStatus = useCallback((item) => {
    if (item.quantidade <= 0) return "esgotado";
    if (item.quantidade <= (item.quantidadeMinima || 0)) return "baixo";
    return "normal";
  }, []);

  const filteredItems = useMemo(() => {
    let list = [...items];
    if (filterCategory !== "all") list = list.filter((i) => i.categoria === filterCategory);
    if (filterStatus !== "all") {
      list = list.filter((i) => getStockStatus(i) === filterStatus);
    }
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (i) =>
          (i.nome || "").toLowerCase().includes(s) ||
          (i.sku || "").toLowerCase().includes(s) ||
          (i.categoria || "").toLowerCase().includes(s)
      );
    }
    return list;
  }, [items, filterCategory, filterStatus, search, getStockStatus]);

  const totalItems = items.length;
  const totalValue = useMemo(() => items.reduce((s, i) => s + (i.quantidade || 0) * (i.precoCompra || 0), 0), [items]);
  const lowStockCount = useMemo(() => items.filter((i) => i.quantidade <= (i.quantidadeMinima || 0) && i.quantidade > 0).length, [items]);
  const outOfStockCount = useMemo(() => items.filter((i) => i.quantidade <= 0).length, [items]);
  const categoriesCount = useMemo(() => new Set(items.map((i) => i.categoria)).size, [items]);

  const isReadOnly = user.role === "tecnico";

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((row) => {
    setEditing(row);
    setForm({
      nome: row.nome || "",
      sku: row.sku || "",
      categoria: row.categoria || "Equipamento",
      quantidade: row.quantidade ?? "",
      quantidadeMinima: row.quantidadeMinima ?? "",
      precoCompra: row.precoCompra ?? "",
      precoVenda: row.precoVenda ?? "",
      descricao: row.descricao || "",
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.nome.trim() || !form.sku.trim()) {
      addToast("Preencha nome e SKU.", "error");
      return;
    }
    const quantidade = parseInt(form.quantidade) || 0;
    const quantidadeMinima = parseInt(form.quantidadeMinima) || 0;
    const precoCompra = parseFloat(String(form.precoCompra).replace(",", ".")) || 0;
    const precoVenda = parseFloat(String(form.precoVenda).replace(",", ".")) || 0;

    if (editing) {
      const updated = {
        ...editing,
        nome: form.nome.trim(),
        sku: form.sku.trim(),
        categoria: form.categoria,
        quantidade,
        quantidadeMinima,
        precoCompra,
        precoVenda,
        descricao: form.descricao,
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:inventory:" + updated.id, updated);
      addToast("Item atualizado com sucesso.", "success");
    } else {
      const newItem = {
        id: genId(),
        nome: form.nome.trim(),
        sku: form.sku.trim(),
        categoria: form.categoria,
        unidade: "un",
        quantidade,
        quantidadeMinima,
        precoCompra,
        precoVenda,
        descricao: form.descricao,
        fornecedor: "",
        localizacao: "",
        status: "ativo",
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:inventory:" + newItem.id, newItem);
      addToast("Item cadastrado com sucesso.", "success");
    }
    setModalOpen(false);
    loadItems();
  }, [form, editing, loadItems, addToast]);

  const handleDelete = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:inventory:" + confirmDelete.id);
      addToast("Item excluído.", "success");
      setConfirmDelete(null);
      loadItems();
    }
  }, [confirmDelete, loadItems, addToast]);

  const openMovement = useCallback((item) => {
    setMovementModal(item);
    setMovementForm({ tipo: "entrada", quantidade: "", motivo: "" });
  }, []);

  const handleMovement = useCallback(() => {
    if (!movementForm.quantidade || parseInt(movementForm.quantidade) <= 0) {
      addToast("Informe uma quantidade válida.", "error");
      return;
    }
    const qty = parseInt(movementForm.quantidade);
    const item = movementModal;
    let newQty = item.quantidade;

    if (movementForm.tipo === "entrada") {
      newQty += qty;
    } else {
      if (qty > item.quantidade) {
        addToast("Quantidade insuficiente em estoque.", "error");
        return;
      }
      newQty -= qty;
    }

    const movement = {
      id: genId(),
      itemId: item.id,
      itemNome: item.nome,
      tipo: movementForm.tipo,
      quantidade: qty,
      quantidadeAnterior: item.quantidade,
      quantidadeNova: newQty,
      motivo: movementForm.motivo || "—",
      usuario: user.nome,
      data: new Date().toISOString(),
    };

    const movements = DB.get("erp:inventory:movements:" + item.id) || [];
    movements.push(movement);
    DB.set("erp:inventory:movements:" + item.id, movements);

    const updated = { ...item, quantidade: newQty, updatedAt: new Date().toISOString() };
    DB.set("erp:inventory:" + item.id, updated);

    addToast(`Movimentação registrada: ${movementForm.tipo === "entrada" ? "+" : "-"}${qty} ${item.nome}`, "success");

    if (newQty <= (item.quantidadeMinima || 0)) {
      addToast(MSG_TEMPLATES.item_baixo(item.nome), "warning");
    }

    setMovementModal(null);
    loadItems();
  }, [movementModal, movementForm, user, loadItems, addToast]);

  const openHistory = useCallback((item) => {
    const movements = DB.get("erp:inventory:movements:" + item.id) || [];
    setHistoryModal({ item, movements });
  }, []);

  const calcMargin = useCallback((custo, venda) => {
    if (!custo || custo === 0) return 0;
    return ((venda - custo) / custo * 100);
  }, []);

  const columns = [
    { key: "nome", label: "Nome" },
    { key: "sku", label: "SKU", width: "w-24" },
    { key: "categoria", label: "Categoria" },
    {
      key: "quantidade", label: "Qtd",
      render: (v, row) => {
        const status = getStockStatus(row);
        return (
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${
            status === "esgotado" ? "bg-red-500/20 text-red-400" :
            status === "baixo" ? "bg-yellow-500/20 text-yellow-400" :
            "text-gray-300"
          }`}>
            {v} {status === "baixo" && `(min: ${row.quantidadeMinima})`}
            {status === "esgotado" && " (esgotado)"}
          </span>
        );
      },
    },
    { key: "precoCompra", label: "Custo", render: (v) => formatCurrency(v) },
    { key: "precoVenda", label: "Preço Venda", render: (v) => formatCurrency(v) },
    {
      key: "margem", label: "Margem %", sortable: false,
      render: (_, row) => {
        const m = calcMargin(row.precoCompra, row.precoVenda);
        return (
          <span className={m >= 30 ? "text-green-400" : m >= 15 ? "text-yellow-400" : "text-red-400"}>
            {m.toFixed(1)}%
          </span>
        );
      },
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Estoque</h2>
          <p className="text-gray-400 text-sm mt-1">Gestão de inventário e movimentações</p>
        </div>
        {!isReadOnly && (
          <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Novo Item
          </button>
        )}
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard title="Total de Itens" value={totalItems} icon="📦" />
        <KPICard title="Valor em Estoque" value={formatCurrency(totalValue)} icon="💰" />
        <KPICard title="Estoque Baixo" value={lowStockCount} icon="⚠" />
        <KPICard title="Esgotados" value={outOfStockCount} icon="🚫" />
        <KPICard title="Categorias" value={categoriesCount} icon="🏷" />
      </div>

      {/* Low Stock Alerts */}
      {items.filter((i) => getStockStatus(i) !== "normal").length > 0 && (
        <div className="bg-yellow-500/5 border border-yellow-500/20 rounded-xl p-4">
          <h3 className="text-yellow-400 font-medium text-sm mb-2">Alertas de Estoque</h3>
          <div className="flex flex-wrap gap-2">
            {items.filter((i) => getStockStatus(i) !== "normal").map((item) => (
              <span key={item.id} className={`px-3 py-1 rounded-full text-xs font-medium ${
                getStockStatus(item) === "esgotado" ? "bg-red-500/20 text-red-400" : "bg-yellow-500/20 text-yellow-400"
              }`}>
                {item.nome}: {item.quantidade} un
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar item..." />
        </div>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todas categorias</option>
          {INVENTORY_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todos os status</option>
          <option value="normal">Normal</option>
          <option value="baixo">Estoque Baixo</option>
          <option value="esgotado">Esgotado</option>
        </select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filteredItems}
        onEdit={isReadOnly ? undefined : openEdit}
        onDelete={isReadOnly ? undefined : handleDelete}
        actions={isReadOnly ? undefined : (row) => (
          <>
            <button onClick={() => openMovement(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-gray-700 transition" title="Movimentação">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
            </button>
            <button onClick={() => openHistory(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition" title="Histórico">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
            </button>
          </>
        )}
        emptyMessage="Nenhum item encontrado no estoque."
      />

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} title={editing ? "Editar Item" : "Novo Item"} onClose={() => setModalOpen(false)} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome *</label>
              <input
                type="text"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                placeholder="Nome do item"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">SKU *</label>
              <input
                type="text"
                value={form.sku}
                onChange={(e) => setForm({ ...form, sku: e.target.value })}
                placeholder="Ex: EQ-005"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
              <select
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {INVENTORY_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Quantidade</label>
              <input
                type="number"
                min="0"
                value={form.quantidade}
                onChange={(e) => setForm({ ...form, quantidade: e.target.value })}
                placeholder="0"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Qtd Mínima</label>
              <input
                type="number"
                min="0"
                value={form.quantidadeMinima}
                onChange={(e) => setForm({ ...form, quantidadeMinima: e.target.value })}
                placeholder="0"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Custo (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.precoCompra}
                onChange={(e) => setForm({ ...form, precoCompra: e.target.value })}
                placeholder="0,00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Preço de Venda (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.precoVenda}
                onChange={(e) => setForm({ ...form, precoVenda: e.target.value })}
                placeholder="0,00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          {form.precoCompra && form.precoVenda && (
            <div className="bg-gray-700/30 rounded-lg p-3">
              <p className="text-sm text-gray-400">
                Margem de lucro:{" "}
                <span className={`font-semibold ${calcMargin(parseFloat(form.precoCompra), parseFloat(form.precoVenda)) >= 30 ? "text-green-400" : "text-yellow-400"}`}>
                  {calcMargin(parseFloat(form.precoCompra) || 0, parseFloat(form.precoVenda) || 0).toFixed(1)}%
                </span>
              </p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição</label>
            <textarea
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              rows={3}
              placeholder="Descrição do item..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
              Cancelar
            </button>
            <button onClick={handleSave} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              {editing ? "Salvar Alterações" : "Cadastrar Item"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Movement Modal */}
      <Modal isOpen={!!movementModal} title={`Movimentação - ${movementModal?.nome || ""}`} onClose={() => setMovementModal(null)} size="sm">
        <div className="space-y-4">
          <div className="bg-gray-700/30 rounded-lg p-3">
            <p className="text-sm text-gray-400">Estoque atual: <span className="text-white font-semibold">{movementModal?.quantidade || 0}</span></p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
            <div className="flex gap-2">
              <button
                onClick={() => setMovementForm({ ...movementForm, tipo: "entrada" })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${movementForm.tipo === "entrada" ? "bg-green-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                Entrada
              </button>
              <button
                onClick={() => setMovementForm({ ...movementForm, tipo: "saida" })}
                className={`flex-1 py-2 rounded-lg text-sm font-medium transition ${movementForm.tipo === "saida" ? "bg-red-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
              >
                Saída
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Quantidade *</label>
            <input
              type="number"
              min="1"
              value={movementForm.quantidade}
              onChange={(e) => setMovementForm({ ...movementForm, quantidade: e.target.value })}
              placeholder="0"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Motivo</label>
            <input
              type="text"
              value={movementForm.motivo}
              onChange={(e) => setMovementForm({ ...movementForm, motivo: e.target.value })}
              placeholder="Ex: Compra de fornecedor, Uso em OS..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {movementForm.quantidade && (
            <div className="bg-gray-700/30 rounded-lg p-3">
              <p className="text-sm text-gray-400">
                Estoque após movimentação:{" "}
                <span className="text-white font-semibold">
                  {movementForm.tipo === "entrada"
                    ? (movementModal?.quantidade || 0) + parseInt(movementForm.quantidade || 0)
                    : (movementModal?.quantidade || 0) - parseInt(movementForm.quantidade || 0)}
                </span>
              </p>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setMovementModal(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
              Cancelar
            </button>
            <button onClick={handleMovement} className={`px-6 py-2 text-sm rounded-lg text-white transition ${movementForm.tipo === "entrada" ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"}`}>
              Registrar {movementForm.tipo === "entrada" ? "Entrada" : "Saída"}
            </button>
          </div>
        </div>
      </Modal>

      {/* History Modal */}
      <Modal isOpen={!!historyModal} title={`Histórico - ${historyModal?.item?.nome || ""}`} onClose={() => setHistoryModal(null)} size="lg">
        {historyModal && historyModal.movements.length > 0 ? (
          <div className="space-y-2">
            {historyModal.movements.sort((a, b) => new Date(b.data) - new Date(a.data)).map((mov) => (
              <div key={mov.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/30">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${mov.tipo === "entrada" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                  {mov.tipo === "entrada" ? "+" : "-"}
                </div>
                <div className="flex-1">
                  <p className="text-white text-sm">
                    {mov.tipo === "entrada" ? "Entrada" : "Saída"}: <span className="font-semibold">{mov.quantidade} un</span>
                  </p>
                  <p className="text-gray-400 text-xs">{mov.motivo} | {formatDateTime(mov.data)} | {mov.usuario}</p>
                </div>
                <div className="text-right">
                  <p className="text-gray-400 text-xs">{mov.quantidadeAnterior} → {mov.quantidadeNova}</p>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState icon="📋" title="Nenhuma movimentação" description="Este item ainda não possui histórico de movimentações." />
        )}
      </Modal>

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Tem certeza que deseja excluir "${confirmDelete.nome}" do estoque?`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── INVOICE MODULE ─────────────────────────────────────────────────────────

function PrintableInvoice({ invoice, config }) {
  if (!invoice) return null;
  return (
    <div className="print-only print-report">
      <div style={{ textAlign: "center", marginBottom: "20px", borderBottom: "2px solid #333", paddingBottom: "15px" }}>
        <h2 style={{ fontSize: "18px", fontWeight: "bold" }}>{config?.nomeEmpresa || "FrostERP Refrigeração"}</h2>
        <p style={{ fontSize: "11px", color: "#666" }}>CNPJ: {config?.cnpj || "—"} | Tel: {config?.telefone || "—"}</p>
        <p style={{ fontSize: "11px", color: "#666" }}>{config?.endereco || "—"}</p>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "20px" }}>
        <div>
          <h2 style={{ fontSize: "14px", fontWeight: "bold" }}>NOTA FISCAL DE SERVIÇO</h2>
          <p style={{ fontSize: "12px" }}>Número: {invoice.numero}</p>
          <p style={{ fontSize: "12px" }}>Data: {formatDate(invoice.data)}</p>
        </div>
        <div style={{ textAlign: "right" }}>
          <p style={{ fontSize: "12px", fontWeight: "bold" }}>Status: {STATUS_MAP[invoice.status]?.label || invoice.status}</p>
        </div>
      </div>

      <div style={{ marginBottom: "20px", padding: "10px", border: "1px solid #ccc", borderRadius: "4px" }}>
        <h3 style={{ fontSize: "12px", fontWeight: "bold", marginBottom: "5px" }}>DADOS DO CLIENTE</h3>
        <p style={{ fontSize: "11px" }}>Nome: {invoice.clienteNome}</p>
        <p style={{ fontSize: "11px" }}>Documento: {invoice.clienteDocumento || "—"}</p>
      </div>

      <table style={{ width: "100%", marginBottom: "15px" }}>
        <thead>
          <tr>
            <th style={{ textAlign: "left" }}>Item</th>
            <th style={{ textAlign: "center" }}>Qtd</th>
            <th style={{ textAlign: "right" }}>Valor Unit.</th>
            <th style={{ textAlign: "right" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {(invoice.itens || []).map((item, idx) => (
            <tr key={idx}>
              <td>{item.descricao}</td>
              <td style={{ textAlign: "center" }}>{item.quantidade}</td>
              <td style={{ textAlign: "right" }}>{formatCurrency(item.valorUnitario)}</td>
              <td style={{ textAlign: "right" }}>{formatCurrency(item.quantidade * item.valorUnitario)}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: "250px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
            <span style={{ fontSize: "11px" }}>Subtotal:</span>
            <span style={{ fontSize: "11px" }}>{formatCurrency(invoice.subtotal)}</span>
          </div>
          {invoice.issPercent > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "11px" }}>ISS ({invoice.issPercent}%):</span>
              <span style={{ fontSize: "11px" }}>{formatCurrency(invoice.issValor)}</span>
            </div>
          )}
          {invoice.icmsPercent > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "11px" }}>ICMS ({invoice.icmsPercent}%):</span>
              <span style={{ fontSize: "11px" }}>{formatCurrency(invoice.icmsValor)}</span>
            </div>
          )}
          {invoice.desconto > 0 && (
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
              <span style={{ fontSize: "11px" }}>Desconto:</span>
              <span style={{ fontSize: "11px", color: "#dc2626" }}>-{formatCurrency(invoice.desconto)}</span>
            </div>
          )}
          <div style={{ display: "flex", justifyContent: "space-between", borderTop: "2px solid #333", paddingTop: "6px", marginTop: "6px" }}>
            <span style={{ fontSize: "13px", fontWeight: "bold" }}>TOTAL:</span>
            <span style={{ fontSize: "13px", fontWeight: "bold" }}>{formatCurrency(invoice.total)}</span>
          </div>
        </div>
      </div>

      {invoice.observacoes && (
        <div style={{ marginTop: "20px", padding: "10px", border: "1px solid #ccc", borderRadius: "4px" }}>
          <h3 style={{ fontSize: "11px", fontWeight: "bold" }}>Observações:</h3>
          <p style={{ fontSize: "11px" }}>{invoice.observacoes}</p>
        </div>
      )}

      <div style={{ marginTop: "40px", textAlign: "center", borderTop: "1px solid #ccc", paddingTop: "10px" }}>
        <p style={{ fontSize: "10px", color: "#888" }}>{config?.nomeEmpresa || "FrostERP Refrigeração"} - {config?.email || ""}</p>
      </div>
    </div>
  );
}

function PrintableBoleto({ boleto, config }) {
  if (!boleto) return null;
  return (
    <div className="print-only print-report">
      <div style={{ border: "2px solid #333", padding: "20px", marginBottom: "20px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", borderBottom: "1px solid #ccc", paddingBottom: "10px", marginBottom: "15px" }}>
          <div>
            <h2 style={{ fontSize: "16px", fontWeight: "bold" }}>{config?.nomeEmpresa || "FrostERP Refrigeração"}</h2>
            <p style={{ fontSize: "10px", color: "#666" }}>CNPJ: {config?.cnpj || "—"}</p>
          </div>
          <div style={{ textAlign: "right" }}>
            <p style={{ fontSize: "11px" }}>Boleto Nº: {boleto.numero}</p>
            <p style={{ fontSize: "11px" }}>Vencimento: {formatDate(boleto.vencimento)}</p>
          </div>
        </div>

        <div style={{ marginBottom: "15px" }}>
          <p style={{ fontSize: "11px" }}><strong>Sacado:</strong> {boleto.clienteNome}</p>
          <p style={{ fontSize: "11px" }}><strong>Valor:</strong> {formatCurrency(boleto.valor)}</p>
          {boleto.observacoes && <p style={{ fontSize: "11px" }}><strong>Ref:</strong> {boleto.observacoes}</p>}
        </div>

        {/* Barcode simulation */}
        <div style={{ display: "flex", height: "50px", gap: "1px", justifyContent: "center", marginTop: "20px" }}>
          {Array.from({ length: 40 }).map((_, i) => (
            <div
              key={i}
              style={{
                width: i % 3 === 0 ? "3px" : i % 2 === 0 ? "2px" : "1px",
                height: "100%",
                backgroundColor: i % 4 === 3 ? "transparent" : "#000",
              }}
            />
          ))}
        </div>
        <p style={{ textAlign: "center", fontSize: "10px", fontFamily: "monospace", marginTop: "5px", letterSpacing: "2px" }}>
          {boleto.numero?.replace(/\D/g, "").padEnd(20, "0").slice(0, 20).replace(/(.{5})/g, "$1.")}
        </p>
      </div>
    </div>
  );
}

function InvoiceModule({ user, dateFilter, addToast, clients }) {
  const [activeTab, setActiveTab] = useState("nf");
  const [invoices, setInvoices] = useState([]);
  const [boletos, setBoletos] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [boletoModalOpen, setBoletoModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [editingBoleto, setEditingBoleto] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [printInvoice, setPrintInvoice] = useState(null);
  const [printBoleto, setPrintBoleto] = useState(null);

  const config = useMemo(() => DB.get("erp:config") || {}, []);

  const loadData = useCallback(() => {
    setInvoices(DB.list("erp:invoice:"));
    setBoletos(DB.list("erp:boleto:"));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  // NF Form
  const emptyNFForm = {
    clienteId: "", itens: [{ descricao: "", quantidade: 1, valorUnitario: "" }],
    issPercent: 5, icmsPercent: 0, desconto: 0, observacoes: "",
  };
  const [nfForm, setNfForm] = useState(emptyNFForm);

  // Boleto Form
  const emptyBoletoForm = {
    clienteId: "", valor: "", vencimento: daysFromNow(30), observacoes: "",
  };
  const [boletoForm, setBoletoForm] = useState(emptyBoletoForm);

  const calcNFTotals = useCallback((form) => {
    const subtotal = (form.itens || []).reduce((s, item) => {
      return s + (parseFloat(item.quantidade) || 0) * (parseFloat(String(item.valorUnitario).replace(",", ".")) || 0);
    }, 0);
    const issValor = subtotal * ((form.issPercent || 0) / 100);
    const icmsValor = subtotal * ((form.icmsPercent || 0) / 100);
    const desconto = parseFloat(form.desconto) || 0;
    const total = subtotal + issValor + icmsValor - desconto;
    return { subtotal, issValor, icmsValor, desconto, total };
  }, []);

  const addNFItem = useCallback(() => {
    setNfForm((prev) => ({
      ...prev,
      itens: [...prev.itens, { descricao: "", quantidade: 1, valorUnitario: "" }],
    }));
  }, []);

  const removeNFItem = useCallback((idx) => {
    setNfForm((prev) => ({
      ...prev,
      itens: prev.itens.filter((_, i) => i !== idx),
    }));
  }, []);

  const updateNFItem = useCallback((idx, field, value) => {
    setNfForm((prev) => ({
      ...prev,
      itens: prev.itens.map((item, i) => (i === idx ? { ...item, [field]: value } : item)),
    }));
  }, []);

  // Filtered lists
  const filteredInvoices = useMemo(() => {
    let list = filterByDate(invoices, "data", dateFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (i) =>
          (i.numero || "").toLowerCase().includes(s) ||
          (i.clienteNome || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.data) - new Date(a.data));
  }, [invoices, dateFilter, search]);

  const filteredBoletos = useMemo(() => {
    let list = filterByDate(boletos, "vencimento", dateFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (b) =>
          (b.numero || "").toLowerCase().includes(s) ||
          (b.clienteNome || "").toLowerCase().includes(s)
      );
    }
    // Auto-detect vencido
    const today = toISODate(new Date());
    list = list.map((b) => {
      if (b.status === "aberto" && b.vencimento < today) {
        return { ...b, status: "vencido" };
      }
      return b;
    });
    return list.sort((a, b) => new Date(b.vencimento) - new Date(a.vencimento));
  }, [boletos, dateFilter, search]);

  // NF CRUD
  const openCreateNF = useCallback(() => {
    setEditing(null);
    setNfForm(emptyNFForm);
    setModalOpen(true);
  }, []);

  const openEditNF = useCallback((row) => {
    setEditing(row);
    setNfForm({
      clienteId: row.clienteId || "",
      itens: row.itens && row.itens.length > 0 ? row.itens : [{ descricao: "", quantidade: 1, valorUnitario: "" }],
      issPercent: row.issPercent ?? 5,
      icmsPercent: row.icmsPercent ?? 0,
      desconto: row.desconto ?? 0,
      observacoes: row.observacoes || "",
    });
    setModalOpen(true);
  }, []);

  const handleSaveNF = useCallback(() => {
    if (!nfForm.clienteId) {
      addToast("Selecione um cliente.", "error");
      return;
    }
    const validItems = nfForm.itens.filter((i) => i.descricao.trim() && i.valorUnitario);
    if (validItems.length === 0) {
      addToast("Adicione pelo menos um item.", "error");
      return;
    }

    const cliente = (clients || []).find((c) => c.id === nfForm.clienteId);
    const totals = calcNFTotals(nfForm);

    if (editing) {
      const updated = {
        ...editing,
        clienteId: nfForm.clienteId,
        clienteNome: cliente?.nome || "—",
        clienteDocumento: cliente?.cpf || cliente?.cnpj || "",
        itens: validItems.map((i) => ({
          descricao: i.descricao.trim(),
          quantidade: parseFloat(i.quantidade) || 1,
          valorUnitario: parseFloat(String(i.valorUnitario).replace(",", ".")) || 0,
        })),
        issPercent: parseFloat(nfForm.issPercent) || 0,
        icmsPercent: parseFloat(nfForm.icmsPercent) || 0,
        issValor: totals.issValor,
        icmsValor: totals.icmsValor,
        subtotal: totals.subtotal,
        desconto: totals.desconto,
        total: totals.total,
        valor: totals.total,
        observacoes: nfForm.observacoes,
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:invoice:" + updated.id, updated);
      addToast("Nota fiscal atualizada.", "success");
    } else {
      const numero = getNextNumber("NF", invoices);
      const newNF = {
        id: genId(),
        numero,
        clienteId: nfForm.clienteId,
        clienteNome: cliente?.nome || "—",
        clienteDocumento: cliente?.cpf || cliente?.cnpj || "",
        data: new Date().toISOString(),
        status: "emitida",
        itens: validItems.map((i) => ({
          descricao: i.descricao.trim(),
          quantidade: parseFloat(i.quantidade) || 1,
          valorUnitario: parseFloat(String(i.valorUnitario).replace(",", ".")) || 0,
        })),
        issPercent: parseFloat(nfForm.issPercent) || 0,
        icmsPercent: parseFloat(nfForm.icmsPercent) || 0,
        issValor: totals.issValor,
        icmsValor: totals.icmsValor,
        subtotal: totals.subtotal,
        desconto: totals.desconto,
        total: totals.total,
        valor: totals.total,
        observacoes: nfForm.observacoes,
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:invoice:" + newNF.id, newNF);
      addToast(`Nota fiscal ${numero} emitida com sucesso.`, "success");
    }

    setModalOpen(false);
    loadData();
  }, [nfForm, editing, invoices, clients, calcNFTotals, loadData, addToast]);

  const handleCancelNF = useCallback((nf) => {
    if (user.role !== "admin" && user.role !== "gerente") {
      addToast("Apenas admin/gerente pode cancelar NF.", "error");
      return;
    }
    const updated = { ...nf, status: "cancelada", updatedAt: new Date().toISOString() };
    DB.set("erp:invoice:" + updated.id, updated);

    // Financial reversal
    const reversalId = genId();
    const reversal = {
      id: reversalId,
      numero: "EST-" + nf.numero,
      descricao: `Estorno NF ${nf.numero} - ${nf.clienteNome}`,
      valor: nf.total || nf.valor || 0,
      tipo: "despesa",
      categoria: "Estorno",
      data: new Date().toISOString(),
      status: "pago",
      formaPagamento: "Estorno",
      observacoes: `Estorno ref. cancelamento da NF ${nf.numero}`,
      osId: null,
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:finance:" + reversalId, reversal);

    addToast(`NF ${nf.numero} cancelada. Estorno financeiro gerado.`, "warning");
    loadData();
  }, [user, loadData, addToast]);

  const handlePrintNF = useCallback((nf) => {
    setPrintInvoice(nf);
    setTimeout(() => window.print(), 300);
  }, []);

  // Boleto CRUD
  const openCreateBoleto = useCallback(() => {
    setEditingBoleto(null);
    setBoletoForm(emptyBoletoForm);
    setBoletoModalOpen(true);
  }, []);

  const openEditBoleto = useCallback((row) => {
    setEditingBoleto(row);
    setBoletoForm({
      clienteId: row.clienteId || "",
      valor: row.valor || "",
      vencimento: row.vencimento ? row.vencimento.split("T")[0] : daysFromNow(30),
      observacoes: row.observacoes || "",
    });
    setBoletoModalOpen(true);
  }, []);

  const handleSaveBoleto = useCallback(() => {
    if (!boletoForm.clienteId || !boletoForm.valor || !boletoForm.vencimento) {
      addToast("Preencha todos os campos obrigatórios.", "error");
      return;
    }
    const valor = parseFloat(String(boletoForm.valor).replace(",", "."));
    if (isNaN(valor) || valor <= 0) {
      addToast("Valor inválido.", "error");
      return;
    }

    const cliente = (clients || []).find((c) => c.id === boletoForm.clienteId);

    if (editingBoleto) {
      const updated = {
        ...editingBoleto,
        clienteId: boletoForm.clienteId,
        clienteNome: cliente?.nome || "—",
        valor,
        vencimento: boletoForm.vencimento + "T00:00:00.000Z",
        observacoes: boletoForm.observacoes,
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:boleto:" + updated.id, updated);
      addToast("Boleto atualizado.", "success");
    } else {
      const numero = getNextNumber("BOL", boletos);
      const newBoleto = {
        id: genId(),
        numero,
        clienteId: boletoForm.clienteId,
        clienteNome: cliente?.nome || "—",
        valor,
        vencimento: boletoForm.vencimento + "T00:00:00.000Z",
        status: "aberto",
        observacoes: boletoForm.observacoes,
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:boleto:" + newBoleto.id, newBoleto);
      addToast(`Boleto ${numero} gerado.`, "success");
    }

    setBoletoModalOpen(false);
    loadData();
  }, [boletoForm, editingBoleto, boletos, clients, loadData, addToast]);

  const handleMarkPaid = useCallback((boleto) => {
    const updated = { ...boleto, status: "pago", dataPagamento: new Date().toISOString(), updatedAt: new Date().toISOString() };
    DB.set("erp:boleto:" + updated.id, updated);

    // Create financial entry
    const finId = genId();
    const finEntry = {
      id: finId,
      numero: "REC-" + boleto.numero,
      descricao: `Pagamento boleto ${boleto.numero} - ${boleto.clienteNome}`,
      valor: boleto.valor,
      tipo: "receita",
      categoria: "Boleto",
      data: new Date().toISOString(),
      status: "pago",
      formaPagamento: "Boleto",
      observacoes: boleto.observacoes || "",
      osId: null,
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:finance:" + finId, finEntry);

    addToast(`Boleto ${boleto.numero} marcado como pago.`, "success");
    loadData();
  }, [loadData, addToast]);

  const handlePrintBoleto = useCallback((bol) => {
    setPrintBoleto(bol);
    setTimeout(() => window.print(), 300);
  }, []);

  const handleDeleteInvoice = useCallback((row) => {
    setConfirmDelete({ type: activeTab === "nf" ? "nf" : "boleto", item: row });
  }, [activeTab]);

  const confirmDeleteAction = useCallback(() => {
    if (!confirmDelete) return;
    if (confirmDelete.type === "nf") {
      DB.delete("erp:invoice:" + confirmDelete.item.id);
    } else {
      DB.delete("erp:boleto:" + confirmDelete.item.id);
    }
    addToast("Registro excluído.", "success");
    setConfirmDelete(null);
    loadData();
  }, [confirmDelete, loadData, addToast]);

  const nfColumns = [
    { key: "numero", label: "Número", width: "w-24" },
    { key: "clienteNome", label: "Cliente" },
    { key: "data", label: "Data", render: (v) => formatDate(v) },
    { key: "valor", label: "Valor", render: (v) => formatCurrency(v) },
    {
      key: "status", label: "Status",
      render: (v) => {
        const colors = { emitida: "bg-green-500", cancelada: "bg-red-500", pendente: "bg-yellow-500" };
        const labels = { emitida: "Emitida", cancelada: "Cancelada", pendente: "Pendente" };
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${colors[v] || "bg-gray-500"}`}>
            {labels[v] || v}
          </span>
        );
      },
    },
  ];

  const boletoColumns = [
    { key: "numero", label: "Número", width: "w-24" },
    { key: "clienteNome", label: "Cliente" },
    { key: "valor", label: "Valor", render: (v) => formatCurrency(v) },
    { key: "vencimento", label: "Vencimento", render: (v) => formatDate(v) },
    {
      key: "status", label: "Status",
      render: (v) => {
        const colors = { aberto: "bg-yellow-500", pago: "bg-green-500", vencido: "bg-red-500", cancelado: "bg-gray-500" };
        const labels = { aberto: "Aberto", pago: "Pago", vencido: "Vencido", cancelado: "Cancelado" };
        return (
          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${colors[v] || "bg-gray-500"}`}>
            {labels[v] || v}
          </span>
        );
      },
    },
  ];

  const totals = calcNFTotals(nfForm);
  const canManage = user.role === "admin" || user.role === "gerente";

  return (
    <div className="space-y-6">
      <PrintableInvoice invoice={printInvoice} config={config} />
      <PrintableBoleto boleto={printBoleto} config={config} />

      <div className="flex items-center justify-between no-print">
        <div>
          <h2 className="text-2xl font-bold text-white">Faturamento</h2>
          <p className="text-gray-400 text-sm mt-1">Notas fiscais e boletos</p>
        </div>
        <div className="flex gap-2">
          {activeTab === "nf" ? (
            <button onClick={openCreateNF} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Nova NF
            </button>
          ) : (
            <button onClick={openCreateBoleto} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Novo Boleto
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-800 rounded-lg p-1 border border-gray-700 no-print">
        <button
          onClick={() => setActiveTab("nf")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition ${activeTab === "nf" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
        >
          Notas Fiscais ({invoices.length})
        </button>
        <button
          onClick={() => setActiveTab("boletos")}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition ${activeTab === "boletos" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
        >
          Boletos ({boletos.length})
        </button>
      </div>

      {/* Search */}
      <div className="flex-1 min-w-[200px] max-w-sm no-print">
        <SearchInput value={search} onChange={setSearch} placeholder={activeTab === "nf" ? "Buscar NF..." : "Buscar boleto..."} />
      </div>

      {/* NF Tab */}
      {activeTab === "nf" && (
        <div className="no-print">
          <DataTable
            columns={nfColumns}
            data={filteredInvoices}
            onEdit={openEditNF}
            onDelete={canManage ? handleDeleteInvoice : undefined}
            actions={(row) => (
              <>
                <button onClick={() => handlePrintNF(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition" title="Imprimir">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                </button>
                {row.status === "emitida" && canManage && (
                  <button onClick={() => handleCancelNF(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition" title="Cancelar NF">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" /></svg>
                  </button>
                )}
              </>
            )}
            emptyMessage="Nenhuma nota fiscal encontrada."
          />
        </div>
      )}

      {/* Boletos Tab */}
      {activeTab === "boletos" && (
        <div className="no-print">
          <DataTable
            columns={boletoColumns}
            data={filteredBoletos}
            onEdit={openEditBoleto}
            onDelete={canManage ? handleDeleteInvoice : undefined}
            actions={(row) => (
              <>
                <button onClick={() => handlePrintBoleto(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition" title="Imprimir">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 17h2a2 2 0 002-2v-4a2 2 0 00-2-2H5a2 2 0 00-2 2v4a2 2 0 002 2h2m2 4h6a2 2 0 002-2v-4a2 2 0 00-2-2H9a2 2 0 00-2 2v4a2 2 0 002 2zm8-12V5a2 2 0 00-2-2H9a2 2 0 00-2 2v4h10z" /></svg>
                </button>
                {(row.status === "aberto" || row.status === "vencido") && (
                  <button onClick={() => handleMarkPaid(row)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition" title="Marcar como pago">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                  </button>
                )}
              </>
            )}
            emptyMessage="Nenhum boleto encontrado."
          />
        </div>
      )}

      {/* NF Modal */}
      <Modal isOpen={modalOpen} title={editing ? "Editar Nota Fiscal" : "Nova Nota Fiscal"} onClose={() => setModalOpen(false)} size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Cliente *</label>
            <select
              value={nfForm.clienteId}
              onChange={(e) => setNfForm({ ...nfForm, clienteId: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
            >
              <option value="">Selecione um cliente...</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-sm font-medium text-gray-300">Itens *</label>
              <button onClick={addNFItem} className="text-xs text-blue-400 hover:text-blue-300 transition">+ Adicionar item</button>
            </div>
            <div className="space-y-2">
              {nfForm.itens.map((item, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input
                    type="text"
                    value={item.descricao}
                    onChange={(e) => updateNFItem(idx, "descricao", e.target.value)}
                    placeholder="Descrição"
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                  <input
                    type="number"
                    min="1"
                    value={item.quantidade}
                    onChange={(e) => updateNFItem(idx, "quantidade", e.target.value)}
                    placeholder="Qtd"
                    className="w-20 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={item.valorUnitario}
                    onChange={(e) => updateNFItem(idx, "valorUnitario", e.target.value)}
                    placeholder="Valor unit."
                    className="w-32 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                  <span className="text-gray-400 text-sm w-24 text-right">
                    {formatCurrency((parseFloat(item.quantidade) || 0) * (parseFloat(String(item.valorUnitario).replace(",", ".")) || 0))}
                  </span>
                  {nfForm.itens.length > 1 && (
                    <button onClick={() => removeNFItem(idx)} className="p-1 text-red-400 hover:text-red-300">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">ISS %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={nfForm.issPercent}
                onChange={(e) => setNfForm({ ...nfForm, issPercent: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">ICMS %</label>
              <input
                type="number"
                step="0.1"
                min="0"
                value={nfForm.icmsPercent}
                onChange={(e) => setNfForm({ ...nfForm, icmsPercent: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Desconto (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={nfForm.desconto}
                onChange={(e) => setNfForm({ ...nfForm, desconto: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          {/* Totals summary */}
          <div className="bg-gray-700/30 rounded-lg p-4 space-y-1">
            <div className="flex justify-between text-sm"><span className="text-gray-400">Subtotal:</span><span className="text-white">{formatCurrency(totals.subtotal)}</span></div>
            {totals.issValor > 0 && <div className="flex justify-between text-sm"><span className="text-gray-400">ISS ({nfForm.issPercent}%):</span><span className="text-white">{formatCurrency(totals.issValor)}</span></div>}
            {totals.icmsValor > 0 && <div className="flex justify-between text-sm"><span className="text-gray-400">ICMS ({nfForm.icmsPercent}%):</span><span className="text-white">{formatCurrency(totals.icmsValor)}</span></div>}
            {totals.desconto > 0 && <div className="flex justify-between text-sm"><span className="text-gray-400">Desconto:</span><span className="text-red-400">-{formatCurrency(totals.desconto)}</span></div>}
            <div className="flex justify-between text-sm font-bold border-t border-gray-600 pt-2 mt-2"><span className="text-gray-300">Total:</span><span className="text-white text-lg">{formatCurrency(totals.total)}</span></div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
            <textarea
              value={nfForm.observacoes}
              onChange={(e) => setNfForm({ ...nfForm, observacoes: e.target.value })}
              rows={2}
              placeholder="Observações..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
            <button onClick={handleSaveNF} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              {editing ? "Salvar Alterações" : "Emitir Nota Fiscal"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Boleto Modal */}
      <Modal isOpen={boletoModalOpen} title={editingBoleto ? "Editar Boleto" : "Novo Boleto"} onClose={() => setBoletoModalOpen(false)} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Cliente *</label>
            <select
              value={boletoForm.clienteId}
              onChange={(e) => setBoletoForm({ ...boletoForm, clienteId: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
            >
              <option value="">Selecione um cliente...</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Valor (R$) *</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={boletoForm.valor}
                onChange={(e) => setBoletoForm({ ...boletoForm, valor: e.target.value })}
                placeholder="0,00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Vencimento *</label>
              <input
                type="date"
                value={boletoForm.vencimento}
                onChange={(e) => setBoletoForm({ ...boletoForm, vencimento: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
            <textarea
              value={boletoForm.observacoes}
              onChange={(e) => setBoletoForm({ ...boletoForm, observacoes: e.target.value })}
              rows={2}
              placeholder="Referência, detalhes..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setBoletoModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
            <button onClick={handleSaveBoleto} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              {editingBoleto ? "Salvar Alterações" : "Gerar Boleto"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Tem certeza que deseja excluir "${confirmDelete.item.numero}"?`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── PDV MODULE ─────────────────────────────────────────────────────────────

function PDVModule({ user, addToast, inventory, reloadData }) {
  const [cart, setCart] = useState([]);
  const [searchTerm, setSearchTerm] = useState("");
  const [showDropdown, setShowDropdown] = useState(false);
  const [discount, setDiscount] = useState("");
  const [discountType, setDiscountType] = useState("percent");
  const [paymentMethod, setPaymentMethod] = useState("PIX");
  const [valorRecebido, setValorRecebido] = useState("");
  const [todaySales, setTodaySales] = useState([]);
  const dropdownRef = useRef(null);

  const inventoryItems = useMemo(() => {
    return (inventory || DB.list("erp:inventory:")).filter((i) => i.quantidade > 0);
  }, [inventory]);

  const loadTodaySales = useCallback(() => {
    const all = DB.list("erp:pdv:");
    const today = toISODate(new Date());
    setTodaySales(all.filter((s) => s.data && s.data.startsWith(today)).sort((a, b) => new Date(b.data) - new Date(a.data)));
  }, []);

  useEffect(() => { loadTodaySales(); }, [loadTodaySales]);

  const searchResults = useMemo(() => {
    if (!searchTerm.trim()) return [];
    const s = searchTerm.toLowerCase();
    return inventoryItems
      .filter((i) => (i.nome || "").toLowerCase().includes(s) || (i.sku || "").toLowerCase().includes(s))
      .slice(0, 8);
  }, [searchTerm, inventoryItems]);

  const addToCart = useCallback((item) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.itemId === item.id);
      if (existing) {
        if (existing.quantidade >= item.quantidade) {
          addToast("Quantidade máxima em estoque atingida.", "warning");
          return prev;
        }
        return prev.map((c) =>
          c.itemId === item.id ? { ...c, quantidade: c.quantidade + 1 } : c
        );
      }
      return [...prev, {
        itemId: item.id,
        nome: item.nome,
        sku: item.sku,
        precoUnitario: item.precoVenda || 0,
        quantidade: 1,
        estoqueDisponivel: item.quantidade,
      }];
    });
    setSearchTerm("");
    setShowDropdown(false);
  }, [addToast]);

  const updateCartQty = useCallback((itemId, delta) => {
    setCart((prev) => prev.map((c) => {
      if (c.itemId !== itemId) return c;
      const newQty = c.quantidade + delta;
      if (newQty <= 0) return null;
      if (newQty > c.estoqueDisponivel) {
        addToast("Estoque insuficiente.", "warning");
        return c;
      }
      return { ...c, quantidade: newQty };
    }).filter(Boolean));
  }, [addToast]);

  const removeFromCart = useCallback((itemId) => {
    setCart((prev) => prev.filter((c) => c.itemId !== itemId));
  }, []);

  const subtotal = useMemo(() => cart.reduce((s, c) => s + c.precoUnitario * c.quantidade, 0), [cart]);

  const discountValue = useMemo(() => {
    const d = parseFloat(String(discount).replace(",", ".")) || 0;
    if (discountType === "percent") return subtotal * (d / 100);
    return d;
  }, [subtotal, discount, discountType]);

  const total = useMemo(() => Math.max(0, subtotal - discountValue), [subtotal, discountValue]);

  const troco = useMemo(() => {
    if (paymentMethod !== "Dinheiro") return 0;
    const recebido = parseFloat(String(valorRecebido).replace(",", ".")) || 0;
    return Math.max(0, recebido - total);
  }, [paymentMethod, valorRecebido, total]);

  const finalizeSale = useCallback(() => {
    if (cart.length === 0) {
      addToast("Adicione itens ao carrinho.", "error");
      return;
    }

    if (paymentMethod === "Dinheiro") {
      const recebido = parseFloat(String(valorRecebido).replace(",", ".")) || 0;
      if (recebido < total) {
        addToast("Valor recebido insuficiente.", "error");
        return;
      }
    }

    // Create PDV record
    const saleId = genId();
    const allSales = DB.list("erp:pdv:");
    const numero = getNextNumber("PDV", allSales);

    const sale = {
      id: saleId,
      numero,
      itens: cart.map((c) => ({
        itemId: c.itemId,
        nome: c.nome,
        sku: c.sku,
        precoUnitario: c.precoUnitario,
        quantidade: c.quantidade,
        subtotal: c.precoUnitario * c.quantidade,
      })),
      subtotal,
      desconto: discountValue,
      total,
      formaPagamento: paymentMethod,
      valorRecebido: paymentMethod === "Dinheiro" ? parseFloat(String(valorRecebido).replace(",", ".")) || 0 : total,
      troco: paymentMethod === "Dinheiro" ? troco : 0,
      vendedor: user.nome,
      data: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:pdv:" + saleId, sale);

    // Deduct inventory
    cart.forEach((c) => {
      const item = DB.get("erp:inventory:" + c.itemId);
      if (item) {
        const updated = { ...item, quantidade: Math.max(0, item.quantidade - c.quantidade), updatedAt: new Date().toISOString() };
        DB.set("erp:inventory:" + item.id, updated);

        // Record movement
        const movements = DB.get("erp:inventory:movements:" + item.id) || [];
        movements.push({
          id: genId(),
          itemId: item.id,
          itemNome: item.nome,
          tipo: "saida",
          quantidade: c.quantidade,
          quantidadeAnterior: item.quantidade,
          quantidadeNova: updated.quantidade,
          motivo: `Venda PDV ${numero}`,
          usuario: user.nome,
          data: new Date().toISOString(),
        });
        DB.set("erp:inventory:movements:" + item.id, movements);
      }
    });

    // Create financial entry
    const finId = genId();
    DB.set("erp:finance:" + finId, {
      id: finId,
      numero: "VND-" + numero,
      descricao: `Venda PDV ${numero}`,
      valor: total,
      tipo: "receita",
      categoria: "Venda de Equipamento",
      data: new Date().toISOString(),
      status: "pago",
      formaPagamento: paymentMethod,
      observacoes: `${cart.length} item(ns) vendido(s)`,
      osId: null,
      createdAt: new Date().toISOString(),
    });

    addToast(`Venda ${numero} finalizada! Total: ${formatCurrency(total)}`, "success");

    // Reset
    setCart([]);
    setDiscount("");
    setValorRecebido("");
    loadTodaySales();
    if (reloadData) reloadData();
  }, [cart, subtotal, discountValue, total, paymentMethod, valorRecebido, troco, user, addToast, loadTodaySales, reloadData]);

  // Daily summary
  const dailySummary = useMemo(() => {
    const totalVendas = todaySales.reduce((s, sale) => s + (sale.total || 0), 0);
    const qtdVendas = todaySales.length;
    const ticketMedio = qtdVendas > 0 ? totalVendas / qtdVendas : 0;
    return { totalVendas, qtdVendas, ticketMedio };
  }, [todaySales]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Ponto de Venda</h2>
          <p className="text-gray-400 text-sm mt-1">PDV - Vendas rápidas</p>
        </div>
      </div>

      {/* Daily Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <KPICard title="Total Vendas Hoje" value={formatCurrency(dailySummary.totalVendas)} icon="💰" />
        <KPICard title="Ticket Médio" value={formatCurrency(dailySummary.ticketMedio)} icon="📊" />
        <KPICard title="Qtd Vendas" value={dailySummary.qtdVendas} icon="🛒" />
      </div>

      {/* POS Interface */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Product Search + Cart */}
        <div className="lg:col-span-2 space-y-4">
          {/* Product Search */}
          <div className="relative" ref={dropdownRef}>
            <div className="relative">
              <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setShowDropdown(true); }}
                onFocus={() => setShowDropdown(true)}
                placeholder="Buscar produto por nome ou SKU..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-3 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition text-sm"
              />
            </div>
            {showDropdown && searchResults.length > 0 && (
              <div className="absolute z-20 w-full mt-1 bg-gray-800 border border-gray-600 rounded-lg shadow-xl max-h-64 overflow-y-auto">
                {searchResults.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => addToCart(item)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-gray-700 transition text-left border-b border-gray-700/50 last:border-0"
                  >
                    <div>
                      <p className="text-white text-sm font-medium">{item.nome}</p>
                      <p className="text-gray-400 text-xs">{item.sku} | Estoque: {item.quantidade}</p>
                    </div>
                    <span className="text-green-400 font-semibold text-sm">{formatCurrency(item.precoVenda)}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Cart */}
          <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-700">
              <h3 className="text-white font-semibold text-sm">Carrinho ({cart.length} itens)</h3>
            </div>
            {cart.length === 0 ? (
              <div className="p-8 text-center">
                <p className="text-gray-500 text-sm">Busque e adicione produtos ao carrinho</p>
              </div>
            ) : (
              <div className="divide-y divide-gray-700/50">
                {cart.map((item) => (
                  <div key={item.itemId} className="flex items-center gap-3 px-4 py-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-white text-sm font-medium truncate">{item.nome}</p>
                      <p className="text-gray-400 text-xs">{item.sku} | {formatCurrency(item.precoUnitario)} un</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => updateCartQty(item.itemId, -1)}
                        className="w-7 h-7 rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 flex items-center justify-center transition text-sm"
                      >
                        -
                      </button>
                      <span className="text-white font-medium text-sm w-8 text-center">{item.quantidade}</span>
                      <button
                        onClick={() => updateCartQty(item.itemId, 1)}
                        className="w-7 h-7 rounded-md bg-gray-700 text-gray-300 hover:bg-gray-600 flex items-center justify-center transition text-sm"
                      >
                        +
                      </button>
                    </div>
                    <span className="text-white font-semibold text-sm w-24 text-right">
                      {formatCurrency(item.precoUnitario * item.quantidade)}
                    </span>
                    <button
                      onClick={() => removeFromCart(item.itemId)}
                      className="p-1 text-gray-400 hover:text-red-400 transition"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Totals + Payment */}
        <div className="space-y-4">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
            <h3 className="text-white font-semibold">Resumo</h3>

            <div className="space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Subtotal:</span>
                <span className="text-white">{formatCurrency(subtotal)}</span>
              </div>

              {/* Discount */}
              <div>
                <label className="block text-xs text-gray-400 mb-1">Desconto</label>
                <div className="flex gap-1">
                  <input
                    type="number"
                    min="0"
                    value={discount}
                    onChange={(e) => setDiscount(e.target.value)}
                    placeholder="0"
                    className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                  <button
                    onClick={() => setDiscountType(discountType === "percent" ? "value" : "percent")}
                    className="px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-sm text-gray-300 hover:bg-gray-600 transition min-w-[40px]"
                  >
                    {discountType === "percent" ? "%" : "R$"}
                  </button>
                </div>
                {discountValue > 0 && (
                  <p className="text-xs text-red-400 mt-1">-{formatCurrency(discountValue)}</p>
                )}
              </div>

              <div className="flex justify-between text-lg font-bold border-t border-gray-700 pt-3 mt-3">
                <span className="text-gray-300">Total:</span>
                <span className="text-green-400">{formatCurrency(total)}</span>
              </div>
            </div>

            {/* Payment Method */}
            <div>
              <label className="block text-xs text-gray-400 mb-2">Forma de Pagamento</label>
              <div className="grid grid-cols-2 gap-1.5">
                {["PIX", "Cartão Crédito", "Cartão Débito", "Dinheiro", "Boleto"].map((method) => (
                  <button
                    key={method}
                    onClick={() => setPaymentMethod(method)}
                    className={`py-2 px-2 rounded-lg text-xs font-medium transition ${
                      paymentMethod === method
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-300 hover:bg-gray-600"
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </div>

            {/* Cash change */}
            {paymentMethod === "Dinheiro" && (
              <div className="space-y-2">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Valor Recebido (R$)</label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    value={valorRecebido}
                    onChange={(e) => setValorRecebido(e.target.value)}
                    placeholder="0,00"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                {troco > 0 && (
                  <div className="flex justify-between text-sm bg-green-500/10 border border-green-500/20 rounded-lg p-2">
                    <span className="text-green-400">Troco:</span>
                    <span className="text-green-400 font-bold">{formatCurrency(troco)}</span>
                  </div>
                )}
              </div>
            )}

            {/* Finalize */}
            <button
              onClick={finalizeSale}
              disabled={cart.length === 0}
              className="w-full py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 transition disabled:opacity-40 disabled:cursor-not-allowed text-sm"
            >
              Finalizar Venda - {formatCurrency(total)}
            </button>
          </div>
        </div>
      </div>

      {/* Today's Sales History */}
      {todaySales.length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700">
            <h3 className="text-white font-semibold text-sm">Vendas de Hoje</h3>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-700">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Nº</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Hora</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Itens</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase">Pagamento</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {todaySales.map((sale) => (
                  <tr key={sale.id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3 text-gray-300">{sale.numero}</td>
                    <td className="px-4 py-3 text-gray-300">{new Date(sale.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</td>
                    <td className="px-4 py-3 text-gray-300">{(sale.itens || []).length} item(ns)</td>
                    <td className="px-4 py-3 text-gray-300">{sale.formaPagamento}</td>
                    <td className="px-4 py-3 text-green-400 font-medium text-right">{formatCurrency(sale.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── WEBDESK MODULE ─────────────────────────────────────────────────────────

function WebdeskModule({ user, dateFilter, addToast, clients }) {
  const [tickets, setTickets] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterPriority, setFilterPriority] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");
  const [replyText, setReplyText] = useState("");

  const TICKET_CATEGORIES = ["Instalação", "Manutenção", "Garantia", "Dúvida", "Reclamação"];
  const PRIORITIES = ["baixa", "media", "alta", "urgente"];
  const PRIORITY_COLORS = {
    baixa: "bg-green-500",
    media: "bg-yellow-500",
    alta: "bg-orange-500",
    urgente: "bg-red-500",
  };
  const PRIORITY_LABELS = {
    baixa: "Baixa",
    media: "Média",
    alta: "Alta",
    urgente: "Urgente",
  };

  const loadTickets = useCallback(() => {
    setTickets(DB.list("erp:ticket:"));
  }, []);

  useEffect(() => { loadTickets(); }, [loadTickets]);

  const emptyForm = {
    clienteId: "", assunto: "", categoria: "Dúvida", prioridade: "media", mensagemInicial: "",
  };
  const [form, setForm] = useState(emptyForm);

  const filteredTickets = useMemo(() => {
    let list = filterByDate(tickets, "dataAbertura", dateFilter);
    if (filterStatus !== "all") list = list.filter((t) => t.status === filterStatus);
    if (filterPriority !== "all") list = list.filter((t) => t.prioridade === filterPriority);
    if (filterCategory !== "all") list = list.filter((t) => t.categoria === filterCategory);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.numero || "").toLowerCase().includes(s) ||
          (t.assunto || "").toLowerCase().includes(s) ||
          (t.clienteNome || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.dataAbertura) - new Date(a.dataAbertura));
  }, [tickets, dateFilter, filterStatus, filterPriority, filterCategory, search]);

  const stats = useMemo(() => ({
    total: tickets.length,
    abertos: tickets.filter((t) => t.status === "aberto").length,
    em_andamento: tickets.filter((t) => t.status === "em_andamento").length,
    resolvidos: tickets.filter((t) => t.status === "resolvido" || t.status === "fechado").length,
  }), [tickets]);

  const openCreate = useCallback(() => {
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.clienteId || !form.assunto.trim()) {
      addToast("Preencha cliente e assunto.", "error");
      return;
    }

    const cliente = (clients || []).find((c) => c.id === form.clienteId);
    const numero = getNextNumber("TK", tickets);

    const newTicket = {
      id: genId(),
      numero,
      assunto: form.assunto.trim(),
      clienteId: form.clienteId,
      clienteNome: cliente?.nome || "—",
      categoria: form.categoria,
      prioridade: form.prioridade,
      status: "aberto",
      dataAbertura: new Date().toISOString(),
      responsavelId: null,
      responsavelNome: null,
      mensagens: form.mensagemInicial.trim() ? [{
        id: genId(),
        autor: cliente?.nome || "Cliente",
        tipo: "cliente",
        texto: form.mensagemInicial.trim(),
        data: new Date().toISOString(),
      }] : [],
      createdAt: new Date().toISOString(),
    };

    DB.set("erp:ticket:" + newTicket.id, newTicket);
    addToast(MSG_TEMPLATES.ticket_aberto(numero), "success");
    setModalOpen(false);
    loadTickets();
  }, [form, tickets, clients, loadTickets, addToast]);

  const handleReply = useCallback(() => {
    if (!replyText.trim() || !selectedTicket) return;

    const msg = {
      id: genId(),
      autor: user.nome,
      tipo: "staff",
      texto: replyText.trim(),
      data: new Date().toISOString(),
    };

    const updated = {
      ...selectedTicket,
      mensagens: [...(selectedTicket.mensagens || []), msg],
      updatedAt: new Date().toISOString(),
    };

    if (updated.status === "aberto") {
      updated.status = "em_andamento";
      updated.responsavelId = user.id;
      updated.responsavelNome = user.nome;
    }

    DB.set("erp:ticket:" + updated.id, updated);
    setSelectedTicket(updated);
    setReplyText("");
    loadTickets();
    addToast("Resposta enviada.", "success");
  }, [replyText, selectedTicket, user, loadTickets, addToast]);

  const changeTicketStatus = useCallback((status) => {
    if (!selectedTicket) return;
    const updated = {
      ...selectedTicket,
      status,
      updatedAt: new Date().toISOString(),
    };
    if (status === "resolvido" || status === "fechado") {
      updated.dataFechamento = new Date().toISOString();
    }
    DB.set("erp:ticket:" + updated.id, updated);
    setSelectedTicket(updated);
    loadTickets();
    addToast(`Ticket atualizado para ${STATUS_MAP[status]?.label || status}.`, "success");
  }, [selectedTicket, loadTickets, addToast]);

  // Detail view
  if (selectedTicket) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setSelectedTicket(null)}
            className="p-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
          </button>
          <div className="flex-1">
            <h2 className="text-xl font-bold text-white">{selectedTicket.numero} - {selectedTicket.assunto}</h2>
            <p className="text-gray-400 text-sm">{selectedTicket.clienteNome} | {selectedTicket.categoria} | Aberto em {formatDateTime(selectedTicket.dataAbertura)}</p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${PRIORITY_COLORS[selectedTicket.prioridade] || "bg-gray-500"}`}>
              {PRIORITY_LABELS[selectedTicket.prioridade] || selectedTicket.prioridade}
            </span>
            <StatusBadge status={selectedTicket.status} />
          </div>
        </div>

        {/* Status Buttons */}
        <div className="flex flex-wrap gap-2">
          {selectedTicket.status !== "aberto" && (
            <button onClick={() => changeTicketStatus("aberto")} className="px-3 py-1.5 text-xs rounded-lg bg-yellow-600 text-white hover:bg-yellow-700 transition">Reabrir</button>
          )}
          {selectedTicket.status !== "em_andamento" && selectedTicket.status !== "resolvido" && selectedTicket.status !== "fechado" && (
            <button onClick={() => changeTicketStatus("em_andamento")} className="px-3 py-1.5 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">Em Andamento</button>
          )}
          {selectedTicket.status !== "resolvido" && selectedTicket.status !== "fechado" && (
            <button onClick={() => changeTicketStatus("resolvido")} className="px-3 py-1.5 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 transition">Resolver</button>
          )}
          {selectedTicket.status !== "fechado" && (
            <button onClick={() => changeTicketStatus("fechado")} className="px-3 py-1.5 text-xs rounded-lg bg-gray-600 text-white hover:bg-gray-700 transition">Fechar</button>
          )}
        </div>

        {/* Timeline / Messages */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Conversa</h3>
          <div className="space-y-4 max-h-[400px] overflow-y-auto mb-4">
            {(selectedTicket.mensagens || []).length === 0 ? (
              <p className="text-gray-500 text-sm text-center py-4">Nenhuma mensagem ainda.</p>
            ) : (
              (selectedTicket.mensagens || []).map((msg) => {
                const isStaff = msg.tipo === "staff";
                return (
                  <div key={msg.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] rounded-xl p-3 ${isStaff ? "bg-blue-600/20 border border-blue-500/30" : "bg-gray-700/50 border border-gray-600/30"}`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs font-medium ${isStaff ? "text-blue-400" : "text-gray-400"}`}>{msg.autor}</span>
                        <span className="text-gray-500 text-xs">{formatDateTime(msg.data)}</span>
                      </div>
                      <p className="text-gray-200 text-sm whitespace-pre-wrap">{msg.texto}</p>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* Reply */}
          {selectedTicket.status !== "fechado" && (
            <div className="flex gap-2 border-t border-gray-700 pt-4">
              <textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                rows={2}
                placeholder="Digite sua resposta..."
                className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none text-sm"
              />
              <button
                onClick={handleReply}
                disabled={!replyText.trim()}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition disabled:opacity-40 disabled:cursor-not-allowed text-sm self-end"
              >
                Enviar
              </button>
            </div>
          )}
        </div>
      </div>
    );
  }

  const columns = [
    { key: "numero", label: "Nº", width: "w-20" },
    { key: "clienteNome", label: "Cliente" },
    { key: "assunto", label: "Assunto" },
    { key: "categoria", label: "Categoria" },
    {
      key: "prioridade", label: "Prioridade",
      render: (v) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${PRIORITY_COLORS[v] || "bg-gray-500"}`}>
          {PRIORITY_LABELS[v] || v}
        </span>
      ),
    },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
    { key: "dataAbertura", label: "Abertura", render: (v) => formatDate(v) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Webdesk</h2>
          <p className="text-gray-400 text-sm mt-1">Central de atendimento e tickets</p>
        </div>
        <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Novo Ticket
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        <KPICard title="Total Tickets" value={stats.total} icon="🎫" />
        <KPICard title="Abertos" value={stats.abertos} icon="📬" />
        <KPICard title="Em Andamento" value={stats.em_andamento} icon="🔄" />
        <KPICard title="Resolvidos" value={stats.resolvidos} icon="✅" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar ticket..." />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todos status</option>
          <option value="aberto">Aberto</option>
          <option value="em_andamento">Em Andamento</option>
          <option value="resolvido">Resolvido</option>
          <option value="fechado">Fechado</option>
        </select>
        <select
          value={filterPriority}
          onChange={(e) => setFilterPriority(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todas prioridades</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
          ))}
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todas categorias</option>
          {TICKET_CATEGORIES.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filteredTickets}
        actions={(row) => (
          <button
            onClick={() => { setSelectedTicket(row); setReplyText(""); }}
            className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition"
            title="Ver detalhes"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </button>
        )}
        emptyMessage="Nenhum ticket encontrado."
      />

      {/* Create Modal */}
      <Modal isOpen={modalOpen} title="Novo Ticket" onClose={() => setModalOpen(false)} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Cliente *</label>
            <select
              value={form.clienteId}
              onChange={(e) => setForm({ ...form, clienteId: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
            >
              <option value="">Selecione um cliente...</option>
              {(clients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Assunto *</label>
            <input
              type="text"
              value={form.assunto}
              onChange={(e) => setForm({ ...form, assunto: e.target.value })}
              placeholder="Resumo do ticket"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
              <select
                value={form.categoria}
                onChange={(e) => setForm({ ...form, categoria: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {TICKET_CATEGORIES.map((c) => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Prioridade</label>
              <select
                value={form.prioridade}
                onChange={(e) => setForm({ ...form, prioridade: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>{PRIORITY_LABELS[p]}</option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Mensagem Inicial</label>
            <textarea
              value={form.mensagemInicial}
              onChange={(e) => setForm({ ...form, mensagemInicial: e.target.value })}
              rows={4}
              placeholder="Descreva o problema ou solicitação..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
            <button onClick={handleSave} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">Abrir Ticket</button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── PROCESS MODULE (OS) ────────────────────────────────────────────────────

function ProcessModule({ user, dateFilter, addToast, clients, employees }) {
  const [orders, setOrders] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterTecnico, setFilterTecnico] = useState("all");
  const [viewMode, setViewMode] = useState("lista");

  const SERVICE_TYPES = ["Instalação", "Manutenção", "Higienização", "Reparo", "Desinstalação"];
  const STATUS_FLOW = ["aguardando", "em_deslocamento", "em_execucao", "finalizado", "faturado"];
  const STATUS_LABELS_OS = {
    aguardando: "Aguardando",
    em_deslocamento: "Em Deslocamento",
    em_execucao: "Em Execução",
    finalizado: "Finalizado",
    faturado: "Faturado",
  };
  const STATUS_COLORS_OS = {
    aguardando: "bg-yellow-500",
    em_deslocamento: "bg-cyan-500",
    em_execucao: "bg-blue-500",
    finalizado: "bg-green-500",
    faturado: "bg-purple-500",
  };

  const tecnicos = useMemo(() => (employees || []).filter((e) => e.tipo === "tecnico" && e.status === "ativo"), [employees]);

  const loadOrders = useCallback(() => {
    setOrders(DB.list("erp:services:"));
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  const emptyForm = {
    clienteId: "", endereco: "", tipo: "Instalação",
    equipamentoModelo: "", equipamentoBTUs: "",
    tecnicoId: "", dataAgendada: toISODate(new Date()), observacoes: "", valor: "",
  };
  const [form, setForm] = useState(emptyForm);

  const filteredOrders = useMemo(() => {
    let list = filterByDate(orders, "dataAbertura", dateFilter);

    // Technician can only see their own
    if (user.role === "tecnico") {
      list = list.filter((os) => os.tecnicoId === user.id || os.tecnicoNome === user.nome);
    }

    if (filterStatus !== "all") list = list.filter((os) => os.status === filterStatus);
    if (filterTecnico !== "all") list = list.filter((os) => os.tecnicoId === filterTecnico);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (os) =>
          (os.numero || "").toLowerCase().includes(s) ||
          (os.clienteNome || "").toLowerCase().includes(s) ||
          (os.tipo || "").toLowerCase().includes(s) ||
          (os.tecnicoNome || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.dataAbertura) - new Date(a.dataAbertura));
  }, [orders, dateFilter, filterStatus, filterTecnico, search, user]);

  const stats = useMemo(() => ({
    total: filteredOrders.length,
    aguardando: filteredOrders.filter((os) => os.status === "aguardando").length,
    em_deslocamento: filteredOrders.filter((os) => os.status === "em_deslocamento").length,
    em_execucao: filteredOrders.filter((os) => os.status === "em_execucao").length,
    finalizado: filteredOrders.filter((os) => os.status === "finalizado").length,
    faturado: filteredOrders.filter((os) => os.status === "faturado").length,
  }), [filteredOrders]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((row) => {
    setEditing(row);
    setForm({
      clienteId: row.clienteId || "",
      endereco: row.endereco || "",
      tipo: row.tipo || "Instalação",
      equipamentoModelo: row.equipamentoModelo || "",
      equipamentoBTUs: row.equipamentoBTUs || "",
      tecnicoId: row.tecnicoId || "",
      dataAgendada: row.dataAgendada ? row.dataAgendada.split("T")[0] : toISODate(new Date()),
      observacoes: row.observacoes || "",
      valor: row.valor || "",
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.clienteId || !form.tipo) {
      addToast("Preencha os campos obrigatórios.", "error");
      return;
    }

    const cliente = (clients || []).find((c) => c.id === form.clienteId);
    const tecnico = tecnicos.find((t) => t.id === form.tecnicoId);
    const valor = parseFloat(String(form.valor).replace(",", ".")) || 0;

    if (editing) {
      const updated = {
        ...editing,
        clienteId: form.clienteId,
        clienteNome: cliente?.nome || "—",
        endereco: form.endereco,
        tipo: form.tipo,
        equipamentoModelo: form.equipamentoModelo,
        equipamentoBTUs: form.equipamentoBTUs,
        tecnicoId: form.tecnicoId,
        tecnicoNome: tecnico?.nome || "—",
        dataAgendada: form.dataAgendada + "T00:00:00.000Z",
        observacoes: form.observacoes,
        valor,
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:services:" + updated.id, updated);
      addToast("OS atualizada.", "success");
    } else {
      const numero = getNextNumber("OS", orders);
      const newOS = {
        id: genId(),
        numero,
        clienteId: form.clienteId,
        clienteNome: cliente?.nome || "—",
        endereco: form.endereco || (cliente?.endereco ? `${cliente.endereco.rua}, ${cliente.endereco.bairro} - ${cliente.endereco.cidade}/${cliente.endereco.estado}` : ""),
        tipo: form.tipo,
        descricao: `${form.tipo} - ${form.equipamentoModelo || "Equipamento"}`,
        equipamentoModelo: form.equipamentoModelo,
        equipamentoBTUs: form.equipamentoBTUs,
        tecnicoId: form.tecnicoId,
        tecnicoNome: tecnico?.nome || "—",
        status: "aguardando",
        dataAbertura: new Date().toISOString(),
        dataAgendada: form.dataAgendada + "T00:00:00.000Z",
        dataConclusao: null,
        observacoes: form.observacoes,
        valor,
        itensUtilizados: [],
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:services:" + newOS.id, newOS);
      addToast(MSG_TEMPLATES.os_criada(numero), "success");
    }

    setModalOpen(false);
    loadOrders();
  }, [form, editing, orders, clients, tecnicos, loadOrders, addToast]);

  const handleDelete = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:services:" + confirmDelete.id);
      addToast("OS excluída.", "success");
      setConfirmDelete(null);
      loadOrders();
    }
  }, [confirmDelete, loadOrders, addToast]);

  const changeStatus = useCallback((os, newStatus) => {
    const updated = { ...os, status: newStatus, updatedAt: new Date().toISOString() };
    if (newStatus === "finalizado") {
      updated.dataConclusao = new Date().toISOString();
    }
    DB.set("erp:services:" + updated.id, updated);
    addToast(`OS ${os.numero} → ${STATUS_LABELS_OS[newStatus]}`, "success");
    loadOrders();
  }, [loadOrders, addToast]);

  const faturarOS = useCallback((os) => {
    if (os.status !== "finalizado") {
      addToast("Somente OS finalizadas podem ser faturadas.", "error");
      return;
    }

    const finId = genId();
    DB.set("erp:finance:" + finId, {
      id: finId,
      numero: "FAT-" + os.numero,
      descricao: `${os.tipo} - ${os.clienteNome}`,
      valor: os.valor || 0,
      tipo: "receita",
      categoria: os.tipo || "Serviço",
      data: new Date().toISOString(),
      status: "pendente",
      formaPagamento: "Boleto",
      observacoes: `Ref. OS ${os.numero}`,
      osId: os.id,
      createdAt: new Date().toISOString(),
    });

    const updated = { ...os, status: "faturado", updatedAt: new Date().toISOString() };
    DB.set("erp:services:" + updated.id, updated);

    addToast(`OS ${os.numero} faturada. Receita de ${formatCurrency(os.valor)} registrada.`, "success");
    loadOrders();
  }, [loadOrders, addToast]);

  const getNextStatus = useCallback((current) => {
    const idx = STATUS_FLOW.indexOf(current);
    if (idx < 0 || idx >= STATUS_FLOW.length - 1) return null;
    return STATUS_FLOW[idx + 1];
  }, []);

  const columns = [
    { key: "numero", label: "Nº", width: "w-24" },
    { key: "clienteNome", label: "Cliente" },
    { key: "tipo", label: "Tipo" },
    { key: "tecnicoNome", label: "Técnico" },
    {
      key: "status", label: "Status",
      render: (v) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${STATUS_COLORS_OS[v] || "bg-gray-500"}`}>
          {STATUS_LABELS_OS[v] || v}
        </span>
      ),
    },
    { key: "dataAbertura", label: "Data", render: (v) => formatDate(v) },
    { key: "valor", label: "Valor", render: (v) => formatCurrency(v) },
  ];

  const canManage = user.role === "admin" || user.role === "gerente" || user.role === "atendente";

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Ordens de Serviço</h2>
          <p className="text-gray-400 text-sm mt-1">Gestão de processos e OS</p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5 border border-gray-700">
            <button
              onClick={() => setViewMode("lista")}
              className={`px-3 py-1.5 text-xs rounded-md transition ${viewMode === "lista" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              Lista
            </button>
            <button
              onClick={() => setViewMode("kanban")}
              className={`px-3 py-1.5 text-xs rounded-md transition ${viewMode === "kanban" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
            >
              Kanban
            </button>
          </div>
          {canManage && (
            <button onClick={openCreate} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Nova OS
            </button>
          )}
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <KPICard title="Total OS" value={stats.total} icon="📋" />
        <KPICard title="Aguardando" value={stats.aguardando} icon="⏳" />
        <KPICard title="Deslocamento" value={stats.em_deslocamento} icon="🚗" />
        <KPICard title="Execução" value={stats.em_execucao} icon="🔧" />
        <KPICard title="Finalizado" value={stats.finalizado} icon="✅" />
        <KPICard title="Faturado" value={stats.faturado} icon="💰" />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar OS..." />
        </div>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todos status</option>
          {STATUS_FLOW.map((s) => (
            <option key={s} value={s}>{STATUS_LABELS_OS[s]}</option>
          ))}
        </select>
        {user.role !== "tecnico" && (
          <select
            value={filterTecnico}
            onChange={(e) => setFilterTecnico(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">Todos técnicos</option>
            {tecnicos.map((t) => (
              <option key={t.id} value={t.id}>{t.nome}</option>
            ))}
          </select>
        )}
      </div>

      {/* List View */}
      {viewMode === "lista" && (
        <DataTable
          columns={columns}
          data={filteredOrders}
          onEdit={canManage ? openEdit : undefined}
          onDelete={(user.role === "admin" || user.role === "gerente") ? handleDelete : undefined}
          actions={(row) => (
            <>
              {row.status !== "faturado" && getNextStatus(row.status) && (
                <button
                  onClick={() => {
                    const next = getNextStatus(row.status);
                    if (next === "faturado") {
                      faturarOS(row);
                    } else {
                      changeStatus(row, next);
                    }
                  }}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-gray-700 transition"
                  title={`Avançar para ${STATUS_LABELS_OS[getNextStatus(row.status)]}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                </button>
              )}
              {row.status === "finalizado" && (
                <button
                  onClick={() => faturarOS(row)}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition"
                  title="Faturar OS"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                </button>
              )}
            </>
          )}
          emptyMessage="Nenhuma OS encontrada."
        />
      )}

      {/* Kanban View */}
      {viewMode === "kanban" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {STATUS_FLOW.map((status) => {
            const osInCol = filteredOrders.filter((os) => os.status === status);
            return (
              <div key={status} className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
                <div className={`px-3 py-2 border-b border-gray-700 flex items-center gap-2`}>
                  <div className={`w-2 h-2 rounded-full ${STATUS_COLORS_OS[status]}`} />
                  <span className="text-white text-sm font-medium">{STATUS_LABELS_OS[status]}</span>
                  <span className="text-gray-400 text-xs ml-auto">{osInCol.length}</span>
                </div>
                <div className="p-2 space-y-2 max-h-[500px] overflow-y-auto">
                  {osInCol.length === 0 ? (
                    <p className="text-gray-500 text-xs text-center py-4">Vazio</p>
                  ) : (
                    osInCol.map((os) => (
                      <div
                        key={os.id}
                        className="bg-gray-700/50 border border-gray-600/30 rounded-lg p-3 hover:bg-gray-700 transition cursor-pointer"
                        onClick={() => {
                          const next = getNextStatus(os.status);
                          if (next) {
                            if (next === "faturado") {
                              faturarOS(os);
                            } else {
                              changeStatus(os, next);
                            }
                          }
                        }}
                      >
                        <p className="text-white text-xs font-semibold">{os.numero}</p>
                        <p className="text-gray-300 text-xs mt-1 truncate">{os.clienteNome}</p>
                        <p className="text-gray-400 text-xs truncate">{os.tipo}</p>
                        <div className="flex items-center justify-between mt-2">
                          <span className="text-gray-500 text-xs">{os.tecnicoNome}</span>
                          {os.valor > 0 && <span className="text-green-400 text-xs font-medium">{formatCurrency(os.valor)}</span>}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} title={editing ? "Editar OS" : "Nova Ordem de Serviço"} onClose={() => setModalOpen(false)} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Cliente *</label>
              <select
                value={form.clienteId}
                onChange={(e) => {
                  const cid = e.target.value;
                  const c = (clients || []).find((cl) => cl.id === cid);
                  setForm({
                    ...form,
                    clienteId: cid,
                    endereco: c?.endereco ? `${c.endereco.rua}, ${c.endereco.bairro} - ${c.endereco.cidade}/${c.endereco.estado}` : form.endereco,
                  });
                }}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Selecione...</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo de Serviço *</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {SERVICE_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Endereço</label>
            <input
              type="text"
              value={form.endereco}
              onChange={(e) => setForm({ ...form, endereco: e.target.value })}
              placeholder="Endereço do serviço"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Modelo Equipamento</label>
              <input
                type="text"
                value={form.equipamentoModelo}
                onChange={(e) => setForm({ ...form, equipamentoModelo: e.target.value })}
                placeholder="Ex: Split Inverter Samsung"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">BTUs</label>
              <input
                type="text"
                value={form.equipamentoBTUs}
                onChange={(e) => setForm({ ...form, equipamentoBTUs: e.target.value })}
                placeholder="Ex: 12000"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Técnico</label>
              <select
                value={form.tecnicoId}
                onChange={(e) => setForm({ ...form, tecnicoId: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Selecione...</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Data Agendada</label>
              <input
                type="date"
                value={form.dataAgendada}
                onChange={(e) => setForm({ ...form, dataAgendada: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Valor (R$)</label>
              <input
                type="number"
                step="0.01"
                min="0"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                placeholder="0,00"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              rows={3}
              placeholder="Detalhes do serviço..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
            <button onClick={handleSave} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              {editing ? "Salvar Alterações" : "Criar OS"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Tem certeza que deseja excluir a OS "${confirmDelete.numero}"?`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── SCHEDULE MODULE ────────────────────────────────────────────────────────

function ScheduleModule({ user, dateFilter, addToast, clients, employees }) {
  const [appointments, setAppointments] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewMode, setViewMode] = useState("mes");
  const [currentDate, setCurrentDate] = useState(new Date());

  const SERVICE_TYPES_SCHEDULE = ["Instalação", "Manutenção", "Higienização", "Reparo", "Revisão", "Desinstalação"];
  const STATUS_COLORS_SCHEDULE = {
    agendado: "bg-cyan-500",
    confirmado: "bg-blue-500",
    em_andamento: "bg-yellow-500",
    concluido: "bg-green-500",
    cancelado: "bg-red-500",
  };
  const STATUS_LABELS_SCHEDULE = {
    agendado: "Agendado",
    confirmado: "Confirmado",
    em_andamento: "Em Andamento",
    concluido: "Concluído",
    cancelado: "Cancelado",
  };

  const tecnicos = useMemo(() => (employees || []).filter((e) => e.tipo === "tecnico" && e.status === "ativo"), [employees]);

  const loadAppointments = useCallback(() => {
    setAppointments(DB.list("erp:schedule:"));
  }, []);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  const emptyForm = {
    data: toISODate(new Date()),
    horaInicio: "08:00",
    horaFim: "10:00",
    clienteId: "",
    tecnicoId: "",
    tipo: "Manutenção",
    endereco: "",
    observacoes: "",
  };
  const [form, setForm] = useState(emptyForm);

  // Calendar helpers
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
  const dayNames = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

  const calendarDays = useMemo(() => {
    const firstDay = new Date(year, month, 1).getDay();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const days = [];

    // Previous month padding
    for (let i = 0; i < firstDay; i++) {
      days.push({ day: null, date: null });
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
      days.push({ day: d, date: dateStr });
    }

    return days;
  }, [year, month]);

  const getAppointmentsForDate = useCallback((dateStr) => {
    if (!dateStr) return [];
    return appointments.filter((a) => a.data && a.data.startsWith(dateStr));
  }, [appointments]);

  // Week view
  const weekDays = useMemo(() => {
    const start = new Date(currentDate);
    start.setDate(start.getDate() - start.getDay());
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      days.push({
        date: toISODate(d),
        dayName: dayNames[d.getDay()],
        dayNum: d.getDate(),
        isToday: toISODate(d) === toISODate(new Date()),
      });
    }
    return days;
  }, [currentDate]);

  // Day view time slots
  const timeSlots = useMemo(() => {
    const slots = [];
    for (let h = 7; h <= 19; h++) {
      slots.push(`${String(h).padStart(2, "0")}:00`);
    }
    return slots;
  }, []);

  const todayStr = toISODate(new Date());

  const prevMonth = useCallback(() => setCurrentDate(new Date(year, month - 1, 1)), [year, month]);
  const nextMonth = useCallback(() => setCurrentDate(new Date(year, month + 1, 1)), [year, month]);
  const prevWeek = useCallback(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 7);
    setCurrentDate(d);
  }, [currentDate]);
  const nextWeek = useCallback(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 7);
    setCurrentDate(d);
  }, [currentDate]);
  const prevDay = useCallback(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() - 1);
    setCurrentDate(d);
  }, [currentDate]);
  const nextDay = useCallback(() => {
    const d = new Date(currentDate);
    d.setDate(d.getDate() + 1);
    setCurrentDate(d);
  }, [currentDate]);

  const openCreate = useCallback((dateStr) => {
    setEditing(null);
    setForm({ ...emptyForm, data: dateStr || toISODate(new Date()) });
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((appt) => {
    setEditing(appt);
    const startTime = appt.data ? new Date(appt.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "08:00";
    const endTime = appt.dataFim ? new Date(appt.dataFim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : "10:00";
    setForm({
      data: appt.data ? appt.data.split("T")[0] : toISODate(new Date()),
      horaInicio: startTime,
      horaFim: endTime,
      clienteId: appt.clienteId || "",
      tecnicoId: appt.tecnicoId || "",
      tipo: appt.tipo || "Manutenção",
      endereco: appt.endereco || "",
      observacoes: appt.observacoes || "",
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    if (!form.data || !form.horaInicio || !form.horaFim || !form.clienteId || !form.tecnicoId) {
      addToast("Preencha todos os campos obrigatórios.", "error");
      return;
    }

    // Conflict detection
    const startDT = new Date(`${form.data}T${form.horaInicio}:00`);
    const endDT = new Date(`${form.data}T${form.horaFim}:00`);

    if (endDT <= startDT) {
      addToast("Hora fim deve ser posterior à hora início.", "error");
      return;
    }

    const conflicts = appointments.filter((a) => {
      if (editing && a.id === editing.id) return false;
      if (a.tecnicoId !== form.tecnicoId) return false;
      if (a.status === "cancelado") return false;
      const aStart = new Date(a.data);
      const aEnd = new Date(a.dataFim);
      return startDT < aEnd && endDT > aStart;
    });

    if (conflicts.length > 0) {
      addToast("Conflito de horário! Técnico já possui agendamento nesse período.", "error");
      return;
    }

    const cliente = (clients || []).find((c) => c.id === form.clienteId);
    const tecnico = tecnicos.find((t) => t.id === form.tecnicoId);

    if (editing) {
      const updated = {
        ...editing,
        titulo: `${form.tipo} - ${cliente?.nome || ""}`,
        data: `${form.data}T${form.horaInicio}:00.000Z`,
        dataFim: `${form.data}T${form.horaFim}:00.000Z`,
        clienteId: form.clienteId,
        clienteNome: cliente?.nome || "—",
        tecnicoId: form.tecnicoId,
        tecnicoNome: tecnico?.nome || "—",
        tipo: form.tipo,
        endereco: form.endereco,
        observacoes: form.observacoes,
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:schedule:" + updated.id, updated);
      addToast("Agendamento atualizado.", "success");
    } else {
      const newAppt = {
        id: genId(),
        titulo: `${form.tipo} - ${cliente?.nome || ""}`,
        data: `${form.data}T${form.horaInicio}:00.000Z`,
        dataFim: `${form.data}T${form.horaFim}:00.000Z`,
        clienteId: form.clienteId,
        clienteNome: cliente?.nome || "—",
        tecnicoId: form.tecnicoId,
        tecnicoNome: tecnico?.nome || "—",
        tipo: form.tipo,
        endereco: form.endereco || (cliente?.endereco ? `${cliente.endereco.rua}, ${cliente.endereco.bairro}` : ""),
        status: "agendado",
        observacoes: form.observacoes,
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:schedule:" + newAppt.id, newAppt);
      addToast("Agendamento criado com sucesso.", "success");
    }

    setModalOpen(false);
    loadAppointments();
  }, [form, editing, appointments, clients, tecnicos, loadAppointments, addToast]);

  const handleDelete = useCallback((appt) => {
    setConfirmDelete(appt);
  }, []);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:schedule:" + confirmDelete.id);
      addToast("Agendamento excluído.", "success");
      setConfirmDelete(null);
      loadAppointments();
    }
  }, [confirmDelete, loadAppointments, addToast]);

  const changeApptStatus = useCallback((appt, status) => {
    const updated = { ...appt, status, updatedAt: new Date().toISOString() };
    DB.set("erp:schedule:" + updated.id, updated);
    addToast(`Agendamento ${STATUS_LABELS_SCHEDULE[status] || status}.`, "success");
    loadAppointments();
  }, [loadAppointments, addToast]);

  const sendWhatsApp = useCallback((appt) => {
    const cliente = (clients || []).find((c) => c.id === appt.clienteId);
    if (!cliente?.telefone) {
      addToast("Cliente sem telefone cadastrado.", "warning");
      return;
    }
    const phone = cliente.telefone.replace(/\D/g, "");
    const msg = encodeURIComponent(
      `Olá ${cliente.nome}! Confirmamos seu agendamento de ${appt.tipo} para ${formatDateTime(appt.data)}. Endereço: ${appt.endereco || "a confirmar"}. FrostERP Refrigeração.`
    );
    window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank");
  }, [clients, addToast]);

  const sendEmail = useCallback((appt) => {
    const cliente = (clients || []).find((c) => c.id === appt.clienteId);
    if (!cliente?.email) {
      addToast("Cliente sem email cadastrado.", "warning");
      return;
    }
    const subject = encodeURIComponent(`Confirmação de Agendamento - ${appt.tipo}`);
    const body = encodeURIComponent(
      `Olá ${cliente.nome},\n\nConfirmamos seu agendamento:\n\nServiço: ${appt.tipo}\nData: ${formatDateTime(appt.data)}\nEndereço: ${appt.endereco || "a confirmar"}\n\nAtenciosamente,\nFrostERP Refrigeração`
    );
    window.open(`mailto:${cliente.email}?subject=${subject}&body=${body}`, "_blank");
  }, [clients, addToast]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Agenda</h2>
          <p className="text-gray-400 text-sm mt-1">Agendamentos e calendário</p>
        </div>
        <div className="flex gap-2">
          <div className="flex gap-1 bg-gray-800 rounded-lg p-0.5 border border-gray-700">
            {["mes", "semana", "dia"].map((mode) => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs rounded-md transition ${viewMode === mode ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {mode === "mes" ? "Mês" : mode === "semana" ? "Semana" : "Dia"}
              </button>
            ))}
          </div>
          <button onClick={() => openCreate()} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
            Novo Agendamento
          </button>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex items-center justify-between bg-gray-800 border border-gray-700 rounded-xl px-4 py-3">
        <button
          onClick={viewMode === "mes" ? prevMonth : viewMode === "semana" ? prevWeek : prevDay}
          className="p-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" /></svg>
        </button>
        <h2 className="text-white font-semibold">
          {viewMode === "mes" && `${monthNames[month]} ${year}`}
          {viewMode === "semana" && `Semana de ${weekDays[0]?.dayNum} a ${weekDays[6]?.dayNum} - ${monthNames[month]} ${year}`}
          {viewMode === "dia" && `${currentDate.getDate()} de ${monthNames[month]} ${year}`}
        </h2>
        <div className="flex gap-2">
          <button
            onClick={() => setCurrentDate(new Date())}
            className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            Hoje
          </button>
          <button
            onClick={viewMode === "mes" ? nextMonth : viewMode === "semana" ? nextWeek : nextDay}
            className="p-2 rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
          </button>
        </div>
      </div>

      {/* Month View */}
      {viewMode === "mes" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7">
            {dayNames.map((d) => (
              <div key={d} className="px-2 py-2 text-center text-xs font-medium text-gray-400 border-b border-gray-700">{d}</div>
            ))}
          </div>
          <div className="grid grid-cols-7">
            {calendarDays.map((cell, idx) => {
              const appts = cell.date ? getAppointmentsForDate(cell.date) : [];
              const isToday = cell.date === todayStr;
              return (
                <div
                  key={idx}
                  className={`min-h-[90px] border-b border-r border-gray-700/50 p-1 ${cell.day ? "cursor-pointer hover:bg-gray-700/30" : "bg-gray-800/50"} ${isToday ? "bg-blue-500/5" : ""}`}
                  onClick={() => cell.day && openCreate(cell.date)}
                >
                  {cell.day && (
                    <>
                      <span className={`text-xs font-medium ${isToday ? "bg-blue-600 text-white rounded-full w-6 h-6 inline-flex items-center justify-center" : "text-gray-400"}`}>
                        {cell.day}
                      </span>
                      <div className="mt-1 space-y-0.5">
                        {appts.slice(0, 3).map((a) => (
                          <div
                            key={a.id}
                            className={`text-xs px-1 py-0.5 rounded truncate text-white ${STATUS_COLORS_SCHEDULE[a.status] || "bg-gray-600"}`}
                            onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                            title={a.titulo}
                          >
                            {a.titulo}
                          </div>
                        ))}
                        {appts.length > 3 && (
                          <span className="text-xs text-gray-400">+{appts.length - 3} mais</span>
                        )}
                      </div>
                    </>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Week View */}
      {viewMode === "semana" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="grid grid-cols-7 divide-x divide-gray-700">
            {weekDays.map((day) => {
              const appts = getAppointmentsForDate(day.date);
              return (
                <div key={day.date} className={`min-h-[300px] ${day.isToday ? "bg-blue-500/5" : ""}`}>
                  <div className={`px-2 py-2 text-center border-b border-gray-700 ${day.isToday ? "bg-blue-600/20" : ""}`}>
                    <p className="text-xs text-gray-400">{day.dayName}</p>
                    <p className={`text-sm font-semibold ${day.isToday ? "text-blue-400" : "text-white"}`}>{day.dayNum}</p>
                  </div>
                  <div className="p-1 space-y-1">
                    {appts.map((a) => (
                      <div
                        key={a.id}
                        className={`text-xs p-1.5 rounded text-white cursor-pointer ${STATUS_COLORS_SCHEDULE[a.status] || "bg-gray-600"} hover:opacity-80 transition`}
                        onClick={() => openEdit(a)}
                      >
                        <p className="font-medium truncate">{a.titulo}</p>
                        <p className="opacity-75">{new Date(a.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</p>
                        <p className="opacity-75 truncate">{a.tecnicoNome}</p>
                      </div>
                    ))}
                    {appts.length === 0 && (
                      <p className="text-gray-600 text-xs text-center py-4 cursor-pointer" onClick={() => openCreate(day.date)}>+</p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Day View */}
      {viewMode === "dia" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="divide-y divide-gray-700/50">
            {timeSlots.map((slot) => {
              const slotDate = toISODate(currentDate);
              const slotAppts = appointments.filter((a) => {
                if (!a.data || !a.data.startsWith(slotDate)) return false;
                const aHour = new Date(a.data).getHours();
                return aHour === parseInt(slot);
              });
              return (
                <div key={slot} className="flex min-h-[60px]">
                  <div className="w-16 flex-shrink-0 px-2 py-2 text-right text-xs text-gray-500 border-r border-gray-700">
                    {slot}
                  </div>
                  <div className="flex-1 p-1 flex gap-1 flex-wrap cursor-pointer hover:bg-gray-700/20 transition" onClick={() => openCreate(slotDate)}>
                    {slotAppts.map((a) => (
                      <div
                        key={a.id}
                        className={`text-xs p-2 rounded text-white flex-1 min-w-[150px] cursor-pointer ${STATUS_COLORS_SCHEDULE[a.status] || "bg-gray-600"} hover:opacity-80`}
                        onClick={(e) => { e.stopPropagation(); openEdit(a); }}
                      >
                        <p className="font-medium">{a.titulo}</p>
                        <p className="opacity-75">{a.tecnicoNome} | {a.clienteNome}</p>
                        <div className="flex gap-1 mt-1">
                          <button
                            onClick={(e) => { e.stopPropagation(); sendWhatsApp(a); }}
                            className="text-xs bg-green-600/50 px-1.5 py-0.5 rounded hover:bg-green-600 transition"
                          >
                            WhatsApp
                          </button>
                          <button
                            onClick={(e) => { e.stopPropagation(); sendEmail(a); }}
                            className="text-xs bg-blue-600/50 px-1.5 py-0.5 rounded hover:bg-blue-600 transition"
                          >
                            Email
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's appointments highlight */}
      {appointments.filter((a) => a.data && a.data.startsWith(todayStr) && a.status !== "cancelado").length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-3">Agendamentos de Hoje</h3>
          <div className="space-y-2">
            {appointments
              .filter((a) => a.data && a.data.startsWith(todayStr) && a.status !== "cancelado")
              .sort((a, b) => new Date(a.data) - new Date(b.data))
              .map((a) => (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/30 hover:bg-gray-700/50 transition">
                  <div className={`w-2 h-8 rounded-full ${STATUS_COLORS_SCHEDULE[a.status]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{a.titulo}</p>
                    <p className="text-gray-400 text-xs">
                      {new Date(a.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} -
                      {a.dataFim ? new Date(a.dataFim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} | {a.tecnicoNome}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button onClick={() => sendWhatsApp(a)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition" title="WhatsApp">
                      <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /></svg>
                    </button>
                    <button onClick={() => sendEmail(a)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition" title="Email">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                    </button>
                    {a.status === "agendado" && (
                      <button onClick={() => changeApptStatus(a, "confirmado")} className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-gray-700 transition" title="Confirmar">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
                      </button>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Create/Edit Modal */}
      <Modal isOpen={modalOpen} title={editing ? "Editar Agendamento" : "Novo Agendamento"} onClose={() => setModalOpen(false)} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Data *</label>
              <input
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hora Início *</label>
              <input
                type="time"
                value={form.horaInicio}
                onChange={(e) => setForm({ ...form, horaInicio: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hora Fim *</label>
              <input
                type="time"
                value={form.horaFim}
                onChange={(e) => setForm({ ...form, horaFim: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Cliente *</label>
              <select
                value={form.clienteId}
                onChange={(e) => {
                  const cid = e.target.value;
                  const c = (clients || []).find((cl) => cl.id === cid);
                  setForm({
                    ...form,
                    clienteId: cid,
                    endereco: c?.endereco ? `${c.endereco.rua}, ${c.endereco.bairro}` : form.endereco,
                  });
                }}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Selecione...</option>
                {(clients || []).map((c) => (
                  <option key={c.id} value={c.id}>{c.nome}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Técnico *</label>
              <select
                value={form.tecnicoId}
                onChange={(e) => setForm({ ...form, tecnicoId: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Selecione...</option>
                {tecnicos.map((t) => (
                  <option key={t.id} value={t.id}>{t.nome}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo de Serviço</label>
              <select
                value={form.tipo}
                onChange={(e) => setForm({ ...form, tipo: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {SERVICE_TYPES_SCHEDULE.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Endereço</label>
              <input
                type="text"
                value={form.endereco}
                onChange={(e) => setForm({ ...form, endereco: e.target.value })}
                placeholder="Endereço do serviço"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              rows={3}
              placeholder="Detalhes do agendamento..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
          </div>

          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
            {editing && (
              <button onClick={() => { handleDelete(editing); setModalOpen(false); }} className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition">Excluir</button>
            )}
            <button onClick={handleSave} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              {editing ? "Salvar Alterações" : "Agendar"}
            </button>
          </div>
        </div>
      </Modal>

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Excluir agendamento "${confirmDelete.titulo || ""}"?`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── BANKING MODULE ──────────────────────────────────────────────────────────

function BankingModule({ user, dateFilter, addToast }) {
  const [bankEntries, setBankEntries] = useState([]);
  const [internalEntries, setInternalEntries] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedBank, setSelectedBank] = useState(null);
  const [selectedInternal, setSelectedInternal] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);

  const emptyForm = {
    data: toISODate(new Date()),
    descricao: "",
    valor: "",
    referencia: "",
  };
  const [form, setForm] = useState(emptyForm);

  const loadData = useCallback(() => {
    setBankEntries(DB.list("erp:banking:"));
    setInternalEntries(DB.list("erp:finance:"));
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const filteredBank = useMemo(() => {
    let list = filterByDate(bankEntries, "data", dateFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (e) =>
          (e.descricao || "").toLowerCase().includes(s) ||
          (e.referencia || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.data) - new Date(a.data));
  }, [bankEntries, dateFilter, search]);

  const filteredInternal = useMemo(() => {
    let list = filterByDate(internalEntries, "data", dateFilter);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (t) =>
          (t.descricao || "").toLowerCase().includes(s) ||
          (t.numero || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.data) - new Date(a.data));
  }, [internalEntries, dateFilter, search]);

  const totalConciliados = useMemo(() => filteredBank.filter((e) => e.statusConciliacao === "conciliado").length, [filteredBank]);
  const totalPendentes = useMemo(() => filteredBank.filter((e) => !e.statusConciliacao || e.statusConciliacao === "pendente").length, [filteredBank]);
  const totalDivergentes = useMemo(() => filteredBank.filter((e) => e.statusConciliacao === "divergente").length, [filteredBank]);

  const handleAddEntry = useCallback(() => {
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const handleSaveEntry = useCallback(() => {
    if (!form.descricao.trim() || !form.valor || !form.data) {
      addToast("Preencha os campos obrigatórios.", "error");
      return;
    }
    const valor = parseFloat(String(form.valor).replace(",", "."));
    if (isNaN(valor)) {
      addToast("Informe um valor válido.", "error");
      return;
    }
    const entry = {
      id: genId(),
      data: form.data + "T00:00:00.000Z",
      descricao: form.descricao.trim(),
      valor,
      referencia: form.referencia.trim(),
      statusConciliacao: "pendente",
      conciliadoCom: null,
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:banking:" + entry.id, entry);
    addToast("Lançamento bancário adicionado.", "success");
    setModalOpen(false);
    loadData();
  }, [form, loadData, addToast]);

  const autoMatch = useCallback(() => {
    const bank = DB.list("erp:banking:");
    const finance = DB.list("erp:finance:");
    let matched = 0;

    bank.forEach((be) => {
      if (be.statusConciliacao === "conciliado") return;
      const beDate = new Date(be.data);
      const beVal = Math.abs(be.valor);

      const match = finance.find((fe) => {
        if (fe.conciliadoBanking) return false;
        const feDate = new Date(fe.data);
        const feVal = fe.valor || 0;
        const dayDiff = Math.abs((beDate - feDate) / (1000 * 60 * 60 * 24));
        return Math.abs(feVal - beVal) < 0.01 && dayDiff <= 2;
      });

      if (match) {
        be.statusConciliacao = "conciliado";
        be.conciliadoCom = match.id;
        DB.set("erp:banking:" + be.id, be);
        match.conciliadoBanking = be.id;
        DB.set("erp:finance:" + match.id, match);
        matched++;
      }
    });

    if (matched > 0) {
      addToast(`${matched} lançamento(s) conciliado(s) automaticamente.`, "success");
    } else {
      addToast("Nenhuma correspondência encontrada.", "info");
    }
    loadData();
  }, [loadData, addToast]);

  const manualConciliate = useCallback(() => {
    if (!selectedBank || !selectedInternal) {
      addToast("Selecione um lançamento bancário e um lançamento interno.", "warning");
      return;
    }
    const be = { ...selectedBank, statusConciliacao: "conciliado", conciliadoCom: selectedInternal.id };
    DB.set("erp:banking:" + be.id, be);
    const fe = { ...selectedInternal, conciliadoBanking: be.id };
    DB.set("erp:finance:" + fe.id, fe);
    addToast("Lançamentos conciliados manualmente.", "success");
    setSelectedBank(null);
    setSelectedInternal(null);
    loadData();
  }, [selectedBank, selectedInternal, loadData, addToast]);

  const markResolved = useCallback((entry) => {
    const updated = { ...entry, statusConciliacao: "conciliado" };
    DB.set("erp:banking:" + updated.id, updated);
    addToast("Lançamento marcado como resolvido.", "success");
    loadData();
  }, [loadData, addToast]);

  const markDivergent = useCallback((entry) => {
    const updated = { ...entry, statusConciliacao: "divergente" };
    DB.set("erp:banking:" + updated.id, updated);
    addToast("Lançamento marcado como divergente.", "warning");
    loadData();
  }, [loadData, addToast]);

  const conciliacaoColor = (status) => {
    if (status === "conciliado") return "bg-green-500";
    if (status === "divergente") return "bg-red-500";
    return "bg-yellow-500";
  };

  const conciliacaoLabel = (status) => {
    if (status === "conciliado") return "Conciliado";
    if (status === "divergente") return "Divergente";
    return "Pendente";
  };

  const valorConciliado = useMemo(() => filteredBank.filter((e) => e.statusConciliacao === "conciliado").reduce((s, e) => s + Math.abs(e.valor || 0), 0), [filteredBank]);
  const valorPendente = useMemo(() => filteredBank.filter((e) => !e.statusConciliacao || e.statusConciliacao === "pendente").reduce((s, e) => s + Math.abs(e.valor || 0), 0), [filteredBank]);
  const valorDivergente = useMemo(() => filteredBank.filter((e) => e.statusConciliacao === "divergente").reduce((s, e) => s + Math.abs(e.valor || 0), 0), [filteredBank]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Conciliação Bancária</h2>
          <p className="text-gray-400 text-sm mt-1">Compare extratos bancários com lançamentos internos</p>
        </div>
        <div className="flex gap-2">
          <button onClick={autoMatch} className="px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition flex items-center gap-2">
            🔄 Auto-Conciliar
          </button>
          <button onClick={handleAddEntry} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2">
            + Novo Lançamento Bancário
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <KPICard title="Total Lançamentos" value={filteredBank.length} icon="🏦" />
        <KPICard title="Conciliados" value={totalConciliados} icon="✅" />
        <KPICard title="Pendentes" value={totalPendentes} icon="⏳" />
        <KPICard title="Divergentes" value={totalDivergentes} icon="⚠️" />
      </div>

      {/* Summary Totals */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Valor Conciliado</p>
          <p className="text-xl font-bold text-green-400">{formatCurrency(valorConciliado)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Valor Pendente</p>
          <p className="text-xl font-bold text-yellow-400">{formatCurrency(valorPendente)}</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-sm">Valor Divergente</p>
          <p className="text-xl font-bold text-red-400">{formatCurrency(valorDivergente)}</p>
        </div>
      </div>

      {/* Search */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar lançamentos..." />
        </div>
        {selectedBank && selectedInternal && (
          <button onClick={manualConciliate} className="px-4 py-2 text-sm rounded-lg bg-green-600 text-white hover:bg-green-700 transition">
            🔗 Conciliar Selecionados
          </button>
        )}
      </div>

      {/* Two-panel layout */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Left Panel - Extrato Bancário */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/80">
            <h3 className="text-white font-semibold">🏦 Extrato Bancário</h3>
          </div>
          <div className="divide-y divide-gray-700/50 max-h-[500px] overflow-y-auto">
            {filteredBank.length === 0 ? (
              <div className="p-8 text-center text-gray-400">Nenhum lançamento bancário.</div>
            ) : (
              filteredBank.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => setSelectedBank(selectedBank?.id === entry.id ? null : entry)}
                  className={`px-4 py-3 cursor-pointer transition hover:bg-gray-700/30 ${selectedBank?.id === entry.id ? "bg-blue-500/10 border-l-2 border-l-blue-500" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-white font-medium">{entry.descricao}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(entry.data)} {entry.referencia ? `• Ref: ${entry.referencia}` : ""}</p>
                    </div>
                    <div className="text-right ml-3">
                      <p className={`text-sm font-semibold ${entry.valor >= 0 ? "text-green-400" : "text-red-400"}`}>
                        {formatCurrency(entry.valor)}
                      </p>
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white mt-1 ${conciliacaoColor(entry.statusConciliacao)}`}>
                        {conciliacaoLabel(entry.statusConciliacao)}
                      </span>
                    </div>
                  </div>
                  {entry.statusConciliacao !== "conciliado" && (
                    <div className="flex gap-2 mt-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); markResolved(entry); }}
                        className="text-xs px-2 py-1 rounded bg-green-600/20 text-green-400 hover:bg-green-600/40 transition"
                      >
                        Resolver
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); markDivergent(entry); }}
                        className="text-xs px-2 py-1 rounded bg-red-600/20 text-red-400 hover:bg-red-600/40 transition"
                      >
                        Divergente
                      </button>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>

        {/* Right Panel - Lançamentos Internos */}
        <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-700 bg-gray-800/80">
            <h3 className="text-white font-semibold">📋 Lançamentos Internos</h3>
          </div>
          <div className="divide-y divide-gray-700/50 max-h-[500px] overflow-y-auto">
            {filteredInternal.length === 0 ? (
              <div className="p-8 text-center text-gray-400">Nenhum lançamento interno.</div>
            ) : (
              filteredInternal.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => setSelectedInternal(selectedInternal?.id === entry.id ? null : entry)}
                  className={`px-4 py-3 cursor-pointer transition hover:bg-gray-700/30 ${selectedInternal?.id === entry.id ? "bg-cyan-500/10 border-l-2 border-l-cyan-500" : ""}`}
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <p className="text-sm text-white font-medium">{entry.descricao}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{formatDate(entry.data)} • {entry.numero || "—"} • {entry.categoria || "—"}</p>
                    </div>
                    <div className="text-right ml-3">
                      <p className={`text-sm font-semibold ${entry.tipo === "receita" ? "text-green-400" : "text-red-400"}`}>
                        {entry.tipo === "despesa" ? "-" : ""}{formatCurrency(entry.valor)}
                      </p>
                      {entry.conciliadoBanking && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium text-white mt-1 bg-green-500">
                          Conciliado
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Add Bank Entry Modal */}
      <Modal isOpen={modalOpen} title="Novo Lançamento Bancário" onClose={() => setModalOpen(false)} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Data *</label>
            <input
              type="date"
              value={form.data}
              onChange={(e) => setForm({ ...form, data: e.target.value })}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição *</label>
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: TED recebida - Maria Silva"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Valor (R$) *</label>
              <input
                type="number"
                step="0.01"
                value={form.valor}
                onChange={(e) => setForm({ ...form, valor: e.target.value })}
                placeholder="Positivo = crédito, Negativo = débito"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Referência</label>
              <input
                type="text"
                value={form.referencia}
                onChange={(e) => setForm({ ...form, referencia: e.target.value })}
                placeholder="Ex: DOC 12345"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>
          <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
              Cancelar
            </button>
            <button onClick={handleSaveEntry} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              Adicionar
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ─── CADASTRO MODULE ─────────────────────────────────────────────────────────

function CadastroModule({ user, addToast }) {
  const [activeTab, setActiveTab] = useState("clientes");
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [detailView, setDetailView] = useState(null);
  const [detailTab, setDetailTab] = useState("dados");

  const loadClients = useCallback(() => { setClients(DB.list("erp:client:")); }, []);
  const loadEmployees = useCallback(() => { setEmployees(DB.list("erp:employee:")); }, []);

  useEffect(() => { loadClients(); loadEmployees(); }, [loadClients, loadEmployees]);

  // ─── Client Form ───
  const emptyClientForm = {
    nome: "", tipo: "pf", cpf: "", cnpj: "", telefone: "", email: "",
    rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "",
    observacoes: "",
  };

  const emptyEmployeeForm = {
    nome: "", cpf: "", telefone: "", email: "",
    cargo: "Técnico", salario: "", dataAdmissao: toISODate(new Date()), status: "ativo",
  };

  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);

  // ─── Filtered lists ───
  const filteredClients = useMemo(() => {
    if (!search.trim()) return clients.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    const s = search.toLowerCase();
    return clients
      .filter(
        (c) =>
          (c.nome || "").toLowerCase().includes(s) ||
          (c.cpf || "").replace(/\D/g, "").includes(s.replace(/\D/g, "")) ||
          (c.cnpj || "").replace(/\D/g, "").includes(s.replace(/\D/g, "")) ||
          (c.telefone || "").replace(/\D/g, "").includes(s.replace(/\D/g, ""))
      )
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [clients, search]);

  const filteredEmployees = useMemo(() => {
    if (!search.trim()) return employees.sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    const s = search.toLowerCase();
    return employees
      .filter(
        (e) =>
          (e.nome || "").toLowerCase().includes(s) ||
          (e.cpf || "").replace(/\D/g, "").includes(s.replace(/\D/g, "")) ||
          (e.cargo || "").toLowerCase().includes(s)
      )
      .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
  }, [employees, search]);

  // ─── Client CRUD ───
  const openCreateClient = useCallback(() => {
    setEditing(null);
    setClientForm(emptyClientForm);
    setModalOpen(true);
  }, []);

  const openEditClient = useCallback((row) => {
    setEditing(row);
    setClientForm({
      nome: row.nome || "",
      tipo: row.tipo || "pf",
      cpf: row.cpf || "",
      cnpj: row.cnpj || "",
      telefone: row.telefone || "",
      email: row.email || "",
      rua: row.endereco?.rua || "",
      numero: row.endereco?.numero || "",
      bairro: row.endereco?.bairro || "",
      cidade: row.endereco?.cidade || "",
      estado: row.endereco?.estado || "",
      cep: row.endereco?.cep || "",
      observacoes: row.observacoes || "",
    });
    setModalOpen(true);
  }, []);

  const handleSaveClient = useCallback(() => {
    if (!clientForm.nome.trim()) {
      addToast("Informe o nome do cliente.", "error");
      return;
    }
    if (clientForm.tipo === "pf" && !clientForm.cpf.trim()) {
      addToast("Informe o CPF do cliente.", "error");
      return;
    }
    if (clientForm.tipo === "pj" && !clientForm.cnpj.trim()) {
      addToast("Informe o CNPJ do cliente.", "error");
      return;
    }
    if (!clientForm.telefone.trim()) {
      addToast("Informe o telefone do cliente.", "error");
      return;
    }

    const data = {
      nome: clientForm.nome.trim(),
      tipo: clientForm.tipo,
      cpf: clientForm.tipo === "pf" ? clientForm.cpf : "",
      cnpj: clientForm.tipo === "pj" ? clientForm.cnpj : "",
      telefone: clientForm.telefone,
      email: clientForm.email.trim(),
      endereco: {
        rua: clientForm.rua.trim(),
        numero: clientForm.numero.trim(),
        bairro: clientForm.bairro.trim(),
        cidade: clientForm.cidade.trim(),
        estado: clientForm.estado.trim(),
        cep: clientForm.cep.trim(),
      },
      observacoes: clientForm.observacoes.trim(),
      status: "ativo",
    };

    if (editing) {
      const updated = { ...editing, ...data, updatedAt: new Date().toISOString() };
      DB.set("erp:client:" + updated.id, updated);
      addToast("Cliente atualizado com sucesso.", "success");
    } else {
      const newClient = { ...data, id: genId(), createdAt: new Date().toISOString() };
      DB.set("erp:client:" + newClient.id, newClient);
      addToast(MSG_TEMPLATES.cliente_criado(newClient.nome), "success");
    }
    setModalOpen(false);
    loadClients();
  }, [clientForm, editing, loadClients, addToast]);

  /* Exclusão de cliente — remove também OS, transações, tickets e agendamentos vinculados */
  const handleDeleteClient = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteClientAction = useCallback(() => {
    if (confirmDelete) {
      // Remove OS vinculadas
      const os = DB.list("erp:os:").filter((o) => o.clienteId === confirmDelete.id);
      os.forEach((o) => DB.delete("erp:os:" + o.id));
      // Remove transações vinculadas
      const tx = DB.list("erp:finance:").filter((t) => t.clienteId === confirmDelete.id);
      tx.forEach((t) => DB.delete("erp:finance:" + t.id));
      // Remove tickets vinculados
      const tk = DB.list("erp:ticket:").filter((t) => t.clienteId === confirmDelete.id);
      tk.forEach((t) => DB.delete("erp:ticket:" + t.id));
      // Remove agendamentos vinculados
      const ag = DB.list("erp:schedule:").filter((s) => s.clienteId === confirmDelete.id);
      ag.forEach((s) => DB.delete("erp:schedule:" + s.id));
      // Remove o cliente
      DB.delete("erp:client:" + confirmDelete.id);
      const removed = os.length + tx.length + tk.length + ag.length;
      addToast(`Cliente e ${removed} registro(s) vinculado(s) excluídos.`, "success");
      setConfirmDelete(null);
      setDetailView(null);
      loadClients();
    }
  }, [confirmDelete, loadClients, addToast]);

  // ─── Employee CRUD ───
  const openCreateEmployee = useCallback(() => {
    setEditing(null);
    setEmployeeForm(emptyEmployeeForm);
    setModalOpen(true);
  }, []);

  const openEditEmployee = useCallback((row) => {
    setEditing(row);
    setEmployeeForm({
      nome: row.nome || "",
      cpf: row.cpf || "",
      telefone: row.telefone || "",
      email: row.email || "",
      cargo: row.cargo || "Técnico",
      salario: row.salario || "",
      dataAdmissao: row.dataAdmissao || toISODate(new Date()),
      status: row.status || "ativo",
    });
    setModalOpen(true);
  }, []);

  const handleSaveEmployee = useCallback(() => {
    if (!employeeForm.nome.trim()) {
      addToast("Informe o nome do funcionário.", "error");
      return;
    }
    if (!employeeForm.cpf.trim()) {
      addToast("Informe o CPF do funcionário.", "error");
      return;
    }
    if (!employeeForm.telefone.trim()) {
      addToast("Informe o telefone do funcionário.", "error");
      return;
    }

    const data = {
      nome: employeeForm.nome.trim(),
      cpf: employeeForm.cpf,
      telefone: employeeForm.telefone,
      email: employeeForm.email.trim(),
      cargo: employeeForm.cargo,
      tipo: employeeForm.cargo === "Técnico" ? "tecnico" : employeeForm.cargo === "Gerente" ? "gerente" : "administrativo",
      salario: parseFloat(String(employeeForm.salario).replace(",", ".")) || 0,
      dataAdmissao: employeeForm.dataAdmissao,
      status: employeeForm.status,
      especialidades: [],
      crea: "",
    };

    if (editing) {
      const updated = { ...editing, ...data, updatedAt: new Date().toISOString() };
      DB.set("erp:employee:" + updated.id, updated);
      addToast("Funcionário atualizado com sucesso.", "success");
    } else {
      const newEmp = { ...data, id: genId(), createdAt: new Date().toISOString() };
      DB.set("erp:employee:" + newEmp.id, newEmp);
      addToast("Funcionário cadastrado com sucesso.", "success");
    }
    setModalOpen(false);
    loadEmployees();
  }, [employeeForm, editing, loadEmployees, addToast]);

  const handleDeleteEmployee = useCallback((row) => {
    if (user.role !== "admin") {
      addToast("Apenas administradores podem excluir funcionários.", "error");
      return;
    }
    setConfirmDelete(row);
  }, [user, addToast]);

  const confirmDeleteEmployeeAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:employee:" + confirmDelete.id);
      addToast("Funcionário excluído.", "success");
      setConfirmDelete(null);
      loadEmployees();
    }
  }, [confirmDelete, loadEmployees, addToast]);

  // ─── Client Detail View ───
  const clientDetailData = useMemo(() => {
    if (!detailView) return null;
    return {
      os: DB.list("erp:os:").filter((o) => o.clienteId === detailView.id),
      transactions: DB.list("erp:finance:").filter((t) => t.clienteId === detailView.id || (t.descricao || "").toLowerCase().includes((detailView.nome || "").toLowerCase())),
      tickets: DB.list("erp:ticket:").filter((t) => t.clienteId === detailView.id),
      invoices: DB.list("erp:invoice:").filter((i) => i.clienteId === detailView.id),
    };
  }, [detailView]);

  const formatCEP = (v) => {
    const d = (v || "").replace(/\D/g, "").slice(0, 8);
    if (d.length <= 5) return d;
    return d.slice(0, 5) + "-" + d.slice(5);
  };

  // ─── Client columns ───
  const clientColumns = [
    { key: "nome", label: "Nome" },
    {
      key: "cpf", label: "CPF/CNPJ",
      render: (_, row) => row.tipo === "pf" ? (row.cpf || "—") : (row.cnpj || "—"),
    },
    {
      key: "telefone", label: "Telefone",
      render: (v) => v || "—",
    },
    { key: "email", label: "Email", render: (v) => v || "—" },
    {
      key: "cidade", label: "Cidade",
      render: (_, row) => row.endereco?.cidade || "—",
    },
  ];

  const employeeColumns = [
    { key: "nome", label: "Nome" },
    { key: "cpf", label: "CPF", render: (v) => v || "—" },
    { key: "cargo", label: "Cargo" },
    { key: "telefone", label: "Telefone", render: (v) => v || "—" },
    {
      key: "status", label: "Status",
      render: (v) => <StatusBadge status={v} />,
    },
  ];

  // ─── Detail View ───
  if (detailView) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => { setDetailView(null); setDetailTab("dados"); }}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            ← Voltar
          </button>
          <h2 className="text-2xl font-bold text-white">{detailView.nome}</h2>
          <StatusBadge status={detailView.status || "ativo"} />
        </div>

        {/* Tabs */}
        <div className="flex gap-2 border-b border-gray-700 pb-2">
          {["dados", "os", "transacoes", "tickets", "nfs"].map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-2 text-sm rounded-t-lg transition ${detailTab === tab ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
            >
              {{ dados: "Dados", os: "Ordens de Serviço", transacoes: "Transações", tickets: "Tickets", nfs: "Notas Fiscais" }[tab]}
            </button>
          ))}
        </div>

        {detailTab === "dados" && (
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase">Tipo</p>
                  <p className="text-white">{detailView.tipo === "pf" ? "Pessoa Física" : "Pessoa Jurídica"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">{detailView.tipo === "pf" ? "CPF" : "CNPJ"}</p>
                  <p className="text-white">{detailView.tipo === "pf" ? detailView.cpf : detailView.cnpj}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Telefone</p>
                  <p className="text-white">{detailView.telefone || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Email</p>
                  <p className="text-white">{detailView.email || "—"}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-xs text-gray-400 uppercase">Endereço</p>
                  <p className="text-white">
                    {detailView.endereco ? (
                      <>
                        {detailView.endereco.rua}{detailView.endereco.numero ? `, ${detailView.endereco.numero}` : ""}<br />
                        {detailView.endereco.bairro && <>{detailView.endereco.bairro}<br /></>}
                        {detailView.endereco.cidade}{detailView.endereco.estado ? ` - ${detailView.endereco.estado}` : ""}
                        {detailView.endereco.cep && <><br />CEP: {detailView.endereco.cep}</>}
                      </>
                    ) : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Observações</p>
                  <p className="text-white">{detailView.observacoes || "—"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400 uppercase">Cadastrado em</p>
                  <p className="text-white">{formatDateTime(detailView.createdAt)}</p>
                </div>
              </div>
            </div>
            <div className="flex gap-2 mt-6 pt-4 border-t border-gray-700">
              <button onClick={() => openEditClient(detailView)} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                Editar
              </button>
            </div>
          </div>
        )}

        {detailTab === "os" && clientDetailData && (
          <DataTable
            columns={[
              { key: "numero", label: "Nº" },
              { key: "tipo", label: "Tipo" },
              { key: "descricao", label: "Descrição" },
              { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
              { key: "dataAbertura", label: "Data", render: (v) => formatDate(v) },
              { key: "valor", label: "Valor", render: (v) => formatCurrency(v) },
            ]}
            data={clientDetailData.os}
            emptyMessage="Nenhuma OS vinculada a este cliente."
          />
        )}

        {detailTab === "transacoes" && clientDetailData && (
          <DataTable
            columns={[
              { key: "numero", label: "Nº" },
              { key: "descricao", label: "Descrição" },
              { key: "tipo", label: "Tipo", render: (v) => v === "receita" ? "Receita" : "Despesa" },
              { key: "valor", label: "Valor", render: (v) => formatCurrency(v) },
              { key: "data", label: "Data", render: (v) => formatDate(v) },
              { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
            ]}
            data={clientDetailData.transactions}
            emptyMessage="Nenhuma transação vinculada a este cliente."
          />
        )}

        {detailTab === "tickets" && clientDetailData && (
          <DataTable
            columns={[
              { key: "numero", label: "Nº" },
              { key: "titulo", label: "Título" },
              { key: "prioridade", label: "Prioridade" },
              { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
              { key: "dataAbertura", label: "Data", render: (v) => formatDate(v) },
            ]}
            data={clientDetailData.tickets}
            emptyMessage="Nenhum ticket vinculado a este cliente."
          />
        )}

        {detailTab === "nfs" && clientDetailData && (
          <DataTable
            columns={[
              { key: "numero", label: "Nº" },
              { key: "clienteNome", label: "Cliente" },
              { key: "valorTotal", label: "Valor", render: (v) => formatCurrency(v) },
              { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
              { key: "dataEmissao", label: "Emissão", render: (v) => formatDate(v) },
            ]}
            data={clientDetailData.invoices}
            emptyMessage="Nenhuma NF vinculada a este cliente."
          />
        )}
      </div>
    );
  }

  // ─── Main View ───
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Cadastros</h2>
          <p className="text-gray-400 text-sm mt-1">Gerencie clientes e funcionários</p>
        </div>
        <button
          onClick={activeTab === "clientes" ? openCreateClient : openCreateEmployee}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2"
        >
          + {activeTab === "clientes" ? "Novo Cliente" : "Novo Funcionário"}
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-2">
        <button
          onClick={() => { setActiveTab("clientes"); setSearch(""); }}
          className={`px-4 py-2 text-sm rounded-lg transition ${activeTab === "clientes" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
        >
          👥 Clientes ({clients.length})
        </button>
        <button
          onClick={() => { setActiveTab("funcionarios"); setSearch(""); }}
          className={`px-4 py-2 text-sm rounded-lg transition ${activeTab === "funcionarios" ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
        >
          👷 Funcionários ({employees.length})
        </button>
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={activeTab === "clientes" ? "Buscar por nome, CPF ou telefone..." : "Buscar por nome, CPF ou cargo..."}
        />
      </div>

      {/* Clients Tab */}
      {activeTab === "clientes" && (
        <DataTable
          columns={clientColumns}
          data={filteredClients}
          onEdit={openEditClient}
          onDelete={handleDeleteClient}
          actions={(row) => (
            <button
              onClick={() => { setDetailView(row); setDetailTab("dados"); }}
              className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-gray-700 transition"
              title="Ver detalhes"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
            </button>
          )}
          emptyMessage="Nenhum cliente encontrado."
        />
      )}

      {/* Employees Tab */}
      {activeTab === "funcionarios" && (
        <DataTable
          columns={employeeColumns}
          data={filteredEmployees}
          onEdit={openEditEmployee}
          onDelete={user.role === "admin" ? handleDeleteEmployee : undefined}
          emptyMessage="Nenhum funcionário encontrado."
        />
      )}

      {/* Client Modal */}
      {activeTab === "clientes" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Cliente" : "Novo Cliente"} onClose={() => setModalOpen(false)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome *</label>
                <input
                  type="text"
                  value={clientForm.nome}
                  onChange={(e) => setClientForm({ ...clientForm, nome: e.target.value })}
                  placeholder="Nome completo ou Razão Social"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
                <select
                  value={clientForm.tipo}
                  onChange={(e) => setClientForm({ ...clientForm, tipo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="pf">Pessoa Física</option>
                  <option value="pj">Pessoa Jurídica</option>
                </select>
              </div>
              <div>
                {clientForm.tipo === "pf" ? (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">CPF *</label>
                    <input
                      type="text"
                      value={clientForm.cpf}
                      onChange={(e) => setClientForm({ ...clientForm, cpf: formatCPF(e.target.value) })}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">CNPJ *</label>
                    <input
                      type="text"
                      value={clientForm.cnpj}
                      onChange={(e) => setClientForm({ ...clientForm, cnpj: formatCNPJ(e.target.value) })}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                    />
                  </>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefone *</label>
                <input
                  type="text"
                  value={clientForm.telefone}
                  onChange={(e) => setClientForm({ ...clientForm, telefone: formatPhone(e.target.value) })}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={clientForm.email}
                  onChange={(e) => setClientForm({ ...clientForm, email: e.target.value })}
                  placeholder="email@exemplo.com"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Endereço</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Rua</label>
                  <input
                    type="text"
                    value={clientForm.rua}
                    onChange={(e) => setClientForm({ ...clientForm, rua: e.target.value })}
                    placeholder="Rua, Avenida..."
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Número</label>
                  <input
                    type="text"
                    value={clientForm.numero}
                    onChange={(e) => setClientForm({ ...clientForm, numero: e.target.value })}
                    placeholder="123"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Bairro</label>
                  <input
                    type="text"
                    value={clientForm.bairro}
                    onChange={(e) => setClientForm({ ...clientForm, bairro: e.target.value })}
                    placeholder="Bairro"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Cidade</label>
                  <input
                    type="text"
                    value={clientForm.cidade}
                    onChange={(e) => setClientForm({ ...clientForm, cidade: e.target.value })}
                    placeholder="Cidade"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Estado</label>
                  <input
                    type="text"
                    value={clientForm.estado}
                    onChange={(e) => setClientForm({ ...clientForm, estado: e.target.value.toUpperCase().slice(0, 2) })}
                    placeholder="SP"
                    maxLength={2}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">CEP</label>
                  <input
                    type="text"
                    value={clientForm.cep}
                    onChange={(e) => setClientForm({ ...clientForm, cep: formatCEP(e.target.value) })}
                    placeholder="00000-000"
                    maxLength={9}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
              <textarea
                value={clientForm.observacoes}
                onChange={(e) => setClientForm({ ...clientForm, observacoes: e.target.value })}
                rows={3}
                placeholder="Observações sobre o cliente..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
                Cancelar
              </button>
              <button onClick={handleSaveClient} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {editing ? "Salvar Alterações" : "Cadastrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Employee Modal */}
      {activeTab === "funcionarios" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Funcionário" : "Novo Funcionário"} onClose={() => setModalOpen(false)} size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome *</label>
              <input
                type="text"
                value={employeeForm.nome}
                onChange={(e) => setEmployeeForm({ ...employeeForm, nome: e.target.value })}
                placeholder="Nome completo"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">CPF *</label>
                <input
                  type="text"
                  value={employeeForm.cpf}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, cpf: formatCPF(e.target.value) })}
                  placeholder="000.000.000-00"
                  maxLength={14}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefone *</label>
                <input
                  type="text"
                  value={employeeForm.telefone}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, telefone: formatPhone(e.target.value) })}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={employeeForm.email}
                onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })}
                placeholder="email@exemplo.com"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Cargo</label>
                <select
                  value={employeeForm.cargo}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, cargo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="Técnico">Técnico</option>
                  <option value="Administrativo">Administrativo</option>
                  <option value="Gerente">Gerente</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Salário (R$)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={employeeForm.salario}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, salario: e.target.value })}
                  placeholder="0,00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Data de Admissão</label>
                <input
                  type="date"
                  value={employeeForm.dataAdmissao}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, dataAdmissao: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
                <select
                  value={employeeForm.status}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, status: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">
                Cancelar
              </button>
              <button onClick={handleSaveEmployee} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {editing ? "Salvar Alterações" : "Cadastrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Delete */}
      {confirmDelete && (
        <ConfirmDialog
          message={activeTab === "clientes" ? `Excluir "${confirmDelete.nome || ""}" e todos os registros vinculados (OS, transações, tickets, agendamentos)? Esta ação não pode ser desfeita.` : `Excluir "${confirmDelete.nome || ""}"? Esta ação não pode ser desfeita.`}
          onConfirm={activeTab === "clientes" ? confirmDeleteClientAction : confirmDeleteEmployeeAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── MESSAGE CENTER ──────────────────────────────────────────────────────────

function sendWhatsApp(phone, message) {
  const cleanPhone = (phone || "").replace(/\D/g, "");
  const brPhone = cleanPhone.startsWith("55") ? cleanPhone : "55" + cleanPhone;
  const url = `https://wa.me/${brPhone}?text=${encodeURIComponent(message)}`;
  window.open(url, "_blank");

  const log = {
    id: genId(),
    tipo: "whatsapp",
    destinatario: phone,
    mensagem: message,
    template: null,
    status: "enviado",
    data: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  DB.set("erp:message:" + log.id, log);
  return log;
}

function sendEmail(email, subject, body) {
  const url = `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  window.open(url, "_blank");

  const log = {
    id: genId(),
    tipo: "email",
    destinatario: email,
    assunto: subject,
    mensagem: body,
    template: null,
    status: "enviado",
    data: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  };
  DB.set("erp:message:" + log.id, log);
  return log;
}

function MessageCenter({ user, addToast }) {
  const [messages, setMessages] = useState([]);
  const [filterType, setFilterType] = useState("all");
  const [search, setSearch] = useState("");
  const [detailView, setDetailView] = useState(null);
  const [dateFilter, setDateFilter] = useState({ period: "30dias" });

  const loadMessages = useCallback(() => {
    setMessages(DB.list("erp:message:"));
  }, []);

  useEffect(() => { loadMessages(); }, [loadMessages]);

  const filteredMessages = useMemo(() => {
    let list = filterByDate(messages, "data", dateFilter);
    if (filterType !== "all") list = list.filter((m) => m.tipo === filterType);
    if (search.trim()) {
      const s = search.toLowerCase();
      list = list.filter(
        (m) =>
          (m.destinatario || "").toLowerCase().includes(s) ||
          (m.mensagem || "").toLowerCase().includes(s) ||
          (m.assunto || "").toLowerCase().includes(s)
      );
    }
    return list.sort((a, b) => new Date(b.data) - new Date(a.data));
  }, [messages, dateFilter, filterType, search]);

  const columns = [
    { key: "data", label: "Data", render: (v) => formatDateTime(v) },
    {
      key: "tipo", label: "Tipo",
      render: (v) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${v === "whatsapp" ? "bg-green-600" : "bg-blue-600"}`}>
          {v === "whatsapp" ? "WhatsApp" : "Email"}
        </span>
      ),
    },
    { key: "destinatario", label: "Destinatário" },
    {
      key: "mensagem", label: "Conteúdo",
      render: (v, row) => (
        <span className="text-gray-300 truncate max-w-[200px] inline-block">
          {row.assunto || (v || "").slice(0, 60) + ((v || "").length > 60 ? "..." : "")}
        </span>
      ),
    },
    {
      key: "status", label: "Status",
      render: (v) => (
        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white bg-green-500">
          {v === "enviado" ? "Enviado" : v}
        </span>
      ),
    },
  ];

  if (detailView) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <button
            onClick={() => setDetailView(null)}
            className="px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition"
          >
            ← Voltar
          </button>
          <h2 className="text-2xl font-bold text-white">Detalhes da Mensagem</h2>
        </div>

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
          <div className="grid grid-cols-2 gap-6">
            <div>
              <p className="text-xs text-gray-400 uppercase">Tipo</p>
              <p className="text-white">{detailView.tipo === "whatsapp" ? "WhatsApp" : "Email"}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Data/Hora</p>
              <p className="text-white">{formatDateTime(detailView.data)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Destinatário</p>
              <p className="text-white">{detailView.destinatario}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 uppercase">Status</p>
              <p className="text-white">{detailView.status === "enviado" ? "Enviado" : detailView.status}</p>
            </div>
          </div>
          {detailView.assunto && (
            <div>
              <p className="text-xs text-gray-400 uppercase">Assunto</p>
              <p className="text-white">{detailView.assunto}</p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 uppercase">Conteúdo</p>
            <div className="mt-2 bg-gray-700 rounded-lg p-4 text-gray-200 text-sm whitespace-pre-wrap">
              {detailView.mensagem || "—"}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Central de Mensagens</h2>
          <p className="text-gray-400 text-sm mt-1">Histórico de mensagens enviadas</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-4">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar mensagens..." />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
        >
          <option value="all">Todos os tipos</option>
          <option value="whatsapp">WhatsApp</option>
          <option value="email">Email</option>
        </select>
        <DateFilterBar dateFilter={dateFilter} setDateFilter={setDateFilter} />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filteredMessages}
        actions={(row) => (
          <button
            onClick={() => setDetailView(row)}
            className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-gray-700 transition"
            title="Ver detalhes"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
          </button>
        )}
        emptyMessage="Nenhuma mensagem registrada."
      />
    </div>
  );
}

// ─── SETTINGS MODULE ──────────────────────────────────────────────────────────

function SettingsModule({ user, addToast, reloadData }) {
  const [config, setConfig] = useState({
    razaoSocial: "", cnpj: "", telefone: "", email: "", endereco: "",
  });
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmResetFinal, setConfirmResetFinal] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [pendingImportData, setPendingImportData] = useState(null);
  const [systemInfo, setSystemInfo] = useState({ totalRecords: 0, lastBackup: null });
  const fileInputRef = useRef(null);

  const loadConfig = useCallback(() => {
    const cfg = DB.get("erp:config") || {};
    setConfig({
      razaoSocial: cfg.nomeEmpresa || cfg.razaoSocial || "",
      cnpj: cfg.cnpj || "",
      telefone: cfg.telefone || "",
      email: cfg.email || "",
      endereco: cfg.endereco || "",
    });

    // Count total records
    const prefixes = [
      "erp:client:", "erp:employee:", "erp:inventory:", "erp:os:", "erp:services:",
      "erp:schedule:", "erp:finance:", "erp:invoice:", "erp:boleto:", "erp:ticket:",
      "erp:banking:", "erp:pdv:", "erp:message:", "erp:user:",
    ];
    let total = 0;
    prefixes.forEach((p) => { total += DB.list(p).length; });
    const lastBackup = DB.get("erp:lastBackup");
    setSystemInfo({ totalRecords: total, lastBackup });
  }, []);

  useEffect(() => { loadConfig(); }, [loadConfig]);

  const handleSaveConfig = useCallback(() => {
    const existing = DB.get("erp:config") || {};
    const updated = {
      ...existing,
      nomeEmpresa: config.razaoSocial,
      razaoSocial: config.razaoSocial,
      cnpj: config.cnpj,
      telefone: config.telefone,
      email: config.email,
      endereco: config.endereco,
    };
    DB.set("erp:config", updated);
    addToast("Configurações salvas com sucesso.", "success");
    loadConfig();
  }, [config, loadConfig, addToast]);

  // ─── Export Backup ───
  const handleExport = useCallback(() => {
    const backup = {
      clients: DB.list("erp:client:"),
      employees: DB.list("erp:employee:"),
      inventory: DB.list("erp:inventory:"),
      services: DB.list("erp:services:"),
      schedule: DB.list("erp:schedule:"),
      finance: DB.list("erp:finance:"),
      invoices: DB.list("erp:invoice:"),
      bills: DB.list("erp:boleto:"),
      tickets: DB.list("erp:ticket:"),
      processes: DB.list("erp:os:"),
      banking: DB.list("erp:banking:"),
      pdv: DB.list("erp:pdv:"),
      messages: DB.list("erp:message:"),
      config: DB.get("erp:config"),
      users: DB.list("erp:user:"),
      exportedAt: new Date().toISOString(),
      version: "1.0",
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `backup-erp-${toISODate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    DB.set("erp:lastBackup", new Date().toISOString());

    // Log export
    const log = {
      id: genId(),
      tipo: "email",
      destinatario: "sistema",
      assunto: "Backup exportado",
      mensagem: `Backup do sistema exportado em ${formatDateTime(new Date().toISOString())} por ${user.nome}.`,
      status: "enviado",
      data: new Date().toISOString(),
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:message:" + log.id, log);

    addToast("Backup exportado com sucesso.", "success");
    loadConfig();
  }, [user, addToast, loadConfig]);

  // ─── Import Backup ───
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Validate structure
        const requiredKeys = ["clients", "employees", "inventory", "finance", "config", "version"];
        const hasRequired = requiredKeys.every((k) => k in data);
        if (!hasRequired) {
          addToast("Arquivo de backup inválido. Chaves obrigatórias ausentes.", "error");
          return;
        }
        setPendingImportData(data);
        setImportConfirm(true);
      } catch {
        addToast("Erro ao ler o arquivo. Certifique-se de que é um JSON válido.", "error");
      }
    };
    reader.readAsText(file);
    // Reset input
    e.target.value = "";
  }, [addToast]);

  const executeImport = useCallback(() => {
    if (!pendingImportData) return;
    const data = pendingImportData;

    // Clear all DB prefixes
    const prefixes = [
      "erp:client:", "erp:employee:", "erp:inventory:", "erp:os:", "erp:services:",
      "erp:schedule:", "erp:finance:", "erp:invoice:", "erp:boleto:", "erp:ticket:",
      "erp:banking:", "erp:pdv:", "erp:message:", "erp:user:",
    ];
    prefixes.forEach((prefix) => {
      const items = DB.list(prefix);
      items.forEach((item) => { if (item.id) DB.delete(prefix + item.id); });
    });

    // Import all records
    const importList = (items, prefix) => {
      (items || []).forEach((item) => {
        if (item.id) DB.set(prefix + item.id, item);
      });
    };

    importList(data.clients, "erp:client:");
    importList(data.employees, "erp:employee:");
    importList(data.inventory, "erp:inventory:");
    importList(data.services, "erp:services:");
    importList(data.schedule, "erp:schedule:");
    importList(data.finance, "erp:finance:");
    importList(data.invoices, "erp:invoice:");
    importList(data.bills, "erp:boleto:");
    importList(data.tickets, "erp:ticket:");
    importList(data.processes, "erp:os:");
    importList(data.banking, "erp:banking:");
    importList(data.pdv, "erp:pdv:");
    importList(data.messages, "erp:message:");
    importList(data.users, "erp:user:");

    if (data.config) DB.set("erp:config", data.config);

    uploadAllToSupabase();
    setImportConfirm(false);
    setPendingImportData(null);
    addToast("Backup importado com sucesso.", "success");
    if (reloadData) reloadData();
    loadConfig();
  }, [pendingImportData, addToast, reloadData, loadConfig]);

  // ─── Limpar Sistema (apaga tudo, mantém apenas o admin padrão) ───
  const handleResetDemo = useCallback(() => {
    setConfirmReset(true);
  }, []);

  const handleResetDemoConfirm = useCallback(() => {
    setConfirmReset(false);
    setConfirmResetFinal(true);
  }, []);

  const executeResetDemo = useCallback(() => {
    // Clear all data
    const prefixes = [
      "erp:client:", "erp:employee:", "erp:inventory:", "erp:os:", "erp:services:",
      "erp:schedule:", "erp:finance:", "erp:invoice:", "erp:boleto:", "erp:ticket:",
      "erp:banking:", "erp:pdv:", "erp:message:", "erp:user:",
    ];
    prefixes.forEach((prefix) => {
      const items = DB.list(prefix);
      items.forEach((item) => { if (item.id) DB.delete(prefix + item.id); });
    });
    DB.delete("erp:config");
    DB.delete("erp:seeded");
    DB.delete("erp:lastBackup");

    // Cria apenas o usuário admin padrão (sem dados demo)
    const adminUser = {
      id: genId(), email: "biel.atm11@gmail.com", nome: "Gabriel Admin",
      password: hashPassword("gabb0089"), role: "admin",
      avatar: "CA", createdAt: new Date().toISOString(), status: "ativo",
    };
    DB.set("erp:user:" + adminUser.id, adminUser);
    DB.set("erp:seeded", true);
    uploadAllToSupabase();

    setConfirmResetFinal(false);
    addToast("Todos os dados foram apagados. Sistema limpo.", "success");
    if (reloadData) reloadData();
    loadConfig();
  }, [addToast, reloadData, loadConfig]);

  if (user.role !== "admin") {
    return (
      <div className="flex flex-col items-center justify-center py-20">
        <div className="text-5xl mb-4 opacity-50">🔒</div>
        <h3 className="text-lg font-semibold text-gray-300 mb-2">Acesso Restrito</h3>
        <p className="text-gray-500 text-sm">Apenas administradores podem acessar as configurações.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white">Configurações</h2>
        <p className="text-gray-400 text-sm mt-1">Gerencie as configurações do sistema</p>
      </div>

      {/* Company Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Dados da Empresa</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Razão Social</label>
              <input
                type="text"
                value={config.razaoSocial}
                onChange={(e) => setConfig({ ...config, razaoSocial: e.target.value })}
                placeholder="Razão Social da empresa"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">CNPJ</label>
              <input
                type="text"
                value={config.cnpj}
                onChange={(e) => setConfig({ ...config, cnpj: formatCNPJ(e.target.value) })}
                placeholder="00.000.000/0000-00"
                maxLength={18}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefone</label>
              <input
                type="text"
                value={config.telefone}
                onChange={(e) => setConfig({ ...config, telefone: formatPhone(e.target.value) })}
                placeholder="(00) 00000-0000"
                maxLength={15}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={config.email}
                onChange={(e) => setConfig({ ...config, email: e.target.value })}
                placeholder="contato@empresa.com.br"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Endereço</label>
            <input
              type="text"
              value={config.endereco}
              onChange={(e) => setConfig({ ...config, endereco: e.target.value })}
              placeholder="Endereço completo"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>
          <div className="flex justify-end">
            <button onClick={handleSaveConfig} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              Salvar Configurações
            </button>
          </div>
        </div>
      </div>

      {/* Backup & Restore */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Backup e Restauração</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Export */}
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
            <div className="text-3xl mb-2">💾</div>
            <h4 className="text-white font-medium mb-1">Exportar Backup</h4>
            <p className="text-gray-400 text-xs mb-3">Baixar todos os dados em formato JSON</p>
            <button onClick={handleExport} className="w-full px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
              Exportar Backup
            </button>
          </div>

          {/* Import */}
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
            <div className="text-3xl mb-2">📂</div>
            <h4 className="text-white font-medium mb-1">Importar Backup</h4>
            <p className="text-gray-400 text-xs mb-3">Restaurar dados a partir de um arquivo JSON</p>
            <input
              type="file"
              accept=".json"
              ref={fileInputRef}
              onChange={handleFileSelect}
              className="hidden"
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="w-full px-4 py-2 text-sm rounded-lg bg-cyan-600 text-white hover:bg-cyan-700 transition"
            >
              Selecionar Arquivo
            </button>
          </div>

          {/* Reset */}
          <div className="bg-gray-700/50 rounded-lg p-4 border border-gray-600">
            <div className="text-3xl mb-2">🔄</div>
            <h4 className="text-white font-medium mb-1">Limpar Sistema</h4>
            <p className="text-gray-400 text-xs mb-3">Apagar todos os dados e reiniciar do zero</p>
            <button onClick={handleResetDemo} className="w-full px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 transition">
              Apagar Tudo
            </button>
          </div>
        </div>
      </div>

      {/* System Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Informações do Sistema</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-gray-400 uppercase">Versão</p>
            <p className="text-white font-medium">1.0.0</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Último Backup</p>
            <p className="text-white font-medium">{systemInfo.lastBackup ? formatDateTime(systemInfo.lastBackup) : "Nenhum"}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Total de Registros</p>
            <p className="text-white font-medium">{systemInfo.totalRecords}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 uppercase">Usuário Logado</p>
            <p className="text-white font-medium">{user.nome}</p>
          </div>
        </div>
      </div>

      {/* Import Confirm */}
      {importConfirm && (
        <ConfirmDialog
          message="Isso substituirá TODOS os dados atuais. Tem certeza de que deseja importar este backup?"
          onConfirm={executeImport}
          onCancel={() => { setImportConfirm(false); setPendingImportData(null); }}
        />
      )}

      {/* Reset Confirm Step 1 */}
      {confirmReset && (
        <ConfirmDialog
          message="Apagar todos os dados do sistema? Esta ação não pode ser desfeita."
          onConfirm={handleResetDemoConfirm}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {/* Reset Confirm Step 2 */}
      {confirmResetFinal && (
        <ConfirmDialog
          message="ÚLTIMA CONFIRMAÇÃO: Todos os dados serão perdidos permanentemente."
          requireType="APAGAR"
          onConfirm={executeResetDemo}
          onCancel={() => setConfirmResetFinal(false)}
        />
      )}
    </div>
  );
}

// ─── MAIN APP COMPONENT ──────────────────────────────────────────────────────

export default function App() {
  const [user, setUser] = useState(null);
  const [activeModule, setActiveModule] = useState("dashboard");
  const [dateFilter, setDateFilter] = useState({ period: "30dias", startDate: "", endDate: "" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [splashVisible, setSplashVisible] = useState(true);
  const [splashFading, setSplashFading] = useState(false);
  const [splashProgress, setSplashProgress] = useState(0);
  const [splashMessage, setSplashMessage] = useState("Inicializando sistema...");
  const [data, setData] = useState({
    clients: [], employees: [], inventory: [], services: [], schedule: [],
    finance: [], invoices: [], bills: [], tickets: [], banking: [], pdv: [], messages: [], config: {},
  });
  const [notifications, setNotifications] = useState([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const searchRef = useRef(null);

  // ─── Init with Splash Screen ───
  useEffect(() => {
    const steps = [
      { msg: "Inicializando sistema...", pct: 10 },
      { msg: "Verificando banco de dados...", pct: 25 },
      { msg: "Carregando módulos...", pct: 40 },
      { msg: "Configurando permissões...", pct: 55 },
      { msg: "Carregando dados...", pct: 70 },
      { msg: "Preparando interface...", pct: 85 },
      { msg: "Quase pronto...", pct: 95 },
    ];
    let step = 0;
    const interval = setInterval(() => {
      if (step < steps.length) {
        setSplashMessage(steps[step].msg);
        setSplashProgress(steps[step].pct);
        step++;
      }
    }, 350);

    // Real init — hydrate from Supabase, then load
    hydrateFromSupabase().then(() => {
      // Inicialização: cria apenas o usuário admin padrão se não houver nenhum usuário
      const users = DB.list("erp:user:");
      if (users.length === 0) {
        const adminUser = {
          id: genId(), email: "biel.atm11@gmail.com", nome: "Gabriel Admin",
          password: hashPassword("gabb0089"), role: "admin",
          avatar: "CA", createdAt: new Date().toISOString(), status: "ativo",
        };
        DB.set("erp:user:" + adminUser.id, adminUser);
        DB.set("erp:seeded", true);
      }
      loadAllData();
      setLoading(false);
      setSplashProgress(100);
      setSplashMessage("Pronto!");
      clearInterval(interval);

      setTimeout(() => {
        setSplashFading(true);
        setTimeout(() => setSplashVisible(false), 600);
      }, 400);
    });

    return () => clearInterval(interval);
  }, []);

  // ─── Load All Data ───
  const loadAllData = useCallback(() => {
    setData({
      clients: DB.list("erp:client:"),
      employees: DB.list("erp:employee:"),
      inventory: DB.list("erp:inventory:"),
      services: DB.list("erp:services:"),
      schedule: DB.list("erp:schedule:"),
      finance: DB.list("erp:finance:"),
      invoices: DB.list("erp:invoice:"),
      bills: DB.list("erp:boleto:"),
      tickets: DB.list("erp:ticket:"),
      banking: DB.list("erp:banking:"),
      pdv: DB.list("erp:pdv:"),
      messages: DB.list("erp:message:"),
      config: DB.get("erp:config") || {},
    });
  }, []);

  // ─── Add Toast ───
  const addToast = useCallback((message, type = "info") => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type, duration: 4000 }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Compute Notifications ───
  const computedNotifications = useMemo(() => {
    const alerts = [];
    // Low stock
    data.inventory.forEach((item) => {
      if (item.quantidade <= item.quantidadeMinima) {
        alerts.push({
          id: "stock-" + item.id,
          type: "warning",
          message: `Estoque baixo: ${item.nome} (${item.quantidade} ${item.unidade || "un"})`,
          module: "estoque",
        });
      }
    });
    // Overdue bills
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    data.finance
      .filter((t) => t.tipo === "despesa" && t.status === "pendente")
      .forEach((t) => {
        const dueDate = new Date(t.data);
        if (dueDate < today) {
          alerts.push({
            id: "bill-" + t.id,
            type: "error",
            message: `Conta vencida: ${t.descricao} - ${formatCurrency(t.valor)}`,
            module: "financeiro",
          });
        }
      });
    // Pending tickets
    data.tickets
      .filter((t) => t.status === "aberto" && t.prioridade === "alta")
      .forEach((t) => {
        alerts.push({
          id: "ticket-" + t.id,
          type: "info",
          message: `Ticket urgente: ${t.titulo}`,
          module: "webdesk",
        });
      });
    return alerts;
  }, [data]);

  useEffect(() => {
    setNotifications(computedNotifications);
  }, [computedNotifications]);

  // ─── Global Search ───
  useEffect(() => {
    if (!globalSearch.trim()) {
      setGlobalSearchResults([]);
      setShowSearchResults(false);
      return;
    }
    const s = globalSearch.toLowerCase();
    const results = [];

    // Search clients
    data.clients.filter((c) => (c.nome || "").toLowerCase().includes(s)).slice(0, 5).forEach((c) => {
      results.push({ type: "Cliente", label: c.nome, sub: c.tipo === "pf" ? c.cpf : c.cnpj, module: "cadastro", id: c.id });
    });

    // Search OS
    data.services.filter((o) => (o.numero || "").toLowerCase().includes(s) || (o.clienteNome || "").toLowerCase().includes(s)).slice(0, 5).forEach((o) => {
      results.push({ type: "OS", label: o.numero + " - " + (o.clienteNome || ""), sub: o.tipo, module: "processos", id: o.id });
    });

    // Search invoices
    data.invoices.filter((i) => (i.numero || "").toLowerCase().includes(s) || (i.clienteNome || "").toLowerCase().includes(s)).slice(0, 5).forEach((i) => {
      results.push({ type: "NF", label: i.numero + " - " + (i.clienteNome || ""), sub: formatCurrency(i.valorTotal), module: "notas", id: i.id });
    });

    // Search finance
    data.finance.filter((t) => (t.descricao || "").toLowerCase().includes(s) || (t.numero || "").toLowerCase().includes(s)).slice(0, 5).forEach((t) => {
      results.push({ type: "Financeiro", label: t.numero + " - " + t.descricao, sub: formatCurrency(t.valor), module: "financeiro", id: t.id });
    });

    // Search inventory
    data.inventory.filter((i) => (i.nome || "").toLowerCase().includes(s) || (i.sku || "").toLowerCase().includes(s)).slice(0, 3).forEach((i) => {
      results.push({ type: "Estoque", label: i.nome, sub: `Qtd: ${i.quantidade}`, module: "estoque", id: i.id });
    });

    setGlobalSearchResults(results);
    setShowSearchResults(results.length > 0);
  }, [globalSearch, data]);

  // Close search results on click outside
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearchResults(false);
      }
      if (showNotifications) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showNotifications]);

  // ─── Sidebar Nav Items ───
  const navItems = useMemo(() => {
    const items = [
      { id: "dashboard", label: "Dashboard", icon: "📊", module: "dashboard" },
      { id: "financeiro", label: "Financeiro", icon: "💰", module: "financeiro" },
      { id: "estoque", label: "Estoque", icon: "📦", module: "estoque" },
      { id: "notas", label: "Notas e Boletos", icon: "📄", module: "notas" },
      { id: "pdv", label: "PDV", icon: "🛒", module: "pdv" },
      { id: "webdesk", label: "Webdesk", icon: "🎫", module: "webdesk" },
      { id: "processos", label: "Ordens de Serviço", icon: "🔧", module: "processos" },
      { id: "agenda", label: "Agenda", icon: "📅", module: "agenda" },
      { id: "conciliacao", label: "Conciliação Bancária", icon: "🏦", module: "conciliacao" },
      { id: "cadastro", label: "Cadastros", icon: "👥", module: "cadastro" },
      { id: "mensagens", label: "Mensagens", icon: "💬", module: "mensagens" },
      { id: "config", label: "Configurações", icon: "⚙️", module: "config" },
    ];

    if (!user) return [];
    const perms = ROLE_PERMISSIONS[user.role] || [];
    if (perms.includes("all")) return items;

    return items.filter((item) => {
      if (item.id === "dashboard") return true;
      if (item.id === "config") return user.role === "admin";
      return perms.includes(item.id) || perms.includes(item.module);
    });
  }, [user]);

  const activeModuleLabel = useMemo(() => {
    const item = navItems.find((n) => n.id === activeModule);
    return item ? item.label : "Dashboard";
  }, [navItems, activeModule]);

  // ─── Login Handler ───
  const handleLogin = useCallback((u) => {
    setUser(u);
    setActiveModule("dashboard");
    loadAllData();
  }, [loadAllData]);

  const handleLogout = useCallback(() => {
    setUser(null);
    setActiveModule("dashboard");
    setGlobalSearch("");
    setGlobalSearchResults([]);
  }, []);

  // ─── Render ───
  if (splashVisible) {
    return (
      <div
        className="min-h-screen flex items-center justify-center overflow-hidden"
        style={{
          background: "linear-gradient(135deg, #0b1120 0%, #0f172a 40%, #0c1425 100%)",
          opacity: splashFading ? 0 : 1,
          transition: "opacity 0.6s ease-out",
        }}
      >
        <StyleSheet />
        <div className="text-center" style={{ animation: "fadeIn 0.8s ease-out" }}>
          {/* Animated snowflake logo */}
          <div className="relative mb-8 inline-block">
            <div
              className="text-8xl"
              style={{
                animation: "spin 4s linear infinite",
                filter: "drop-shadow(0 0 30px rgba(59, 130, 246, 0.5))",
              }}
            >
              ❄️
            </div>
            <div
              className="absolute inset-0 text-8xl"
              style={{
                animation: "spin 4s linear infinite reverse",
                opacity: 0.15,
                filter: "blur(8px)",
              }}
            >
              ❄️
            </div>
          </div>

          {/* Marca — usa div em vez de h1 para evitar múltiplos h1 na página */}
          <div
            className="text-5xl font-bold mb-2"
            style={{
              background: "linear-gradient(135deg, #3b82f6, #06b6d4, #3b82f6)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              animation: "gradientShift 3s ease infinite",
            }}
          >
            FrostERP
          </div>
          <p className="text-gray-500 text-sm mb-10 tracking-widest uppercase">
            Sistema de Gestão Integrada
          </p>

          {/* Progress bar */}
          <div className="w-72 mx-auto">
            <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden mb-4">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${splashProgress}%`,
                  background: "linear-gradient(90deg, #3b82f6, #06b6d4)",
                  transition: "width 0.4s ease-out",
                  boxShadow: "0 0 12px rgba(6, 182, 212, 0.4)",
                }}
              />
            </div>
            <p className="text-gray-500 text-xs tracking-wide">{splashMessage}</p>
            <p className="text-gray-700 text-xs mt-1">{splashProgress}%</p>
          </div>

          {/* Decorative particles */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            {[...Array(6)].map((_, i) => (
              <div
                key={i}
                className="absolute text-blue-500/10"
                style={{
                  fontSize: `${12 + i * 4}px`,
                  left: `${15 + i * 14}%`,
                  top: `${20 + (i % 3) * 25}%`,
                  animation: `floatParticle ${3 + i * 0.5}s ease-in-out infinite`,
                  animationDelay: `${i * 0.3}s`,
                }}
              >
                ❄
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <>
        <StyleSheet />
        <LoginScreen onLogin={handleLogin} />
      </>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-['DM_Sans']">
      <StyleSheet />

      {/* Sidebar */}
      <aside
        className={`fixed lg:static inset-y-0 left-0 z-40 bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-300 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
        } ${sidebarCollapsed ? "w-16" : "w-64"}`}
      >
        {/* Logo */}
        <div className={`flex items-center gap-3 px-4 py-5 border-b border-gray-700 ${sidebarCollapsed ? "justify-center" : ""}`}>
          <span className="text-2xl">❄️</span>
          {!sidebarCollapsed && (
            <div>
              <span className="text-lg font-bold text-white">FrostERP</span>
              <p className="text-xs text-gray-400">Gestão Integrada</p>
            </div>
          )}
        </div>

        {/* Collapse button (desktop) */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className="hidden lg:flex items-center justify-center py-2 text-gray-400 hover:text-white hover:bg-gray-700/50 transition border-b border-gray-700"
          title={sidebarCollapsed ? "Expandir" : "Recolher"}
        >
          <svg className={`w-4 h-4 transition-transform ${sidebarCollapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
          </svg>
        </button>

        {/* Nav Items */}
        <nav className="flex-1 overflow-y-auto py-4 px-2 space-y-1" aria-label="Menu principal">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => {
                setActiveModule(item.id);
                setSidebarOpen(false);
                setGlobalSearch("");
                setGlobalSearchResults([]);
                setShowSearchResults(false);
              }}
              title={sidebarCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-all ${
                activeModule === item.id
                  ? "bg-blue-600 text-white shadow-lg shadow-blue-600/20"
                  : "text-gray-300 hover:bg-gray-700 hover:text-white"
              } ${sidebarCollapsed ? "justify-center" : ""}`}
            >
              <span className="text-lg flex-shrink-0">{item.icon}</span>
              {!sidebarCollapsed && <span className="truncate">{item.label}</span>}
            </button>
          ))}
        </nav>

        {/* Version */}
        <div className={`px-4 py-3 border-t border-gray-700 text-xs text-gray-500 ${sidebarCollapsed ? "text-center" : ""}`}>
          {sidebarCollapsed ? "v1.0" : "FrostERP ERP v1.0.0"}
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Main content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <header className="bg-gray-800 border-b border-gray-700 px-4 lg:px-6 py-3">
          <div className="flex items-center gap-4 flex-wrap">
            {/* Hamburger (mobile) */}
            <button
              onClick={() => setSidebarOpen(true)}
              className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition"
              aria-label="Abrir menu"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>

            {/* Breadcrumb — trunca em telas menores para não quebrar o header */}
            <div className="hidden md:flex items-center gap-2 text-sm min-w-0 flex-shrink-0">
              <span className="text-gray-400 flex-shrink-0">FrostERP</span>
              <span className="text-gray-600 flex-shrink-0">›</span>
              <span className="text-white font-medium truncate max-w-[180px]">{activeModuleLabel}</span>
            </div>

            {/* Filtro de data — só aparece em páginas que usam período */}
            {["dashboard", "financeiro", "notas", "webdesk", "processos", "agenda", "conciliacao"].includes(activeModule) && (
              <div className="hidden xl:block ml-4">
                <DateFilterBar dateFilter={dateFilter} setDateFilter={setDateFilter} />
              </div>
            )}

            {/* Spacer */}
            <div className="flex-1" />

            {/* Global Search */}
            <div className="relative" ref={searchRef}>
              <div className="relative">
                <svg className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                </svg>
                <input
                  type="text"
                  value={globalSearch}
                  onChange={(e) => setGlobalSearch(e.target.value)}
                  onFocus={() => { if (globalSearchResults.length > 0) setShowSearchResults(true); }}
                  placeholder="Buscar..."
                  aria-label="Busca global"
                  name="globalSearch"
                  id="globalSearch"
                  className="w-48 lg:w-64 bg-gray-700 border border-gray-600 rounded-lg pl-10 pr-4 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>

              {/* Search Results Dropdown */}
              {showSearchResults && globalSearchResults.length > 0 && (
                <div className="absolute right-0 top-full mt-2 w-96 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto animate-slideDown">
                  {/* Group by type */}
                  {(() => {
                    const grouped = {};
                    globalSearchResults.forEach((r) => {
                      if (!grouped[r.type]) grouped[r.type] = [];
                      grouped[r.type].push(r);
                    });
                    return Object.entries(grouped).map(([type, items]) => (
                      <div key={type}>
                        <div className="px-4 py-2 text-xs font-medium text-gray-400 uppercase bg-gray-700/50 sticky top-0">
                          {type}
                        </div>
                        {items.map((item, idx) => (
                          <button
                            key={idx}
                            onClick={() => {
                              setActiveModule(item.module);
                              setGlobalSearch("");
                              setShowSearchResults(false);
                            }}
                            className="w-full px-4 py-2.5 flex items-center justify-between hover:bg-gray-700/50 transition text-left"
                          >
                            <div>
                              <p className="text-sm text-white">{item.label}</p>
                              <p className="text-xs text-gray-400">{item.sub}</p>
                            </div>
                            <svg className="w-4 h-4 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                          </button>
                        ))}
                      </div>
                    ));
                  })()}
                </div>
              )}
            </div>

            {/* Notifications Bell */}
            <div className="relative">
              <button
                onClick={() => setShowNotifications(!showNotifications)}
                className="relative p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition"
                aria-label="Notificações"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                {notifications.length > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-5 h-5 bg-red-500 text-white text-xs rounded-full flex items-center justify-center font-bold">
                    {notifications.length}
                  </span>
                )}
              </button>

              {/* Notifications Dropdown */}
              {showNotifications && (
                <div className="absolute right-0 top-full mt-2 w-80 bg-gray-800 border border-gray-700 rounded-xl shadow-2xl z-50 max-h-[400px] overflow-y-auto animate-slideDown">
                  <div className="px-4 py-3 border-b border-gray-700">
                    <h4 className="text-white font-medium text-sm">Notificações ({notifications.length})</h4>
                  </div>
                  {notifications.length === 0 ? (
                    <div className="px-4 py-8 text-center text-gray-400 text-sm">Nenhuma notificação.</div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        onClick={() => {
                          setActiveModule(n.module);
                          setShowNotifications(false);
                        }}
                        className="w-full px-4 py-3 flex items-start gap-3 hover:bg-gray-700/50 transition text-left border-b border-gray-700/50"
                      >
                        <span className={`mt-0.5 w-2 h-2 rounded-full flex-shrink-0 ${n.type === "error" ? "bg-red-500" : n.type === "warning" ? "bg-yellow-500" : "bg-blue-500"}`} />
                        <p className="text-sm text-gray-300">{n.message}</p>
                      </button>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* User Info */}
            <div className="hidden md:flex items-center gap-3 ml-2 pl-4 border-l border-gray-700">
              <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-white text-sm font-bold">
                {(user.nome || "U").charAt(0)}
              </div>
              <div className="hidden lg:block">
                <p className="text-sm font-medium text-white leading-tight">{user.nome}</p>
                <p className="text-xs text-gray-400 capitalize">{user.role}</p>
              </div>
            </div>

            {/* Logout */}
            <button
              onClick={handleLogout}
              className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition"
              title="Sair"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>

          {/* Filtro de data mobile — só aparece em páginas que usam período */}
          {["dashboard", "financeiro", "notas", "webdesk", "processos", "agenda", "conciliacao"].includes(activeModule) && (
            <div className="xl:hidden mt-3">
              <DateFilterBar dateFilter={dateFilter} setDateFilter={setDateFilter} />
            </div>
          )}
        </header>

        {/* Content Area */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
          {activeModule === "dashboard" && (
            <Dashboard user={user} dateFilter={dateFilter} onNavigate={setActiveModule} />
          )}
          {activeModule === "financeiro" && (
            <FinanceModule user={user} dateFilter={dateFilter} addToast={addToast} />
          )}
          {activeModule === "estoque" && (
            <InventoryModule user={user} addToast={addToast} />
          )}
          {activeModule === "notas" && (
            <InvoiceModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} />
          )}
          {activeModule === "pdv" && (
            <PDVModule user={user} addToast={addToast} inventory={data.inventory} reloadData={loadAllData} />
          )}
          {activeModule === "webdesk" && (
            <WebdeskModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} />
          )}
          {activeModule === "processos" && (
            <ProcessModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} employees={data.employees} />
          )}
          {activeModule === "agenda" && (
            <ScheduleModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} employees={data.employees} />
          )}
          {activeModule === "conciliacao" && (
            <BankingModule user={user} dateFilter={dateFilter} addToast={addToast} />
          )}
          {activeModule === "cadastro" && (
            <CadastroModule user={user} addToast={addToast} />
          )}
          {activeModule === "mensagens" && (
            <MessageCenter user={user} addToast={addToast} />
          )}
          {activeModule === "config" && (
            <SettingsModule user={user} addToast={addToast} reloadData={loadAllData} />
          )}
        </main>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
