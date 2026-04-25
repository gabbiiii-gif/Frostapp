import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";
import { hydrateFromSupabase, uploadAllToSupabase, syncToSupabase, deleteFromSupabase, subscribeToChanges, uploadFotoOS, deleteFotoOS } from "./supabase.js";
import Aurora from "./Aurora.jsx";
import BlurText from "./BlurText.jsx";

// ─── CONSTANTS ──────────────────────────────────────────────────────────────────

// Paleta compartilhada por gráficos e badges
const COLORS = ["#3b82f6", "#06b6d4", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899", "#14b8a6"];

// Mapeamento global de status — usado pelo StatusBadge em OS, Agenda, Cadastros e Financeiro
const STATUS_MAP = {
  ativo: { label: "Ativo", color: "bg-green-500" },
  inativo: { label: "Inativo", color: "bg-gray-500" },
  concluido: { label: "Concluído", color: "bg-green-500" },
  pendente: { label: "Pendente", color: "bg-yellow-500" },
  em_andamento: { label: "Em Andamento", color: "bg-blue-500" },
  cancelado: { label: "Cancelado", color: "bg-red-500" },
  agendado: { label: "Agendado", color: "bg-cyan-500" },
  confirmado: { label: "Confirmado", color: "bg-blue-500" },
  // ─── Novos status do fluxo Tech App → ERP ───────────────────────────────
  // Técnico chegou no local e iniciou o serviço
  em_servico: { label: "Em Serviço", color: "bg-blue-600" },
  // Técnico terminou e enviou relatório — aguarda revisão admin/gerente para fechar OS
  aguardando_finalizacao: { label: "Aguardando Finalização", color: "bg-orange-500" },
  pago: { label: "Pago", color: "bg-green-500" },
  atrasado: { label: "Atrasado", color: "bg-red-500" },
};

// Matriz de permissões por role — inclui módulo financeiro
const ROLE_PERMISSIONS = {
  admin: ["all"],
  gerente: ["dashboard", "clientes", "funcionarios", "financeiro", "os", "agenda", "config"],
  tecnico: ["dashboard", "os", "agenda"],
  atendente: ["dashboard", "clientes", "os", "agenda"],
};

// ─── CATEGORIAS E FORMAS DE PAGAMENTO DO FINANCEIRO ─────────────────────────
// Categorias separadas em receita (entradas) e despesa (saídas) para
// evitar confusão no relatório — o usuário só vê as categorias relevantes
// ao tipo selecionado.
const CATEGORIES_RECEITA = [
  "Instalação",
  "Manutenção",
  "Troca de Peças",
  "Solda",
  "Venda de Equipamento",
  "Venda de Peça",
  "Contrato de Manutenção",
  "Outros",
];

const CATEGORIES_DESPESA = [
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

const PAYMENT_METHODS = [
  "PIX",
  "Cartão de Crédito",
  "Cartão de Débito",
  "Boleto",
  "Dinheiro",
  "Transferência",
];

// ─── TIPOS DE EQUIPAMENTO — OS ──────────────────────────────────────────────
// Cada tipo define quais campos técnicos aparecem no formulário de OS.
// Usado para refrigeração comercial, climatização e linha branca.
const EQUIPMENT_TYPES = {
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

// ─── TIPOS DE SERVIÇO — OS ───────────────────────────────────────────────────
// Lista usada no dropdown de serviços da OS e da Agenda.
// Removidos: Higienização, Reparo. Adicionados: Troca de Peças, Solda.
const SERVICE_TYPES_OS = [
  "Instalação",
  "Manutenção",
  "Troca de Peças",
  "Solda",
  "Desinstalação",
];

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

// Token criptograficamente seguro (32 bytes em hex) — usado para sessão
function genSecureToken() {
  if (crypto?.getRandomValues) {
    const arr = new Uint8Array(32);
    crypto.getRandomValues(arr);
    return Array.from(arr, (b) => b.toString(16).padStart(2, "0")).join("");
  }
  // Fallback inseguro apenas para ambientes sem WebCrypto (não-HTTPS)
  return genId() + genId();
}

// SHA-256 em hex — usado para validar token de sessão sem armazená-lo em claro
async function sha256Hex(str) {
  if (!crypto?.subtle) return str;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");
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
    // Extrai apenas a parte da data (YYYY-MM-DD) para evitar conversão de fuso horário
    const datePart = String(dateStr).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
      const [y, m, d] = datePart.split("-");
      return `${d}/${m}/${y}`;
    }
    return new Date(dateStr).toLocaleDateString("pt-BR");
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

// ─── Hash legado (mantido apenas para migração de senhas antigas) ────────────
function hashPasswordLegacy(pwd) {
  let hash = 0;
  const salt = "frostErpSalt2024";
  const salted = salt + pwd + salt;
  for (let i = 0; i < salted.length; i++) {
    const char = salted.charCodeAt(i);
    hash = ((hash << 5) - hash + char) | 0;
  }
  let result = "";
  let h = hash;
  for (let i = 0; i < 8; i++) {
    h = ((h * 2654435761) >>> 0);
    result += h.toString(16).padStart(8, "0");
  }
  return result;
}

// ─── Hash seguro com PBKDF2 via Web Crypto API ───────────────────���──────────
// Retorna formato "pbkdf2:<base64-salt>:<base64-hash>"
// Usa salt aleatório por usuário, 100k iterações, SHA-256
async function hashPassword(pwd, existingSalt = null) {
  // Fallback para navegadores sem Web Crypto (contextos inseguros)
  if (!crypto?.subtle) {
    return hashPasswordLegacy(pwd);
  }
  const encoder = new TextEncoder();
  const salt = existingSalt
    ? Uint8Array.from(atob(existingSalt), (c) => c.charCodeAt(0))
    : crypto.getRandomValues(new Uint8Array(16));

  const keyMaterial = await crypto.subtle.importKey(
    "raw", encoder.encode(pwd), "PBKDF2", false, ["deriveBits"]
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256
  );
  const hashArray = new Uint8Array(derivedBits);
  const saltB64 = btoa(String.fromCharCode(...salt));
  const hashB64 = btoa(String.fromCharCode(...hashArray));
  return `pbkdf2:${saltB64}:${hashB64}`;
}

// ─── Verificação de senha com suporte a migração automática ──────────────────
// Retorna { match: boolean, needsRehash: boolean }
// Detecta formato PBKDF2, legado (DJB2) e antigo (base64/btoa)
async function checkPassword(plain, stored) {
  // Formato novo PBKDF2
  if (stored && stored.startsWith("pbkdf2:")) {
    const parts = stored.split(":");
    if (parts.length === 3) {
      const rehashed = await hashPassword(plain, parts[1]);
      return { match: rehashed === stored, needsRehash: false };
    }
  }
  // Formato legado (DJB2 customizado)
  if (stored === hashPasswordLegacy(plain)) {
    return { match: true, needsRehash: true };
  }
  // Formato antigo (base64 — inseguro, apenas para migração)
  try {
    if (stored === btoa(plain)) {
      return { match: true, needsRehash: true };
    }
  } catch { /* ignora erro de codificação */ }
  return { match: false, needsRehash: false };
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

// Lista de módulos disponíveis para autorização manual no gerenciamento de usuários
// Mantida em sincronia com navItems do App (remoções de sessões devem ocorrer aqui também)
const ALL_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "processos", label: "Ordens de Serviço" },
  { id: "agenda", label: "Agenda" },
  { id: "cadastro", label: "Cadastros" },
  { id: "config", label: "Configurações (admin)" },
];

// hasPermission respeita customPermissions quando o array está definido (mesmo vazio,
// permitindo que o admin restrinja totalmente um usuário). Caso contrário, cai no role.
function hasPermission(user, module) {
  if (!user || !user.role) return false;
  if (Array.isArray(user.customPermissions)) {
    return user.customPermissions.includes("all") || user.customPermissions.includes(module);
  }
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

// Apaga todas as credenciais (locais e remotas) — usado em migração e em "esqueci a senha"
function purgeAllUsers() {
  const keys = [];
  for (let i = 0; i < window.storage.length; i++) {
    const k = window.storage.key(i);
    if (k && k.startsWith("erp:user:")) keys.push(k);
  }
  keys.forEach((k) => DB.delete(k));
  return keys.length;
}

async function seedDatabase() {
  // Migração única: ao detectar versão antiga, limpa TODOS os usuários demo
  // para forçar o cadastro do primeiro super admin pelo próprio cliente.
  if (!DB.get("erp:credentialsCleared_v1")) {
    purgeAllUsers();
    DB.set("erp:credentialsCleared_v1", true);
  }

  if (DB.get("erp:seeded")) return;

  // NÃO há mais usuários demo — o primeiro acesso exibe a tela de cadastro
  // do super admin. Veja o componente FirstUserSetup.

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
      createdAt: daysFromNow(0) + "T10:00:00.000Z",
    },
  ];
  serviceOrders.forEach((os) => DB.set("erp:os:" + os.id, os));

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

  // ─── Botão "voltar" do navegador/Android fecha o modal em vez de sair da página ───
  useEffect(() => {
    if (!isOpen) return;
    let poppedByBack = false;
    // Empilha estado para que o "voltar" caia aqui em vez de navegar fora
    window.history.pushState({ modal: true }, "");
    const onPop = () => {
      poppedByBack = true;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      // Se o modal foi fechado por X/Esc (não pelo botão voltar), remove o estado empilhado
      if (!poppedByBack && window.history.state?.modal) {
        window.history.back();
      }
    };
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

  useEffect(() => { setPage(1); }, [data]);

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
              {columns.map((col) => {
                const sortable = col.sortable !== false;
                const isSorted = sortKey === col.key;
                const ariaSort = !sortable ? undefined : isSorted ? (sortDir === "asc" ? "ascending" : "descending") : "none";
                return (
                  <th
                    key={col.key}
                    onClick={() => sortable && handleSort(col.key)}
                    onKeyDown={(e) => { if (sortable && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); handleSort(col.key); } }}
                    tabIndex={sortable ? 0 : undefined}
                    role={sortable ? "button" : undefined}
                    aria-sort={ariaSort}
                    className={`px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider ${sortable ? "cursor-pointer hover:text-white select-none" : ""} ${col.width || ""}`}
                  >
                    <div className="flex items-center gap-1">
                      {col.label}
                      {isSorted && (
                        <span className="text-blue-400" aria-hidden="true">{sortDir === "asc" ? "↑" : "↓"}</span>
                      )}
                    </div>
                  </th>
                );
              })}
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
                    <div className="flex items-center justify-end gap-0.5 sm:gap-1">
                      {actions && actions(row)}
                      {onEdit && (
                        <button
                          onClick={() => onEdit(row)}
                          className="p-2 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                          title="Editar"
                          aria-label="Editar"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" /></svg>
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => onDelete(row)}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition inline-flex items-center justify-center min-h-[36px] min-w-[36px]"
                          title="Excluir"
                          aria-label="Excluir"
                        >
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
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-gray-700">
          <p className="text-xs sm:text-sm text-gray-400">
            {startIdx}-{endIdx} de {sorted.length}
          </p>
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              aria-label="Página anterior"
              className="px-2.5 sm:px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[36px]"
            >
              ‹
            </button>
            {/* Em mobile mostra só página atual; em sm+ mostra até 5 páginas com ellipsis */}
            <span className="sm:hidden px-3 py-1.5 text-sm text-gray-300 min-w-[60px] text-center">
              {page} / {totalPages}
            </span>
            <div className="hidden sm:flex gap-1">
              {(() => {
                const pages = [];
                const maxVisible = 5;
                if (totalPages <= maxVisible) {
                  for (let i = 1; i <= totalPages; i++) pages.push(i);
                } else {
                  pages.push(1);
                  let start = Math.max(2, page - 1);
                  let end = Math.min(totalPages - 1, page + 1);
                  if (start > 2) pages.push("…");
                  for (let i = start; i <= end; i++) pages.push(i);
                  if (end < totalPages - 1) pages.push("…");
                  pages.push(totalPages);
                }
                return pages.map((p, i) =>
                  p === "…" ? (
                    <span key={"el-" + i} className="px-2 py-1.5 text-sm text-gray-500">…</span>
                  ) : (
                    <button
                      key={p}
                      onClick={() => setPage(p)}
                      aria-current={p === page ? "page" : undefined}
                      className={`px-3 py-1.5 text-sm rounded-lg transition min-h-[36px] min-w-[36px] ${p === page ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
                    >
                      {p}
                    </button>
                  )
                );
              })()}
            </div>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              aria-label="Próxima página"
              className="px-2.5 sm:px-3 py-1.5 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 disabled:opacity-40 disabled:cursor-not-allowed transition min-h-[36px]"
            >
              ›
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

// Chave usada para persistir tentativas de login entre recargas (sessionStorage)
const LOGIN_ATTEMPTS_KEY = "frost_login_attempts";

function readLoginAttempts() {
  try {
    const raw = sessionStorage.getItem(LOGIN_ATTEMPTS_KEY);
    if (!raw) return { count: 0, lockoutUntil: 0 };
    const parsed = JSON.parse(raw);
    return { count: Number(parsed.count) || 0, lockoutUntil: Number(parsed.lockoutUntil) || 0 };
  } catch {
    return { count: 0, lockoutUntil: 0 };
  }
}

function writeLoginAttempts(state) {
  try { sessionStorage.setItem(LOGIN_ATTEMPTS_KEY, JSON.stringify(state)); } catch { /* ignora */ }
}

function clearLoginAttempts() {
  try { sessionStorage.removeItem(LOGIN_ATTEMPTS_KEY); } catch { /* ignora */ }
}

function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Inicializa a partir do sessionStorage para que o lockout persista entre recargas
  const initial = readLoginAttempts();
  const [failedAttempts, setFailedAttempts] = useState(initial.count);
  const [lockoutUntil, setLockoutUntil] = useState(initial.lockoutUntil > Date.now() ? initial.lockoutUntil : null);
  const [lockoutSeconds, setLockoutSeconds] = useState(0);

  // Countdown do lockout — atualiza a cada segundo enquanto bloqueado
  useEffect(() => {
    if (!lockoutUntil) { setLockoutSeconds(0); return; }
    const tick = () => {
      const remaining = Math.ceil((lockoutUntil - Date.now()) / 1000);
      if (remaining <= 0) { setLockoutUntil(null); setLockoutSeconds(0); }
      else setLockoutSeconds(remaining);
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lockoutUntil]);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError("");

    // Rate limiting — bloqueia tentativas durante lockout (consulta sessionStorage também)
    const persisted = readLoginAttempts();
    const effectiveLockout = Math.max(lockoutUntil || 0, persisted.lockoutUntil || 0);
    if (effectiveLockout && Date.now() < effectiveLockout) {
      setError(`Aguarde ${Math.ceil((effectiveLockout - Date.now()) / 1000)}s antes de tentar novamente.`);
      return;
    }

    if (!email.trim() || !password.trim()) {
      setError("Preencha todos os campos.");
      return;
    }

    // Validação de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      setError("Formato de email inválido.");
      return;
    }

    setLoading(true);
    try {
      const users = DB.list("erp:user:");
      let found = null;

      // checkPassword é async (PBKDF2) — verifica cada usuário
      // Comparação case-insensitive para tolerar registros antigos
      for (const u of users) {
        if ((u.email || "").trim().toLowerCase() === normalizedEmail) {
          const result = await checkPassword(password, u.password);
          if (result.match) {
            // Normaliza email persistido caso esteja em maiúsculas
            if (u.email !== normalizedEmail) u.email = normalizedEmail;
            // Migração automática: re-hash com PBKDF2 se senha em formato antigo
            if (result.needsRehash) {
              const newHash = await hashPassword(password);
              u.password = newHash;
            }
            DB.set("erp:user:" + u.id, u);
            found = u;
            break;
          }
        }
      }

      if (found) {
        setFailedAttempts(0);
        setLockoutUntil(null);
        clearLoginAttempts();
        onLogin(found);
      } else {
        const attempts = (persisted.count || failedAttempts) + 1;
        // Lockout progressivo: 5 falhas=30s, 10=60s, 15+=300s
        let nextLockout = 0;
        if (attempts >= 15) nextLockout = Date.now() + 300000;
        else if (attempts >= 10) nextLockout = Date.now() + 60000;
        else if (attempts >= 5) nextLockout = Date.now() + 30000;
        setFailedAttempts(attempts);
        setLockoutUntil(nextLockout || null);
        writeLoginAttempts({ count: attempts, lockoutUntil: nextLockout });
        setError("Email ou senha incorretos.");
      }
    } finally {
      setLoading(false);
    }
  }, [email, password, onLogin, failedAttempts, lockoutUntil]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4" style={{ position: 'relative', overflow: 'hidden' }}>
      {/* Aurora animated background */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0 }}>
        <Aurora
          colorStops={["#4e487f", "#433a5f", "#5227FF"]}
          amplitude={1}
          blend={0.43}
        />
      </div>
      <div className="w-full max-w-md animate-slideIn" style={{ position: 'relative', zIndex: 1 }}>
        <div className="bg-gray-800/70 backdrop-blur-2xl rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.4)] border border-white/10 p-6 sm:p-8 ring-1 ring-white/5">
          <div className="text-center mb-8">
            <div className="text-6xl mb-3 drop-shadow-[0_4px_12px_rgba(96,165,250,0.35)]">❄️</div>
            <h2 className="text-2xl font-bold text-white tracking-tight">FrostERP</h2>
            <p className="text-gray-400 text-sm mt-1">Sistema de Gestão Integrada</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                id="login-email"
                name="email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                placeholder="seu@email.com.br"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
                autoFocus
              />
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
              <input
                id="login-password"
                name="password"
                type="password"
                autoComplete="current-password"
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

            {lockoutSeconds > 0 && (
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg px-4 py-2.5 text-yellow-400 text-sm text-center">
                Bloqueado por {lockoutSeconds}s — muitas tentativas incorretas
              </div>
            )}

            <button
              type="submit"
              disabled={loading || lockoutSeconds > 0}
              className="w-full bg-gradient-to-b from-blue-500 to-blue-600 text-white py-3 rounded-lg font-medium hover:from-blue-400 hover:to-blue-500 active:scale-[0.98] transition disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-blue-600/25 min-h-[44px]"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" aria-hidden="true">
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
              FrostERP &copy; {new Date().getFullYear()}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DIALOG DE TROCA DE SENHA OBRIGATÓRIA ────────────────────────────────────
// Exibido quando o usuário faz login com credenciais demo ou forcePasswordChange=true

function ForcePasswordChangeDialog({ user, onComplete }) {
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setError("");
    if (!newPassword || !confirmPassword) {
      setError("Preencha todos os campos.");
      return;
    }
    if (newPassword.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    setSaving(true);
    try {
      const hashed = await hashPassword(newPassword);
      const updated = { ...user, password: hashed, forcePasswordChange: false };
      DB.set("erp:user:" + user.id, updated);
      onComplete(updated);
    } finally {
      setSaving(false);
    }
  }, [newPassword, confirmPassword, user, onComplete]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md animate-slideIn">
        <div className="bg-gray-800 rounded-2xl shadow-2xl border border-gray-700 p-8">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">🔐</div>
            <h2 className="text-xl font-bold text-white">Troca de Senha Obrigatória</h2>
            <p className="text-gray-400 text-sm mt-2">
              Por segurança, defina uma nova senha para continuar.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nova Senha</label>
              <input
                type="password"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar Senha</label>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                placeholder="Repita a nova senha"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? "Salvando..." : "Definir Nova Senha"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── PRIMEIRO ACESSO — CADASTRO DO SUPER ADMIN ──────────────────────────────
// Exibido quando NÃO há nenhum usuário cadastrado. O usuário criado aqui recebe
// role admin (acesso total) e é o responsável por criar/gerenciar os demais.

function FirstUserSetup({ onComplete }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const handleSave = useCallback(async () => {
    setError("");
    if (!nome.trim() || !email.trim() || !password) {
      setError("Preencha todos os campos.");
      return;
    }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = email.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      setError("Formato de email inválido.");
      return;
    }
    if (password.length < 8) {
      setError("A senha deve ter no mínimo 8 caracteres.");
      return;
    }
    if (password !== confirmPassword) {
      setError("As senhas não conferem.");
      return;
    }

    setSaving(true);
    try {
      const newUser = {
        id: genId(),
        email: normalizedEmail,
        nome: nome.trim(),
        password: await hashPassword(password),
        role: "admin",
        avatar: nome.trim().slice(0, 2).toUpperCase(),
        createdAt: new Date().toISOString(),
        status: "ativo",
        forcePasswordChange: false,
        sessionTokenHash: null,
        customPermissions: null,
        isSuperAdmin: true,
      };
      DB.set("erp:user:" + newUser.id, newUser);
      onComplete(newUser);
    } finally {
      setSaving(false);
    }
  }, [nome, email, password, confirmPassword, onComplete]);

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4" style={{ position: "relative", overflow: "hidden" }}>
      <div style={{ position: "absolute", inset: 0, zIndex: 0 }}>
        <Aurora colorStops={["#4e487f", "#433a5f", "#5227FF"]} amplitude={1} blend={0.43} />
      </div>
      <div className="w-full max-w-md animate-slideIn" style={{ position: "relative", zIndex: 1 }}>
        <div className="bg-gray-800/80 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-700 p-8">
          <div className="text-center mb-6">
            <div className="text-5xl mb-3">❄️</div>
            <h2 className="text-2xl font-bold text-white">Primeiro Acesso</h2>
            <p className="text-gray-400 text-sm mt-2">
              Cadastre o usuário <strong className="text-white">Super Administrador</strong>.<br />
              Este usuário terá acesso total e poderá criar os demais.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome completo</label>
              <input
                type="text"
                value={nome}
                onChange={(e) => { setNome(e.target.value); setError(""); }}
                placeholder="Seu nome"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => { setEmail(e.target.value); setError(""); }}
                placeholder="seu@email.com.br"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Senha</label>
              <input
                type="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar Senha</label>
              <input
                type="password"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(""); }}
                placeholder="Repita a senha"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              onClick={handleSave}
              disabled={saving}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
              {saving ? "Criando..." : "Criar Super Administrador"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── DASHBOARD ──────────────────────────────────────────────────────────────────

// Dashboard completo — OS, Agenda, Cadastros e Financeiro (receita realizada do mês)
function Dashboard({ user, dateFilter, onNavigate }) {
  const [data, setData] = useState({
    serviceOrders: [],
    schedule: [],
    clients: [],
    transactions: [],
  });

  const loadData = useCallback(() => {
    setData({
      serviceOrders: DB.list("erp:os:"),
      schedule: DB.list("erp:schedule:"),
      clients: DB.list("erp:client:"),
      transactions: DB.list("erp:finance:"),
    });
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const { serviceOrders, schedule, clients, transactions } = data;

  // Receita "realizada" do mês — considera apenas transações com status "pago"
  // para não inflar o dashboard com receitas ainda não efetivadas.
  const receitaRealizadaMes = useMemo(() => {
    const m = new Date().getMonth();
    const y = new Date().getFullYear();
    return transactions
      .filter((t) => {
        if (t.tipo !== "receita" || t.status !== "pago") return false;
        if (!t.data) return false;
        const d = new Date(t.data);
        return d.getMonth() === m && d.getFullYear() === y;
      })
      .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);
  }, [transactions]);

  // useMemo garante que 'now' não quebre o cache dos memos que dependem dele
  const now = useMemo(() => new Date(), []);
  const todayStr = toISODate(now);

  // KPIs centrados em OS e Agenda
  const osEmAndamento = useMemo(
    () => serviceOrders.filter((os) => os.status === "em_andamento").length,
    [serviceOrders]
  );

  const osPendentes = useMemo(
    () => serviceOrders.filter((os) => os.status === "pendente").length,
    [serviceOrders]
  );

  const osConcluidasMes = useMemo(() => {
    const m = now.getMonth();
    const y = now.getFullYear();
    return serviceOrders.filter((os) => {
      if (os.status !== "concluido" || !os.dataConclusao) return false;
      const d = new Date(os.dataConclusao);
      return d.getMonth() === m && d.getFullYear() === y;
    }).length;
  }, [serviceOrders, now]);

  // Une agendamentos do módulo Agenda + OS do dia — reflete a nova visão unificada
  const agendamentosHoje = useMemo(() => {
    const schedHoje = schedule.filter((s) => s.data && s.data.startsWith(todayStr)).length;
    const osHoje = serviceOrders.filter((os) => {
      const d = os.dataAbertura || os.dataAgendada;
      return d && String(d).startsWith(todayStr) && os.status !== "concluido" && os.status !== "cancelado";
    }).length;
    return schedHoje + osHoje;
  }, [schedule, serviceOrders, todayStr]);

  const clientesAtivos = useMemo(
    () => clients.filter((c) => c.status !== "inativo").length,
    [clients]
  );

  // Gráfico de linha: OS concluídas por semana (últimas 8 semanas)
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

  // Próximas atividades: mescla schedule + OS agendadas/pendentes, ordena por data
  const proximasAtividades = useMemo(() => {
    const schedItems = schedule
      .filter((s) => new Date(s.data) >= now && s.status !== "cancelado" && s.status !== "concluido")
      .map((s) => ({
        id: `sched-${s.id}`,
        titulo: s.titulo,
        data: s.data,
        clienteNome: s.clienteNome,
        tecnicoNome: s.tecnicoNome,
        status: s.status,
        origem: "agenda",
      }));
    const osItems = serviceOrders
      .filter((os) => {
        const dRef = os.dataAbertura || os.dataAgendada;
        if (!dRef) return false;
        if (os.status === "concluido" || os.status === "cancelado") return false;
        return new Date(dRef) >= now;
      })
      .map((os) => ({
        id: `os-${os.id}`,
        titulo: `${os.numero} — ${os.tipo}`,
        data: os.dataAbertura || os.dataAgendada,
        clienteNome: os.clienteNome,
        tecnicoNome: os.tecnicoNome,
        status: os.status,
        origem: "os",
      }));
    return [...schedItems, ...osItems]
      .sort((a, b) => new Date(a.data) - new Date(b.data))
      .slice(0, 6);
  }, [schedule, serviceOrders, now]);

  // Alertas: OS pendentes há muito tempo (sem movimentação)
  const osAtencao = useMemo(() => {
    const doisDiasAtras = new Date(now);
    doisDiasAtras.setDate(doisDiasAtras.getDate() - 2);
    return serviceOrders
      .filter((os) => os.status === "pendente" && new Date(os.dataAbertura) < doisDiasAtras)
      .slice(0, 5);
  }, [serviceOrders, now]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Dashboard</h2>
          <p className="text-gray-400 text-sm mt-1">Bem-vindo, {user.nome.split(" ")[0]}!</p>
        </div>
      </div>

      {/* KPI Cards — OS, Agenda, Cadastros e Financeiro */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <KPICard
          title="OS em Andamento"
          value={osEmAndamento}
          icon="🔧"
          onClick={() => onNavigate("processos")}
        />
        <KPICard
          title="OS Pendentes"
          value={osPendentes}
          icon="⏳"
          onClick={() => onNavigate("processos")}
        />
        <KPICard
          title="Agendamentos Hoje"
          value={agendamentosHoje}
          icon="📅"
          onClick={() => onNavigate("agenda")}
        />
        <KPICard
          title="Clientes Ativos"
          value={clientesAtivos}
          icon="👥"
          onClick={() => onNavigate("cadastro")}
        />
        <KPICard
          title="Receita do Mês"
          value={formatCurrency(receitaRealizadaMes)}
          icon="💰"
          onClick={() => onNavigate("financeiro")}
        />
      </div>

      {/* Gráfico + Próximas Atividades */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-white font-semibold">OS Concluídas por Semana</h3>
            <span className="text-xs text-gray-400">{osConcluidasMes} este mês</span>
          </div>
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

        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-4">Próximas Atividades</h3>
          {proximasAtividades.length > 0 ? (
            <div className="space-y-3">
              {proximasAtividades.map((ativ) => (
                <button
                  key={ativ.id}
                  onClick={() => onNavigate(ativ.origem === "os" ? "processos" : "agenda")}
                  className="w-full flex items-start gap-3 p-3 rounded-lg bg-gray-700/30 hover:bg-gray-700/50 transition text-left"
                >
                  <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-sm flex-shrink-0 ${
                    ativ.origem === "os"
                      ? "bg-purple-500/20 text-purple-400"
                      : "bg-cyan-500/20 text-cyan-400"
                  }`}>
                    {ativ.origem === "os" ? "🔧" : "📅"}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate">{ativ.titulo}</p>
                    <p className="text-gray-400 text-xs mt-0.5">{formatDateTime(ativ.data)}</p>
                    <p className="text-gray-500 text-xs truncate">
                      {ativ.tecnicoNome || "—"} • {ativ.clienteNome || "—"}
                    </p>
                  </div>
                  <StatusBadge status={ativ.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="flex items-center justify-center h-[200px] text-gray-500 text-sm">
              Nenhuma atividade agendada
            </div>
          )}
        </div>
      </div>

      {/* OS que precisam de atenção */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
        <h3 className="text-white font-semibold mb-4">OS que precisam de atenção</h3>
        {osAtencao.length > 0 ? (
          <div className="space-y-2">
            {osAtencao.map((os) => (
              <button
                key={os.id}
                onClick={() => onNavigate("processos")}
                className="w-full flex items-center gap-3 p-3 rounded-lg bg-yellow-500/5 border border-yellow-500/20 hover:bg-yellow-500/10 transition text-left"
              >
                <span className="text-lg">⚠️</span>
                <div className="flex-1 min-w-0">
                  <p className="text-white text-sm font-medium truncate">
                    {os.numero} — {os.tipo} ({os.clienteNome})
                  </p>
                  <p className="text-gray-400 text-xs mt-0.5">
                    Aberta em {formatDate(os.dataAbertura)} — sem movimentação há 2+ dias
                  </p>
                </div>
                <StatusBadge status={os.status} />
              </button>
            ))}
          </div>
        ) : (
          <div className="flex items-center justify-center h-[100px] text-green-400 text-sm">
            ✓ Todas as OS estão sob controle
          </div>
        )}
      </div>
    </div>
  );
}


// ─── FINANCE MODULE ─────────────────────────────────────────────────────────

// Módulo financeiro — gestão de receitas/despesas com cálculo por status.
// Organização dos totais no topo:
//   - Realizado  = apenas PAGO (dinheiro efetivamente em caixa)
//   - A receber  = PENDENTE + EM ANDAMENTO (ainda não pagos, mas esperados)
//   - Vencidos   = ATRASADO (alerta — ação prioritária)
//   - Cancelado  = informativo, não entra nas somas
function FinanceModule({ user, dateFilter, addToast }) {
  const [transactions, setTransactions] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterCategory, setFilterCategory] = useState("all");

  const loadTransactions = useCallback(() => {
    setTransactions(DB.list("erp:finance:"));
  }, []);

  useEffect(() => { loadTransactions(); }, [loadTransactions]);

  const emptyForm = {
    descricao: "",
    valor: "",
    tipo: "receita",
    categoria: "",
    data: toISODate(new Date()),
    status: "pendente",
    formaPagamento: "PIX",
    observacoes: "",
  };
  const [form, setForm] = useState(emptyForm);

  const filteredTransactions = useMemo(() => {
    let list = filterByDate(transactions, "data", dateFilter);
    if (filterType !== "all") list = list.filter((t) => t.tipo === filterType);
    if (filterStatus !== "all") list = list.filter((t) => t.status === filterStatus);
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
  }, [transactions, dateFilter, filterType, filterStatus, filterCategory, search]);

  // ─── Totais por status — núcleo do módulo ────────────────────────────────
  // Separação explícita entre dinheiro realizado e pipeline:
  // admin/gerente vê claramente quanto já entrou, quanto está para entrar
  // e quanto está atrasado. Cancelado nunca entra em nenhuma soma.
  const totals = useMemo(() => {
    const acc = {
      // Receitas
      receitaPaga: 0,
      receitaPendente: 0,
      receitaEmAndamento: 0,
      receitaAtrasada: 0,
      // Despesas
      despesaPaga: 0,
      despesaPendente: 0,
      despesaEmAndamento: 0,
      despesaAtrasada: 0,
      // Contagem de cancelados (apenas informativo)
      canceladosCount: 0,
    };
    for (const t of filteredTransactions) {
      const v = Number(t.valor) || 0;
      const isReceita = t.tipo === "receita";
      switch (t.status) {
        case "pago":
          if (isReceita) acc.receitaPaga += v; else acc.despesaPaga += v;
          break;
        case "pendente":
          if (isReceita) acc.receitaPendente += v; else acc.despesaPendente += v;
          break;
        case "em_andamento":
          if (isReceita) acc.receitaEmAndamento += v; else acc.despesaEmAndamento += v;
          break;
        case "atrasado":
          if (isReceita) acc.receitaAtrasada += v; else acc.despesaAtrasada += v;
          break;
        case "cancelado":
          acc.canceladosCount += 1;
          break;
        default:
          break;
      }
    }
    // Saldo realizado (em caixa): receita paga - despesa paga
    acc.saldoRealizado = acc.receitaPaga - acc.despesaPaga;
    // A receber (pipeline de entrada): pendente + em andamento
    acc.aReceber = acc.receitaPendente + acc.receitaEmAndamento;
    // A pagar (pipeline de saída): pendente + em andamento
    acc.aPagar = acc.despesaPendente + acc.despesaEmAndamento;
    // Previsão de saldo: considera tudo que não foi cancelado nem está atrasado
    acc.saldoPrevisto = (acc.receitaPaga + acc.aReceber) - (acc.despesaPaga + acc.aPagar);
    return acc;
  }, [filteredTransactions]);

  const allCategories = useMemo(() => {
    const cats = new Set();
    transactions.forEach((t) => { if (t.categoria) cats.add(t.categoria); });
    return [...cats].sort();
  }, [transactions]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
      addToast("Preencha descrição, valor e data.", "error");
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
      addToast("Transação atualizada.", "success");
    } else {
      const prefix = form.tipo === "receita" ? "REC" : "DESP";
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
      addToast(`Transação ${numero} registrada.`, "success");
    }
    setModalOpen(false);
    loadTransactions();
  }, [form, editing, transactions, loadTransactions, addToast]);

  const handleDelete = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:finance:" + confirmDelete.id);
      addToast("Transação excluída.", "success");
      setConfirmDelete(null);
      loadTransactions();
    }
  }, [confirmDelete, loadTransactions, addToast]);

  // Atalho: marcar como pago direto da tabela
  const markAsPaid = useCallback((row) => {
    if (row.status === "pago") return;
    const updated = { ...row, status: "pago", dataPagamento: new Date().toISOString(), updatedAt: new Date().toISOString() };
    DB.set("erp:finance:" + updated.id, updated);
    addToast(`${row.descricao}: marcada como paga.`, "success");
    loadTransactions();
  }, [loadTransactions, addToast]);

  const STATUS_LABELS_FIN = {
    pago: "Pago",
    pendente: "Pendente",
    em_andamento: "Em Andamento",
    atrasado: "Atrasado",
    cancelado: "Cancelado",
  };
  const STATUS_COLORS_FIN = {
    pago: "bg-green-500",
    pendente: "bg-yellow-500",
    em_andamento: "bg-blue-500",
    atrasado: "bg-red-500",
    cancelado: "bg-gray-500",
  };

  const columns = [
    { key: "numero", label: "Nº", width: "w-24" },
    { key: "data", label: "Data", render: (v) => formatDate(v) },
    { key: "descricao", label: "Descrição" },
    { key: "categoria", label: "Categoria", render: (v) => v || "—" },
    {
      key: "tipo",
      label: "Tipo",
      render: (v) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${v === "receita" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
          {v === "receita" ? "Receita" : "Despesa"}
        </span>
      ),
    },
    { key: "formaPagamento", label: "Pgto", render: (v) => v || "—" },
    {
      key: "status",
      label: "Status",
      render: (v) => (
        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium text-white ${STATUS_COLORS_FIN[v] || "bg-gray-500"}`}>
          {STATUS_LABELS_FIN[v] || v}
        </span>
      ),
    },
    {
      key: "valor",
      label: "Valor",
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
      {/* Cabeçalho */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold text-white">Financeiro</h2>
          <p className="text-gray-400 text-sm mt-1">Receitas, despesas e saldo por status</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition text-sm flex items-center gap-2 min-h-[44px]"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
          Nova Transação
        </button>
      </div>

      {/* Cards de status — primeira linha: dinheiro "real" (pago) */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Realizado (efetivado)</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-gray-800 border border-green-500/20 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-sm">Receita Paga</p>
              <span className="text-green-400 text-lg">✓</span>
            </div>
            <p className="text-2xl font-bold text-green-400 mt-1">{formatCurrency(totals.receitaPaga)}</p>
          </div>
          <div className="bg-gray-800 border border-red-500/20 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <p className="text-gray-400 text-sm">Despesa Paga</p>
              <span className="text-red-400 text-lg">✓</span>
            </div>
            <p className="text-2xl font-bold text-red-400 mt-1">{formatCurrency(totals.despesaPaga)}</p>
          </div>
          <div className="bg-gradient-to-br from-gray-800 to-gray-800/50 border border-gray-600 rounded-xl p-5">
            <div className="flex items-center justify-between">
              <p className="text-gray-300 text-sm font-medium">Saldo em Caixa</p>
              <span className="text-lg">💰</span>
            </div>
            <p className={`text-2xl font-bold mt-1 ${totals.saldoRealizado >= 0 ? "text-green-400" : "text-red-400"}`}>
              {formatCurrency(totals.saldoRealizado)}
            </p>
          </div>
        </div>
      </div>

      {/* Segunda linha: pipeline (ainda não pago) */}
      <div>
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Pipeline (a receber / a pagar)</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="bg-gray-800 border border-yellow-500/20 rounded-xl p-4">
            <p className="text-gray-400 text-xs">A Receber</p>
            <p className="text-lg font-bold text-yellow-300 mt-1">{formatCurrency(totals.aReceber)}</p>
            <p className="text-gray-500 text-xs mt-1">Pendente + em andamento</p>
          </div>
          <div className="bg-gray-800 border border-yellow-500/20 rounded-xl p-4">
            <p className="text-gray-400 text-xs">A Pagar</p>
            <p className="text-lg font-bold text-yellow-300 mt-1">{formatCurrency(totals.aPagar)}</p>
            <p className="text-gray-500 text-xs mt-1">Pendente + em andamento</p>
          </div>
          <div className="bg-gray-800 border border-red-500/30 rounded-xl p-4">
            <p className="text-gray-400 text-xs">Vencidos (receita)</p>
            <p className="text-lg font-bold text-red-400 mt-1">{formatCurrency(totals.receitaAtrasada)}</p>
            <p className="text-gray-500 text-xs mt-1">Atrasado — prioridade</p>
          </div>
          <div className="bg-gray-800 border border-red-500/30 rounded-xl p-4">
            <p className="text-gray-400 text-xs">Vencidos (despesa)</p>
            <p className="text-lg font-bold text-red-400 mt-1">{formatCurrency(totals.despesaAtrasada)}</p>
            <p className="text-gray-500 text-xs mt-1">Atrasado — prioridade</p>
          </div>
        </div>
      </div>

      {/* Terceira linha: saldo previsto + cancelados */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs">Saldo Previsto (próximo período)</p>
          <p className={`text-xl font-bold mt-1 ${totals.saldoPrevisto >= 0 ? "text-green-400" : "text-red-400"}`}>
            {formatCurrency(totals.saldoPrevisto)}
          </p>
          <p className="text-gray-500 text-xs mt-1">Pago + a receber − despesas previstas. Atrasados e cancelados excluídos.</p>
        </div>
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
          <p className="text-gray-400 text-xs">Cancelados</p>
          <p className="text-xl font-bold text-gray-300 mt-1">{totals.canceladosCount}</p>
          <p className="text-gray-500 text-xs mt-1">Não entram em nenhum total.</p>
        </div>
      </div>

      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex-1 min-w-[200px] max-w-sm">
          <SearchInput value={search} onChange={setSearch} placeholder="Buscar transação..." />
        </div>
        <select
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 min-h-[44px]"
        >
          <option value="all">Todos os tipos</option>
          <option value="receita">Receitas</option>
          <option value="despesa">Despesas</option>
        </select>
        <select
          value={filterStatus}
          onChange={(e) => setFilterStatus(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 min-h-[44px]"
        >
          <option value="all">Todos status</option>
          <option value="pago">Pago</option>
          <option value="pendente">Pendente</option>
          <option value="em_andamento">Em Andamento</option>
          <option value="atrasado">Atrasado</option>
          <option value="cancelado">Cancelado</option>
        </select>
        <select
          value={filterCategory}
          onChange={(e) => setFilterCategory(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 min-h-[44px]"
        >
          <option value="all">Todas categorias</option>
          {allCategories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
      </div>

      {/* Tabela */}
      <DataTable
        columns={columns}
        data={filteredTransactions}
        onEdit={openEdit}
        onDelete={canDelete ? handleDelete : undefined}
        actions={(row) => (
          row.status !== "pago" && row.status !== "cancelado" ? (
            <button
              onClick={() => markAsPaid(row)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition"
              title="Marcar como pago"
              aria-label={`Marcar ${row.descricao} como pago`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
            </button>
          ) : null
        )}
        emptyMessage="Nenhuma transação encontrada."
      />

      {/* Modal criar/editar */}
      <Modal isOpen={modalOpen} title={editing ? "Editar Transação" : "Nova Transação"} onClose={() => setModalOpen(false)} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição *</label>
            <input
              type="text"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex: Instalação split 12000 BTUs — Cliente X"
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
                inputMode="decimal"
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
                <option value="em_andamento">Em Andamento</option>
                <option value="pago">Pago</option>
                <option value="atrasado">Atrasado</option>
                <option value="cancelado">Cancelado</option>
              </select>
              <p className="text-xs text-gray-500 mt-1">Apenas "Pago" entra no saldo em caixa.</p>
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
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition min-h-[44px]">Cancelar</button>
            <button onClick={handleSave} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition min-h-[44px]">
              {editing ? "Salvar Alterações" : "Criar Transação"}
            </button>
          </div>
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          message={`Excluir a transação "${confirmDelete.descricao}"? Esta ação não pode ser desfeita.`}
          onConfirm={confirmDeleteAction}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// ─── GERADOR DE DOCUMENTOS HTML ─────────────────────────────────────────────
// Documentos pensados para serem salvos como PDF (via Ctrl+P → "Salvar como PDF")
// ou impressos em A4. Design compacto, tipografia hierárquica, sem emojis,
// tabular-numerals em todos os valores monetários, contraste AA. Alinhado
// ao skill UI/UX Pro Max: rhythm 4/8pt, semantic color tokens, print-first.

// Abre documento HTML em nova aba do navegador
function openHTMLDoc(html) {
  const w = window.open("", "_blank");
  if (!w) { alert("Permita popups para gerar documentos."); return; }
  w.document.write(html);
  w.document.close();
}

// Formatação compacta de moeda (BRL) com tabular-nums implícito
function _fmtBRL(n) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);
}

// Estilos CSS compartilhados — design tokens, print-first (A4)
function _docStyles(accentColor = "#1d4ed8") {
  return `
    /* ─── Design tokens (semantic) ─────────────────────────────────────── */
    :root{
      --accent:${accentColor};
      --accent-soft:${accentColor}14;       /* ~8% do accent p/ background sutil */
      --accent-border:${accentColor}33;     /* ~20% do accent p/ borders */
      --ink-900:#0f172a;                    /* texto primário */
      --ink-700:#334155;                    /* texto corpo */
      --ink-500:#64748b;                    /* texto secundário */
      --ink-400:#94a3b8;                    /* rótulos */
      --ink-300:#cbd5e1;                    /* dividers */
      --ink-100:#f1f5f9;                    /* surface muted */
      --ink-50:#f8fafc;                     /* zebra */
      --surface:#ffffff;
    }

    /* ─── Reset + base ─────────────────────────────────────────────────── */
    *{margin:0;padding:0;box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    html,body{font-family:'Inter','DM Sans','Segoe UI',-apple-system,Arial,sans-serif;background:var(--ink-100);color:var(--ink-900);font-size:13px;line-height:1.5;font-feature-settings:'tnum' 1,'cv11' 1}
    body{padding:32px 16px}

    /* ─── Página A4 ────────────────────────────────────────────────────── */
    .page{max-width:760px;margin:0 auto;background:var(--surface);border-radius:4px;box-shadow:0 1px 2px rgba(15,23,42,.04),0 8px 24px rgba(15,23,42,.08);overflow:hidden}
    .page-inner{padding:36px 44px}

    /* ─── Header: identidade + badge ──────────────────────────────────── */
    .hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:24px;padding-bottom:20px;border-bottom:2px solid var(--accent)}
    .hdr-brand{flex:1;min-width:0}
    .hdr-brand .company{font-size:18px;font-weight:700;color:var(--ink-900);letter-spacing:-0.01em;line-height:1.2}
    .hdr-brand .tagline{font-size:11px;color:var(--ink-500);margin-top:2px;font-weight:500}
    .hdr-brand .contact{font-size:10.5px;color:var(--ink-500);margin-top:8px;line-height:1.6}
    .hdr-doc{text-align:right;flex-shrink:0}
    .hdr-doc .doc-type{font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--accent)}
    .hdr-doc .doc-num{font-size:22px;font-weight:800;color:var(--ink-900);letter-spacing:-0.02em;margin-top:2px;tab-size:2;font-variant-numeric:tabular-nums}
    .hdr-doc .doc-date{font-size:10.5px;color:var(--ink-500);margin-top:4px;font-variant-numeric:tabular-nums}

    /* ─── Seção genérica ──────────────────────────────────────────────── */
    .section{margin-top:20px}
    .section-title{font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;color:var(--ink-500);margin-bottom:8px}

    /* ─── Info grid (2 colunas densas) ────────────────────────────────── */
    .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 24px}
    .info-item{display:flex;flex-direction:column;gap:2px;min-width:0}
    .info-item label{font-size:9.5px;color:var(--ink-400);text-transform:uppercase;letter-spacing:.06em;font-weight:600}
    .info-item span{font-size:12.5px;color:var(--ink-900);font-weight:500;word-break:break-word}
    .info-item.mono span{font-variant-numeric:tabular-nums}

    /* ─── Info card compacto (dados cliente + execução) ───────────────── */
    .info-card{background:var(--ink-50);border:1px solid var(--ink-300);border-radius:6px;padding:14px 16px}
    .info-card + .info-card{margin-left:0}

    /* ─── Tabela ──────────────────────────────────────────────────────── */
    table{width:100%;border-collapse:collapse;font-size:12px}
    thead tr{border-bottom:1.5px solid var(--ink-900);background:transparent}
    th{padding:8px 10px;text-align:left;font-size:9.5px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--ink-700)}
    th.num,td.num{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
    tbody td{padding:9px 10px;font-size:12px;color:var(--ink-900);border-bottom:1px solid var(--ink-300)}
    tbody td.muted{color:var(--ink-500)}
    tbody tr:last-child td{border-bottom:1px solid var(--ink-300)}

    /* ─── Totais ──────────────────────────────────────────────────────── */
    .totals{margin-top:14px;display:flex;justify-content:flex-end}
    .totals-inner{min-width:280px;width:100%;max-width:340px}
    .total-row{display:flex;justify-content:space-between;gap:16px;padding:6px 12px;font-size:12px;color:var(--ink-700);font-variant-numeric:tabular-nums}
    .total-row.grand{margin-top:4px;background:var(--ink-900);color:#fff;padding:12px 14px;border-radius:4px;font-size:13px;font-weight:700;letter-spacing:0}
    .total-row.grand .label{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.1em;opacity:.85}
    .total-row.grand .value{font-size:16px;font-weight:800}

    /* ─── Box de observações ───────────────────────────────────────────── */
    .obs-box{background:var(--ink-50);border-left:3px solid var(--accent);padding:12px 14px;font-size:11.5px;color:var(--ink-700);line-height:1.6;border-radius:3px}
    .obs-box.placeholder{color:var(--ink-400);font-style:italic;min-height:56px}

    /* ─── Assinaturas ─────────────────────────────────────────────────── */
    .signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:48px;page-break-inside:avoid}
    .sig{padding-top:40px;border-top:1px solid var(--ink-700);text-align:center}
    .sig .name{font-size:11.5px;color:var(--ink-900);font-weight:600;line-height:1.3}
    .sig .role{font-size:10px;color:var(--ink-500);margin-top:2px;text-transform:uppercase;letter-spacing:.06em}

    /* ─── Termos / rodapé legal ───────────────────────────────────────── */
    .terms{margin-top:20px;border-top:1px solid var(--ink-300);padding-top:12px;font-size:10px;color:var(--ink-500);line-height:1.6}
    .terms strong{display:block;color:var(--ink-700);font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;margin-bottom:3px}

    /* ─── Badges ──────────────────────────────────────────────────────── */
    .badge{display:inline-flex;align-items:center;padding:2px 9px;border-radius:999px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;line-height:1.4;border:1px solid transparent}
    .badge-blue{background:#eff6ff;color:#1d4ed8;border-color:#bfdbfe}
    .badge-green{background:#ecfdf5;color:#047857;border-color:#a7f3d0}
    .badge-yellow{background:#fefce8;color:#a16207;border-color:#fde68a}
    .badge-red{background:#fef2f2;color:#b91c1c;border-color:#fecaca}

    /* ─── Hero (recibo): bloco de valor em destaque ───────────────────── */
    .hero-amount{margin:16px 0 8px;text-align:center;padding:20px 16px;background:linear-gradient(180deg,var(--accent-soft),transparent);border:1px solid var(--accent-border);border-radius:8px}
    .hero-amount .hero-label{font-size:10px;text-transform:uppercase;letter-spacing:.12em;color:var(--ink-500);font-weight:700}
    .hero-amount .hero-value{font-size:32px;font-weight:800;color:var(--accent);letter-spacing:-0.02em;margin-top:4px;font-variant-numeric:tabular-nums;line-height:1.1}
    .hero-amount .hero-hint{font-size:10.5px;color:var(--ink-500);margin-top:4px;font-variant-numeric:tabular-nums}

    /* ─── Rodapé watermark ────────────────────────────────────────────── */
    .watermark{margin-top:28px;padding-top:12px;border-top:1px solid var(--ink-300);font-size:9.5px;color:var(--ink-400);text-align:center;letter-spacing:.04em}

    /* ─── Barra de ação (apenas tela — some na impressão) ─────────────── */
    .actionbar{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);display:flex;gap:8px;background:var(--surface);padding:8px;border-radius:999px;box-shadow:0 4px 16px rgba(15,23,42,.18),0 0 0 1px var(--ink-300);z-index:999}
    .actionbar button{background:var(--accent);color:#fff;border:none;padding:10px 18px;border-radius:999px;cursor:pointer;font-size:13px;font-weight:600;display:inline-flex;align-items:center;gap:6px;transition:background .15s}
    .actionbar button.secondary{background:var(--ink-100);color:var(--ink-900)}
    .actionbar button:hover{filter:brightness(1.05)}
    .actionbar button:active{transform:translateY(1px)}

    /* ─── Print (A4) ──────────────────────────────────────────────────── */
    @page{size:A4;margin:12mm 14mm}
    @media print{
      html,body{background:#fff;padding:0;font-size:11.5pt}
      .page{max-width:none;margin:0;box-shadow:none;border-radius:0}
      .page-inner{padding:0}
      .actionbar{display:none !important}
      .section{page-break-inside:avoid}
      .totals,.signatures{page-break-inside:avoid}
      thead{display:table-header-group}
    }
  `;
}

// Header reutilizável — identidade da empresa + badge do documento
function _docHeader(config, docType, numero, dataStr) {
  const emp = config.nomeEmpresa || "FrostERP Refrigeração";
  const cnpj = config.cnpj ? `CNPJ ${config.cnpj}` : "";
  const tel = config.telefone ? `Tel ${config.telefone}` : "";
  const email = config.email || "";
  const end = config.endereco || "";
  const contactLine = [cnpj, tel, email, end].filter(Boolean).join(" · ");
  return `
    <div class="hdr">
      <div class="hdr-brand">
        <div class="company">${emp}</div>
        <div class="tagline">Refrigeração e Climatização</div>
        ${contactLine ? `<div class="contact">${contactLine}</div>` : ""}
      </div>
      <div class="hdr-doc">
        <div class="doc-type">${docType}</div>
        <div class="doc-num">${numero}</div>
        <div class="doc-date">${dataStr}</div>
      </div>
    </div>
  `;
}

// Barra fixa com ações (imprimir/salvar-PDF + fechar) — some no print
function _actionBar() {
  return `
    <div class="actionbar" role="toolbar" aria-label="Ações do documento">
      <button onclick="window.print()" aria-label="Salvar como PDF ou imprimir">Salvar PDF / Imprimir</button>
      <button class="secondary" onclick="window.close()" aria-label="Fechar aba">Fechar</button>
    </div>
  `;
}

// ─── Helper compartilhado: descrição do equipamento ────────────────────────
// Monta "Modelo — Capacidade Unidade" conforme o tipo salvo na OS.
function _equipamentoDescricao(os) {
  const UNIT = {
    central: "BTUs", geladeira: "L", lavadora: "Kg", centrifuga: "Kg",
    expositor: "L", bebedouro_industrial: "L/h", bebedouro_mesa: "",
    bebedouro_coluna: "", camara_fria: "m³", outro: "",
  };
  const TYPE_LABEL = {
    central: "Central de Ar", geladeira: "Geladeira/Freezer", lavadora: "Máq. de Lavar",
    centrifuga: "Centrífuga", expositor: "Expositor", bebedouro_industrial: "Bebedouro Industrial",
    bebedouro_mesa: "Gelágua de Mesa", bebedouro_coluna: "Gelágua de Coluna",
    camara_fria: "Câmara Fria", outro: "Equipamento",
  };
  const tipoKey = os.equipamentoTipo || "central";
  const tipoLabel = TYPE_LABEL[tipoKey] || "Equipamento";
  const unit = UNIT[tipoKey] || "";
  const cap = os.equipamentoCapacidade || os.equipamentoBTUs || "";
  const capLabel = cap ? (unit ? `${cap} ${unit}` : cap) : "";
  return { tipoLabel, capLabel, modelo: os.equipamentoModelo || "" };
}

// Gera HTML do Orçamento — documento para envio ao cliente (PDF)
function generateOrcamentoHTML(os, clients) {
  const config = DB.get("erp:config") || {};
  const cliente = (clients || []).find((c) => c.id === os.clienteId) || {};
  const dataHoje = new Date().toLocaleDateString("pt-BR");
  const validade = new Date(Date.now() + 15 * 86400000).toLocaleDateString("pt-BR");
  const valorServico = os.valor || 0;

  const endCliente = cliente.endereco && (cliente.endereco.rua || cliente.endereco.cidade)
    ? `${cliente.endereco.rua || ""}${cliente.endereco.numero ? ", " + cliente.endereco.numero : ""} · ${cliente.endereco.bairro || ""} — ${cliente.endereco.cidade || ""}${cliente.endereco.estado ? "/" + cliente.endereco.estado : ""}`
    : (os.endereco || "—");

  const docCliente = cliente.tipo === "pj"
    ? (cliente.cnpj ? `CNPJ ${cliente.cnpj}` : "—")
    : (cliente.cpf ? `CPF ${cliente.cpf}` : "—");

  const equip = _equipamentoDescricao(os);
  const equipText = [equip.tipoLabel, equip.modelo, equip.capLabel].filter(Boolean).join(" · ") || "—";

  // Monta linhas da tabela: serviços + peças
  const servicos = Array.isArray(os.servicos) && os.servicos.length > 0
    ? os.servicos
    : [{ tipo: os.tipo, descricao: os.equipamentoModelo || "Serviço de Refrigeração", valor: valorServico }];
  const pecas = Array.isArray(os.pecas) && os.pecas.length > 0 ? os.pecas : (os.itensUtilizados || []);

  const rowsServicos = servicos.map((s) => {
    const v = Number(s.valor) || 0;
    const desc = s.descricao
      ? `<strong style="color:var(--ink-900)">${s.tipo}</strong><div style="font-size:11px;color:var(--ink-500);margin-top:2px">${s.descricao}</div>`
      : `<strong style="color:var(--ink-900)">${s.tipo}</strong>`;
    return `<tr><td>${desc}</td><td class="num">1</td><td class="num">${_fmtBRL(v)}</td><td class="num">${_fmtBRL(v)}</td></tr>`;
  }).join("");

  const rowsPecas = pecas.map((p) => {
    const qtd = Number(p.quantidade) || 1;
    const valU = Number(p.valorUnit) || 0;
    const sub = qtd * valU;
    const valStr = valU > 0 ? _fmtBRL(valU) : "—";
    const subStr = valU > 0 ? _fmtBRL(sub) : "<span class=\"muted\">Incluso</span>";
    return `<tr><td>${p.nome || "Material"}</td><td class="num">${qtd}</td><td class="num">${valStr}</td><td class="num">${subStr}</td></tr>`;
  }).join("");

  const totServ = servicos.reduce((acc, s) => acc + (Number(s.valor) || 0), 0);
  const totPecas = pecas.reduce((acc, p) => acc + (Number(p.quantidade) || 1) * (Number(p.valorUnit) || 0), 0);
  const total = (totServ + totPecas) || valorServico;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Orçamento ${os.numero}</title>
<style>${_docStyles("#1d4ed8")}</style>
</head>
<body>
<main class="page">
  <div class="page-inner">
    ${_docHeader(config, "Orçamento", os.numero, `Emitido em ${dataHoje}`)}

    <!-- Info cards lado a lado: cliente + detalhes do serviço -->
    <div class="section">
      <div class="info-grid">
        <div class="info-card">
          <div class="section-title" style="margin-bottom:10px">Cliente</div>
          <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
            <div class="info-item"><label>Nome / Razão Social</label><span>${cliente.nome || os.clienteNome || "—"}</span></div>
            <div class="info-item mono"><label>Documento</label><span>${docCliente}</span></div>
            <div class="info-item mono"><label>Telefone</label><span>${cliente.telefone || "—"}</span></div>
            <div class="info-item"><label>Email</label><span>${cliente.email || "—"}</span></div>
          </div>
        </div>
        <div class="info-card">
          <div class="section-title" style="margin-bottom:10px">Serviço</div>
          <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
            <div class="info-item"><label>Tipo</label><span>${os.tipo || "—"}</span></div>
            <div class="info-item"><label>Endereço de Execução</label><span>${endCliente}</span></div>
            <div class="info-item"><label>Equipamento</label><span>${equipText}</span></div>
            <div class="info-item"><label>Técnico Responsável</label><span>${os.tecnicoNome || "—"}</span></div>
          </div>
        </div>
      </div>
    </div>

    <!-- Itens do orçamento: serviços + peças em uma tabela -->
    <div class="section">
      <div class="section-title">Itens do Orçamento</div>
      <table>
        <thead>
          <tr>
            <th>Descrição</th>
            <th class="num" style="width:60px">Qtd</th>
            <th class="num" style="width:110px">Valor Unit.</th>
            <th class="num" style="width:120px">Subtotal</th>
          </tr>
        </thead>
        <tbody>
          ${rowsServicos}
          ${rowsPecas}
        </tbody>
      </table>

      <div class="totals">
        <div class="totals-inner">
          <div class="total-row"><span>Mão de obra</span><span>${_fmtBRL(totServ)}</span></div>
          <div class="total-row"><span>Peças e Materiais</span><span>${totPecas > 0 ? _fmtBRL(totPecas) : "Incluso"}</span></div>
          <div class="total-row grand"><span class="label">Total</span><span class="value">${_fmtBRL(total)}</span></div>
        </div>
      </div>
    </div>

    ${os.observacoes ? `
    <div class="section">
      <div class="section-title">Observações</div>
      <div class="obs-box">${os.observacoes}</div>
    </div>` : ""}

    <div class="terms">
      <strong>Condições do Orçamento</strong>
      Validade até <strong style="color:var(--ink-900)">${validade}</strong>. Garantia de serviço de 90 dias. Equipamentos com garantia do fabricante. Valores sujeitos a alteração após vistoria técnica no local.
    </div>

    <div class="signatures">
      <div class="sig">
        <div class="name">${config.nomeEmpresa || "FrostERP Refrigeração"}</div>
        <div class="role">Responsável Técnico</div>
      </div>
      <div class="sig">
        <div class="name">${cliente.nome || os.clienteNome || "Cliente"}</div>
        <div class="role">Aceite do Orçamento</div>
      </div>
    </div>

    <div class="watermark">Documento gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// Gera HTML da Ordem de Serviço — documento de execução + ciência do cliente
function generateOSHTML(os, clients) {
  const config = DB.get("erp:config") || {};
  const cliente = (clients || []).find((c) => c.id === os.clienteId) || {};
  const dataAbertura = os.dataAbertura ? new Date(os.dataAbertura).toLocaleDateString("pt-BR") : "—";
  const dataAgendada = os.dataAgendada
    ? new Date(os.dataAgendada.replace("T00:00:00.000Z", "T12:00:00")).toLocaleDateString("pt-BR")
    : "—";

  const STATUS_LABELS = {
    aguardando: "Aguardando", em_deslocamento: "Em Deslocamento",
    em_execucao: "Em Execução", finalizado: "Finalizado",
    concluido: "Concluído", pendente: "Pendente", em_andamento: "Em Andamento",
    cancelado: "Cancelado",
  };
  const statusLabel = STATUS_LABELS[os.status] || os.status || "—";
  const statusClass = ["finalizado", "concluido"].includes(os.status) ? "badge-green"
    : ["aguardando", "pendente"].includes(os.status) ? "badge-yellow"
    : os.status === "cancelado" ? "badge-red" : "badge-blue";

  const enderecoFinal = os.endereco
    || (cliente.endereco ? `${cliente.endereco.rua || ""}${cliente.endereco.numero ? ", " + cliente.endereco.numero : ""}${cliente.endereco.bairro ? " · " + cliente.endereco.bairro : ""}${cliente.endereco.cidade ? " — " + cliente.endereco.cidade : ""}${cliente.endereco.estado ? "/" + cliente.endereco.estado : ""}` : "—");

  const equip = _equipamentoDescricao(os);
  const hasEquipamento = equip.modelo || equip.capLabel;

  const servicos = Array.isArray(os.servicos) && os.servicos.length > 0 ? os.servicos : null;
  const pecas = Array.isArray(os.pecas) && os.pecas.length > 0 ? os.pecas : (os.itensUtilizados || []);

  const rowsServicos = servicos ? servicos.map((s) => {
    const v = Number(s.valor) || 0;
    return `<tr>
      <td><strong style="color:var(--ink-900)">${s.tipo || "—"}</strong></td>
      <td class="muted">${s.descricao || "—"}</td>
      <td class="num">${_fmtBRL(v)}</td>
    </tr>`;
  }).join("") : "";

  const rowsPecas = pecas.map((i) => {
    const qtd = Number(i.quantidade) || 1;
    const valU = Number(i.valorUnit) || 0;
    const sub = qtd * valU;
    return `<tr>
      <td>${i.nome || "—"}</td>
      <td class="num">${qtd}</td>
      <td class="num">${valU > 0 ? _fmtBRL(valU) : "—"}</td>
      <td class="num">${valU > 0 ? _fmtBRL(sub) : "—"}</td>
    </tr>`;
  }).join("");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>OS ${os.numero}</title>
<style>${_docStyles("#1d4ed8")}</style>
</head>
<body>
<main class="page">
  <div class="page-inner">
    ${_docHeader(config, "Ordem de Serviço", os.numero, `Abertura: ${dataAbertura}`)}

    <!-- Cliente + Execução em cards lado a lado -->
    <div class="section">
      <div class="info-grid">
        <div class="info-card">
          <div class="section-title" style="margin-bottom:10px">Cliente</div>
          <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
            <div class="info-item"><label>Nome</label><span>${cliente.nome || os.clienteNome || "—"}</span></div>
            <div class="info-item mono"><label>Telefone</label><span>${cliente.telefone || "—"}</span></div>
            <div class="info-item"><label>Endereço de Atendimento</label><span>${enderecoFinal}</span></div>
          </div>
        </div>
        <div class="info-card">
          <div class="section-title" style="margin-bottom:10px">Execução</div>
          <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
            <div class="info-item"><label>Status</label><span><span class="badge ${statusClass}">${statusLabel}</span></span></div>
            <div class="info-item"><label>Técnico</label><span>${os.tecnicoNome || "—"}</span></div>
            <div class="info-item mono"><label>Data Agendada</label><span>${dataAgendada}</span></div>
            <div class="info-item"><label>Tipo</label><span>${os.tipo || "—"}</span></div>
          </div>
        </div>
      </div>
    </div>

    ${hasEquipamento ? `
    <div class="section">
      <div class="section-title">Equipamento</div>
      <div class="info-card">
        <div class="info-grid">
          <div class="info-item"><label>Tipo</label><span>${equip.tipoLabel}</span></div>
          <div class="info-item"><label>Modelo / Marca</label><span>${equip.modelo || "—"}</span></div>
          ${equip.capLabel ? `<div class="info-item mono"><label>Capacidade</label><span>${equip.capLabel}</span></div>` : ""}
        </div>
      </div>
    </div>` : ""}

    ${servicos ? `
    <div class="section">
      <div class="section-title">Serviços Executados</div>
      <table>
        <thead>
          <tr>
            <th style="width:28%">Tipo</th>
            <th>Descrição</th>
            <th class="num" style="width:130px">Valor</th>
          </tr>
        </thead>
        <tbody>${rowsServicos}</tbody>
      </table>
    </div>` : `
    <div class="section">
      <div class="section-title">Descrição do Serviço</div>
      <div class="obs-box">${os.descricao || os.observacoes || "Sem descrição informada."}</div>
    </div>`}

    ${pecas.length > 0 ? `
    <div class="section">
      <div class="section-title">Peças e Materiais</div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num" style="width:70px">Qtd</th>
            <th class="num" style="width:120px">Valor Unit.</th>
            <th class="num" style="width:130px">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rowsPecas}</tbody>
      </table>
    </div>` : ""}

    <!-- Valor total em destaque -->
    <div class="totals">
      <div class="totals-inner">
        <div class="total-row grand">
          <span class="label">Valor Total</span>
          <span class="value">${_fmtBRL(os.valor || 0)}</span>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">Relato do Técnico</div>
      <div class="obs-box placeholder">Descreva aqui os procedimentos realizados, peças substituídas, medições e orientações ao cliente.</div>
    </div>

    ${os.observacoes ? `
    <div class="section">
      <div class="section-title">Observações</div>
      <div class="obs-box">${os.observacoes}</div>
    </div>` : ""}

    <div class="signatures">
      <div class="sig">
        <div class="name">${os.tecnicoNome || "—"}</div>
        <div class="role">Técnico Responsável</div>
      </div>
      <div class="sig">
        <div class="name">${cliente.nome || os.clienteNome || "Cliente"}</div>
        <div class="role">Ciente do Serviço</div>
      </div>
    </div>

    <div class="watermark">Documento gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// Gera HTML do Recibo — documento final com valor em destaque
function generateReciboHTML(os, clients) {
  const config = DB.get("erp:config") || {};
  const cliente = (clients || []).find((c) => c.id === os.clienteId) || {};
  const dataConclusao = os.dataConclusao
    ? new Date(os.dataConclusao).toLocaleDateString("pt-BR")
    : new Date().toLocaleDateString("pt-BR");
  const valor = os.valor || 0;
  const valorExtenso = valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  const enderecoFinal = os.endereco
    || (cliente.endereco ? `${cliente.endereco.rua || ""}${cliente.endereco.numero ? ", " + cliente.endereco.numero : ""}${cliente.endereco.bairro ? " · " + cliente.endereco.bairro : ""}${cliente.endereco.cidade ? " — " + cliente.endereco.cidade : ""}${cliente.endereco.estado ? "/" + cliente.endereco.estado : ""}` : "—");

  const equip = _equipamentoDescricao(os);
  const equipText = [equip.modelo, equip.capLabel].filter(Boolean).join(" · ");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Recibo ${os.numero}</title>
<style>${_docStyles("#047857")}</style>
</head>
<body>
<main class="page">
  <div class="page-inner">
    ${_docHeader(config, "Recibo de Serviço", os.numero, `Data: ${dataConclusao}`)}

    <!-- Hero: valor em destaque -->
    <div class="hero-amount">
      <div class="hero-label">Valor Total do Serviço</div>
      <div class="hero-value">${_fmtBRL(valor)}</div>
      <div class="hero-hint">R$ ${valorExtenso}</div>
    </div>

    <!-- Partes + referência -->
    <div class="section">
      <div class="info-grid">
        <div class="info-card">
          <div class="section-title" style="margin-bottom:10px">Recebemos de</div>
          <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
            <div class="info-item"><label>Nome / Razão Social</label><span>${cliente.nome || os.clienteNome || "—"}</span></div>
            <div class="info-item mono"><label>Telefone</label><span>${cliente.telefone || "—"}</span></div>
            <div class="info-item"><label>Endereço</label><span>${enderecoFinal}</span></div>
          </div>
        </div>
        <div class="info-card">
          <div class="section-title" style="margin-bottom:10px">Referente a</div>
          <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
            <div class="info-item"><label>Serviço</label><span>${os.tipo || "—"}</span></div>
            ${equipText ? `<div class="info-item"><label>Equipamento</label><span>${equipText}</span></div>` : ""}
            <div class="info-item"><label>Técnico Responsável</label><span>${os.tecnicoNome || "—"}</span></div>
            <div class="info-item mono"><label>Data de Conclusão</label><span>${dataConclusao}</span></div>
          </div>
        </div>
      </div>
    </div>

    ${os.observacoes || os.descricao ? `
    <div class="section">
      <div class="section-title">Descrição</div>
      <div class="obs-box">${os.descricao || os.observacoes}</div>
    </div>` : ""}

    <div class="terms">
      <strong>Garantia</strong>
      Este serviço possui garantia de 90 dias contados a partir da data de conclusão, cobrindo defeitos de execução. Equipamentos seguem a garantia do fabricante conforme manual do produto. A garantia não cobre danos causados por mau uso, sobrecargas elétricas, sinistros ou falta de manutenção periódica.
    </div>

    <div class="signatures">
      <div class="sig">
        <div class="name">${config.nomeEmpresa || "FrostERP Refrigeração"}</div>
        <div class="role">Prestador do Serviço</div>
      </div>
      <div class="sig">
        <div class="name">${cliente.nome || os.clienteNome || "Cliente"}</div>
        <div class="role">Recebimento e Aprovação</div>
      </div>
    </div>

    <div class="watermark">Documento gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
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
  // Filtro por cliente — permite ver todas as OS de um cliente específico
  const [filterCliente, setFilterCliente] = useState("all");
  const [viewMode, setViewMode] = useState("lista");
  // ─── Modal Produtividade Mensal por Técnico (admin/gerente) ───
  const [showProdutividade, setShowProdutividade] = useState(false);
  // ─── Modal Revisão de OS finalizadas pelo técnico (admin/gerente) ───
  const [reviewing, setReviewing] = useState(null);

  // Lista de tipos de serviço — vem da constante global (SERVICE_TYPES_OS)
  // Removidos: Higienização, Reparo. Adicionados: Troca de Peças, Solda.
  const SERVICE_TYPES = SERVICE_TYPES_OS;
  // Fluxo de status simplificado — sem "faturado"
  const STATUS_FLOW = ["aguardando", "em_deslocamento", "em_execucao", "finalizado"];
  const STATUS_LABELS_OS = {
    aguardando: "Aguardando",
    em_deslocamento: "Em Deslocamento",
    em_execucao: "Em Execução",
    finalizado: "Finalizado",
  };
  const STATUS_COLORS_OS = {
    aguardando: "bg-yellow-500",
    em_deslocamento: "bg-cyan-500",
    em_execucao: "bg-blue-500",
    finalizado: "bg-green-500",
  };

  // Carrega clientes e funcionários do DB diretamente para garantir dados atualizados
  // mesmo se os props estiverem desatualizados (ex: após novo cadastro sem rehydrate)
  const [allEmployees, setAllEmployees] = useState(employees || []);
  const [allClients, setAllClients] = useState(clients || []);
  useEffect(() => {
    const empFromDB = DB.list("erp:employee:");
    setAllEmployees(empFromDB.length > 0 ? empFromDB : (employees || []));
    const cliFromDB = DB.list("erp:client:");
    setAllClients(cliFromDB.length > 0 ? cliFromDB : (clients || []));
  }, [employees, clients]);
  const tecnicos = useMemo(() => allEmployees.filter((e) => e.tipo === "tecnico" && e.status === "ativo"), [allEmployees]);

  const loadOrders = useCallback(() => {
    setOrders(DB.list("erp:os:"));
  }, []);

  useEffect(() => { loadOrders(); }, [loadOrders]);

  // Cada OS pode conter múltiplos serviços e peças/materiais — cada linha tem valor próprio.
  // valorTotal = soma de todos os serviços + soma de todas as peças (qtd × valor unit).
  const emptyServico = { tipo: "Instalação", descricao: "", valor: "" };
  // Peças/materiais: nome obrigatório, quantidade e valor unitário opcionais
  const emptyPeca = { nome: "", quantidade: "1", valorUnit: "" };
  const emptyForm = {
    clienteId: "", endereco: "",
    servicos: [{ ...emptyServico }],
    pecas: [],
    // Tipo de equipamento define quais campos técnicos aparecem (BTU, Litros, Kg, etc.)
    equipamentoTipo: "central",
    equipamentoModelo: "",
    equipamentoCapacidade: "", // valor genérico — a unidade depende do tipo
    equipamentoBTUs: "",       // mantido para retrocompatibilidade (apenas quando tipo=central)
    tecnicoId: "", dataAgendada: toISODate(new Date()), horaAgendada: "08:00", observacoes: "",
  };
  const [form, setForm] = useState(emptyForm);

  // Soma reativa dos valores dos serviços + peças
  const valorTotalForm = useMemo(() => {
    const totalServicos = (form.servicos || []).reduce((acc, s) => {
      const v = parseFloat(String(s.valor || "0").replace(",", ".")) || 0;
      return acc + v;
    }, 0);
    const totalPecas = (form.pecas || []).reduce((acc, p) => {
      const qtd = parseFloat(String(p.quantidade || "0").replace(",", ".")) || 0;
      const valU = parseFloat(String(p.valorUnit || "0").replace(",", ".")) || 0;
      return acc + qtd * valU;
    }, 0);
    return totalServicos + totalPecas;
  }, [form.servicos, form.pecas]);

  const addServico = useCallback(() => {
    setForm((f) => ({ ...f, servicos: [...(f.servicos || []), { ...emptyServico }] }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateServico = useCallback((index, patch) => {
    setForm((f) => ({
      ...f,
      servicos: (f.servicos || []).map((s, i) => (i === index ? { ...s, ...patch } : s)),
    }));
  }, []);

  const removeServico = useCallback((index) => {
    setForm((f) => {
      const next = (f.servicos || []).filter((_, i) => i !== index);
      return { ...f, servicos: next.length > 0 ? next : [{ ...emptyServico }] };
    });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Peças e materiais — mesmas operações dos serviços ──────────────────
  const addPeca = useCallback(() => {
    setForm((f) => ({ ...f, pecas: [...(f.pecas || []), { ...emptyPeca }] }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updatePeca = useCallback((index, patch) => {
    setForm((f) => ({
      ...f,
      pecas: (f.pecas || []).map((p, i) => (i === index ? { ...p, ...patch } : p)),
    }));
  }, []);

  const removePeca = useCallback((index) => {
    setForm((f) => ({ ...f, pecas: (f.pecas || []).filter((_, i) => i !== index) }));
  }, []);

  const filteredOrders = useMemo(() => {
    let list = filterByDate(orders, "dataAbertura", dateFilter);

    // Technician can only see their own
    if (user.role === "tecnico") {
      list = list.filter((os) => os.tecnicoId === user.id || os.tecnicoNome === user.nome);
    }

    if (filterStatus !== "all") list = list.filter((os) => os.status === filterStatus);
    if (filterTecnico !== "all") list = list.filter((os) => os.tecnicoId === filterTecnico);
    if (filterCliente !== "all") list = list.filter((os) => os.clienteId === filterCliente);
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
  }, [orders, dateFilter, filterStatus, filterTecnico, filterCliente, search, user]);

  const stats = useMemo(() => ({
    total: filteredOrders.length,
    aguardando: filteredOrders.filter((os) => os.status === "aguardando").length,
    em_deslocamento: filteredOrders.filter((os) => os.status === "em_deslocamento").length,
    em_execucao: filteredOrders.filter((os) => os.status === "em_execucao").length,
    finalizado: filteredOrders.filter((os) => os.status === "finalizado").length,
  }), [filteredOrders]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((row) => {
    setEditing(row);
    // Migração: OS antigas têm tipo/valor soltos — convertemos para o array de serviços
    const servicos = Array.isArray(row.servicos) && row.servicos.length > 0
      ? row.servicos.map((s) => ({
          tipo: s.tipo || "Instalação",
          descricao: s.descricao || "",
          valor: s.valor !== undefined && s.valor !== null ? String(s.valor) : "",
        }))
      : [{
          tipo: row.tipo || "Instalação",
          descricao: row.descricao || "",
          valor: row.valor !== undefined && row.valor !== null ? String(row.valor) : "",
        }];
    // Peças: estrutura { nome, quantidade, valorUnit } — migra itensUtilizados antigo
    const pecas = Array.isArray(row.pecas) && row.pecas.length > 0
      ? row.pecas.map((p) => ({
          nome: p.nome || "",
          quantidade: p.quantidade !== undefined && p.quantidade !== null ? String(p.quantidade) : "1",
          valorUnit: p.valorUnit !== undefined && p.valorUnit !== null ? String(p.valorUnit) : "",
        }))
      : Array.isArray(row.itensUtilizados) && row.itensUtilizados.length > 0
        ? row.itensUtilizados.map((i) => ({
            nome: i.nome || "",
            quantidade: i.quantidade !== undefined && i.quantidade !== null ? String(i.quantidade) : "1",
            valorUnit: i.valorUnit !== undefined && i.valorUnit !== null ? String(i.valorUnit) : "",
          }))
        : [];
    // Equipamento: migra OS antigas (que só tinham BTUs) para o novo modelo multi-tipo
    const equipamentoTipo = row.equipamentoTipo || "central";
    const equipamentoCapacidade = row.equipamentoCapacidade !== undefined && row.equipamentoCapacidade !== null && row.equipamentoCapacidade !== ""
      ? String(row.equipamentoCapacidade)
      : String(row.equipamentoBTUs || "");
    setForm({
      clienteId: row.clienteId || "",
      endereco: row.endereco || "",
      servicos,
      pecas,
      equipamentoTipo,
      equipamentoModelo: row.equipamentoModelo || "",
      equipamentoCapacidade,
      equipamentoBTUs: row.equipamentoBTUs || "",
      tecnicoId: row.tecnicoId || "",
      dataAgendada: row.dataAgendada ? row.dataAgendada.split("T")[0] : toISODate(new Date()),
      horaAgendada: row.horaAgendada || "08:00",
      observacoes: row.observacoes || "",
    });
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    // Normaliza os serviços removendo entradas totalmente vazias
    const servicosLimpos = (form.servicos || [])
      .map((s) => ({
        tipo: (s.tipo || "").trim(),
        descricao: (s.descricao || "").trim(),
        valor: parseFloat(String(s.valor || "0").replace(",", ".")) || 0,
      }))
      .filter((s) => s.tipo);

    if (!form.clienteId || servicosLimpos.length === 0) {
      addToast("Preencha o cliente e pelo menos um serviço.", "error");
      return;
    }

    // Normaliza peças/materiais — só mantém linhas com nome preenchido
    const pecasLimpas = (form.pecas || [])
      .map((p) => ({
        nome: (p.nome || "").trim(),
        quantidade: parseFloat(String(p.quantidade || "1").replace(",", ".")) || 1,
        valorUnit: parseFloat(String(p.valorUnit || "0").replace(",", ".")) || 0,
      }))
      .filter((p) => p.nome);

    const cliente = (allClients || []).find((c) => c.id === form.clienteId);
    const tecnico = tecnicos.find((t) => t.id === form.tecnicoId);
    // Total da OS = soma dos serviços + soma das peças (qtd × valorUnit)
    const totalServicos = servicosLimpos.reduce((acc, s) => acc + s.valor, 0);
    const totalPecas = pecasLimpas.reduce((acc, p) => acc + p.quantidade * p.valorUnit, 0);
    const valorTotal = totalServicos + totalPecas;

    // Campos de retrocompatibilidade: tipo recebe resumo, descricao monta um texto
    const tipoResumo = servicosLimpos.length === 1
      ? servicosLimpos[0].tipo
      : `Múltiplos (${servicosLimpos.length})`;
    const descricaoResumo = servicosLimpos
      .map((s) => s.descricao ? `${s.tipo}: ${s.descricao}` : s.tipo)
      .join(" • ");

    // Mantém compat com código antigo: se tipo=central, popula equipamentoBTUs
    const equipCapacidade = form.equipamentoCapacidade || "";
    const equipBTUs = form.equipamentoTipo === "central" ? equipCapacidade : "";

    if (editing) {
      const updated = {
        ...editing,
        clienteId: form.clienteId,
        clienteNome: cliente?.nome || "—",
        endereco: form.endereco,
        servicos: servicosLimpos,
        pecas: pecasLimpas,
        tipo: tipoResumo,
        descricao: descricaoResumo,
        equipamentoTipo: form.equipamentoTipo,
        equipamentoModelo: form.equipamentoModelo,
        equipamentoCapacidade: equipCapacidade,
        equipamentoBTUs: equipBTUs,
        tecnicoId: form.tecnicoId,
        tecnicoNome: tecnico?.nome || "—",
        dataAgendada: form.dataAgendada + "T00:00:00.000Z",
        horaAgendada: form.horaAgendada || "",
        observacoes: form.observacoes,
        valor: valorTotal,
        // Mantém itensUtilizados sincronizado (alguns docs antigos ainda usam)
        itensUtilizados: pecasLimpas.map((p) => ({ nome: p.nome, quantidade: p.quantidade, valorUnit: p.valorUnit })),
        updatedAt: new Date().toISOString(),
      };
      DB.set("erp:os:" + updated.id, updated);
      addToast("OS atualizada.", "success");
    } else {
      const numero = getNextNumber("OS", orders);
      const newOS = {
        id: genId(),
        numero,
        clienteId: form.clienteId,
        clienteNome: cliente?.nome || "—",
        endereco: form.endereco || (cliente?.endereco ? `${cliente.endereco.rua}, ${cliente.endereco.bairro} - ${cliente.endereco.cidade}/${cliente.endereco.estado}` : ""),
        servicos: servicosLimpos,
        pecas: pecasLimpas,
        tipo: tipoResumo,
        descricao: descricaoResumo,
        equipamentoTipo: form.equipamentoTipo,
        equipamentoModelo: form.equipamentoModelo,
        equipamentoCapacidade: equipCapacidade,
        equipamentoBTUs: equipBTUs,
        tecnicoId: form.tecnicoId,
        tecnicoNome: tecnico?.nome || "—",
        status: "aguardando",
        dataAbertura: new Date().toISOString(),
        dataAgendada: form.dataAgendada + "T00:00:00.000Z",
        horaAgendada: form.horaAgendada || "",
        dataConclusao: null,
        observacoes: form.observacoes,
        valor: valorTotal,
        itensUtilizados: pecasLimpas.map((p) => ({ nome: p.nome, quantidade: p.quantidade, valorUnit: p.valorUnit })),
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:os:" + newOS.id, newOS);
      addToast(`Ordem de Serviço ${numero} criada com sucesso.`, "success");
    }

    setModalOpen(false);
    loadOrders();
  }, [form, editing, orders, allClients, tecnicos, loadOrders, addToast]);

  const handleDelete = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      DB.delete("erp:os:" + confirmDelete.id);
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
    DB.set("erp:os:" + updated.id, updated);
    addToast(`OS ${os.numero} → ${STATUS_LABELS_OS[newStatus]}`, "success");
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
    {
      key: "tipo", label: "Tipo",
      // Quando há múltiplos serviços, mostra tag com a quantidade + tooltip com a lista
      render: (_, row) => {
        const servicos = Array.isArray(row.servicos) ? row.servicos : null;
        if (servicos && servicos.length > 1) {
          const resumo = servicos.map((s) => s.tipo).join(", ");
          return (
            <span className="inline-flex items-center gap-1.5" title={resumo}>
              <span>{servicos[0].tipo}</span>
              <span className="px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300 text-xs">+{servicos.length - 1}</span>
            </span>
          );
        }
        return row.tipo || "—";
      },
    },
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
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
        <KPICard title="Total OS" value={stats.total} icon="📋" />
        <KPICard title="Aguardando" value={stats.aguardando} icon="⏳" />
        <KPICard title="Deslocamento" value={stats.em_deslocamento} icon="🚗" />
        <KPICard title="Execução" value={stats.em_execucao} icon="🔧" />
        <KPICard title="Finalizado" value={stats.finalizado} icon="✅" />
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
          {/* Status novos do fluxo Tech App */}
          <option value="em_servico">Em Serviço (técnico)</option>
          <option value="aguardando_finalizacao">Aguardando Finalização</option>
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
        {/* Filtro por cliente — para ver histórico de serviços de um cliente específico */}
        {user.role !== "tecnico" && (
          <select
            value={filterCliente}
            onChange={(e) => setFilterCliente(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          >
            <option value="all">Todos clientes</option>
            {[...allClients].sort((a, b) => (a.nome || "").localeCompare(b.nome || "")).map((c) => (
              <option key={c.id} value={c.id}>{c.nome}</option>
            ))}
          </select>
        )}
        {/* Botão Produtividade — só admin/gerente veem */}
        {(user.role === "admin" || user.role === "gerente") && (
          <button
            onClick={() => setShowProdutividade(true)}
            className="ml-auto bg-purple-600 hover:bg-purple-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition flex items-center gap-2"
          >
            📊 Produtividade
          </button>
        )}
      </div>

      {/* ─── Banner: OS aguardando revisão da equipe técnica ─── */}
      {(user.role === "admin" || user.role === "gerente") && orders.filter((o) => o.status === "aguardando_finalizacao").length > 0 && (
        <div className="bg-orange-500/10 border border-orange-500/40 rounded-xl p-4 mb-4">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h3 className="font-semibold text-orange-300 mb-1">
                ⚠ {orders.filter((o) => o.status === "aguardando_finalizacao").length} OS aguardando finalização
              </h3>
              <p className="text-xs text-orange-200/80">
                Técnicos enviaram relatórios — clique para revisar e fechar.
              </p>
            </div>
            <button
              onClick={() => setFilterStatus("aguardando_finalizacao")}
              className="bg-orange-600 hover:bg-orange-700 text-white px-3 py-2 rounded-lg text-sm font-semibold transition whitespace-nowrap"
            >
              Ver pendentes
            </button>
          </div>
        </div>
      )}

      {/* List View */}
      {viewMode === "lista" && (
        <DataTable
          columns={columns}
          data={filteredOrders}
          onEdit={canManage ? openEdit : undefined}
          onDelete={(user.role === "admin" || user.role === "gerente") ? handleDelete : undefined}
          actions={(row) => (
            <>
              {/* Botão revisar OS finalizada pelo técnico — só admin/gerente */}
              {row.status === "aguardando_finalizacao" && (user.role === "admin" || user.role === "gerente") && (
                <button
                  onClick={() => setReviewing(row)}
                  className="p-1.5 rounded-lg text-orange-400 hover:text-orange-300 hover:bg-gray-700 transition"
                  title="Revisar relatório do técnico"
                >
                  📋
                </button>
              )}
              {getNextStatus(row.status) && (
                <button
                  onClick={() => changeStatus(row, getNextStatus(row.status))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-cyan-400 hover:bg-gray-700 transition"
                  title={`Avançar para ${STATUS_LABELS_OS[getNextStatus(row.status)]}`}
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" /></svg>
                </button>
              )}
              {/* Botões de documentos HTML */}
              <button
                onClick={() => openHTMLDoc(generateOrcamentoHTML(row, allClients))}
                className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition"
                title="Gerar Orçamento HTML"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
              </button>
              <button
                onClick={() => openHTMLDoc(generateOSHTML(row, allClients))}
                className="p-1.5 rounded-lg text-gray-400 hover:text-purple-400 hover:bg-gray-700 transition"
                title="Gerar Ordem de Serviço HTML"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01" /></svg>
              </button>
              {(row.status === "finalizado" || row.status === "concluido") && (
                <button
                  onClick={() => openHTMLDoc(generateReciboHTML(row, allClients))}
                  className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition"
                  title="Gerar Recibo HTML"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 14l6-6m-5.5.5h.01m4.99 5h.01M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16l3.5-2 3.5 2 3.5-2 3.5 2z" /></svg>
                </button>
              )}
            </>
          )}
          emptyMessage="Nenhuma OS encontrada."
        />
      )}

      {/* Kanban View */}
      {viewMode === "kanban" && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
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
                        className="bg-gray-700/50 border border-gray-600/30 rounded-lg p-3 hover:bg-gray-700 transition"
                      >
                        <div
                          className="cursor-pointer"
                          onClick={() => {
                            const next = getNextStatus(os.status);
                            if (next) changeStatus(os, next);
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
                        {/* Ações rápidas de documentos */}
                        <div className="flex items-center gap-1 mt-2 pt-2 border-t border-gray-600/30">
                          <button onClick={() => openHTMLDoc(generateOrcamentoHTML(os, allClients))} className="flex-1 py-1 text-xs rounded bg-blue-600/20 text-blue-400 hover:bg-blue-600/40 transition text-center" title="Orçamento">Orç.</button>
                          <button onClick={() => openHTMLDoc(generateOSHTML(os, allClients))} className="flex-1 py-1 text-xs rounded bg-purple-600/20 text-purple-400 hover:bg-purple-600/40 transition text-center" title="OS">OS</button>
                          {(os.status === "finalizado" || os.status === "concluido") && (
                            <button onClick={() => openHTMLDoc(generateReciboHTML(os, allClients))} className="flex-1 py-1 text-xs rounded bg-green-600/20 text-green-400 hover:bg-green-600/40 transition text-center" title="Recibo">Recibo</button>
                          )}
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
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Cliente *</label>
            <select
              value={form.clienteId}
              onChange={(e) => {
                const cid = e.target.value;
                const c = (allClients || []).find((cl) => cl.id === cid);
                setForm({
                  ...form,
                  clienteId: cid,
                  endereco: c?.endereco ? `${c.endereco.rua}, ${c.endereco.bairro} - ${c.endereco.cidade}/${c.endereco.estado}` : form.endereco,
                });
              }}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
            >
              <option value="">Selecione...</option>
              {(allClients || []).map((c) => (
                <option key={c.id} value={c.id}>{c.nome}</option>
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

          {/* Lista dinâmica de serviços — cada OS pode ter um ou mais */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">Serviços *</label>
              <span className="text-xs text-gray-400">
                Total OS (serviços + peças): <span className="text-white font-semibold tabular-nums">{formatCurrency(valorTotalForm)}</span>
              </span>
            </div>
            <div className="space-y-2">
              {(form.servicos || []).map((s, idx) => (
                <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-gray-700/40 border border-gray-700 rounded-lg p-2.5">
                  <div className="col-span-12 sm:col-span-3">
                    <label className="block text-xs text-gray-400 mb-1">Tipo</label>
                    <select
                      value={s.tipo}
                      onChange={(e) => updateServico(idx, { tipo: e.target.value })}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                    >
                      {SERVICE_TYPES.map((t) => (
                        <option key={t} value={t}>{t}</option>
                      ))}
                    </select>
                  </div>
                  <div className="col-span-8 sm:col-span-6">
                    <label className="block text-xs text-gray-400 mb-1">Descrição</label>
                    <input
                      type="text"
                      value={s.descricao}
                      onChange={(e) => updateServico(idx, { descricao: e.target.value })}
                      placeholder="Detalhe do serviço (opcional)"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>
                  <div className="col-span-3 sm:col-span-2">
                    <label className="block text-xs text-gray-400 mb-1">Valor (R$)</label>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      value={s.valor}
                      onChange={(e) => updateServico(idx, { valor: e.target.value })}
                      placeholder="0,00"
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                    />
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => removeServico(idx)}
                      disabled={(form.servicos || []).length <= 1}
                      className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition disabled:opacity-30 disabled:cursor-not-allowed min-h-[36px] min-w-[36px] inline-flex items-center justify-center"
                      aria-label="Remover serviço"
                      title="Remover serviço"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={addServico}
              className="w-full sm:w-auto px-3 py-2 text-sm rounded-lg bg-blue-600/20 border border-blue-600/40 text-blue-300 hover:bg-blue-600/30 transition inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Adicionar serviço
            </button>
          </div>

          {/* ─── Peças e Materiais ────────────────────────────────────────
              Lista opcional: cada linha tem nome, quantidade e valor unitário.
              Subtotal reativo por linha, total somado ao valor da OS. */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <label className="block text-sm font-medium text-gray-300">Peças e Materiais</label>
              <span className="text-xs text-gray-400">
                {(form.pecas || []).length > 0 ? `${(form.pecas || []).length} ite${(form.pecas || []).length === 1 ? "m" : "ns"}` : "Opcional"}
              </span>
            </div>
            {(form.pecas || []).length > 0 && (
              <div className="space-y-2">
                {(form.pecas || []).map((p, idx) => {
                  const qtd = parseFloat(String(p.quantidade || "0").replace(",", ".")) || 0;
                  const valU = parseFloat(String(p.valorUnit || "0").replace(",", ".")) || 0;
                  const subtotal = qtd * valU;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-gray-700/40 border border-gray-700 rounded-lg p-2.5">
                      <div className="col-span-12 sm:col-span-5">
                        <label className="block text-xs text-gray-400 mb-1">Peça/Material</label>
                        <input
                          type="text"
                          value={p.nome}
                          onChange={(e) => updatePeca(idx, { nome: e.target.value })}
                          placeholder="Ex: Compressor, Gás R-410A, Filtro..."
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Qtd</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={p.quantidade}
                          onChange={(e) => updatePeca(idx, { quantidade: e.target.value })}
                          placeholder="1"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Valor Unit.</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          inputMode="decimal"
                          value={p.valorUnit}
                          onChange={(e) => updatePeca(idx, { valorUnit: e.target.value })}
                          placeholder="0,00"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div className="col-span-3 sm:col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Subtotal</label>
                        <div className="px-3 py-2 rounded-lg bg-gray-800 border border-gray-700 text-sm text-gray-300 tabular-nums">
                          {formatCurrency(subtotal)}
                        </div>
                      </div>
                      <div className="col-span-1 flex justify-end">
                        <button
                          type="button"
                          onClick={() => removePeca(idx)}
                          className="p-2 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition min-h-[36px] min-w-[36px] inline-flex items-center justify-center"
                          aria-label="Remover peça"
                          title="Remover peça"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <button
              type="button"
              onClick={addPeca}
              className="w-full sm:w-auto px-3 py-2 text-sm rounded-lg bg-emerald-600/20 border border-emerald-600/40 text-emerald-300 hover:bg-emerald-600/30 transition inline-flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" /></svg>
              Adicionar peça/material
            </button>
          </div>

          {/* ─── Equipamento ──────────────────────────────────────────────
              Campos técnicos dependem do tipo selecionado:
              - central  → BTUs   - geladeira  → Litros
              - lavadora → Kg     - câmara fria → m³ etc. */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo de Equipamento</label>
              <select
                value={form.equipamentoTipo}
                onChange={(e) => setForm({ ...form, equipamentoTipo: e.target.value, equipamentoCapacidade: "" })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                {Object.entries(EQUIPMENT_TYPES).map(([key, cfg]) => (
                  <option key={key} value={key}>{cfg.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Modelo / Marca</label>
              <input
                type="text"
                value={form.equipamentoModelo}
                onChange={(e) => setForm({ ...form, equipamentoModelo: e.target.value })}
                placeholder="Ex: Consul, Brastemp, Samsung..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                {EQUIPMENT_TYPES[form.equipamentoTipo]?.capacityLabel || "Capacidade"}
              </label>
              <input
                type="text"
                value={form.equipamentoCapacidade}
                onChange={(e) => setForm({ ...form, equipamentoCapacidade: e.target.value })}
                placeholder={EQUIPMENT_TYPES[form.equipamentoTipo]?.capacityPlaceholder || ""}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
              {/* Hora agendada — usada pelo app do técnico para saber horário do compromisso */}
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hora Agendada</label>
              <input
                type="time"
                value={form.horaAgendada || ""}
                onChange={(e) => setForm({ ...form, horaAgendada: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Relatos do Cliente</label>
            <textarea
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              rows={3}
              placeholder="O que o cliente relatou sobre o problema/serviço solicitado..."
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

      {/* ─── Modal Produtividade Mensal ─── */}
      {showProdutividade && (
        <ProductivityReport
          orders={orders}
          tecnicos={tecnicos}
          onClose={() => setShowProdutividade(false)}
        />
      )}

      {/* ─── Modal Revisão OS finalizada pelo técnico ─── */}
      {reviewing && (
        <Modal isOpen={true} title={`Revisar OS — ${reviewing.clienteNome || ""}`} onClose={() => setReviewing(null)} size="lg">
          <div className="space-y-4">
            {/* Cabeçalho com info do técnico */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400">Técnico</div>
                <div className="font-semibold">{reviewing.tecnicoNome}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400">Equipamento</div>
                <div className="font-semibold">{EQUIPMENT_TYPES[reviewing.equipamentoTipo]?.label || "—"}</div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400">Chegada</div>
                <div className="font-semibold">
                  {reviewing.tecnico?.chegada ? new Date(reviewing.tecnico.chegada).toLocaleString("pt-BR") : "—"}
                </div>
              </div>
              <div className="bg-gray-800 rounded-lg p-3">
                <div className="text-xs text-gray-400">Saída</div>
                <div className="font-semibold">
                  {reviewing.tecnico?.saida ? new Date(reviewing.tecnico.saida).toLocaleString("pt-BR") : "—"}
                </div>
              </div>
              {reviewing.tecnico?.chegada && reviewing.tecnico?.saida && (
                <div className="bg-gray-800 rounded-lg p-3 col-span-2">
                  <div className="text-xs text-gray-400">Tempo de execução</div>
                  <div className="font-semibold text-cyan-400">
                    {(() => {
                      const ms = new Date(reviewing.tecnico.saida) - new Date(reviewing.tecnico.chegada);
                      const min = Math.floor(ms / 60000);
                      const h = Math.floor(min / 60);
                      const m = min % 60;
                      return h > 0 ? `${h}h ${m}min` : `${m}min`;
                    })()}
                  </div>
                </div>
              )}
            </div>

            {/* Descrição */}
            <div>
              <h4 className="text-xs font-semibold text-gray-400 mb-2">DESCRIÇÃO DO SERVIÇO</h4>
              <div className="bg-gray-800 rounded-lg p-3 text-sm whitespace-pre-wrap min-h-[80px]">
                {reviewing.descricaoTecnico || reviewing.tecnico?.descricao || "—"}
              </div>
            </div>

            {/* Fotos */}
            {(reviewing.fotos || []).length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-400 mb-2">FOTOS ({reviewing.fotos.length})</h4>
                <div className="grid grid-cols-3 gap-2">
                  {reviewing.fotos.map((url) => (
                    <a key={url} href={url} target="_blank" rel="noopener" className="block aspect-square">
                      <img src={url} alt="Foto serviço" className="w-full h-full object-cover rounded-lg hover:opacity-80 transition" />
                    </a>
                  ))}
                </div>
              </div>
            )}

            {/* Ações */}
            <div className="flex gap-2 pt-3 border-t border-gray-700">
              <button
                onClick={() => setReviewing(null)}
                className="flex-1 bg-gray-700 hover:bg-gray-600 text-white px-4 py-2 rounded-lg text-sm transition"
              >
                Fechar
              </button>
              <button
                onClick={() => {
                  // Reabre OS para o técnico corrigir — volta a 'em_servico'
                  if (!confirm("Devolver OS para o técnico corrigir?")) return;
                  const updated = { ...reviewing, status: "em_servico" };
                  DB.set("erp:os:" + updated.id, updated);
                  loadOrders();
                  setReviewing(null);
                  addToast("OS devolvida ao técnico", "warning");
                }}
                className="flex-1 bg-yellow-600 hover:bg-yellow-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
              >
                ↩ Devolver ao técnico
              </button>
              <button
                onClick={() => {
                  // Aprova e finaliza — status 'finalizado' + define dataConclusao
                  const updated = {
                    ...reviewing,
                    status: "finalizado",
                    dataConclusao: new Date().toISOString(),
                  };
                  DB.set("erp:os:" + updated.id, updated);
                  loadOrders();
                  setReviewing(null);
                  addToast(`OS ${reviewing.numero} finalizada`, "success");
                }}
                className="flex-1 bg-green-600 hover:bg-green-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition"
              >
                ✅ Aprovar e finalizar
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// ─── SCHEDULE MODULE ────────────────────────────────────────────────────────

function ScheduleModule({ user, dateFilter, addToast, clients, employees, onNavigate }) {
  const [appointments, setAppointments] = useState([]);
  // OS também entram no calendário como itens "só visualização" (origem=os) — editáveis só pelo módulo OS
  const [serviceOrders, setServiceOrders] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [viewMode, setViewMode] = useState("mes");
  const [currentDate, setCurrentDate] = useState(new Date());

  // Tipos usados no dropdown de agendamento — mesma lista da OS + "Revisão" para visitas técnicas
  const SERVICE_TYPES_SCHEDULE = [...SERVICE_TYPES_OS, "Revisão"];
  const STATUS_COLORS_SCHEDULE = {
    agendado: "bg-cyan-500",
    confirmado: "bg-blue-500",
    em_andamento: "bg-yellow-500",
    concluido: "bg-green-500",
    cancelado: "bg-red-500",
    // Status provenientes das OS — usamos cores distintas para separar visualmente
    aguardando: "bg-amber-500",
    em_deslocamento: "bg-cyan-600",
    em_execucao: "bg-blue-600",
    finalizado: "bg-green-600",
    pendente: "bg-orange-500",
  };
  const STATUS_LABELS_SCHEDULE = {
    agendado: "Agendado",
    confirmado: "Confirmado",
    em_andamento: "Em Andamento",
    concluido: "Concluído",
    cancelado: "Cancelado",
    aguardando: "Aguardando",
    em_deslocamento: "Em Deslocamento",
    em_execucao: "Em Execução",
    finalizado: "Finalizado",
    pendente: "Pendente",
  };

  // Carrega clientes e funcionários do DB diretamente para refletir cadastros recentes
  const [allEmployees, setAllEmployees] = useState(employees || []);
  const [allClients, setAllClients] = useState(clients || []);
  useEffect(() => {
    const empFromDB = DB.list("erp:employee:");
    setAllEmployees(empFromDB.length > 0 ? empFromDB : (employees || []));
    const cliFromDB = DB.list("erp:client:");
    setAllClients(cliFromDB.length > 0 ? cliFromDB : (clients || []));
  }, [employees, clients]);
  const tecnicos = useMemo(() => allEmployees.filter((e) => e.tipo === "tecnico" && e.status === "ativo"), [allEmployees]);

  // Carrega agendamentos (erp:schedule:) e OS (erp:os:) — os dois stores alimentam o calendário
  const loadAppointments = useCallback(() => {
    setAppointments(DB.list("erp:schedule:"));
    setServiceOrders(DB.list("erp:os:"));
  }, []);

  useEffect(() => { loadAppointments(); }, [loadAppointments]);

  // Converte cada OS no formato compatível com a visualização do calendário.
  // dataAgendada normalmente vem como "YYYY-MM-DDT00:00:00.000Z" — extraímos só a data
  // para evitar problemas de fuso (UTC 00:00 vira dia anterior em BRT).
  // Para OS sem dataAgendada, cai para dataAbertura (timestamp real).
  const osAsAppointments = useMemo(() => {
    const pad = (n) => String(n).padStart(2, "0");
    return serviceOrders
      .filter((os) => os.status !== "cancelado" && (os.dataAgendada || os.dataAbertura))
      .map((os) => {
        let dataStr, dataFimStr;
        if (os.dataAgendada) {
          // "2024-01-15T00:00:00.000Z" → "2024-01-15" → "2024-01-15T09:00"
          const datePart = String(os.dataAgendada).slice(0, 10);
          dataStr = `${datePart}T09:00`;
          dataFimStr = `${datePart}T10:00`;
        } else {
          const dt = new Date(os.dataAbertura);
          const datePart = `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
          const timePart = `${pad(dt.getHours())}:${pad(dt.getMinutes())}`;
          dataStr = `${datePart}T${timePart}`;
          const dtFim = new Date(dt.getTime() + 60 * 60 * 1000);
          dataFimStr = `${dtFim.getFullYear()}-${pad(dtFim.getMonth() + 1)}-${pad(dtFim.getDate())}T${pad(dtFim.getHours())}:${pad(dtFim.getMinutes())}`;
        }
        return {
          id: "os-" + os.id,
          osId: os.id,
          origem: "os",
          titulo: `OS ${os.numero || ""} — ${os.tipo || "Serviço"}`,
          data: dataStr,
          dataFim: dataFimStr,
          clienteId: os.clienteId,
          clienteNome: os.clienteNome || "—",
          tecnicoId: os.tecnicoId,
          tecnicoNome: os.tecnicoNome || "—",
          tipo: os.tipo,
          endereco: os.endereco || "",
          status: os.status || "aguardando",
          observacoes: os.descricao || "",
        };
      });
  }, [serviceOrders]);

  // Lista unificada usada por todos os renderizadores do calendário
  const allItems = useMemo(() => {
    const scheduled = appointments.map((a) => ({ ...a, origem: a.origem || "agenda" }));
    return [...scheduled, ...osAsAppointments];
  }, [appointments, osAsAppointments]);

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

  // Agora inclui agendamentos + OS do dia (visualização unificada)
  const getAppointmentsForDate = useCallback((dateStr) => {
    if (!dateStr) return [];
    return allItems.filter((a) => a.data && a.data.startsWith(dateStr));
  }, [allItems]);

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

  // Clique em item do calendário — OS redireciona para o módulo Ordens de Serviço
  const handleItemClick = useCallback((item) => {
    if (item.origem === "os") {
      if (onNavigate) {
        onNavigate("processos");
        addToast("Edite a OS pelo módulo Ordens de Serviço.", "info");
      } else {
        addToast("Esta OS é editada pelo módulo Ordens de Serviço.", "info");
      }
      return;
    }
    openEditInternal(item);
  }, [onNavigate, addToast]); // eslint-disable-line react-hooks/exhaustive-deps

  const openEditInternal = useCallback((appt) => {
    setEditing(appt);
    // Extrai horário diretamente da string (sem conversão de fuso) — ex: "2024-01-15T09:00" → "09:00"
    const startTime = appt.data && appt.data.includes("T") ? appt.data.slice(11, 16) : "08:00";
    const endTime = appt.dataFim && appt.dataFim.includes("T") ? appt.dataFim.slice(11, 16) : "10:00";
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

    // Detecção de conflito considera agendamentos E OS do mesmo técnico
    const conflicts = allItems.filter((a) => {
      if (editing && a.id === editing.id) return false;
      if (a.tecnicoId !== form.tecnicoId) return false;
      if (a.status === "cancelado") return false;
      const aStart = new Date(a.data);
      const aEnd = new Date(a.dataFim);
      return startDT < aEnd && endDT > aStart;
    });

    if (conflicts.length > 0) {
      const hasOS = conflicts.some((c) => c.origem === "os");
      addToast(hasOS
        ? "Conflito de horário! Técnico já possui uma OS nesse período."
        : "Conflito de horário! Técnico já possui agendamento nesse período.",
        "error");
      return;
    }

    const cliente = (allClients || []).find((c) => c.id === form.clienteId);
    const tecnico = tecnicos.find((t) => t.id === form.tecnicoId);

    if (editing) {
      const updated = {
        ...editing,
        titulo: `${form.tipo} - ${cliente?.nome || ""}`,
        data: `${form.data}T${form.horaInicio}:00`,
        dataFim: `${form.data}T${form.horaFim}:00`,
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
        data: `${form.data}T${form.horaInicio}:00`,
        dataFim: `${form.data}T${form.horaFim}:00`,
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
  }, [form, editing, allItems, allClients, tecnicos, loadAppointments, addToast]);

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
    const cliente = (allClients || []).find((c) => c.id === appt.clienteId);
    if (!cliente?.telefone) {
      addToast("Cliente sem telefone cadastrado.", "warning");
      return;
    }
    const phone = cliente.telefone.replace(/\D/g, "");
    const msg = encodeURIComponent(
      `Olá ${cliente.nome}! Confirmamos seu agendamento de ${appt.tipo} para ${formatDateTime(appt.data)}. Endereço: ${appt.endereco || "a confirmar"}. FrostERP Refrigeração.`
    );
    window.open(`https://wa.me/55${phone}?text=${msg}`, "_blank");
  }, [allClients, addToast]);

  const sendEmail = useCallback((appt) => {
    const cliente = (allClients || []).find((c) => c.id === appt.clienteId);
    if (!cliente?.email) {
      addToast("Cliente sem email cadastrado.", "warning");
      return;
    }
    const subject = encodeURIComponent(`Confirmação de Agendamento - ${appt.tipo}`);
    const body = encodeURIComponent(
      `Olá ${cliente.nome},\n\nConfirmamos seu agendamento:\n\nServiço: ${appt.tipo}\nData: ${formatDateTime(appt.data)}\nEndereço: ${appt.endereco || "a confirmar"}\n\nAtenciosamente,\nFrostERP Refrigeração`
    );
    window.open(`mailto:${cliente.email}?subject=${subject}&body=${body}`, "_blank");
  }, [allClients, addToast]);

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
                            className={`text-xs px-1 py-0.5 rounded truncate text-white flex items-center gap-1 ${STATUS_COLORS_SCHEDULE[a.status] || "bg-gray-600"} ${a.origem === "os" ? "ring-1 ring-white/30" : ""}`}
                            onClick={(e) => { e.stopPropagation(); handleItemClick(a); }}
                            title={`${a.origem === "os" ? "OS — clique para abrir Ordens de Serviço" : "Agendamento"} · ${a.titulo}`}
                          >
                            {a.origem === "os" && <span aria-hidden="true">🔧</span>}
                            <span className="truncate">{a.titulo}</span>
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
                        className={`text-xs p-1.5 rounded text-white cursor-pointer ${STATUS_COLORS_SCHEDULE[a.status] || "bg-gray-600"} ${a.origem === "os" ? "ring-1 ring-white/30" : ""} hover:opacity-80 transition`}
                        onClick={() => handleItemClick(a)}
                        title={a.origem === "os" ? "OS — abre no módulo Ordens de Serviço" : "Agendamento"}
                      >
                        <p className="font-medium truncate flex items-center gap-1">
                          {a.origem === "os" && <span aria-hidden="true">🔧</span>}
                          {a.titulo}
                        </p>
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
              // Agora considera agendamentos + OS
              const slotAppts = allItems.filter((a) => {
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
                        className={`text-xs p-2 rounded text-white flex-1 min-w-[150px] cursor-pointer ${STATUS_COLORS_SCHEDULE[a.status] || "bg-gray-600"} ${a.origem === "os" ? "ring-1 ring-white/30" : ""} hover:opacity-80`}
                        onClick={(e) => { e.stopPropagation(); handleItemClick(a); }}
                      >
                        <p className="font-medium flex items-center gap-1">
                          {a.origem === "os" && <span aria-hidden="true">🔧</span>}
                          {a.titulo}
                        </p>
                        <p className="opacity-75">{a.tecnicoNome} | {a.clienteNome}</p>
                        {a.origem !== "os" && (
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
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Today's items — agendamentos + OS */}
      {allItems.filter((a) => a.data && a.data.startsWith(todayStr) && a.status !== "cancelado").length > 0 && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5">
          <h3 className="text-white font-semibold mb-3">Agenda de Hoje</h3>
          <div className="space-y-2">
            {allItems
              .filter((a) => a.data && a.data.startsWith(todayStr) && a.status !== "cancelado")
              .sort((a, b) => new Date(a.data) - new Date(b.data))
              .map((a) => (
                <div key={a.id} className="flex items-center gap-3 p-3 rounded-lg bg-gray-700/30 hover:bg-gray-700/50 transition">
                  <div className={`w-2 h-8 rounded-full ${STATUS_COLORS_SCHEDULE[a.status]}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-white text-sm font-medium truncate flex items-center gap-1.5">
                      {a.origem === "os" && <span className="text-xs px-1.5 py-0.5 rounded bg-purple-500/30 text-purple-200">OS</span>}
                      {a.titulo}
                    </p>
                    <p className="text-gray-400 text-xs">
                      {new Date(a.data).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })} -
                      {a.dataFim ? new Date(a.dataFim).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }) : ""} | {a.tecnicoNome}
                    </p>
                  </div>
                  <div className="flex gap-1">
                    {a.origem !== "os" && (
                      <>
                        <button onClick={() => sendWhatsApp(a)} className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition" title="WhatsApp">
                          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z" /></svg>
                        </button>
                        <button onClick={() => sendEmail(a)} className="p-1.5 rounded-lg text-gray-400 hover:text-blue-400 hover:bg-gray-700 transition" title="Email">
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" /></svg>
                        </button>
                      </>
                    )}
                    {a.origem === "os" && (
                      <button onClick={() => onNavigate && onNavigate("processos")} className="p-1.5 rounded-lg text-gray-400 hover:text-purple-400 hover:bg-gray-700 transition" title="Abrir em Ordens de Serviço">
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" /></svg>
                      </button>
                    )}
                    {a.origem !== "os" && a.status === "agendado" && (
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
                  const c = (allClients || []).find((cl) => cl.id === cid);
                  setForm({
                    ...form,
                    clienteId: cid,
                    endereco: c?.endereco ? `${c.endereco.rua}, ${c.endereco.bairro}` : form.endereco,
                  });
                }}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="">Selecione...</option>
                {(allClients || []).map((c) => (
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


// ─── CADASTRO MODULE ─────────────────────────────────────────────────────────

function CadastroModule({ user, addToast, reloadData }) {
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
  // rg: apenas para pessoa física
  const emptyClientForm = {
    nome: "", tipo: "pf", cpf: "", rg: "", cnpj: "", telefone: "", email: "",
    rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "",
    observacoes: "",
  };

  // Funcionário agora tem endereço completo (rua, número, bairro, cidade, estado, CEP)
  const emptyEmployeeForm = {
    nome: "", cpf: "", rg: "", telefone: "", email: "",
    cargo: "Técnico", salario: "", dataAdmissao: toISODate(new Date()), status: "ativo",
    rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "",
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
      rg: row.rg || "",
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
    if (!clientForm.telefone.trim()) {
      addToast("Informe o telefone do cliente.", "error");
      return;
    }

    const data = {
      nome: clientForm.nome.trim(),
      tipo: clientForm.tipo,
      cpf: clientForm.tipo === "pf" ? clientForm.cpf : "",
      rg: clientForm.tipo === "pf" ? clientForm.rg.trim() : "",
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
      addToast(`Cliente ${newClient.nome} cadastrado com sucesso.`, "success");
    }
    setModalOpen(false);
    loadClients();
    // Propaga o cliente atualizado aos demais módulos (Processos/OS, Agenda, Finanças)
    if (reloadData) reloadData();
  }, [clientForm, editing, loadClients, addToast, reloadData]);

  /* Exclusão de cliente — remove também OS, transações, tickets e agendamentos vinculados */
  const handleDeleteClient = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteClientAction = useCallback(() => {
    if (confirmDelete) {
      // Remove OS vinculadas
      const os = DB.list("erp:os:").filter((o) => o.clienteId === confirmDelete.id);
      os.forEach((o) => DB.delete("erp:os:" + o.id));
      // Remove agendamentos vinculados
      const ag = DB.list("erp:schedule:").filter((s) => s.clienteId === confirmDelete.id);
      ag.forEach((s) => DB.delete("erp:schedule:" + s.id));
      // Remove o cliente
      DB.delete("erp:client:" + confirmDelete.id);
      const removed = os.length + ag.length;
      addToast(`Cliente e ${removed} registro(s) vinculado(s) excluídos.`, "success");
      setConfirmDelete(null);
      setDetailView(null);
      loadClients();
      // Propaga a exclusão aos demais módulos (remoções em cascata de OS/transações/tickets/agenda)
      if (reloadData) reloadData();
    }
  }, [confirmDelete, loadClients, addToast, reloadData]);

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
      rg: row.rg || "",
      telefone: row.telefone || "",
      email: row.email || "",
      cargo: row.cargo || "Técnico",
      salario: row.salario || "",
      dataAdmissao: row.dataAdmissao || toISODate(new Date()),
      status: row.status || "ativo",
      rua: row.endereco?.rua || "",
      numero: row.endereco?.numero || "",
      bairro: row.endereco?.bairro || "",
      cidade: row.endereco?.cidade || "",
      estado: row.endereco?.estado || "",
      cep: row.endereco?.cep || "",
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
      rg: employeeForm.rg.trim(),
      telefone: employeeForm.telefone,
      email: employeeForm.email.trim(),
      cargo: employeeForm.cargo,
      tipo: employeeForm.cargo === "Técnico" ? "tecnico" : employeeForm.cargo === "Gerente" ? "gerente" : "administrativo",
      salario: parseFloat(String(employeeForm.salario).replace(",", ".")) || 0,
      dataAdmissao: employeeForm.dataAdmissao,
      status: employeeForm.status,
      especialidades: [],
      crea: "",
      // Endereço residencial completo do funcionário
      endereco: {
        rua: employeeForm.rua.trim(),
        numero: employeeForm.numero.trim(),
        bairro: employeeForm.bairro.trim(),
        cidade: employeeForm.cidade.trim(),
        estado: employeeForm.estado.trim(),
        cep: employeeForm.cep.trim(),
      },
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
    if (reloadData) reloadData(); // atualiza data.employees no App para refletir nos módulos OS e Agenda
  }, [employeeForm, editing, loadEmployees, addToast, reloadData]);

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
      // Propaga a remoção do funcionário aos módulos que o usam (Processos/OS, Agenda)
      if (reloadData) reloadData();
    }
  }, [confirmDelete, loadEmployees, addToast, reloadData]);

  // ─── Client Detail View — restrito a dados + OS após remoção dos módulos financeiro/fiscal
  const clientDetailData = useMemo(() => {
    if (!detailView) return null;
    return {
      os: DB.list("erp:os:").filter((o) => o.clienteId === detailView.id),
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
          {["dados", "os"].map((tab) => (
            <button
              key={tab}
              onClick={() => setDetailTab(tab)}
              className={`px-4 py-2 text-sm rounded-t-lg transition ${detailTab === tab ? "bg-blue-600 text-white" : "text-gray-400 hover:text-white hover:bg-gray-700"}`}
            >
              {{ dados: "Dados", os: "Ordens de Serviço" }[tab]}
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
                  <p className="text-white">{detailView.tipo === "pf" ? (detailView.cpf || "—") : (detailView.cnpj || "—")}</p>
                </div>
                {detailView.tipo === "pf" && (
                  <div>
                    <p className="text-xs text-gray-400 uppercase">RG</p>
                    <p className="text-white">{detailView.rg || "—"}</p>
                  </div>
                )}
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
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">CPF</label>
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
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">CNPJ</label>
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
              {/* RG — só aparece para Pessoa Física */}
              {clientForm.tipo === "pf" && (
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">RG</label>
                  <input
                    type="text"
                    value={clientForm.rg}
                    onChange={(e) => setClientForm({ ...clientForm, rg: e.target.value })}
                    placeholder="00.000.000-0"
                    maxLength={20}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
              )}
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
            <div className="grid grid-cols-3 gap-4">
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
                <label className="block text-sm font-medium text-gray-300 mb-1.5">RG</label>
                <input
                  type="text"
                  value={employeeForm.rg}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, rg: e.target.value })}
                  placeholder="00.000.000-0"
                  maxLength={20}
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

            {/* Endereço residencial do funcionário — mesmo padrão usado no cadastro de cliente */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Endereço Residencial</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Rua</label>
                  <input
                    type="text"
                    value={employeeForm.rua}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, rua: e.target.value })}
                    placeholder="Rua, Avenida..."
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Número</label>
                  <input
                    type="text"
                    value={employeeForm.numero}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, numero: e.target.value })}
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
                    value={employeeForm.bairro}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, bairro: e.target.value })}
                    placeholder="Bairro"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Cidade</label>
                  <input
                    type="text"
                    value={employeeForm.cidade}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, cidade: e.target.value })}
                    placeholder="Cidade"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Estado</label>
                  <input
                    type="text"
                    value={employeeForm.estado}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, estado: e.target.value.toUpperCase().slice(0, 2) })}
                    placeholder="SP"
                    maxLength={2}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">CEP</label>
                  <input
                    type="text"
                    value={employeeForm.cep}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, cep: formatCEP(e.target.value) })}
                    placeholder="00000-000"
                    maxLength={9}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
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


// ─── SETTINGS MODULE ──────────────────────────────────────────────────────────

// ─── GERENCIAMENTO DE USUÁRIOS — apenas para admins ────────────────────────────
// Permite criar, editar, ativar/desativar e remover usuários.
// O admin pode escolher um papel padrão (role) OU marcar permissões manuais
// que sobrescrevem completamente as permissões do papel.

function UserManagement({ currentUser, addToast }) {
  const [users, setUsers] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);

  const emptyForm = {
    nome: "", email: "", password: "", confirmPassword: "",
    role: "atendente", status: "ativo",
    useCustomPermissions: false,
    customPermissions: [],
  };
  const [form, setForm] = useState(emptyForm);

  const loadUsers = useCallback(() => {
    const list = DB.list("erp:user:").sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    setUsers(list);
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const openCreate = useCallback(() => {
    setEditing(null);
    setForm(emptyForm);
    setModalOpen(true);
  }, []);

  const openEdit = useCallback((u) => {
    setEditing(u);
    setForm({
      nome: u.nome || "",
      email: u.email || "",
      password: "",
      confirmPassword: "",
      role: u.role || "atendente",
      status: u.status || "ativo",
      useCustomPermissions: Array.isArray(u.customPermissions),
      customPermissions: Array.isArray(u.customPermissions) ? u.customPermissions : [],
    });
    setModalOpen(true);
  }, []);

  const togglePermission = useCallback((moduleId) => {
    setForm((f) => ({
      ...f,
      customPermissions: f.customPermissions.includes(moduleId)
        ? f.customPermissions.filter((m) => m !== moduleId)
        : [...f.customPermissions, moduleId],
    }));
  }, []);

  const handleSave = useCallback(async () => {
    const nome = form.nome.trim();
    const emailNorm = form.email.trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!nome) { addToast("Informe o nome.", "error"); return; }
    if (!emailRegex.test(emailNorm)) { addToast("Email inválido.", "error"); return; }

    // Verifica unicidade do email (ignora o próprio usuário em edição)
    const dup = users.find((u) => (u.email || "").toLowerCase() === emailNorm && (!editing || u.id !== editing.id));
    if (dup) { addToast("Já existe um usuário com este email.", "error"); return; }

    if (!editing) {
      // Criação exige senha
      if (!form.password || form.password.length < 8) {
        addToast("Senha deve ter no mínimo 8 caracteres.", "error"); return;
      }
      if (form.password !== form.confirmPassword) {
        addToast("As senhas não conferem.", "error"); return;
      }
    } else if (form.password) {
      // Em edição, troca de senha é opcional
      if (form.password.length < 8) {
        addToast("Nova senha deve ter no mínimo 8 caracteres.", "error"); return;
      }
      if (form.password !== form.confirmPassword) {
        addToast("As senhas não conferem.", "error"); return;
      }
    }

    if (editing) {
      const updated = {
        ...editing,
        nome,
        email: emailNorm,
        role: form.role,
        status: form.status,
        customPermissions: form.useCustomPermissions ? form.customPermissions : null,
        updatedAt: new Date().toISOString(),
      };
      if (form.password) {
        updated.password = await hashPassword(form.password);
        // Invalida sessões antigas ao trocar senha
        updated.sessionTokenHash = null;
      }
      DB.set("erp:user:" + updated.id, updated);
      addToast("Usuário atualizado.", "success");
    } else {
      const newUser = {
        id: genId(),
        nome,
        email: emailNorm,
        password: await hashPassword(form.password),
        role: form.role,
        status: form.status,
        avatar: nome.slice(0, 2).toUpperCase(),
        createdAt: new Date().toISOString(),
        forcePasswordChange: false,
        sessionTokenHash: null,
        customPermissions: form.useCustomPermissions ? form.customPermissions : null,
      };
      DB.set("erp:user:" + newUser.id, newUser);
      addToast("Usuário criado.", "success");
    }

    setModalOpen(false);
    loadUsers();
  }, [form, editing, users, addToast, loadUsers]);

  const handleDelete = useCallback((u) => {
    if (u.id === currentUser.id) {
      addToast("Você não pode excluir o próprio usuário.", "error");
      return;
    }
    // Impede deletar o último admin ativo
    const activeAdmins = users.filter((x) => x.role === "admin" && x.status === "ativo");
    if (u.role === "admin" && activeAdmins.length <= 1) {
      addToast("Não é possível excluir o último administrador ativo.", "error");
      return;
    }
    setConfirmDelete(u);
  }, [currentUser.id, users, addToast]);

  const executeDelete = useCallback(() => {
    if (!confirmDelete) return;
    DB.delete("erp:user:" + confirmDelete.id);
    addToast(`Usuário ${confirmDelete.nome} excluído.`, "success");
    setConfirmDelete(null);
    loadUsers();
  }, [confirmDelete, addToast, loadUsers]);

  const toggleStatus = useCallback((u) => {
    if (u.id === currentUser.id) {
      addToast("Você não pode desativar a si mesmo.", "error");
      return;
    }
    const activeAdmins = users.filter((x) => x.role === "admin" && x.status === "ativo");
    if (u.role === "admin" && u.status === "ativo" && activeAdmins.length <= 1) {
      addToast("Não é possível desativar o último administrador ativo.", "error");
      return;
    }
    const updated = { ...u, status: u.status === "ativo" ? "inativo" : "ativo" };
    if (updated.status === "inativo") updated.sessionTokenHash = null;
    DB.set("erp:user:" + updated.id, updated);
    addToast(`Usuário ${updated.status === "ativo" ? "ativado" : "desativado"}.`, "success");
    loadUsers();
  }, [currentUser.id, users, addToast, loadUsers]);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-white">Usuários do Sistema</h3>
          <p className="text-gray-400 text-sm mt-0.5">Gerencie quem tem acesso e o que cada um pode fazer.</p>
        </div>
        <button
          onClick={openCreate}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
        >
          + Novo Usuário
        </button>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400 text-xs uppercase">
              <th className="text-left px-3 py-2">Nome</th>
              <th className="text-left px-3 py-2">Email</th>
              <th className="text-left px-3 py-2">Papel</th>
              <th className="text-left px-3 py-2">Permissões</th>
              <th className="text-left px-3 py-2">Status</th>
              <th className="text-right px-3 py-2">Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-gray-500">Nenhum usuário cadastrado.</td></tr>
            )}
            {users.map((u) => (
              <tr key={u.id} className="border-b border-gray-700/50 hover:bg-gray-700/30">
                <td className="px-3 py-2 text-white">
                  {u.nome}
                  {u.id === currentUser.id && <span className="ml-2 text-xs text-blue-400">(você)</span>}
                </td>
                <td className="px-3 py-2 text-gray-300">{u.email}</td>
                <td className="px-3 py-2 text-gray-300 capitalize">{u.role}</td>
                <td className="px-3 py-2 text-gray-400 text-xs">
                  {Array.isArray(u.customPermissions)
                    ? `Manual (${u.customPermissions.length})`
                    : "Padrão do papel"}
                </td>
                <td className="px-3 py-2">
                  <StatusBadge status={u.status === "ativo" ? "ativo" : "inativo"} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  <button
                    onClick={() => toggleStatus(u)}
                    className="px-2 py-1 text-xs rounded bg-gray-700 text-gray-300 hover:bg-gray-600 transition mr-1"
                    title={u.status === "ativo" ? "Desativar" : "Ativar"}
                  >
                    {u.status === "ativo" ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => openEdit(u)}
                    className="px-2 py-1 text-xs rounded bg-blue-600/30 text-blue-300 hover:bg-blue-600/50 transition mr-1"
                  >
                    Editar
                  </button>
                  <button
                    onClick={() => handleDelete(u)}
                    className="px-2 py-1 text-xs rounded bg-red-600/30 text-red-300 hover:bg-red-600/50 transition"
                  >
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Modal de criação/edição */}
      <Modal
        isOpen={modalOpen}
        title={editing ? "Editar Usuário" : "Novo Usuário"}
        onClose={() => setModalOpen(false)}
        size="lg"
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome</label>
              <input
                type="text"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">
                Senha {editing && <span className="text-xs text-gray-500">(deixe vazio para manter)</span>}
              </label>
              <input
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar senha</label>
              <input
                type="password"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(e) => setForm({ ...form, confirmPassword: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Papel (Role)</label>
              <select
                value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="admin">Administrador</option>
                <option value="gerente">Gerente</option>
                <option value="tecnico">Técnico</option>
                <option value="atendente">Atendente</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
              <select
                value={form.status}
                onChange={(e) => setForm({ ...form, status: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>
          </div>

          <div className="border border-gray-700 rounded-lg p-4 bg-gray-900/40">
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={form.useCustomPermissions}
                onChange={(e) => setForm({ ...form, useCustomPermissions: e.target.checked })}
                className="w-4 h-4"
              />
              <span className="text-sm text-white font-medium">Personalizar permissões manualmente</span>
            </label>
            <p className="text-xs text-gray-400 mb-3">
              Quando ativado, o acesso é definido pelos módulos marcados abaixo, ignorando o papel.
              Se desativado, o usuário usa as permissões padrão do papel selecionado.
            </p>
            <div className={`grid grid-cols-2 md:grid-cols-3 gap-2 ${form.useCustomPermissions ? "" : "opacity-40 pointer-events-none"}`}>
              {ALL_MODULES.map((m) => (
                <label key={m.id} className="flex items-center gap-2 text-sm text-gray-300 cursor-pointer hover:text-white">
                  <input
                    type="checkbox"
                    checked={form.customPermissions.includes(m.id)}
                    onChange={() => togglePermission(m.id)}
                    className="w-4 h-4"
                  />
                  <span>{m.label}</span>
                </label>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600">
              Cancelar
            </button>
            <button onClick={handleSave} className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700">
              {editing ? "Salvar alterações" : "Criar usuário"}
            </button>
          </div>
        </div>
      </Modal>

      {confirmDelete && (
        <ConfirmDialog
          message={`Excluir o usuário ${confirmDelete.nome}? Esta ação não pode ser desfeita.`}
          requireType="EXCLUIR"
          onConfirm={executeDelete}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}

// Painel do feed iCalendar — mostra URL https/webcal, QR code e ações de regenerar/desativar
// QR code é gerado via API pública (chart.googleapis / goqr.me) sem dependência extra.
function CalendarFeedPanel({ feed, onRegenerate, onDisable, onCopy }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const httpsURL = `${origin}/api/calendar.ics?token=${feed.token}`;
  // webcal:// faz calendários (iOS/macOS/Outlook) assinarem o feed automaticamente
  const webcalURL = httpsURL.replace(/^https?:\/\//, "webcal://");
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(webcalURL)}`;

  return (
    <div className="grid md:grid-cols-[1fr_auto] gap-6 items-start">
      <div className="space-y-4">
        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase mb-1">URL HTTPS (Google Calendar, Outlook)</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={httpsURL}
              onFocus={(e) => e.target.select()}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono"
            />
            <button
              onClick={() => onCopy(httpsURL)}
              className="px-3 py-2 text-xs rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition"
            >
              Copiar
            </button>
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-gray-400 uppercase mb-1">URL webcal (Apple Calendar / iOS)</label>
          <div className="flex gap-2">
            <input
              readOnly
              value={webcalURL}
              onFocus={(e) => e.target.select()}
              className="flex-1 bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-xs text-gray-200 font-mono"
            />
            <button
              onClick={() => onCopy(webcalURL)}
              className="px-3 py-2 text-xs rounded-lg bg-gray-700 text-gray-200 hover:bg-gray-600 transition"
            >
              Copiar
            </button>
          </div>
        </div>

        <details className="text-sm text-gray-400">
          <summary className="cursor-pointer text-blue-400 hover:text-blue-300">Como adicionar no celular?</summary>
          <ul className="mt-2 space-y-1 text-xs leading-relaxed list-disc pl-5">
            <li><strong>iPhone:</strong> Ajustes → Calendário → Contas → Adicionar Conta → Outra → Adicionar Calendário Assinado → cole a URL <em>webcal://</em>.</li>
            <li><strong>Google Calendar:</strong> calendar.google.com → &quot;Outros calendários&quot; → &quot;Por URL&quot; → cole a URL <em>https</em>.</li>
            <li><strong>Outlook (web):</strong> Calendário → &quot;Adicionar calendário&quot; → &quot;Inscrever-se na Web&quot; → cole a URL <em>https</em>.</li>
            <li>A sincronização é automática; pode levar alguns minutos para novos eventos aparecerem.</li>
          </ul>
        </details>

        <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-700">
          <button
            onClick={onRegenerate}
            className="px-3 py-1.5 text-xs rounded-lg bg-yellow-600/20 border border-yellow-600/40 text-yellow-300 hover:bg-yellow-600/30 transition"
          >
            Regenerar token
          </button>
          <button
            onClick={onDisable}
            className="px-3 py-1.5 text-xs rounded-lg bg-red-600/20 border border-red-600/40 text-red-300 hover:bg-red-600/30 transition"
          >
            Desativar sincronização
          </button>
        </div>
      </div>

      <div className="flex flex-col items-center gap-2">
        <img
          src={qrSrc}
          alt="QR Code da URL do calendário"
          className="w-[180px] h-[180px] rounded-lg bg-white p-2"
          loading="lazy"
        />
        <p className="text-xs text-gray-400 text-center max-w-[180px]">
          Escaneie com o celular para abrir direto no calendário nativo
        </p>
      </div>
    </div>
  );
}

function SettingsModule({ user, addToast, reloadData }) {
  const [config, setConfig] = useState({
    razaoSocial: "", cnpj: "", telefone: "", email: "", endereco: "",
  });
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmResetFinal, setConfirmResetFinal] = useState(false);
  const [importConfirm, setImportConfirm] = useState(false);
  const [pendingImportData, setPendingImportData] = useState(null);
  const [systemInfo, setSystemInfo] = useState({ totalRecords: 0, lastBackup: null });
  // Estado do feed de calendário (sincronização com celular)
  const [calendarFeed, setCalendarFeed] = useState({ token: null, enabled: false });
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

    // Prefixos ativos após remoção dos módulos financeiro/fiscal/estoque/mensageria
    const prefixes = [
      "erp:client:", "erp:employee:", "erp:os:",
      "erp:schedule:", "erp:user:",
    ];
    let total = 0;
    prefixes.forEach((p) => { total += DB.list(p).length; });
    const lastBackup = DB.get("erp:lastBackup");
    setSystemInfo({ totalRecords: total, lastBackup });

    // Carrega estado atual do feed de calendário
    const feed = DB.get("erp:calendarFeedToken") || { token: null, enabled: false };
    setCalendarFeed(feed);
  }, []);

  // ─── Feed de Calendário — gera token para sincronizar com celular via URL iCalendar ───
  const handleEnableCalendarFeed = useCallback(() => {
    const token = genSecureToken();
    const feed = { token, enabled: true, name: "FrostERP — Agenda", createdAt: new Date().toISOString() };
    DB.set("erp:calendarFeedToken", feed);
    setCalendarFeed(feed);
    addToast("Link de sincronização gerado! Use a URL abaixo no seu celular.", "success");
  }, [addToast]);

  const handleRegenerateCalendarToken = useCallback(() => {
    const token = genSecureToken();
    const existing = DB.get("erp:calendarFeedToken") || {};
    const feed = { ...existing, token, enabled: true, regeneratedAt: new Date().toISOString() };
    DB.set("erp:calendarFeedToken", feed);
    setCalendarFeed(feed);
    addToast("Novo token gerado. O link antigo não funciona mais.", "success");
  }, [addToast]);

  const handleDisableCalendarFeed = useCallback(() => {
    const existing = DB.get("erp:calendarFeedToken") || {};
    const feed = { ...existing, enabled: false };
    DB.set("erp:calendarFeedToken", feed);
    setCalendarFeed(feed);
    addToast("Sincronização desativada.", "info");
  }, [addToast]);

  const handleCopyCalendarURL = useCallback((url) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(
        () => addToast("URL copiada!", "success"),
        () => addToast("Não foi possível copiar. Copie manualmente.", "error")
      );
    } else {
      addToast("Clipboard indisponível. Copie manualmente.", "warning");
    }
  }, [addToast]);

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

  // ─── Export Backup — restrito aos módulos ativos (clientes, funcionários, OS, agenda, usuários) ───
  const handleExport = useCallback(() => {
    const backup = {
      clients: DB.list("erp:client:"),
      employees: DB.list("erp:employee:"),
      services: DB.list("erp:os:"),
      schedule: DB.list("erp:schedule:"),
      config: DB.get("erp:config"),
      users: DB.list("erp:user:"),
      exportedAt: new Date().toISOString(),
      version: "2.0",
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
    addToast("Backup exportado com sucesso.", "success");
    loadConfig();
  }, [addToast, loadConfig]);

  // ─── Import Backup ───
  const handleFileSelect = useCallback((e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = JSON.parse(ev.target.result);
        // Aceita backups antigos (v1.0 com inventory/finance) ignorando campos descontinuados
        const requiredKeys = ["clients", "employees", "config", "version"];
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

    // Apaga apenas os prefixos que o sistema atual usa
    const prefixes = [
      "erp:client:", "erp:employee:", "erp:os:",
      "erp:schedule:", "erp:user:",
    ];
    prefixes.forEach((prefix) => {
      const items = DB.list(prefix);
      items.forEach((item) => { if (item.id) DB.delete(prefix + item.id); });
    });

    // Importa apenas os registros relevantes — campos de backups antigos são ignorados
    const importList = (items, prefix) => {
      (items || []).forEach((item) => {
        if (item.id) DB.set(prefix + item.id, item);
      });
    };

    importList(data.clients, "erp:client:");
    importList(data.employees, "erp:employee:");
    importList(data.services || data.processes, "erp:os:");
    importList(data.schedule, "erp:schedule:");
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

  const executeResetDemo = useCallback(async () => {
    // Apaga todos os dados do sistema
    const prefixes = [
      "erp:client:", "erp:employee:", "erp:os:",
      "erp:schedule:", "erp:user:",
    ];
    prefixes.forEach((prefix) => {
      const items = DB.list(prefix);
      items.forEach((item) => { if (item.id) DB.delete(prefix + item.id); });
    });
    DB.delete("erp:config");
    DB.delete("erp:seeded");
    DB.delete("erp:lastBackup");

    // Cria apenas o usuário admin padrão com senha segura (PBKDF2)
    const adminUser = {
      id: genId(), email: "admin@frosterp.com.br", nome: "Administrador",
      password: await hashPassword("admin@frost2024"), role: "admin",
      avatar: "AD", createdAt: new Date().toISOString(), status: "ativo",
      forcePasswordChange: true, sessionTokenHash: null,
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


      {/* Sincronização de calendário com o celular (feed iCalendar) */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-white flex items-center gap-2">
              📱 Sincronizar Agenda com o Celular
            </h3>
            <p className="text-gray-400 text-sm mt-1">
              Gere um link privado para adicionar seus agendamentos e OS ao Google Calendar, Apple Calendar ou Outlook.
            </p>
          </div>
        </div>

        {!calendarFeed.enabled || !calendarFeed.token ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-sm text-gray-400">
              Ao ativar, um link com token único será criado. Mantenha-o em segurança — qualquer pessoa com o link pode ver seus eventos.
            </p>
            <button
              onClick={handleEnableCalendarFeed}
              className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition"
            >
              Ativar sincronização
            </button>
          </div>
        ) : (
          <CalendarFeedPanel
            feed={calendarFeed}
            onRegenerate={handleRegenerateCalendarToken}
            onDisable={handleDisableCalendarFeed}
            onCopy={handleCopyCalendarURL}
          />
        )}
      </div>

      {/* Gerenciamento de Usuários (apenas admin) */}
      <UserManagement currentUser={user} addToast={addToast} />

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

// ─── RELATÓRIO DE PRODUTIVIDADE POR TÉCNICO ──────────────────────────────────
// Lista todos os serviços concluídos no mês selecionado, agrupados por técnico.
// Calcula: total de OS, tempo médio (chegada → saída), valor total faturado.
function ProductivityReport({ orders, tecnicos, onClose }) {
  const [mes, setMes] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });

  // ─── Agrupa OS concluídas/aguardando por técnico no mês selecionado ───
  const stats = useMemo(() => {
    const [ano, mm] = mes.split("-").map(Number);
    const inicio = new Date(ano, mm - 1, 1).getTime();
    const fim = new Date(ano, mm, 1).getTime();

    // Filtra OS finalizadas (concluido ou aguardando_finalizacao) cuja saída do técnico está no mês
    const filtradas = orders.filter((os) => {
      const status = os.status;
      if (!["concluido", "aguardando_finalizacao"].includes(status)) return false;
      const saidaIso = os.tecnico?.saida;
      if (!saidaIso) return false;
      const t = new Date(saidaIso).getTime();
      return t >= inicio && t < fim;
    });

    // Agrupa por tecnicoId
    const agrupado = {};
    filtradas.forEach((os) => {
      const tid = os.tecnicoId || "sem_tecnico";
      if (!agrupado[tid]) {
        agrupado[tid] = {
          tecnicoId: tid,
          nome: os.tecnicoNome || "Sem técnico",
          total: 0,
          tempoTotalMs: 0,
          valorTotal: 0,
          ordens: [],
        };
      }
      const grupo = agrupado[tid];
      grupo.total += 1;
      grupo.ordens.push(os);
      // Soma tempo de execução (chegada → saída)
      if (os.tecnico?.chegada && os.tecnico?.saida) {
        grupo.tempoTotalMs += new Date(os.tecnico.saida) - new Date(os.tecnico.chegada);
      }
      // Soma valor cobrado (campo valorTotal ou valor da OS)
      grupo.valorTotal += Number(os.valorTotal || os.valor || 0);
    });

    return Object.values(agrupado).sort((a, b) => b.total - a.total);
  }, [orders, mes]);

  const formatDuracao = (ms) => {
    if (!ms) return "—";
    const min = Math.floor(ms / 60000);
    const h = Math.floor(min / 60);
    const m = min % 60;
    return h > 0 ? `${h}h ${m}min` : `${m}min`;
  };

  const totalGeral = stats.reduce((sum, s) => sum + s.total, 0);
  const valorGeral = stats.reduce((sum, s) => sum + s.valorTotal, 0);

  return (
    <Modal isOpen={true} title="Produtividade Mensal por Técnico" onClose={onClose} size="xl">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-300">Mês:</label>
          <input
            type="month"
            value={mes}
            onChange={(e) => setMes(e.target.value)}
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
          />
          <div className="ml-auto text-sm text-gray-400">
            Total: <span className="text-white font-semibold">{totalGeral} OS</span>
            {" • "}
            <span className="text-green-400 font-semibold">
              {valorGeral.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
            </span>
          </div>
        </div>

        {stats.length === 0 ? (
          <div className="text-center py-12 text-gray-500">
            Nenhum serviço finalizado neste mês.
          </div>
        ) : (
          <div className="space-y-3">
            {stats.map((s) => (
              <details
                key={s.tecnicoId}
                className="bg-gray-800 border border-gray-700 rounded-xl overflow-hidden"
              >
                <summary className="cursor-pointer px-4 py-3 flex items-center justify-between hover:bg-gray-750">
                  <div>
                    <div className="font-semibold text-white">{s.nome}</div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      Tempo médio:{" "}
                      {formatDuracao(s.total > 0 ? s.tempoTotalMs / s.total : 0)}
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="text-right">
                      <div className="text-2xl font-bold text-cyan-400">{s.total}</div>
                      <div className="text-xs text-gray-500">serviços</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-green-400">
                        {s.valorTotal.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                      </div>
                      <div className="text-xs text-gray-500">faturado</div>
                    </div>
                  </div>
                </summary>
                <div className="px-4 py-3 border-t border-gray-700 bg-gray-900/40">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="py-1">Cliente</th>
                        <th className="py-1">Equipamento</th>
                        <th className="py-1">Saída</th>
                        <th className="py-1">Tempo</th>
                        <th className="py-1 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody>
                      {s.ordens.map((o) => {
                        const dur =
                          o.tecnico?.chegada && o.tecnico?.saida
                            ? new Date(o.tecnico.saida) - new Date(o.tecnico.chegada)
                            : 0;
                        return (
                          <tr key={o.id} className="border-t border-gray-800">
                            <td className="py-1.5">{o.clienteNome || "—"}</td>
                            <td className="py-1.5">
                              {EQUIPMENT_TYPES[o.equipamentoTipo]?.label || "—"}
                            </td>
                            <td className="py-1.5">
                              {o.tecnico?.saida
                                ? new Date(o.tecnico.saida).toLocaleString("pt-BR")
                                : "—"}
                            </td>
                            <td className="py-1.5">{formatDuracao(dur)}</td>
                            <td className="py-1.5 text-right">
                              {Number(o.valorTotal || o.valor || 0).toLocaleString("pt-BR", {
                                style: "currency",
                                currency: "BRL",
                              })}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </details>
            ))}
          </div>
        )}

        <div className="flex justify-end pt-3 border-t border-gray-700">
          <button
            onClick={() => window.print()}
            className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-sm transition"
          >
            🖨️ Imprimir
          </button>
        </div>
      </div>
    </Modal>
  );
}

// ─── TÉCNICO MOBILE APP ─────────────────────────────────────────────────────
// Shell totalmente separado renderizado quando o usuário logado tem role="tecnico".
// Não usa sidebar — UI mobile-first focada exclusivamente nas demandas do técnico.
// Fluxo: vê OS atribuídas → marca chegada → preenche relatório+fotos → finaliza.
function TecnicoMobileApp({ user, onLogout, addToast }) {
  const [orders, setOrders] = useState([]);
  const [tab, setTab] = useState("ativas"); // ativas | historico
  const [selected, setSelected] = useState(null); // OS aberta no detalhe
  const [reload, setReload] = useState(0);

  // ─── Carrega OS atribuídas ao técnico logado ───
  useEffect(() => {
    const all = DB.list("erp:os:");
    const minhas = all.filter(
      (os) => os.tecnicoId === user.id || os.tecnicoNome === user.nome
    );
    setOrders(minhas);
  }, [user.id, user.nome, reload]);

  // ─── Realtime: recarrega quando ERP envia novas OS ───
  useEffect(() => {
    const unsub = subscribeToChanges(() => setReload((r) => r + 1));
    return unsub;
  }, []);

  // Filtra ativas (qualquer status antes de aguardando_finalizacao) e histórico
  // ERP cria OS com status='aguardando' (STATUS_FLOW[0]), então essa também é ativa
  const ativas = orders.filter((o) =>
    ["aguardando", "agendado", "em_deslocamento", "em_servico", "em_execucao", "confirmado"].includes(o.status)
  );
  const historico = orders.filter((o) =>
    ["aguardando_finalizacao", "concluido", "finalizado", "cancelado"].includes(o.status)
  );

  const lista = tab === "ativas" ? ativas : historico;

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-['DM_Sans']">
      <StyleSheet />

      {/* Header fixo */}
      <header className="sticky top-0 z-20 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center justify-between shadow-lg">
        <div>
          <h1 className="text-base font-bold">{user.nome}</h1>
          <p className="text-xs text-gray-400">Técnico • FrostERP</p>
        </div>
        <button
          onClick={onLogout}
          className="text-xs px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
        >
          Sair
        </button>
      </header>

      {/* Tabs */}
      <div className="flex border-b border-gray-700 bg-gray-800">
        {[
          { id: "ativas", label: `Ativas (${ativas.length})` },
          { id: "historico", label: `Histórico (${historico.length})` },
        ].map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`flex-1 py-3 text-sm font-semibold transition ${
              tab === t.id
                ? "text-cyan-400 border-b-2 border-cyan-400"
                : "text-gray-400"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Lista */}
      <main className="p-4 space-y-3 pb-24">
        {lista.length === 0 && (
          <div className="text-center py-20 text-gray-500">
            <div className="text-4xl mb-2">📋</div>
            <p className="text-sm">
              {tab === "ativas"
                ? "Nenhuma OS ativa atribuída a você."
                : "Sem histórico ainda."}
            </p>
          </div>
        )}

        {lista.map((os) => (
          <button
            key={os.id}
            onClick={() => setSelected(os)}
            className="w-full text-left bg-gray-800 hover:bg-gray-750 border border-gray-700 rounded-xl p-4 transition active:scale-[0.98]"
          >
            <div className="flex items-start justify-between mb-2">
              <span className="font-semibold text-sm">{os.clienteNome || "—"}</span>
              <StatusBadge status={os.status} />
            </div>
            <p className="text-xs text-gray-400 mb-1">
              {EQUIPMENT_TYPES[os.equipamentoTipo]?.label || os.tipoEquipamento || "—"}
            </p>
            <p className="text-xs text-gray-500">
              📅 {os.dataAgendada ? formatDate(os.dataAgendada) : "Sem data"}
              {os.horaAgendada && <span className="ml-2">⏰ {os.horaAgendada}</span>}
            </p>
            {os.endereco && (
              <p className="text-xs text-gray-500 mt-1">📍 {os.endereco}</p>
            )}
          </button>
        ))}
      </main>

      {/* Modal detalhe/ação */}
      {selected && (
        <TecnicoOSDetail
          os={selected}
          user={user}
          onClose={() => setSelected(null)}
          onUpdated={() => {
            setSelected(null);
            setReload((r) => r + 1);
          }}
          addToast={addToast}
        />
      )}
    </div>
  );
}

// ─── Tela de detalhe + ações para uma OS específica (técnico) ────────────────
function TecnicoOSDetail({ os, user, onClose, onUpdated, addToast }) {
  const [descricao, setDescricao] = useState(os.descricaoTecnico || "");
  const [fotos, setFotos] = useState(os.fotos || []); // array de URLs públicas
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // ─── Botão "voltar" Android/navegador fecha esta tela ao invés de sair do app ───
  useEffect(() => {
    let poppedByBack = false;
    window.history.pushState({ tecnicoDetail: true }, "");
    const onPop = () => {
      poppedByBack = true;
      onClose();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!poppedByBack && window.history.state?.tecnicoDetail) {
        window.history.back();
      }
    };
  }, [onClose]);

  // ─── Marca chegada do técnico no local ───
  const handleChegada = async () => {
    setBusy(true);
    const updated = {
      ...os,
      status: "em_servico",
      tecnico: { ...(os.tecnico || {}), chegada: new Date().toISOString() },
    };
    DB.set(`erp:os:${os.id}`, updated);
    addToast("Chegada registrada!", "success");
    setBusy(false);
    onUpdated();
  };

  // ─── Upload de fotos: captura/galeria (camera mobile) ───
  const handleFotosChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);
    const novasUrls = [];
    for (const file of files) {
      const url = await uploadFotoOS(file, os.id);
      if (url) novasUrls.push(url);
    }
    setFotos((prev) => [...prev, ...novasUrls]);
    setUploading(false);
    if (novasUrls.length > 0) addToast(`${novasUrls.length} foto(s) enviada(s)`, "success");
    else addToast("Falha no upload", "error");
    e.target.value = ""; // reset input
  };

  // ─── Remove foto antes de finalizar ───
  const removeFoto = async (url) => {
    if (!confirm("Remover esta foto?")) return;
    await deleteFotoOS(url);
    setFotos((prev) => prev.filter((u) => u !== url));
  };

  // ─── Finaliza serviço: envia tudo para ERP revisar ───
  const handleFinalizar = async () => {
    if (!descricao.trim()) {
      addToast("Descreva o serviço realizado antes de finalizar", "warning");
      return;
    }
    if (!confirm("Finalizar serviço e enviar para escritório?")) return;
    setBusy(true);
    const updated = {
      ...os,
      status: "aguardando_finalizacao",
      descricaoTecnico: descricao.trim(),
      fotos,
      tecnico: {
        ...(os.tecnico || {}),
        chegada: os.tecnico?.chegada || new Date().toISOString(),
        saida: new Date().toISOString(),
        descricao: descricao.trim(),
        fotos,
      },
    };
    DB.set(`erp:os:${os.id}`, updated);
    addToast("Serviço enviado para revisão!", "success");
    setBusy(false);
    onUpdated();
  };

  // Tech pode iniciar (chegada) quando OS está em qualquer status pré-execução
  const podeIniciar = ["aguardando", "agendado", "em_deslocamento", "confirmado"].includes(os.status);
  const emServico = ["em_servico", "em_execucao"].includes(os.status);
  const finalizado = ["aguardando_finalizacao", "concluido", "finalizado"].includes(os.status);

  return (
    <div className="fixed inset-0 z-50 bg-gray-900 overflow-y-auto fade-in">
      {/* Header */}
      <header className="sticky top-0 z-10 bg-gray-800 border-b border-gray-700 px-4 py-3 flex items-center gap-3">
        <button onClick={onClose} className="text-2xl leading-none">&larr;</button>
        <div className="flex-1">
          <h2 className="text-sm font-bold">OS #{os.numero || os.id.slice(0, 6)}</h2>
          <p className="text-xs text-gray-400">{os.clienteNome}</p>
        </div>
        <StatusBadge status={os.status} />
      </header>

      <div className="p-4 space-y-4">
        {/* Info básica */}
        <section className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Equipamento</span>
            <span>{EQUIPMENT_TYPES[os.equipamentoTipo]?.label || "—"}</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-400">Data / Hora</span>
            <span>
              {os.dataAgendada ? formatDate(os.dataAgendada) : "—"}
              {os.horaAgendada ? ` às ${os.horaAgendada}` : ""}
            </span>
          </div>
          {os.endereco && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-400">Endereço</span>
              <span className="text-right">{os.endereco}</span>
            </div>
          )}
          {(() => {
            // Busca telefone do cliente no DB (não vem direto na OS)
            const cli = os.clienteId ? DB.get("erp:client:" + os.clienteId) : null;
            const tel = cli?.telefone;
            if (!tel) return null;
            return (
              <a
                href={`tel:${tel.replace(/\D/g, "")}`}
                className="block mt-2 text-center bg-cyan-600 hover:bg-cyan-700 rounded-lg py-2 text-sm font-semibold"
              >
                📞 Ligar para {tel}
              </a>
            );
          })()}
        </section>

        {/* Relatos do cliente (campo observacoes da OS — preenchido pelo escritório) */}
        {os.observacoes && (
          <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 mb-2">RELATOS DO CLIENTE</h3>
            <p className="text-sm whitespace-pre-wrap">{os.observacoes}</p>
          </section>
        )}

        {/* Lista de serviços previstos */}
        {(os.servicos || []).length > 0 && (
          <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 mb-2">SERVIÇOS PREVISTOS</h3>
            <ul className="text-sm space-y-1">
              {os.servicos.map((s, i) => (
                <li key={i} className="flex justify-between">
                  <span>• {s.tipo}{s.descricao ? ` — ${s.descricao}` : ""}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {/* Botão chegada */}
        {podeIniciar && (
          <button
            onClick={handleChegada}
            disabled={busy}
            className="w-full py-4 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-base font-bold transition active:scale-[0.98]"
          >
            🚪 Cheguei no local
          </button>
        )}

        {/* Em serviço — formulário relatório */}
        {(emServico || finalizado) && (
          <>
            {os.tecnico?.chegada && (
              <p className="text-xs text-gray-500 text-center">
                Chegada: {new Date(os.tecnico.chegada).toLocaleString("pt-BR")}
              </p>
            )}

            <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <label className="text-xs font-semibold text-gray-400 mb-2 block">
                DESCRIÇÃO DETALHADA DO SERVIÇO
              </label>
              <textarea
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                disabled={finalizado}
                rows={6}
                placeholder="Descreva o que foi feito, peças trocadas, observações..."
                className="w-full bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm focus:outline-none focus:border-cyan-500 disabled:opacity-60"
              />
            </section>

            <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
              <label className="text-xs font-semibold text-gray-400 mb-2 block">
                FOTOS DO SERVIÇO ({fotos.length})
              </label>

              {!finalizado && (
                <label className="block w-full py-3 mb-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-center text-sm font-semibold cursor-pointer transition">
                  {uploading ? "Enviando..." : "📷 Adicionar fotos"}
                  <input
                    type="file"
                    accept="image/*"
                    capture="environment"
                    multiple
                    onChange={handleFotosChange}
                    disabled={uploading}
                    className="hidden"
                  />
                </label>
              )}

              {fotos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {fotos.map((url) => (
                    <div key={url} className="relative aspect-square">
                      <img
                        src={url}
                        alt="Foto serviço"
                        className="w-full h-full object-cover rounded-lg"
                      />
                      {!finalizado && (
                        <button
                          onClick={() => removeFoto(url)}
                          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-600 text-xs flex items-center justify-center"
                        >
                          ×
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Botão finalizar */}
            {emServico && (
              <button
                onClick={handleFinalizar}
                disabled={busy}
                className="w-full py-4 rounded-xl bg-green-600 hover:bg-green-700 disabled:opacity-50 text-base font-bold transition active:scale-[0.98]"
              >
                ✅ Finalizar e enviar para escritório
              </button>
            )}

            {finalizado && os.tecnico?.saida && (
              <p className="text-xs text-gray-500 text-center">
                Saída: {new Date(os.tecnico.saida).toLocaleString("pt-BR")}
              </p>
            )}
          </>
        )}
      </div>
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
  const [data, setData] = useState({
    clients: [], employees: [], services: [], schedule: [],
    finance: [], inventory: [], config: {},
  });
  const [notifications, setNotifications] = useState([]);
  const [globalSearch, setGlobalSearch] = useState("");
  const [globalSearchResults, setGlobalSearchResults] = useState([]);
  const [showSearchResults, setShowSearchResults] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const [pendingPasswordChange, setPendingPasswordChange] = useState(null);
  const [needsFirstUser, setNeedsFirstUser] = useState(false);
  const searchRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  // ─── Init com Splash de 3 segundos + restauração de sessão ───
  useEffect(() => {
    // Splash de 3s com fade-out
    const t1 = setTimeout(() => {
      setSplashFading(true);
      const t2 = setTimeout(() => setSplashVisible(false), 600);
      return () => clearTimeout(t2);
    }, 3000);

    // Real init — hydrate from Supabase, then load
    hydrateFromSupabase().then(async () => {
      // Inicialização: popula dados demo se for o primeiro acesso (sem usuários)
      await seedDatabase();
      loadAllData();
      setLoading(false);
      // Se não há nenhum usuário cadastrado, exige criação do super admin
      const usersCount = DB.list("erp:user:").length;
      if (usersCount === 0) setNeedsFirstUser(true);
      // Restauração de sessão via sessionStorage — agora valida token contra hash do usuário
      try {
        const sessionRaw = sessionStorage.getItem("frost_session");
        if (sessionRaw) {
          const session = JSON.parse(sessionRaw);
          const SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutos
          const within = session.userId && session.token && (Date.now() - session.lastActivity) < SESSION_TIMEOUT;
          if (within) {
            const savedUser = DB.get("erp:user:" + session.userId);
            // Valida HASH do token armazenado no usuário — impede forjar sessão pelo DevTools
            const tokenHash = await sha256Hex(session.token);
            if (savedUser && savedUser.status === "ativo" && savedUser.sessionTokenHash === tokenHash) {
              setUser(savedUser);
              lastActivityRef.current = Date.now();
              sessionStorage.setItem("frost_session", JSON.stringify({ ...session, lastActivity: Date.now() }));
            } else {
              // Token inválido ou usuário desativado — limpa sessão
              sessionStorage.removeItem("frost_session");
            }
          } else {
            sessionStorage.removeItem("frost_session");
          }
        }
      } catch { sessionStorage.removeItem("frost_session"); }
      // Upload inicial só roda quando NÃO existe nada no Supabase (evita escrita massiva a cada load)
    });

    // Realtime: escuta mudanças de outros aparelhos e atualiza dados automaticamente
    // Debounce 300ms — evita reload em rajada quando muitas chaves mudam de uma vez
    let realtimeTimer = null;
    const unsubscribe = subscribeToChanges(() => {
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => { loadAllData(); }, 300);
    });

    return () => {
      clearTimeout(t1);
      if (realtimeTimer) clearTimeout(realtimeTimer);
      unsubscribe();
    };
  }, []);

  // ─── Load All Data ───
  const loadAllData = useCallback(() => {
    setData({
      clients: DB.list("erp:client:"),
      employees: DB.list("erp:employee:"),
      services: DB.list("erp:os:"),
      schedule: DB.list("erp:schedule:"),
      finance: DB.list("erp:finance:"),
      config: DB.get("erp:config") || {},
    });
  }, []);

  // ─── Add Toast ───
  // Timer de remoção fica apenas no componente Toast (via useEffect com clearTimeout)
  const addToast = useCallback((message, type = "info") => {
    const id = genId();
    setToasts((prev) => [...prev, { id, message, type, duration: 4000 }]);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // ─── Timeout de inatividade (30 min) — desloga automaticamente ───
  useEffect(() => {
    const INACTIVITY_TIMEOUT = 30 * 60 * 1000;
    const resetActivity = () => {
      lastActivityRef.current = Date.now();
      try {
        const raw = sessionStorage.getItem("frost_session");
        if (raw) {
          const s = JSON.parse(raw);
          s.lastActivity = Date.now();
          sessionStorage.setItem("frost_session", JSON.stringify(s));
        }
      } catch { /* ignora */ }
    };
    const events = ["mousemove", "keydown", "click", "touchstart", "scroll"];
    events.forEach((ev) => document.addEventListener(ev, resetActivity, { passive: true }));

    const checkInterval = setInterval(() => {
      if (user && (Date.now() - lastActivityRef.current) > INACTIVITY_TIMEOUT) {
        setUser(null);
        setPendingPasswordChange(null);
        setActiveModule("dashboard");
        sessionStorage.removeItem("frost_session");
        addToast("Sessão expirada por inatividade.", "warning");
      }
    }, 60000);

    return () => {
      events.forEach((ev) => document.removeEventListener(ev, resetActivity));
      clearInterval(checkInterval);
    };
  }, [user, addToast]);

  // ─── Compute Notifications ───
  // OS pendentes há mais de 2 dias — sinaliza atenção no sino da barra superior
  const computedNotifications = useMemo(() => {
    const alerts = [];
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() - 2);
    data.services
      .filter((os) => os.status === "pendente" || os.status === "aguardando")
      .forEach((os) => {
        if (new Date(os.dataAbertura) < dueDate) {
          alerts.push({
            id: "os-" + os.id,
            type: "warning",
            message: `OS ${os.numero} sem movimentação há 2+ dias — ${os.clienteNome}`,
            module: "processos",
          });
        }
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

    // Search funcionários
    data.employees.filter((e) => (e.nome || "").toLowerCase().includes(s)).slice(0, 5).forEach((e) => {
      results.push({ type: "Funcionário", label: e.nome, sub: e.cargo, module: "cadastro", id: e.id });
    });

    setGlobalSearchResults(results);
    setShowSearchResults(results.length > 0);
  }, [globalSearch, data]);

  // Fecha busca/notificações ao clicar fora — usa ref do dropdown de notificações
  // para permitir clicar nas notificações sem fechá-las imediatamente
  const notificationsRef = useRef(null);
  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearchResults(false);
      }
      if (notificationsRef.current && !notificationsRef.current.contains(e.target)) {
        setShowNotifications(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // ─── Sidebar Nav Items ───
  // Cada item declara o módulo correspondente em ROLE_PERMISSIONS para controle de acesso
  const navItems = useMemo(() => {
    const items = [
      { id: "dashboard", label: "Dashboard", icon: "📊", module: "dashboard" },
      { id: "processos", label: "Ordens de Serviço", icon: "🔧", module: "os" },
      { id: "agenda", label: "Agenda", icon: "📅", module: "agenda" },
      { id: "financeiro", label: "Financeiro", icon: "💰", module: "financeiro" },
      { id: "cadastro", label: "Cadastros", icon: "👥", module: "clientes" },
      { id: "config", label: "Configurações", icon: "⚙️", module: "config" },
    ];

    if (!user) return [];
    // Usa hasPermission para respeitar permissões customizadas (sobrescrevem o role)
    return items.filter((item) => {
      if (item.id === "dashboard") return hasPermission(user, "dashboard");
      if (item.id === "config") {
        // Apenas admin (ou quem tem 'config' explicitamente) acessa configurações
        return user.role === "admin" || hasPermission(user, "config");
      }
      return hasPermission(user, item.id) || hasPermission(user, item.module);
    });
  }, [user]);

  const activeModuleLabel = useMemo(() => {
    const item = navItems.find((n) => n.id === activeModule);
    return item ? item.label : "Dashboard";
  }, [navItems, activeModule]);

  // Gera um token seguro, salva apenas o HASH no usuário e o token bruto na sessão
  // Isso impede que um atacante forje sessões pelo DevTools (ele não conhece o token original)
  const startSession = useCallback(async (u) => {
    const token = genSecureToken();
    const tokenHash = await sha256Hex(token);
    const updated = { ...u, sessionTokenHash: tokenHash, lastLoginAt: new Date().toISOString() };
    DB.set("erp:user:" + updated.id, updated);
    sessionStorage.setItem("frost_session", JSON.stringify({
      userId: updated.id, loginAt: Date.now(), lastActivity: Date.now(), token,
    }));
    return updated;
  }, []);

  // ─── Login Handler — salva sessão e verifica troca de senha obrigatória ───
  const handleLogin = useCallback(async (u) => {
    if (u.forcePasswordChange) {
      setPendingPasswordChange(u);
      return;
    }
    const sessUser = await startSession(u);
    setUser(sessUser);
    setActiveModule("dashboard");
    lastActivityRef.current = Date.now();
    loadAllData();
  }, [loadAllData, startSession]);

  // Callback após troca de senha obrigatória
  const handlePasswordChanged = useCallback(async (updatedUser) => {
    setPendingPasswordChange(null);
    const sessUser = await startSession(updatedUser);
    setUser(sessUser);
    setActiveModule("dashboard");
    lastActivityRef.current = Date.now();
    loadAllData();
  }, [loadAllData, startSession]);

  // Após criar o super admin no primeiro acesso — loga automaticamente
  const handleFirstUserCreated = useCallback(async (newUser) => {
    setNeedsFirstUser(false);
    const sessUser = await startSession(newUser);
    setUser(sessUser);
    setActiveModule("dashboard");
    lastActivityRef.current = Date.now();
    loadAllData();
  }, [loadAllData, startSession]);

  const handleLogout = useCallback(() => {
    // Invalida o token também no usuário (sessões em outras abas/aparelhos perdem validade)
    if (user?.id) {
      const fresh = DB.get("erp:user:" + user.id);
      if (fresh) DB.set("erp:user:" + user.id, { ...fresh, sessionTokenHash: null });
    }
    setUser(null);
    setPendingPasswordChange(null);
    setActiveModule("dashboard");
    setGlobalSearch("");
    setGlobalSearchResults([]);
    sessionStorage.removeItem("frost_session");
  }, [user]);

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
        <BlurText
          text="FrostERP"
          delay={200}
          animateBy="words"
          direction="top"
          className="text-5xl font-bold text-white"
        />
      </div>
    );
  }

  // Primeiro acesso: nenhum usuário cadastrado → cria super admin
  if (needsFirstUser && !user) {
    return (
      <>
        <StyleSheet />
        <FirstUserSetup onComplete={handleFirstUserCreated} />
      </>
    );
  }

  // Dialog de troca de senha obrigatória (antes de permitir acesso)
  if (pendingPasswordChange) {
    return (
      <>
        <StyleSheet />
        <ForcePasswordChangeDialog user={pendingPasswordChange} onComplete={handlePasswordChanged} />
      </>
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

  // ─── Roteamento por role: técnico vê app mobile dedicado, sem sidebar ───
  if (user.role === "tecnico") {
    return (
      <>
        <ToastContainer toasts={toasts} removeToast={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
        <TecnicoMobileApp user={user} onLogout={handleLogout} addToast={addToast} />
      </>
    );
  }

  return (
    <div className="flex h-screen bg-gray-900 text-gray-100 font-['DM_Sans'] fade-in">
      <StyleSheet />

      {/* Sidebar */}
      <aside
        id="main-sidebar"
        aria-label="Navegação principal"
        className={`fixed lg:static inset-y-0 left-0 z-40 bg-gray-800 border-r border-gray-700 flex flex-col transition-all duration-300 shadow-2xl lg:shadow-none ${
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
              className="lg:hidden p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition min-h-[40px] min-w-[40px] inline-flex items-center justify-center"
              aria-label="Abrir menu"
              aria-controls="main-sidebar"
              aria-expanded={sidebarOpen}
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
            {["dashboard", "processos", "agenda"].includes(activeModule) && (
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
            <div className="relative" ref={notificationsRef}>
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
          {["dashboard", "processos", "agenda"].includes(activeModule) && (
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
          {activeModule === "processos" && (
            <ProcessModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} employees={data.employees} />
          )}
          {activeModule === "agenda" && (
            <ScheduleModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} employees={data.employees} onNavigate={setActiveModule} />
          )}
          {activeModule === "financeiro" && (
            <FinanceModule user={user} dateFilter={dateFilter} addToast={addToast} />
          )}
          {activeModule === "cadastro" && (
            <CadastroModule user={user} addToast={addToast} reloadData={loadAllData} />
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
