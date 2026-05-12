
import { useState, useEffect, useCallback, useRef, useMemo, useLayoutEffect, Component } from "react";
import {
  LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer
} from "recharts";
import { animate } from "animejs";
import { supabase, hydrateFromSupabase, uploadAllToSupabase, syncToSupabase, deleteFromSupabase, subscribeToChanges, uploadFotoOS, deleteFotoOS, signInWithFallback, signOutSupabase, ensureMemberLoaded, getCurrentMember, listMastersRemote, upsertMasterRemote, deleteMasterRemote } from "./supabase.js";
import Aurora from "./Aurora.jsx";
import BlurText from "./BlurText.jsx";
import { PasswordInput } from "./PasswordInput.jsx";
// Biometria: APK pode logar com Touch ID / Face ID / digital
import { isNative, isBiometricAvailable, isBiometricEnabled, authenticateBiometric, enableBiometricLogin, getBiometricCreds, disableBiometricLogin } from "./platform.js";

// ─── ErrorBoundary por módulo ────────────────────────────────────────────────
// Sem isto, qualquer crash em um módulo (Recharts com dado malformado, OS legada
// num formatDate, etc) branqueia o app inteiro e o operador perde a sessão. O
// boundary isola o módulo: módulo X morre, restante (sidebar, header, toasts)
// continua. Reset automático quando moduleKey muda — usuário troca de módulo
// e tenta de novo. Logamos no console pra captura por Sentry/LogRocket futuro.
class ModuleErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    console.error("[ModuleErrorBoundary]", this.props.moduleKey, error, info?.componentStack);
  }
  componentDidUpdate(prevProps) {
    // Reset ao trocar de módulo — permite ao usuário sair do erro
    if (prevProps.moduleKey !== this.props.moduleKey && this.state.error) {
      this.setState({ error: null });
    }
  }
  render() {
    if (this.state.error) {
      return (
        <div className="flex flex-col items-center justify-center min-h-[60vh] p-6 text-center">
          <div className="w-16 h-16 rounded-full bg-red-500/10 border border-red-500/30 flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-lg font-semibold text-gray-100 mb-2">
            Erro ao carregar este módulo
          </h2>
          <p className="text-sm text-gray-400 mb-4 max-w-md">
            Algo quebrou inesperadamente. Tente trocar de módulo e voltar, ou recarregue a página. Os dados já salvos não foram perdidos.
          </p>
          <details className="text-xs text-gray-500 mb-4 max-w-md">
            <summary className="cursor-pointer">Detalhes técnicos</summary>
            <pre className="mt-2 p-2 bg-gray-800 rounded text-left overflow-auto">
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
          <button
            onClick={() => this.setState({ error: null })}
            className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition"
          >
            Tentar novamente
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── Crossfade entre módulos do ERP ─────────────────────────────────────────
// Anima troca de módulo no painel principal: opacity 0→1 (200ms, easeOutQuad).
// Só opacidade — evita CLS, reflow e layout shift em tabelas densas.
// Respeita prefers-reduced-motion (a11y). Re-monta via prop `key`, então o
// módulo antigo simplesmente desmonta (exit implícito, sem bloquear input).
function ModuleSwitcher({ moduleKey, children }) {
  const ref = useRef(null);
  useLayoutEffect(() => {
    if (!ref.current) return;
    if (typeof window !== "undefined" &&
        window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      ref.current.style.opacity = "1";
      return;
    }
    animate(ref.current, {
      opacity: [0, 1],
      duration: 200,
      ease: "outQuad",
    });
  }, [moduleKey]);
  return <div ref={ref} key={moduleKey} className="h-full">{children}</div>;
}
import AnimatedSnowflake from "./AnimatedSnowflake.jsx";
import { FrostIcon } from "./FrostIcons.jsx";
import AnimatedLogo from "./AnimatedLogo.jsx";
// Catálogo padrão de serviços (Refrigeração/Climatização) — semeado uma vez
// por dispositivo via seedServiceCatalog() para popular erp:service: ao iniciar.
import SERVICE_CATALOG_SEED from "./services-seed.json";
// Catálogo padrão de produtos (peças/insumos) — semeado via seedProductCatalog().
// Cada item entra no estoque com saldo inicial de 10 unidades.
import PRODUCT_CATALOG_SEED from "./products-seed.json";
// Catálogo de equipamentos (marca/modelo/capacidade) usado no picker da OS:
// quando o usuário escolhe o tipo, o select de modelo é populado e a
// capacidade preenchida automaticamente ao selecionar um item.
import EQUIPMENT_CATALOG_RAW from "./equipment-catalog.json";

// Detecta se a URL aponta para um arquivo de vídeo (preview do tecnico)
const VIDEO_EXT_RE = /\.(mp4|mov|webm|m4v|avi|mkv|ogv|3gp)(\?|$)/i;
const isVideoUrl = (url) => typeof url === "string" && VIDEO_EXT_RE.test(url);

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
  // ─── Status do fluxo da OS (alinhados ao STATUS_FLOW de ProcessModule) ──
  aguardando: { label: "Aguardando", color: "bg-yellow-500" },
  em_deslocamento: { label: "Em Deslocamento", color: "bg-cyan-500" },
  em_execucao: { label: "Em Execução", color: "bg-blue-500" },
  finalizado: { label: "Finalizado", color: "bg-green-500" },
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
  gerente: ["dashboard", "clientes", "funcionarios", "financeiro", "os", "agenda", "config", "ia", "folha"],
  tecnico: ["dashboard", "os", "agenda"],
  atendente: ["dashboard", "clientes", "os", "agenda", "ia"],
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

// ─── CARGOS de funcionários ──────────────────────────────────────────────────
// Lista canônica usada no cadastro e nos relatórios. Ao adicionar cargo novo,
// considere também atualizar a derivação de `tipo` em saveEmployee (técnico/
// gerente/administrativo controla quais módulos o user vê).
const CARGOS_FUNCIONARIO = [
  "Técnico em Refrigeração",
  "Técnico de Central",
  "Ajudante",
  "Motorista",
  "Administrativo",
  "Gerente",
];
// Cargos que são considerados "técnicos" para gating de UI/relatórios
const CARGOS_TECNICOS = ["Técnico em Refrigeração", "Técnico de Central", "Técnico", "Ajudante"];
const CARGOS_GERENCIA = ["Gerente"];

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

// ─── Índice do catálogo de equipamentos por tipo interno ────────────────────
// Para cada tipo interno (central, geladeira, ...) montamos a lista de modelos
// disponíveis. O JSON usa o label do tipo (ex: "Central de Ar (Split/Janela)"),
// então construímos um label→key reverso de EQUIPMENT_TYPES.
const _LABEL_TO_TYPE_KEY = (() => {
  const m = {};
  for (const [key, meta] of Object.entries(EQUIPMENT_TYPES)) {
    m[(meta.label || "").trim()] = key;
  }
  return m;
})();

// Mapa: tipoKey → [{ marca, modelo, capacidade, unidade, voltagem, descricao, label }]
// `label` é o texto exibido no select (ex: "Elgin HVFI09B2IA — 9.000 BTUs · 220V").
const EQUIPMENT_CATALOG_BY_KEY = (() => {
  const out = {};
  for (const item of (EQUIPMENT_CATALOG_RAW || [])) {
    if (item.ativo === false) continue;
    const tipoKey = _LABEL_TO_TYPE_KEY[(item.tipo_equipamento || "").trim()] || "outro";
    const cap = String(item.capacidade || "").trim();
    const uni = String(item.unidade_capacidade || "").trim();
    const volt = String(item.voltagem || "").trim();
    const marca = String(item.marca || "").trim();
    const modelo = String(item.modelo || "").trim();
    const label =
      `${marca}${marca && modelo ? " " : ""}${modelo}` +
      (cap ? ` — ${cap}${uni ? " " + uni : ""}` : "") +
      (volt ? ` · ${volt}` : "");
    if (!out[tipoKey]) out[tipoKey] = [];
    out[tipoKey].push({ marca, modelo, capacidade: cap, unidade: uni, voltagem: volt, label });
  }
  // Ordena por marca, depois capacidade numérica
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => {
      if (a.marca !== b.marca) return a.marca.localeCompare(b.marca);
      const na = parseFloat(String(a.capacidade).replace(/\./g, "").replace(",", "."));
      const nb = parseFloat(String(b.capacidade).replace(/\./g, "").replace(",", "."));
      if (!isNaN(na) && !isNaN(nb)) return na - nb;
      return (a.modelo || "").localeCompare(b.modelo || "");
    });
  }
  return out;
})();

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

// Tenta localStorage; se indisponível (modo privado em alguns browsers, iframe sandboxed,
// SSR, cota cheia), cai num Map em memória. Quando isso ocorre, marca-se a sessão como
// efêmera para que o usuário seja avisado — caso contrário, perderia tudo no reload.
let __storageIsEphemeral = false;
try {
  // Sanity check: alguns browsers expõem localStorage mas tiram o write em modo privado
  const probe = "__frost_storage_probe__";
  localStorage.setItem(probe, "1");
  localStorage.removeItem(probe);
  window.storage = localStorage;
} catch {
  // localStorage indisponível ou negando writes
}
if (!window.storage) {
  __storageIsEphemeral = true;
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

// ─── Banner de aviso quando storage é efêmero ───────────────────────────────
// Injeta um banner fixo no topo via DOM puro (independente do return tree do App,
// que tem múltiplos caminhos: splash, login, app técnico, app principal). Responsivo.
if (__storageIsEphemeral && typeof document !== "undefined") {
  const mount = () => {
    if (document.getElementById("frost-storage-warning")) return;
    const el = document.createElement("div");
    el.id = "frost-storage-warning";
    el.setAttribute("role", "alert");
    el.style.cssText = [
      "position:fixed", "top:0", "left:0", "right:0", "z-index:9999",
      "background:#b91c1c", "color:#fff",
      "font:600 13px/1.4 'DM Sans',system-ui,sans-serif",
      "padding:8px 12px", "text-align:center",
      "box-shadow:0 2px 8px rgba(0,0,0,0.4)",
    ].join(";");
    el.innerHTML = '<span style="display:inline-block;max-width:100%">⚠️ Armazenamento local indisponível (modo privado/anônimo). <strong>Os dados serão perdidos ao recarregar.</strong> Saia do modo privado para persistir.</span> <button id="frost-storage-warning-close" aria-label="Fechar aviso" style="margin-left:12px;background:transparent;border:1px solid rgba(255,255,255,0.6);color:#fff;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit">×</button>';
    document.body.appendChild(el);
    document.body.style.paddingTop = (el.offsetHeight || 36) + "px";
    el.querySelector("#frost-storage-warning-close")?.addEventListener("click", () => {
      el.remove();
      document.body.style.paddingTop = "";
    });
  };
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount, { once: true });
}

// ─── Multi-tenant: company ativa e prefixos com escopo ──────────────────────
// Quando há uma company ativa (usuário logado em uma empresa), DB.list filtra
// e DB.set decora registros com `companyId` automaticamente. Master user opera
// com __activeCompanyId=null e enxerga todos os registros (DB.listAll bypassa).
let __activeCompanyId = null;

// Prefixos cujos registros pertencem a uma company específica
const SCOPED_PREFIXES = [
  "erp:client:",
  "erp:employee:",
  "erp:os:",
  "erp:schedule:",
  "erp:finance:",
  "erp:user:",
  "erp:webdesk:",
  "erp:invoice:",
  "erp:pdv:",
  "erp:banking:",
  "erp:transferencia:",
  "erp:notificacao:",
  "erp:transaction:",
  "erp:inventory:",
  "erp:product:",
  "erp:supplier:",
  "erp:stock:",
  "erp:stockMov:",
  "erp:service:",
  "erp:audit:",
  "erp:autoBackup:",
];

// Usuário ativo — para que DB consiga registrar autoria nos logs de auditoria.
let __activeUser = null;
function setActiveUser(u) { __activeUser = u || null; }
function getActiveUser() { return __activeUser; }

function isScopedKey(key) {
  if (!key) return false;
  return SCOPED_PREFIXES.some((p) => key.startsWith(p));
}

function setActiveCompanyId(id) {
  __activeCompanyId = id || null;
}
function getActiveCompanyId() {
  return __activeCompanyId;
}

// Singletons que precisam ser escopados por empresa (singleton = chave única, não lista).
// Antes "erp:config" era global e dados da Empresa A vazavam para Empresa B.
// Agora: redirecionamos para "erp:config:<companyId>" quando há tenant ativo.
const SCOPED_SINGLETONS = ["erp:config", "erp:calendarFeedToken", "erp:lastBackup", "erp:autoBackupMeta"];
function rewriteSingletonKey(key) {
  if (!__activeCompanyId) return key;
  return SCOPED_SINGLETONS.includes(key) ? key + ":" + __activeCompanyId : key;
}

// Migração one-shot dos singletons globais legados para a primeira empresa que logar.
// Não afeta empresas criadas depois — elas iniciam com singletons em branco.
// Marker garante idempotência mesmo após reload.
function migrateLegacyConfigOnce(companyId) {
  if (!companyId) return;
  try {
    const claimMarker = window.storage.getItem("erp:legacySingletonsClaimedBy");
    if (claimMarker) return;
    let migrated = false;
    SCOPED_SINGLETONS.forEach((legacy) => {
      const legacyRaw = window.storage.getItem(legacy);
      const scopedKey = legacy + ":" + companyId;
      const scopedRaw = window.storage.getItem(scopedKey);
      if (legacyRaw && !scopedRaw) {
        window.storage.setItem(scopedKey, legacyRaw);
        migrated = true;
        try { syncToSupabase(scopedKey, JSON.parse(legacyRaw)); } catch { /* ignora */ }
      }
    });
    if (migrated) {
      window.storage.setItem("erp:legacySingletonsClaimedBy", companyId);
    } else {
      // Mesmo sem dados a migrar, fecha a janela pra novas empresas não tentarem
      window.storage.setItem("erp:legacySingletonsClaimedBy", companyId);
    }
  } catch { /* migração é best-effort */ }
}

// Backup automático semanal — gera snapshot por empresa se passou 7+ dias do último.
// Mantém apenas as últimas 4 (1 mês). Excluí senhas/tokens dos usuários.
// Disparado no login (não bloqueia o fluxo) e no restore de sessão.
function ensureAutoBackup(companyId) {
  try {
    if (!companyId) return null;
    const meta = DB.get("erp:autoBackupMeta") || {};
    const last = meta.lastTs ? new Date(meta.lastTs).getTime() : 0;
    const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    if (Date.now() - last < WEEK_MS) return null;

    // Coleta dados via DB.list (já filtrado pelo scope da company ativa,
    // mas garantimos passando companyId explícito quando possível).
    const collect = (prefix) => DB.listAll(prefix).filter((r) => r && r.companyId === companyId);
    const users = collect("erp:user:").map((u) => ({
      ...u,
      // Remove credenciais — backup deve ser portável sem virar vetor de ataque
      password: undefined,
      sessionTokenHash: undefined,
    }));
    const snapshot = {
      version: 1,
      ts: new Date().toISOString(),
      companyId,
      clients: collect("erp:client:"),
      employees: collect("erp:employee:"),
      services: collect("erp:os:"),
      schedule: collect("erp:schedule:"),
      finance: collect("erp:finance:"),
      users,
      config: window.storage.getItem("erp:config:" + companyId) ? JSON.parse(window.storage.getItem("erp:config:" + companyId)) : null,
    };
    const id = "ab_" + Date.now();
    const key = "erp:autoBackup:" + id;
    snapshot.id = id;
    window.storage.setItem(key, JSON.stringify(snapshot));
    try { syncToSupabase(key, snapshot); } catch { /* ignora */ }

    // Mantém apenas as 4 últimas por empresa (descarta as mais antigas)
    const all = DB.listAll("erp:autoBackup:")
      .filter((b) => b && b.companyId === companyId)
      .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    all.slice(4).forEach((b) => {
      if (b.id) {
        try {
          window.storage.removeItem("erp:autoBackup:" + b.id);
          deleteFromSupabase("erp:autoBackup:" + b.id);
        } catch { /* ignora */ }
      }
    });

    DB.set("erp:autoBackupMeta", { lastTs: snapshot.ts, lastId: id });
    return snapshot;
  } catch { return null; }
}

// Auditoria por empresa — registra mutações de entidades críticas (OS, clientes,
// funcionários, finanças, usuários). Logs são scoped por companyId, somente admin
// vê. Skipa silenciosamente keys não auditadas e a própria entrada de auditoria.
const AUDITED_PREFIXES = [
  "erp:os:", "erp:client:", "erp:employee:", "erp:finance:", "erp:user:",
];
function shouldAudit(key) {
  if (!key) return false;
  if (key.startsWith("erp:audit:") || key.startsWith("master:") || key.startsWith("erp:autoBackup")) return false;
  return AUDITED_PREFIXES.some((p) => key.startsWith(p));
}
function summarizeRecord(prefix, value) {
  if (!value || typeof value !== "object") return "";
  if (prefix === "erp:os:") return `OS ${value.numero || value.id} — ${value.clienteNome || ""}`.trim();
  if (prefix === "erp:client:") return value.nome || value.razaoSocial || value.id || "";
  if (prefix === "erp:employee:") return value.nome || value.id || "";
  if (prefix === "erp:user:") return `${value.nome || ""} <${value.email || ""}>`;
  if (prefix === "erp:finance:") return `${value.tipo || ""} R$${value.valor || 0} — ${value.descricao || ""}`.trim();
  return value.id || "";
}
function recordAudit(action, key, value, prevValue) {
  try {
    if (!shouldAudit(key)) return;
    if (!__activeCompanyId) return; // master ou pré-login não loga
    const prefix = AUDITED_PREFIXES.find((p) => key.startsWith(p));
    const id = "aud_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    const entry = {
      id,
      ts: new Date().toISOString(),
      action,
      entity: prefix ? prefix.replace(/^erp:|:$/g, "") : "?",
      entityId: (value && value.id) || (prevValue && prevValue.id) || null,
      summary: summarizeRecord(prefix, value || prevValue),
      userId: __activeUser?.id || null,
      userNome: __activeUser?.nome || "Sistema",
      companyId: __activeCompanyId,
    };
    const auditKey = "erp:audit:" + id;
    window.storage.setItem(auditKey, JSON.stringify(entry));
    try { syncToSupabase(auditKey, entry); } catch { /* ignora */ }
  } catch { /* não-crítico */ }
}

const DB = {
  get(key) {
    try {
      const realKey = rewriteSingletonKey(key);
      const raw = window.storage.getItem(realKey);
      if (raw === null || raw === undefined) return null;
      return JSON.parse(raw);
    } catch {
      return null;
    }
  },

  set(key, value) {
    try {
      const realKey = rewriteSingletonKey(key);
      // Detecta create vs update lendo registro anterior (audit precisa disso)
      const auditable = shouldAudit(key);
      let prev = null;
      if (auditable) {
        try {
          const raw = window.storage.getItem(realKey);
          if (raw) prev = JSON.parse(raw);
        } catch { /* ignora */ }
      }
      // Decora registros com companyId quando há company ativa e o prefixo é com escopo
      let toStore = value;
      if (
        __activeCompanyId &&
        isScopedKey(key) &&
        toStore &&
        typeof toStore === "object" &&
        !Array.isArray(toStore) &&
        !toStore.companyId
      ) {
        toStore = { ...toStore, companyId: __activeCompanyId };
      }
      window.storage.setItem(realKey, JSON.stringify(toStore));
      syncToSupabase(realKey, toStore);
      if (auditable) {
        recordAudit(prev ? "update" : "create", key, toStore, prev);
      }
      return true;
    } catch {
      return false;
    }
  },

  delete(key) {
    try {
      const realKey = rewriteSingletonKey(key);
      let prev = null;
      if (shouldAudit(key)) {
        try {
          const raw = window.storage.getItem(realKey);
          if (raw) prev = JSON.parse(raw);
        } catch { /* ignora */ }
      }
      window.storage.removeItem(realKey);
      deleteFromSupabase(realKey);
      if (prev) recordAudit("delete", key, null, prev);
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
      // Filtra por company quando há contexto de tenant ativo e o prefixo é com escopo.
      // Registros sem companyId são tratados como "legados" e ficam visíveis (migração tagga depois).
      if (__activeCompanyId && isScopedKey(prefix)) {
        return results.filter((r) => !r || !r.companyId || r.companyId === __activeCompanyId);
      }
      return results;
    } catch {
      return [];
    }
  },

  // Lista crua — usado pelo MasterApp para enxergar registros de todas as empresas
  listAll(prefix) {
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

// ─── Multi-tenant: migração + helpers de company ─────────────────────────────
// Garante que existe uma "empresa padrão" e tagga todos os registros antigos
// com `companyId`. Idempotente — pode ser chamado em todo boot.
const DEFAULT_COMPANY_ID = "cmp_default";

function ensureCompanyMigration() {
  try {
    // Se já existe alguma company, não cria padrão
    const companies = DB.listAll("erp:company:");
    let defaultCompanyId = null;
    if (companies.length === 0) {
      // Cria company padrão a partir do erp:config (se existir)
      const cfg = DB.get("erp:config") || {};
      const company = {
        id: DEFAULT_COMPANY_ID,
        nome: cfg.nomeEmpresa || cfg.razaoSocial || "Empresa Padrão",
        cnpj: cfg.cnpj || "",
        telefone: cfg.telefone || "",
        email: cfg.email || "",
        endereco: cfg.endereco || "",
        ativo: true,
        criadoEm: new Date().toISOString(),
      };
      // grava direto sem decoração (registros de company não têm companyId)
      window.storage.setItem("erp:company:" + company.id, JSON.stringify(company));
      try { syncToSupabase("erp:company:" + company.id, company); } catch { /* ignora */ }
      defaultCompanyId = DEFAULT_COMPANY_ID;
    } else {
      defaultCompanyId = companies[0].id;
    }

    // Tagga registros legados sem companyId
    const len = window.storage.length;
    const keysToFix = [];
    for (let i = 0; i < len; i++) {
      const key = window.storage.key(i);
      if (key && isScopedKey(key)) keysToFix.push(key);
    }
    keysToFix.forEach((k) => {
      const val = DB.get(k);
      if (val && typeof val === "object" && !val.companyId) {
        const tagged = { ...val, companyId: defaultCompanyId };
        try {
          window.storage.setItem(k, JSON.stringify(tagged));
          syncToSupabase(k, tagged);
        } catch { /* ignora */ }
      }
    });
    return defaultCompanyId;
  } catch {
    return null;
  }
}

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
// ─── TOTP / 2FA — RFC 6238 puro com Web Crypto (sem libs externas) ─────────
// Base32 (RFC 4648) — apps de autenticação esperam o secret nesse formato.
const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(bytes) {
  let bits = 0, value = 0, output = "";
  for (let i = 0; i < bytes.length; i++) {
    value = (value << 8) | bytes[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return output;
}
function base32Decode(str) {
  const clean = str.replace(/=+$/, "").toUpperCase().replace(/\s+/g, "");
  const out = [];
  let bits = 0, value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(clean[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
// Gera secret novo de 20 bytes (160 bits) — padrão RFC 4226
function generateTotpSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base32Encode(bytes);
}
// Gera código TOTP de 6 dígitos para um momento (default agora). RFC 6238: T0=0, step=30s, SHA-1.
async function totpCode(secret, time = Date.now()) {
  if (!crypto?.subtle) return null;
  const counter = Math.floor(time / 1000 / 30);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(0, 0);
  view.setUint32(4, counter);
  const keyBytes = base32Decode(secret);
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const bin =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(bin % 1000000).padStart(6, "0");
}
// Verifica código aceitando ±1 janela (30s) pra tolerar drift de relógio
async function verifyTotp(secret, code) {
  if (!secret || !code || String(code).length !== 6) return false;
  const now = Date.now();
  const target = String(code).padStart(6, "0");
  const candidates = await Promise.all([
    totpCode(secret, now - 30000),
    totpCode(secret, now),
    totpCode(secret, now + 30000),
  ]);
  return candidates.includes(target);
}
// Constrói URI otpauth:// padrão (Google Authenticator, Authy, 1Password leem direto)
function buildOtpAuthUri({ issuer, accountName, secret }) {
  const enc = encodeURIComponent;
  return `otpauth://totp/${enc(issuer)}:${enc(accountName)}?secret=${secret}&issuer=${enc(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

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
  // Formato legado (DJB2 customizado) — DEPRECADO. Aceito apenas para permitir
  // login + re-hash imediato em PBKDF2. Os call sites já gravam o novo hash no DB
  // quando needsRehash=true. Quando todos os usuários migrarem, esta branch deve
  // ser removida (junto com hashPasswordLegacy).
  if (stored === hashPasswordLegacy(plain)) {
    console.warn("[auth] Senha em formato DJB2 legado detectada — re-hash automático para PBKDF2 será aplicado.");
    return { match: true, needsRehash: true };
  }
  // Formato antigo (base64 — inseguro, apenas para migração)
  try {
    if (stored === btoa(plain)) {
      console.warn("[auth] Senha em formato base64 legado detectada — re-hash automático para PBKDF2 será aplicado.");
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

// ─── Sincroniza OS finalizada com o Financeiro ──────────────────────────────
// Toda OS que entra em status "finalizado" (revisada e aprovada) precisa
// virar uma transação de receita pendente em erp:finance: para que apareça
// no módulo Financeiro automaticamente.
//
// Idempotente: se já existe uma transação com o mesmo osId, atualizamos
// valor/categoria/data (sem mexer no status — admin pode já ter marcado
// como "pago"). Se a transação não existe, criamos uma nova com prefixo
// "REC" e status "pendente".
//
// Chamado em: changeStatus('finalizado'), aprovação do admin no review,
// e na edição de OS já finalizada (para refletir mudança de valor).
function syncOSToFinance(os) {
  if (!os || !os.id) return;
  const valor = Number(os.valor) || 0;
  if (valor <= 0) return; // sem valor, nada a registrar no Financeiro

  const all = DB.list("erp:finance:");
  const existing = all.find((t) => t.osId === os.id);

  // Categoria: tipo da OS se bater com a lista de receita; senão "Outros"
  const categoria = CATEGORIES_RECEITA.includes(os.tipo) ? os.tipo : "Outros";
  const dataIso = os.dataConclusao || new Date().toISOString();
  const descricao = `OS ${os.numero || os.id} — ${os.clienteNome || "Cliente"}${os.tipo ? " — " + os.tipo : ""}`;

  if (existing) {
    // Mantém status — admin pode ter marcado como "pago" manualmente.
    // Atualiza apenas dados informativos para refletir a OS atual.
    const updated = {
      ...existing,
      descricao,
      valor,
      categoria,
      data: existing.status === "pago" ? existing.data : dataIso,
      updatedAt: new Date().toISOString(),
    };
    DB.set("erp:finance:" + updated.id, updated);
    return;
  }

  const numero = getNextNumber("REC", all);
  const newTx = {
    id: genId(),
    numero,
    descricao,
    valor,
    tipo: "receita",
    categoria,
    data: dataIso,
    status: "pendente",
    formaPagamento: "PIX",
    observacoes: "Gerada automaticamente ao finalizar OS",
    osId: os.id,
    createdAt: new Date().toISOString(),
  };
  DB.set("erp:finance:" + newTx.id, newTx);
}

// Lista de módulos disponíveis para autorização manual no gerenciamento de usuários
// Mantida em sincronia com navItems do App (remoções de sessões devem ocorrer aqui também)
const ALL_MODULES = [
  { id: "dashboard", label: "Dashboard" },
  { id: "processos", label: "Ordens de Serviço" },
  { id: "agenda", label: "Agenda" },
  { id: "cadastro", label: "Cadastros" },
  { id: "ia", label: "IA / Atendimento" },
  { id: "folha", label: "Folha de Pagamento" },
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

// ─── Seed do catálogo de serviços ───────────────────────────────────────────
// Importa o JSON padrão (~155 itens de Refrigeração/Climatização) para a tabela
// erp:service: na primeira execução. Idempotente: pula códigos que já existem,
// então pode rodar a cada boot sem duplicar.
//
// Os registros entram sem companyId — o filtro de tenant trata records sem
// companyId como "globais", visíveis a todas as empresas, o que é desejável
// para um catálogo padrão. Empresas que quiserem podem editar/desativar.
function seedServiceCatalog() {
  if (!Array.isArray(SERVICE_CATALOG_SEED) || SERVICE_CATALOG_SEED.length === 0) return;

  const existing = DB.listAll("erp:service:");
  const existingCodes = new Set(
    existing.map((s) => (s.codigo || "").toUpperCase()).filter(Boolean)
  );

  let added = 0;
  for (const item of SERVICE_CATALOG_SEED) {
    const codigo = String(item.codigo || "").trim();
    if (!codigo || existingCodes.has(codigo.toUpperCase())) continue;

    const equipamento = String(item.equipamento || "").trim();
    const newRow = {
      id: genId(),
      codigo,
      nome: String(item.nome_servico || "").trim(),
      categoria: String(item.categoria || "").trim(),
      unidade: String(item.unidade || "Serviço").trim(),
      precoBase: Number(item.preco_base) || 0,
      duracaoMin: Number(item.duracao_min) || 0,
      descricao: equipamento ? `Equipamento: ${equipamento}` : "",
      status: item.ativo === false ? "inativo" : "ativo",
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:service:" + newRow.id, newRow);
    existingCodes.add(codigo.toUpperCase());
    added++;
  }

  if (added > 0) {
    console.info(`[seedServiceCatalog] ${added} serviço(s) padrão importado(s).`);
  }
}

// ─── Seed do catálogo de produtos (peças/insumos) ────────────────────────────
// Importa o JSON padrão (~126 itens: gases, capacitores, compressores,
// filtros, peças e insumos) na primeira execução. Cada produto recebe
// um registro de estoque com saldo inicial de 10 unidades.
//
// Idempotente: pula SKUs já cadastrados, então pode rodar a cada boot.
// Registros entram sem companyId (catálogo global).
function seedProductCatalog() {
  if (!Array.isArray(PRODUCT_CATALOG_SEED) || PRODUCT_CATALOG_SEED.length === 0) return;

  const existingProducts = DB.listAll("erp:product:");
  const existingSkus = new Set(
    existingProducts.map((p) => (p.codigo || "").toUpperCase()).filter(Boolean)
  );

  const SALDO_INICIAL = 10; // quantidade pedida pelo usuário para cada item
  let added = 0;

  for (const item of PRODUCT_CATALOG_SEED) {
    const sku = String(item.sku || "").trim();
    if (!sku || existingSkus.has(sku.toUpperCase())) continue;

    const aplicacao = String(item.aplicacao || "").trim();
    const baseDesc = String(item.descricao || "").trim();
    const descricao = aplicacao
      ? (baseDesc ? `${baseDesc} (Aplicação: ${aplicacao})` : `Aplicação: ${aplicacao}`)
      : baseDesc;

    const product = {
      id: genId(),
      codigo: sku,
      codigoBarras: String(item.codigo_barras || "").trim(),
      nome: String(item.nome_produto || "").trim(),
      categoria: String(item.categoria || "").trim(),
      unidade: String(item.unidade || "UN").trim(),
      precoCusto: Number(item.preco_custo) || 0,
      precoVenda: Number(item.preco_venda) || 0,
      fornecedorId: "",
      fornecedorNome: String(item.fornecedor || "").trim(),
      ncm: String(item.ncm || "").trim(),
      descricao,
      status: item.ativo === false ? "inativo" : "ativo",
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:product:" + product.id, product);

    // Cria registro de estoque com saldo inicial = 10 (e mantém estoque mínimo do JSON)
    const stock = {
      id: genId(),
      produtoId: product.id,
      saldo: SALDO_INICIAL,
      estoqueMinimo: Number(item.estoque_minimo) || 0,
      estoqueMaximo: 0,
      localizacao: "",
      observacoes: "Estoque inicial gerado automaticamente",
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:stock:" + stock.id, stock);

    existingSkus.add(sku.toUpperCase());
    added++;
  }

  if (added > 0) {
    console.info(`[seedProductCatalog] ${added} produto(s) padrão importado(s) com saldo inicial 10.`);
  }
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
  // IMPORTANTE: deps apenas [isOpen]. onClose troca de identidade a cada render do pai
  // e dispararia cleanup → history.back() → modal fecharia sozinho ao interagir.
  const onCloseRef = useRef(onClose);
  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);
  useEffect(() => {
    if (!isOpen) return;
    let poppedByBack = false;
    window.history.pushState({ modal: true }, "");
    const onPop = () => {
      poppedByBack = true;
      onCloseRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!poppedByBack && window.history.state?.modal) {
        window.history.back();
      }
    };
  }, [isOpen]);

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
      <input name="local"
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

/*
 * Combobox — select pesquisável (substituto do <select> nativo).
 *
 * Por que: o usuário precisa achar um cliente entre centenas, um modelo
 * entre 187 ou um serviço entre 155 — selects nativos não filtram.
 *
 * Uso:
 *   <Combobox
 *     value={form.clienteId}
 *     onChange={(v) => setForm({ ...form, clienteId: v })}
 *     options={[{ value: "abc", label: "Maria Silva", searchText: "12345..." }]}
 *     placeholder="Selecione..."
 *     emptyLabel="— Nenhum —"
 *   />
 *
 * `searchText` é opcional — quando presente, é incluído no match (útil
 * para procurar cliente por CPF/telefone, p.ex.).
 */
function Combobox({
  value,
  onChange,
  options,
  placeholder = "Selecione...",
  emptyLabel = "— Nenhum —",
  showEmpty = true,
  disabled = false,
  className = "",
  size = "md",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const containerRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const selectedLabel = useMemo(() => {
    const m = (options || []).find((o) => o.value === value);
    return m?.label || "";
  }, [options, value]);

  const filtered = useMemo(() => {
    const list = options || [];
    if (!query.trim()) return list;
    const q = query
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, ""); // remove acentos para busca tolerante
    const norm = (s) => String(s || "")
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "");
    return list.filter((o) =>
      norm(o.label).includes(q) || norm(o.searchText).includes(q)
    );
  }, [options, query]);

  // Fecha ao clicar fora
  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => { setHighlighted(0); }, [query, open]);

  const select = useCallback((v) => {
    onChange(v);
    setOpen(false);
    setQuery("");
    if (inputRef.current) inputRef.current.blur();
  }, [onChange]);

  const onKeyDown = useCallback((e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      setHighlighted((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlighted((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = filtered[highlighted];
      if (item) select(item.value);
    } else if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
    }
  }, [open, filtered, highlighted, select]);

  const padY = size === "sm" ? "py-2" : "py-2.5";

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <input
        ref={inputRef}
        type="text"
        value={open ? query : selectedLabel}
        onChange={(e) => { setOpen(true); setQuery(e.target.value); }}
        onFocus={() => { if (!disabled) { setOpen(true); setQuery(""); } }}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        disabled={disabled}
        className={`w-full bg-gray-700 border border-gray-600 rounded-lg px-3 ${padY} text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition disabled:opacity-50 disabled:cursor-not-allowed pr-9`}
      />
      <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none">
        {value && !open ? (
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); onChange(""); }}
            className="text-gray-400 hover:text-white pointer-events-auto"
            aria-label="Limpar seleção"
            title="Limpar"
          >
            ×
          </button>
        ) : null}
        <svg className="w-4 h-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {open && (
        <div
          ref={listRef}
          className="absolute z-50 left-0 right-0 mt-1 max-h-64 overflow-y-auto bg-gray-800 border border-gray-600 rounded-lg shadow-xl"
        >
          {showEmpty && (
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); select(""); }}
              className="w-full text-left px-3 py-2 text-sm text-gray-400 italic hover:bg-gray-700 transition"
            >
              {emptyLabel}
            </button>
          )}
          {filtered.length === 0 ? (
            <div className="px-3 py-3 text-sm text-gray-500 text-center">Nenhum resultado para "{query}"</div>
          ) : (
            filtered.map((o, i) => (
              <button
                key={o.value}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); select(o.value); }}
                onMouseEnter={() => setHighlighted(i)}
                className={`w-full text-left px-3 py-2 text-sm transition ${
                  i === highlighted ? "bg-blue-600/30 text-white" : "text-gray-200 hover:bg-gray-700"
                } ${o.value === value ? "font-semibold" : ""}`}
              >
                {o.label}
              </button>
            ))
          )}
        </div>
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
            <input name="typed"
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

function LoginScreen({ onLogin, theme, setTheme, onSwitchToMaster, onForgotPassword }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  // Estado intermediário do 2FA — quando senha OK mas usuário tem TOTP ativado
  const [pending2FA, setPending2FA] = useState(null);
  const [totpCodeInput, setTotpCodeInput] = useState("");
  // ─── Biometria (APK) ──────────────────────────────────────────────────────
  // bioAvail: hardware tem biometria configurada (digital/face/iris)
  // bioEnabled: usuario ja optou por habilitar login biometrico nesse device
  // bioEnroll: apos login com senha, oferece habilitar biometria pra proximas vezes
  const [bioAvail, setBioAvail] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [bioEnroll, setBioEnroll] = useState(null); // { email, password, user }
  const [bioBusy, setBioBusy] = useState(false);
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

  const handleSubmit = useCallback(async (e, overrideEmail, overridePassword) => {
    if (e && typeof e.preventDefault === 'function') e.preventDefault();
    setError("");

    // Rate limiting — bloqueia tentativas durante lockout (consulta sessionStorage também)
    const persisted = readLoginAttempts();
    const effectiveLockout = Math.max(lockoutUntil || 0, persisted.lockoutUntil || 0);
    if (effectiveLockout && Date.now() < effectiveLockout) {
      setError(`Aguarde ${Math.ceil((effectiveLockout - Date.now()) / 1000)}s antes de tentar novamente.`);
      return;
    }

    // Permite chamada programatica (biometria) com creds salvas, sem depender do state
    const useEmailRaw = overrideEmail ?? email;
    const usePassword = overridePassword ?? password;

    if (!useEmailRaw.trim() || !usePassword.trim()) {
      setError("Preencha todos os campos.");
      return;
    }

    // Validação de formato de email
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedEmail = useEmailRaw.trim().toLowerCase();
    if (!emailRegex.test(normalizedEmail)) {
      setError("Formato de email inválido.");
      return;
    }

    setLoading(true);
    try {
      // ─── PORTÃO Supabase Auth (item 1 da auditoria) ────────────────────
      // Antes de validar local, autentica no Supabase. Isso:
      //  - estabelece JWT server-validated (item 3),
      //  - libera RLS por company para hydrate (item 2),
      //  - migra usuários PBKDF2 legados via Edge Function migrate-login.
      const authResp = await signInWithFallback(normalizedEmail, usePassword);
      // Fallback local: usuarios cadastrados antes da migracao Supabase Auth
      // (ou Supabase indisponivel) — valida via PBKDF2 contra erp:user:* local.
      // Pulamos lockout aqui se o local matchear; Supabase falhou mas creds OK.
      const supabaseFailed = !authResp.ok;
      if (supabaseFailed) {
        const localUsers = DB.listAll("erp:user:");
        let localMatch = null;
        for (const u of localUsers) {
          if ((u.email || "").trim().toLowerCase() === normalizedEmail) {
            const r = await checkPassword(usePassword, u.password);
            if (r.match) { localMatch = u; break; }
          }
        }
        if (!localMatch) {
          // Falha de fato — aplica lockout normal
          const persistedNow = readLoginAttempts();
          const attemptsNow = (persistedNow.count || failedAttempts) + 1;
          let lockNow = 0;
          if (attemptsNow >= 15) lockNow = Date.now() + 300000;
          else if (attemptsNow >= 10) lockNow = Date.now() + 60000;
          else if (attemptsNow >= 5) lockNow = Date.now() + 30000;
          setFailedAttempts(attemptsNow);
          setLockoutUntil(lockNow || null);
          writeLoginAttempts({ count: attemptsNow, lockoutUntil: lockNow });
          setError(authResp.error || "Email ou senha incorretos.");
          setLoading(false);
          return;
        }
        // Local OK — segue fluxo de bloqueios + onLogin abaixo (skip hydrate)
        if (localMatch.companyId) {
          const company = DB.get("erp:company:" + localMatch.companyId);
          if (company && company.ativo === false) {
            setError("Empresa bloqueada. Contate o administrador.");
            setLoading(false);
            return;
          }
        }
        if (localMatch.status && localMatch.status !== "ativo") {
          setError("Usuário desativado. Contate o administrador.");
          setLoading(false);
          return;
        }
        setFailedAttempts(0);
        setLockoutUntil(null);
        clearLoginAttempts();
        if (localMatch.twoFactorEnabled && localMatch.twoFactorSecret) {
          setPending2FA(localMatch);
          setLoading(false);
          return;
        }
        if (isNative() && bioAvail && !bioEnabled && !overrideEmail) {
          setBioEnroll({ email: normalizedEmail, password: usePassword, user: localMatch });
          setLoading(false);
          return;
        }
        onLogin(localMatch);
        setLoading(false);
        return;
      }
      // Após auth, sincroniza dados da empresa (RLS agora deixa)
      await hydrateFromSupabase();

      const users = DB.list("erp:user:");
      let found = null;

      // checkPassword é async (PBKDF2) — verifica cada usuário
      // Comparação case-insensitive para tolerar registros antigos
      for (const u of users) {
        if ((u.email || "").trim().toLowerCase() === normalizedEmail) {
          const result = await checkPassword(usePassword, u.password);
          if (result.match) {
            // Normaliza email persistido caso esteja em maiúsculas
            if (u.email !== normalizedEmail) u.email = normalizedEmail;
            // Migração automática: re-hash com PBKDF2 se senha em formato antigo
            if (result.needsRehash) {
              const newHash = await hashPassword(usePassword);
              u.password = newHash;
            }
            DB.set("erp:user:" + u.id, u);
            found = u;
            break;
          }
        }
      }
      // Se Supabase Auth passou mas o user legado não foi achado (ex: cadastro novo
      // sem PBKDF2 ainda), gera um user a partir do company_member.
      if (!found) {
        const member = getCurrentMember();
        if (member) {
          found = {
            id: member.legacy_user_id || member.user_id,
            nome: member.nome || normalizedEmail,
            email: normalizedEmail,
            avatar: member.avatar || (member.nome || "?").slice(0, 2).toUpperCase(),
            role: member.role || "tecnico",
            status: member.status || "ativo",
            companyId: member.company_id,
            customPermissions: member.custom_permissions || null,
            isSuperAdmin: !!member.is_super_admin,
          };
        }
      }

      if (found) {
        // Bloqueio por empresa — Master pode marcar empresa como inativa,
        // e neste caso nenhum usuário daquela empresa consegue logar.
        if (found.companyId) {
          const company = DB.get("erp:company:" + found.companyId);
          if (company && company.ativo === false) {
            setError("Empresa bloqueada. Contate o administrador.");
            setLoading(false);
            return;
          }
        }
        // Bloqueio individual do usuário (status já controlado via gestão de usuários)
        if (found.status && found.status !== "ativo") {
          setError("Usuário desativado. Contate o administrador.");
          setLoading(false);
          return;
        }
        setFailedAttempts(0);
        setLockoutUntil(null);
        clearLoginAttempts();
        // Se o usuário tem 2FA ativado, segura o login até validar o código TOTP
        if (found.twoFactorEnabled && found.twoFactorSecret) {
          setPending2FA(found);
          setLoading(false);
          return;
        }
        // APK: se biometria disponivel mas ainda nao habilitada, oferece habilitar
        // antes de fechar a tela. Pulamos se ja veio de login biometrico (override).
        if (isNative() && bioAvail && !bioEnabled && !overrideEmail) {
          setBioEnroll({ email: normalizedEmail, password: usePassword, user: found });
          setLoading(false);
          return;
        }
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
  }, [email, password, onLogin, failedAttempts, lockoutUntil, bioAvail, bioEnabled]);

  // ─── Biometria: probe + auto-prompt ──────────────────────────────────────
  // Na entrada da tela de login no APK: checa disponibilidade. Se ja habilitado
  // pra esse device, dispara o prompt biometrico automaticamente.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isNative()) return;
      const av = await isBiometricAvailable();
      if (cancelled) return;
      const enabled = await isBiometricEnabled();
      if (cancelled) return;
      setBioAvail(!!av.available);
      setBioEnabled(enabled);
      if (av.available && enabled) {
        // Auto prompt — ajuda o usuario a entrar sem digitar
        handleBiometricLogin();
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Login via biometria: autentica → recupera creds salvas → chama handleSubmit
  const handleBiometricLogin = useCallback(async () => {
    if (bioBusy) return;
    setBioBusy(true);
    setError("");
    try {
      const ok = await authenticateBiometric('Entrar no FrostERP');
      if (!ok) return;
      const creds = await getBiometricCreds();
      if (!creds || !creds.email || !creds.password) {
        setError("Credenciais biométricas não encontradas. Faça login com senha uma vez.");
        await disableBiometricLogin();
        setBioEnabled(false);
        return;
      }
      await handleSubmit(null, creds.email, creds.password);
    } finally {
      setBioBusy(false);
    }
  }, [bioBusy, handleSubmit]);

  // Confirma habilitar biometria com creds atuais e fecha login
  const confirmEnableBiometric = useCallback(async () => {
    if (!bioEnroll) return;
    await enableBiometricLogin(bioEnroll.email, bioEnroll.password);
    setBioEnabled(true);
    const u = bioEnroll.user;
    setBioEnroll(null);
    onLogin(u);
  }, [bioEnroll, onLogin]);

  const skipEnableBiometric = useCallback(() => {
    if (!bioEnroll) return;
    const u = bioEnroll.user;
    setBioEnroll(null);
    onLogin(u);
  }, [bioEnroll, onLogin]);

  const handleVerify2FA = useCallback(async (e) => {
    e.preventDefault();
    setError("");
    if (!pending2FA) return;
    const code = totpCodeInput.trim();
    if (code.length !== 6) { setError("Digite o código de 6 dígitos."); return; }
    setLoading(true);
    try {
      const ok = await verifyTotp(pending2FA.twoFactorSecret, code);
      if (ok) {
        setPending2FA(null);
        setTotpCodeInput("");
        onLogin(pending2FA);
      } else {
        setError("Código inválido. Tente novamente.");
      }
    } finally {
      setLoading(false);
    }
  }, [pending2FA, totpCodeInput, onLogin]);

  // Paleta da Aurora muda com o tema — light usa azuis claros para combinar com superfície branca
  const isLight = theme === "light";
  const auroraColors = isLight
    ? ["#bfdbfe", "#93c5fd", "#60a5fa"]
    : ["#4e487f", "#433a5f", "#5227FF"];

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4"
      style={{
        position: 'relative',
        overflow: 'hidden',
        background: isLight ? '#f8fafc' : '#0f172a',
      }}
    >
      {/* Toggle tema — disponível antes do login (acessibilidade para usuários com preferência clara) */}
      {typeof setTheme === "function" && (
        <button
          type="button"
          onClick={() => setTheme(isLight ? "dark" : "light")}
          className="absolute top-4 right-4 z-10 p-2 rounded-lg backdrop-blur-md transition"
          style={{
            background: isLight ? 'rgba(255,255,255,0.7)' : 'rgba(15,23,42,0.6)',
            border: `1px solid ${isLight ? 'rgba(15,23,42,0.12)' : 'rgba(255,255,255,0.12)'}`,
            color: isLight ? '#1e293b' : '#f1f5f9',
          }}
          title={isLight ? "Mudar para Dark Mode" : "Mudar para Light Mode"}
          aria-label="Alternar tema"
        >
          {isLight ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.05 16.95l-1.41 1.41m12.72 0l-1.41-1.41M7.05 7.05L5.64 5.64M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          )}
        </button>
      )}

      {/* Aurora animated background */}
      <div style={{ position: 'absolute', inset: 0, zIndex: 0, opacity: isLight ? 0.55 : 1 }}>
        <Aurora
          colorStops={auroraColors}
          amplitude={1}
          blend={isLight ? 0.6 : 0.43}
        />
      </div>
      <div className="w-full max-w-md animate-slideIn" style={{ position: 'relative', zIndex: 1 }}>
        <div
          className="backdrop-blur-2xl rounded-2xl p-6 sm:p-8"
          style={{
            background: isLight ? 'rgba(255,255,255,0.85)' : 'rgba(31,41,55,0.7)',
            border: `1px solid ${isLight ? 'rgba(15,23,42,0.10)' : 'rgba(255,255,255,0.10)'}`,
            boxShadow: isLight
              ? '0 20px 60px rgba(15,23,42,0.18), 0 0 0 1px rgba(15,23,42,0.04)'
              : '0 20px 60px rgba(0,0,0,0.4)',
          }}
        >
          <div className="text-center mb-8">
            {/* Logo principal da tela de login */}
            {/* Login: floco animado (SVG com animacoes CSS) + titulo + subtitulo */}
            <AnimatedSnowflake className="mx-auto mb-3 w-32 sm:w-40 aspect-square drop-shadow-[0_4px_12px_rgba(96,165,250,0.35)]" />
            <h2 className="text-2xl font-bold text-white tracking-tight">FrostERP</h2>
            <p className="text-gray-400 text-sm mt-1">Sistema de Gestão Integrada</p>
          </div>

          {pending2FA ? (
            // ─── Etapa 2 do login: validação TOTP ───
            <form onSubmit={handleVerify2FA} className="space-y-4">
              <div className="text-center">
                <div className="w-12 h-12 mx-auto rounded-full bg-blue-500/20 text-blue-400 flex items-center justify-center text-xl mb-3">🔐</div>
                <p className="text-sm text-gray-300">Verificação em 2 etapas</p>
                <p className="text-xs text-gray-500 mt-1">Digite o código de 6 dígitos do seu app autenticador</p>
              </div>
              <input
                name="totp"
                type="text"
                inputMode="numeric"
                pattern="[0-9]{6}"
                maxLength={6}
                autoFocus
                value={totpCodeInput}
                onChange={(e) => { setTotpCodeInput(e.target.value.replace(/\D/g, "")); setError(""); }}
                placeholder="000000"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-3 text-white text-center text-2xl tracking-widest font-mono focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
              {error && (
                <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">{error}</div>
              )}
              <button
                type="submit"
                disabled={loading || totpCodeInput.length !== 6}
                className="w-full bg-gradient-to-b from-blue-500 to-blue-600 text-white py-3 rounded-lg font-medium hover:from-blue-400 hover:to-blue-500 transition disabled:opacity-50 min-h-[44px]"
              >
                {loading ? "Verificando..." : "Confirmar código"}
              </button>
              <button
                type="button"
                onClick={() => { setPending2FA(null); setTotpCodeInput(""); setError(""); }}
                className="w-full text-xs text-gray-400 hover:text-white transition"
              >
                Cancelar e voltar ao login
              </button>
            </form>
          ) : (
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
              <PasswordInput
                id="login-password"
                name="password"
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

            {/* Botao biometria — APK only, so se hardware suporta + ja habilitado */}
            {bioAvail && bioEnabled && (
              <button
                type="button"
                onClick={handleBiometricLogin}
                disabled={bioBusy || loading}
                className="w-full mt-2 bg-gray-700/60 border border-gray-600 text-gray-100 py-3 rounded-lg font-medium hover:bg-gray-700 active:scale-[0.98] transition disabled:opacity-50 flex items-center justify-center gap-2 min-h-[44px]"
              >
                <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M17.81 4.47c-.08 0-.16-.02-.23-.06C15.66 3.42 14 3 12.01 3c-1.98 0-3.86.47-5.57 1.41-.24.13-.54.04-.68-.2-.13-.24-.04-.55.2-.68C7.82 2.52 9.86 2 12.01 2c2.13 0 3.99.47 6.03 1.52.25.13.34.43.21.67-.09.18-.26.28-.44.28zM3.5 9.72c-.1 0-.2-.03-.29-.09-.23-.16-.28-.47-.12-.7.99-1.4 2.25-2.5 3.75-3.27C9.98 4.04 14 4.03 17.15 5.65c1.5.77 2.76 1.86 3.75 3.25.16.22.11.54-.12.7-.23.16-.54.11-.7-.12-.9-1.26-2.04-2.25-3.39-2.94-2.87-1.47-6.54-1.47-9.4.01-1.36.7-2.5 1.7-3.4 2.96-.08.14-.23.21-.39.21z"/>
                  <path d="M9.75 21.79c-.13 0-.26-.05-.35-.15-.87-.87-1.34-1.43-2.01-2.64-.69-1.23-1.05-2.73-1.05-4.34 0-2.97 2.54-5.39 5.66-5.39s5.66 2.42 5.66 5.39c0 .28-.22.5-.5.5s-.5-.22-.5-.5c0-2.42-2.09-4.39-4.66-4.39S7.34 12.24 7.34 14.66c0 1.44.32 2.77.93 3.85.64 1.15 1.08 1.64 1.85 2.42.19.2.19.51 0 .71-.11.1-.24.15-.37.15zm9.43-2.44c-1.19 0-2.24-.3-3.1-.89-1.49-1.01-2.38-2.65-2.38-4.4 0-.28.22-.5.5-.5s.5.22.5.5c0 1.42.72 2.75 1.94 3.57.71.48 1.54.71 2.54.71.24 0 .64-.03 1.04-.1.27-.05.53.13.58.41.05.27-.13.53-.41.58-.57.11-1.07.12-1.21.12zM17.17 22c-.04 0-.09-.01-.13-.02-1.59-.44-2.63-1.03-3.72-2.1-1.4-1.39-2.17-3.24-2.17-5.22 0-1.62 1.38-2.94 3.08-2.94s3.08 1.32 3.08 2.94c0 1.07.93 1.94 2.08 1.94s2.08-.87 2.08-1.94c0-3.77-3.25-6.83-7.25-6.83-2.84 0-5.44 1.58-6.61 4.03-.39.81-.59 1.76-.59 2.8 0 .78.07 2.01.67 3.61.1.26-.03.55-.29.64-.26.1-.55-.04-.64-.29-.49-1.31-.73-2.61-.73-3.96 0-1.2.23-2.29.68-3.24 1.33-2.79 4.28-4.6 7.51-4.6 4.55 0 8.25 3.51 8.25 7.83 0 1.62-1.38 2.94-3.08 2.94s-3.08-1.32-3.08-2.94c0-1.07-.93-1.94-2.08-1.94s-2.08.87-2.08 1.94c0 1.71.66 3.31 1.87 4.51.95.94 1.86 1.46 3.27 1.85.27.07.42.35.35.61-.05.23-.26.38-.47.38z"/>
                </svg>
                {bioBusy ? "Aguardando biometria..." : "Entrar com biometria"}
              </button>
            )}
          </form>
          )}

          <div className="mt-6 pt-6 border-t border-gray-700 flex flex-col items-center gap-2">
            <p className="text-gray-500 text-xs text-center">
              FrostERP &copy; {new Date().getFullYear()}
            </p>
            {typeof onSwitchToMaster === "function" && (
              <button
                type="button"
                onClick={onSwitchToMaster}
                className="text-xs text-gray-400 hover:text-blue-400 transition"
              >
                👑 Acesso Master
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Modal: oferece habilitar biometria apos primeiro login no APK */}
      {bioEnroll && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="bg-gray-800 rounded-2xl border border-gray-700 max-w-sm w-full p-6 shadow-2xl">
            <div className="text-center mb-4">
              <div className="text-5xl mb-3">🔒</div>
              <h3 className="text-lg font-bold text-white">Habilitar biometria?</h3>
              <p className="text-gray-400 text-sm mt-2">
                Use sua digital ou Face ID pra entrar mais rápido nas próximas vezes.
              </p>
            </div>
            <div className="flex flex-col gap-2">
              <button
                onClick={confirmEnableBiometric}
                className="w-full bg-gradient-to-b from-blue-500 to-blue-600 text-white py-3 rounded-lg font-medium hover:from-blue-400 hover:to-blue-500 active:scale-[0.98] transition"
              >
                Habilitar agora
              </button>
              <button
                onClick={skipEnableBiometric}
                className="w-full bg-gray-700 text-gray-200 py-2.5 rounded-lg font-medium hover:bg-gray-600 transition"
              >
                Agora não
              </button>
            </div>
          </div>
        </div>
      )}
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
              <PasswordInput name="newPassword"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(""); }}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                autoFocus
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar Senha</label>
              <PasswordInput name="confirmPassword"
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

function FirstUserSetup({ onComplete, onSwitchToLogin }) {
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
            {/* Logo no fluxo de primeiro acesso (super admin) */}
            <img src="/frosterp-snowflake.svg" alt="FrostERP" className="mx-auto mb-3 h-16 w-auto" />
            <h2 className="text-2xl font-bold text-white">Primeiro Acesso</h2>
            <p className="text-gray-400 text-sm mt-2">
              Cadastre o usuário <strong className="text-white">Super Administrador</strong>.<br />
              Este usuário terá acesso total e poderá criar os demais.
            </p>
          </div>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome completo</label>
              <input name="nome"
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
              <input name="email"
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
              <PasswordInput name="password"
                autoComplete="new-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setError(""); }}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar Senha</label>
              <PasswordInput name="confirmPassword"
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

            {/* Botão para usuários que já têm conta cadastrada (ex: novo dispositivo, app reinstalado).
                Tenta hidratar do Supabase + fazer login com credenciais existentes. */}
            {onSwitchToLogin && (
              <div className="pt-2 border-t border-gray-700/50">
                <p className="text-center text-xs text-gray-500 mb-2">
                  Já tem conta cadastrada em outro dispositivo?
                </p>
                <button
                  type="button"
                  onClick={onSwitchToLogin}
                  className="w-full bg-transparent border border-gray-600 text-gray-300 py-2.5 rounded-lg font-medium hover:bg-gray-700/40 hover:border-gray-500 transition"
                >
                  Já tenho conta — fazer login
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── MASTER USER (multi-tenant): primeiro setup, login e dashboard de empresas ──
// Master é o usuário "do dono do app" — cadastra novas empresas (companies) e
// um admin inicial em cada uma. Não pertence a nenhuma company.
//
// SEGURANCA: master:user:* é local-only (excluido de SENSITIVE_PREFIXES no
// supabase.js). Nao sincroniza pro kv_store, nao e sobrescrito por hydrate.
// Isso impede que admins de uma empresa leiam/falsifiquem credenciais master
// via kv_store. Porem nao protege contra XSS/manipulation no proprio device.
//
// TODO(security #2): mover criacao/login/operacoes master pra Edge Function
// com check JWT 'is_super_admin' do company_members. Hoje, qualquer XSS que
// escreva master:user:hack no localStorage + URL ?master=1 ainda permite
// escalation. RLS protege as escritas em kv_store/companies, mas a UI
// confia no flag local — fix definitivo exige server-side gating.

const MASTER_PREFIX = "master:user:";

function FirstMasterSetup({ onComplete, theme, setTheme }) {
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
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
    if (!emailRegex.test(normalizedEmail)) { setError("Email inválido."); return; }
    if (password.length < 8) { setError("Senha mínima 8 caracteres."); return; }
    if (password !== confirm) { setError("Senhas não conferem."); return; }
    setSaving(true);
    try {
      const newMaster = {
        id: genId(),
        email: normalizedEmail,
        nome: nome.trim(),
        password: await hashPassword(password),
        role: "master",
        createdAt: new Date().toISOString(),
        sessionTokenHash: null,
      };
      // Master usa prefixo dedicado e nunca é decorado com companyId
      window.storage.setItem(MASTER_PREFIX + newMaster.id, JSON.stringify(newMaster));
      // Sync via tabela dedicada master_users — permite logar em outros devices
      try { await upsertMasterRemote(newMaster); } catch { /* ignora — local OK */ }
      onComplete(newMaster);
    } finally {
      setSaving(false);
    }
  }, [nome, email, password, confirm, onComplete]);

  const isLight = theme === "light";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: isLight ? "#f8fafc" : "#0f172a" }}>
      <div className="w-full max-w-md animate-slideIn">
        <div
          className="rounded-2xl p-8"
          style={{
            background: isLight ? "rgba(255,255,255,0.95)" : "rgba(31,41,55,0.85)",
            border: `1px solid ${isLight ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.10)"}`,
            boxShadow: isLight ? "0 20px 60px rgba(15,23,42,0.18)" : "0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">👑</div>
            <h2 className="text-2xl font-bold text-white">Cadastro do Master</h2>
            <p className="text-gray-400 text-sm mt-2">
              Este usuário cadastra <strong className="text-white">empresas</strong> que vão usar o app.
            </p>
          </div>
          <div className="space-y-4">
            <input name="nome" type="text" value={nome} onChange={(e) => setNome(e.target.value)} placeholder="Nome completo" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition" />
            <input name="email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition" />
            <PasswordInput name="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha (min. 8)" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition" />
            <PasswordInput name="confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="Confirmar senha" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition" />
            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">{error}</div>}
            <button onClick={handleSave} disabled={saving} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">
              {saving ? "Criando..." : "Criar Master"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MasterLoginScreen({ onLogin, onCancel, theme, setTheme }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = useCallback(async (e) => {
    e.preventDefault();
    setError("");
    if (!email.trim() || !password.trim()) { setError("Preencha todos os campos."); return; }
    const normalized = email.trim().toLowerCase();
    setLoading(true);
    try {
      // Hidrata masters remotos antes — garante que master cadastrado em outro
      // device esteja visivel pra login. Local fallback se Supabase offline.
      try {
        const remoteMasters = await listMastersRemote();
        remoteMasters.forEach(m => {
          window.storage.setItem(MASTER_PREFIX + m.id, JSON.stringify(m));
        });
      } catch { /* offline — usa local */ }
      // Lista direto (não filtra por company — master não tem company)
      const masters = DB.listAll(MASTER_PREFIX);
      let found = null;
      for (const m of masters) {
        if ((m.email || "").trim().toLowerCase() === normalized) {
          const result = await checkPassword(password, m.password);
          if (result.match) {
            if (result.needsRehash) {
              m.password = await hashPassword(password);
              try { await upsertMasterRemote(m); } catch { /* ignora */ }
            }
            window.storage.setItem(MASTER_PREFIX + m.id, JSON.stringify(m));
            found = m; break;
          }
        }
      }
      if (found) onLogin(found);
      else setError("Email ou senha incorretos.");
    } finally {
      setLoading(false);
    }
  }, [email, password, onLogin]);

  const isLight = theme === "light";

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: isLight ? "#f8fafc" : "#0f172a", position: "relative" }}>
      {typeof setTheme === "function" && (
        <button
          type="button"
          onClick={() => setTheme(isLight ? "dark" : "light")}
          className="absolute top-4 right-4 z-10 p-2 rounded-lg backdrop-blur-md transition"
          style={{
            background: isLight ? "rgba(255,255,255,0.7)" : "rgba(15,23,42,0.6)",
            border: `1px solid ${isLight ? "rgba(15,23,42,0.12)" : "rgba(255,255,255,0.12)"}`,
            color: isLight ? "#1e293b" : "#f1f5f9",
          }}
          aria-label="Alternar tema"
        >
          {isLight ? (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
          ) : (
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.05 16.95l-1.41 1.41m12.72 0l-1.41-1.41M7.05 7.05L5.64 5.64M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
          )}
        </button>
      )}
      <div className="w-full max-w-md animate-slideIn">
        <div
          className="rounded-2xl p-8"
          style={{
            background: isLight ? "rgba(255,255,255,0.95)" : "rgba(31,41,55,0.85)",
            border: `1px solid ${isLight ? "rgba(15,23,42,0.10)" : "rgba(255,255,255,0.10)"}`,
            boxShadow: isLight ? "0 20px 60px rgba(15,23,42,0.18)" : "0 20px 60px rgba(0,0,0,0.4)",
          }}
        >
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">👑</div>
            <h2 className="text-2xl font-bold text-white">Acesso Master</h2>
            <p className="text-gray-400 text-sm mt-2">Painel de gestão de empresas</p>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <input name="email" type="email" autoComplete="email" value={email} onChange={(e) => { setEmail(e.target.value); setError(""); }} placeholder="Email" autoFocus className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition" />
            <PasswordInput name="password" autoComplete="current-password" value={password} onChange={(e) => { setPassword(e.target.value); setError(""); }} placeholder="Senha" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition" />
            {error && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">{error}</div>}
            <button type="submit" disabled={loading} className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50">
              {loading ? "Entrando..." : "Entrar como Master"}
            </button>
            <button type="button" onClick={onCancel} className="w-full text-sm text-gray-400 hover:text-white transition py-2">
              ← Voltar para login da empresa
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}

function MasterApp({ master, onLogout, addToast, theme, setTheme }) {
  const [companies, setCompanies] = useState([]);
  const [showForm, setShowForm] = useState(false);
  const [reload, setReload] = useState(0);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all"); // all | ativa | bloqueada
  const [confirmDelete, setConfirmDelete] = useState(null); // empresa a excluir
  const [editingCompany, setEditingCompany] = useState(null); // empresa em edição
  const [showAuditLog, setShowAuditLog] = useState(false);

  // Form state
  const [cNome, setCNome] = useState("");
  const [cCnpj, setCCnpj] = useState("");
  const [cTelefone, setCTelefone] = useState("");
  const [cEmail, setCEmail] = useState("");
  const [cLogoUrl, setCLogoUrl] = useState("");
  const [cMaxUsuarios, setCMaxUsuarios] = useState(0); // 0 = ilimitado
  const [adminNome, setAdminNome] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [adminSenha, setAdminSenha] = useState("");
  const [formError, setFormError] = useState("");
  const [saving, setSaving] = useState(false);

  // Carrega empresas (listAll para enxergar todas — master não tem companyId)
  useEffect(() => {
    setCompanies(DB.listAll("erp:company:"));
  }, [reload]);

  // Audit log Master — registra ações do master (criar/bloquear/excluir empresa)
  const writeAudit = useCallback((action, payload) => {
    try {
      const entry = {
        id: genId(),
        ts: new Date().toISOString(),
        masterId: master?.id,
        masterNome: master?.nome,
        action,
        ...payload,
      };
      window.storage.setItem("master:audit:" + entry.id, JSON.stringify(entry));
      try { syncToSupabase("master:audit:" + entry.id, entry); } catch { /* ignora */ }
    } catch { /* não-crítico */ }
  }, [master]);

  const resetForm = () => {
    setCNome(""); setCCnpj(""); setCTelefone(""); setCEmail(""); setCLogoUrl("");
    setCMaxUsuarios(0);
    setAdminNome(""); setAdminEmail(""); setAdminSenha("");
    setFormError("");
    setEditingCompany(null);
  };

  const handleCreateCompany = useCallback(async (e) => {
    e.preventDefault();
    setFormError("");
    if (!cNome.trim()) { setFormError("Informe o nome da empresa."); return; }
    if (!adminNome.trim() || !adminEmail.trim() || !adminSenha) {
      setFormError("Preencha o admin inicial (nome, email, senha)."); return;
    }
    if (adminSenha.length < 8) { setFormError("Senha do admin: mínimo 8 caracteres."); return; }
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const normalizedAdminEmail = adminEmail.trim().toLowerCase();
    if (!emailRegex.test(normalizedAdminEmail)) { setFormError("Email do admin inválido."); return; }

    // Verifica conflito de email entre todas as empresas
    const allUsers = DB.listAll("erp:user:");
    if (allUsers.some((u) => (u.email || "").trim().toLowerCase() === normalizedAdminEmail)) {
      setFormError("Já existe usuário com este email."); return;
    }

    setSaving(true);
    try {
      const companyId = "cmp_" + genId();
      const company = {
        id: companyId,
        nome: cNome.trim(),
        cnpj: cCnpj.trim(),
        telefone: cTelefone.trim(),
        email: cEmail.trim(),
        logoUrl: cLogoUrl.trim(),
        maxUsuarios: Math.max(0, parseInt(cMaxUsuarios, 10) || 0),
        ativo: true,
        criadoEm: new Date().toISOString(),
        criadoPor: master?.id,
      };
      // Persiste sem decoração (companies não pertencem a outra company)
      window.storage.setItem("erp:company:" + companyId, JSON.stringify(company));
      try { syncToSupabase("erp:company:" + companyId, company); } catch { /* ignora */ }
      writeAudit("create_company", { companyId, companyNome: company.nome });

      // Cria admin inicial dessa empresa
      const adminUser = {
        id: genId(),
        email: normalizedAdminEmail,
        nome: adminNome.trim(),
        password: await hashPassword(adminSenha),
        role: "admin",
        avatar: adminNome.trim().slice(0, 2).toUpperCase(),
        createdAt: new Date().toISOString(),
        status: "ativo",
        forcePasswordChange: true,
        sessionTokenHash: null,
        customPermissions: null,
        isSuperAdmin: true,
        companyId, // tag explícito (master opera sem company ativa)
      };
      window.storage.setItem("erp:user:" + adminUser.id, JSON.stringify(adminUser));
      try { syncToSupabase("erp:user:" + adminUser.id, adminUser); } catch { /* ignora */ }

      addToast(`Empresa "${company.nome}" criada com admin ${adminUser.email}.`, "success");
      resetForm();
      setShowForm(false);
      setReload((r) => r + 1);
    } finally {
      setSaving(false);
    }
  }, [cNome, cCnpj, cTelefone, cEmail, cLogoUrl, cMaxUsuarios, adminNome, adminEmail, adminSenha, master, addToast, writeAudit]);

  const toggleAtivo = useCallback((company) => {
    const updated = { ...company, ativo: !company.ativo };
    window.storage.setItem("erp:company:" + company.id, JSON.stringify(updated));
    try { syncToSupabase("erp:company:" + company.id, updated); } catch { /* ignora */ }
    setReload((r) => r + 1);
    writeAudit(updated.ativo ? "unblock_company" : "block_company", { companyId: company.id, companyNome: company.nome });
    addToast(`Empresa ${updated.ativo ? "ativada" : "bloqueada"}.`, "info");
  }, [addToast, writeAudit]);

  // Excluir empresa em cascata — remove company + todos os registros decorados com companyId.
  // Itera prefixos com escopo (SCOPED_PREFIXES) e apaga o que pertencer à empresa.
  const handleDelete = useCallback((company) => {
    if (!company) return;
    const cid = company.id;
    let removed = 0;
    SCOPED_PREFIXES.forEach((prefix) => {
      const rows = DB.listAll(prefix);
      rows.forEach((r) => {
        if (r && r.companyId === cid) {
          DB.delete(prefix + r.id);
          removed += 1;
        }
      });
    });
    DB.delete("erp:company:" + cid);
    writeAudit("delete_company", { companyId: cid, companyNome: company.nome, registrosRemovidos: removed });
    setReload((r) => r + 1);
    setConfirmDelete(null);
    addToast(`Empresa "${company.nome}" excluída. ${removed} registro(s) removido(s).`, "success");
  }, [addToast, writeAudit]);

  // Abrir modal em modo edição — preenche estado com dados atuais
  const openEdit = useCallback((c) => {
    setEditingCompany(c);
    setCNome(c.nome || "");
    setCCnpj(c.cnpj || "");
    setCTelefone(c.telefone || "");
    setCEmail(c.email || "");
    setCLogoUrl(c.logoUrl || "");
    setCMaxUsuarios(typeof c.maxUsuarios === "number" ? c.maxUsuarios : 0);
    setShowForm(true);
  }, []);

  // Salvar edição (sem mexer no admin/usuários)
  const handleSaveEdit = useCallback((e) => {
    e.preventDefault();
    if (!editingCompany) return;
    if (!cNome.trim()) { setFormError("Informe o nome da empresa."); return; }
    const updated = {
      ...editingCompany,
      nome: cNome.trim(),
      cnpj: cCnpj.trim(),
      telefone: cTelefone.trim(),
      email: cEmail.trim(),
      logoUrl: cLogoUrl.trim(),
      maxUsuarios: Math.max(0, parseInt(cMaxUsuarios, 10) || 0),
      atualizadoEm: new Date().toISOString(),
    };
    window.storage.setItem("erp:company:" + updated.id, JSON.stringify(updated));
    try { syncToSupabase("erp:company:" + updated.id, updated); } catch { /* ignora */ }
    writeAudit("update_company", { companyId: updated.id, companyNome: updated.nome });
    addToast("Empresa atualizada.", "success");
    setShowForm(false);
    resetForm();
    setReload((r) => r + 1);
  }, [editingCompany, cNome, cCnpj, cTelefone, cEmail, cLogoUrl, cMaxUsuarios, addToast, writeAudit]);

  // Filtra empresas por busca e status
  const filteredCompanies = useMemo(() => {
    const s = search.trim().toLowerCase();
    return companies.filter((c) => {
      if (filter === "ativa" && !c.ativo) return false;
      if (filter === "bloqueada" && c.ativo) return false;
      if (!s) return true;
      return (
        (c.nome || "").toLowerCase().includes(s) ||
        (c.cnpj || "").toLowerCase().includes(s) ||
        (c.email || "").toLowerCase().includes(s)
      );
    });
  }, [companies, search, filter]);

  // Stats globais — contagem total de registros por entidade em todas as empresas
  const globalStats = useMemo(() => {
    const totalUsers = DB.listAll("erp:user:").length;
    const totalOS = DB.listAll("erp:os:").length;
    const totalClients = DB.listAll("erp:client:").length;
    const ativas = companies.filter((c) => c.ativo).length;
    const bloqueadas = companies.length - ativas;
    return { totalUsers, totalOS, totalClients, ativas, bloqueadas };
  }, [companies, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 font-['DM_Sans'] fade-in">
      <StyleSheet />
      <header className="sticky top-0 z-20 bg-gray-800 border-b border-gray-700 px-6 py-3 flex items-center justify-between shadow-lg">
        <div className="flex items-center gap-3">
          <span className="text-2xl">👑</span>
          <div>
            <h1 className="text-base font-bold">Painel Master</h1>
            <p className="text-xs text-gray-400">{master?.nome} • Gestão de empresas</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {typeof setTheme === "function" && (
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
              aria-label="Alternar tema"
              title="Alternar tema"
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.05 16.95l-1.41 1.41m12.72 0l-1.41-1.41M7.05 7.05L5.64 5.64M16 12a4 4 0 11-8 0 4 4 0 018 0z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" /></svg>
              )}
            </button>
          )}
          <button onClick={onLogout} className="text-xs px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition">
            Sair
          </button>
        </div>
      </header>

      <main className="p-6 max-w-6xl mx-auto space-y-6">
        {/* Stats globais — visão rápida do sistema multi-tenant */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">Empresas</p>
            <p className="text-2xl font-bold text-white mt-1">{companies.length}</p>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">Ativas</p>
            <p className="text-2xl font-bold text-green-400 mt-1">{globalStats.ativas}</p>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">Bloqueadas</p>
            <p className="text-2xl font-bold text-red-400 mt-1">{globalStats.bloqueadas}</p>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">Usuários</p>
            <p className="text-2xl font-bold text-blue-400 mt-1">{globalStats.totalUsers}</p>
          </div>
          <div className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <p className="text-xs text-gray-400">OS / Clientes</p>
            <p className="text-2xl font-bold text-cyan-400 mt-1">{globalStats.totalOS} / {globalStats.totalClients}</p>
          </div>
        </div>

        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold text-white">Empresas</h2>
            <p className="text-sm text-gray-400 mt-1">{filteredCompanies.length} de {companies.length} — dados isolados por empresa</p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              name="searchCompany"
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar nome, CNPJ ou email..."
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white w-64"
            />
            <select
              name="filterStatus"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-white"
            >
              <option value="all">Todas</option>
              <option value="ativa">Ativas</option>
              <option value="bloqueada">Bloqueadas</option>
            </select>
            <button onClick={() => setShowAuditLog(true)} className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-sm transition" title="Histórico de ações do Master">
              📜 Auditoria
            </button>
            <button onClick={() => { resetForm(); setShowForm(true); }} className="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-lg text-sm font-medium transition shadow-lg shadow-blue-600/20">
              + Nova Empresa
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCompanies.length === 0 && (
            <div className="col-span-full text-center py-16 text-gray-500 bg-gray-800 border border-gray-700 rounded-xl">
              {companies.length === 0 ? "Nenhuma empresa cadastrada ainda." : "Nenhum resultado para o filtro."}
            </div>
          )}
          {filteredCompanies.map((c) => {
            // Conta usuários e OS dessa empresa para diagnóstico rápido
            const allUsers = DB.listAll("erp:user:").filter((u) => u.companyId === c.id);
            const allOS = DB.listAll("erp:os:").filter((o) => o.companyId === c.id);
            return (
              <div key={c.id} className="bg-gray-800 border border-gray-700 rounded-xl p-5 transition hover:border-blue-500">
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3 min-w-0">
                    {c.logoUrl ? (
                      <img src={c.logoUrl} alt={c.nome} className="w-10 h-10 rounded-lg object-cover bg-gray-700" />
                    ) : (
                      <div className="w-10 h-10 rounded-lg bg-blue-600/20 text-blue-400 flex items-center justify-center font-bold text-sm">
                        {(c.nome || "?").slice(0, 2).toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0">
                      <h3 className="font-semibold text-white truncate">{c.nome}</h3>
                      <p className="text-xs text-gray-400 mt-0.5">{c.cnpj || "sem CNPJ"}</p>
                    </div>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full whitespace-nowrap ${c.ativo ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"}`}>
                    {c.ativo ? "Ativa" : "Bloqueada"}
                  </span>
                </div>
                <div className="text-xs text-gray-400 space-y-1 mb-3">
                  {c.email && <div className="truncate">📧 {c.email}</div>}
                  {c.telefone && <div>📞 {c.telefone}</div>}
                  <div>
                    👥 {allUsers.length}
                    {c.maxUsuarios > 0 ? (
                      <span className={allUsers.length >= c.maxUsuarios ? "text-red-400 font-semibold" : "text-gray-400"}>
                        {" "}/ {c.maxUsuarios} usuário(s)
                      </span>
                    ) : (
                      <span> usuário(s) • ilimitado</span>
                    )}
                    {" • 🛠 "}{allOS.length} OS
                  </div>
                  <div className="text-gray-500">Criada {new Date(c.criadoEm).toLocaleDateString("pt-BR")}</div>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <button onClick={() => openEdit(c)} className="text-xs py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200 transition" title="Editar dados da empresa">
                    Editar
                  </button>
                  <button onClick={() => toggleAtivo(c)} className={`text-xs py-2 rounded-lg transition ${c.ativo ? "bg-yellow-600/20 hover:bg-yellow-600/40 text-yellow-300" : "bg-green-600 hover:bg-green-700 text-white"}`}>
                    {c.ativo ? "Bloquear" : "Reativar"}
                  </button>
                  <button onClick={() => setConfirmDelete(c)} className="text-xs py-2 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-300 transition" title="Excluir empresa e todos os dados">
                    Excluir
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </main>

      {showForm && (
        <Modal isOpen={true} title={editingCompany ? "Editar empresa" : "Cadastrar nova empresa"} onClose={() => { setShowForm(false); resetForm(); }} size="lg">
          <form onSubmit={editingCompany ? handleSaveEdit : handleCreateCompany} className="space-y-4">
            <h4 className="text-sm font-semibold text-white">Empresa</h4>
            <div className="grid grid-cols-2 gap-3">
              <input name="cNome" type="text" value={cNome} onChange={(e) => setCNome(e.target.value)} placeholder="Razão social *" className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
              <input name="cCnpj" type="text" value={cCnpj} onChange={(e) => setCCnpj(formatCNPJ(e.target.value))} placeholder="CNPJ" maxLength={18} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
              <input name="cTelefone" type="text" value={cTelefone} onChange={(e) => setCTelefone(formatPhone(e.target.value))} placeholder="Telefone" maxLength={15} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
              <input name="cEmail" type="email" value={cEmail} onChange={(e) => setCEmail(e.target.value)} placeholder="Email da empresa" className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
              <div className="col-span-2">
                <label className="block text-xs text-gray-400 mb-1">Limite de usuários (0 = ilimitado)</label>
                <input
                  name="cMaxUsuarios"
                  type="number"
                  min="0"
                  value={cMaxUsuarios}
                  onChange={(e) => setCMaxUsuarios(e.target.value)}
                  placeholder="Ex: 5"
                  className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white w-full"
                />
                <p className="text-[11px] text-gray-500 mt-1">Ao atingir o limite, novos usuários não poderão ser cadastrados pelos admins desta empresa.</p>
              </div>
              <LogoPicker value={cLogoUrl} onChange={setCLogoUrl} addToast={addToast} />
            </div>

            {!editingCompany && (
              <>
                <h4 className="text-sm font-semibold text-white pt-2">Admin inicial</h4>
                <div className="grid grid-cols-2 gap-3">
                  <input name="adminNome" type="text" value={adminNome} onChange={(e) => setAdminNome(e.target.value)} placeholder="Nome do admin *" className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                  <input name="adminEmail" type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Email do admin *" className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                  <PasswordInput name="adminSenha" value={adminSenha} onChange={(e) => setAdminSenha(e.target.value)} placeholder="Senha provisória (min. 8) *" containerClassName="col-span-2" className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white" />
                </div>
                <p className="text-xs text-gray-400">O admin será forçado a trocar a senha no primeiro login.</p>
              </>
            )}

            {formError && <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">{formError}</div>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => { setShowForm(false); resetForm(); }} className="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 transition">Cancelar</button>
              <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition disabled:opacity-50">
                {saving ? "Salvando..." : (editingCompany ? "Salvar alterações" : "Criar empresa")}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {/* Confirmação de exclusão — exige digitar o nome da empresa */}
      {confirmDelete && (
        <ConfirmDialog
          message={`Excluir a empresa "${confirmDelete.nome}" remove TODOS os dados (usuários, clientes, OS, financeiro, etc). Operação irreversível.`}
          requireType={confirmDelete.nome}
          onConfirm={() => handleDelete(confirmDelete)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}

      {/* Auditoria — log de ações do Master */}
      {showAuditLog && (
        <Modal isOpen={true} title="Auditoria — Ações do Master" onClose={() => setShowAuditLog(false)} size="lg">
          <MasterAuditLog onClose={() => setShowAuditLog(false)} />
        </Modal>
      )}
    </div>
  );
}

// LogoPicker — componente unificado pra escolher logo da empresa.
// Suporta: upload de arquivo (com compressão), URL externa, colar do clipboard,
// e drag-drop. Resultado é sempre uma string (data URL ou http URL) salva em logoUrl.
// Limite de 300KB no arquivo final pra não inchar localStorage/Supabase.
function LogoPicker({ value, onChange, addToast }) {
  const [mode, setMode] = useState("file"); // file | url
  const [urlInput, setUrlInput] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef(null);

  // Comprime imagem via canvas — mantém aspecto, reduz pra max 256px e qualidade JPEG 0.85
  // Retorna data URL. Aceita PNG transparente preservando.
  const compressImage = useCallback(async (file) => {
    if (file.size > 5 * 1024 * 1024) {
      throw new Error("Arquivo > 5MB. Escolha imagem menor.");
    }
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
    const img = await new Promise((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = reject;
      i.src = dataUrl;
    });
    const MAX = 256;
    let w = img.width;
    let h = img.height;
    if (w > MAX || h > MAX) {
      const ratio = Math.min(MAX / w, MAX / h);
      w = Math.round(w * ratio);
      h = Math.round(h * ratio);
    }
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(img, 0, 0, w, h);
    // PNG preserva transparência; outros formatos vão pra JPEG (menor)
    const isPng = file.type === "image/png";
    const out = canvas.toDataURL(isPng ? "image/png" : "image/jpeg", 0.85);
    // Hard limit: 300KB no resultado final
    if (out.length > 300 * 1024 * 1.4) {
      // Tenta de novo em JPEG menor
      const fallback = canvas.toDataURL("image/jpeg", 0.7);
      if (fallback.length > 300 * 1024 * 1.4) {
        throw new Error("Imagem muito grande mesmo após compressão. Use logo até 256x256.");
      }
      return fallback;
    }
    return out;
  }, []);

  const handleFile = useCallback(async (file) => {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      addToast?.("Apenas arquivos de imagem.", "error");
      return;
    }
    setBusy(true);
    try {
      const compressed = await compressImage(file);
      onChange(compressed);
      addToast?.("Logo carregada.", "success");
    } catch (err) {
      addToast?.(err.message || "Falha ao processar imagem.", "error");
    } finally {
      setBusy(false);
    }
  }, [compressImage, onChange, addToast]);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handlePaste = useCallback(async () => {
    try {
      const items = await navigator.clipboard.read();
      for (const item of items) {
        for (const type of item.types) {
          if (type.startsWith("image/")) {
            const blob = await item.getType(type);
            const file = new File([blob], "clipboard.png", { type });
            handleFile(file);
            return;
          }
        }
      }
      addToast?.("Nenhuma imagem no clipboard.", "info");
    } catch {
      addToast?.("Permissão de clipboard negada.", "error");
    }
  }, [handleFile, addToast]);

  const applyUrl = useCallback(() => {
    const u = urlInput.trim();
    if (!u) return;
    if (!/^https?:\/\//i.test(u)) {
      addToast?.("URL deve começar com http:// ou https://", "error");
      return;
    }
    onChange(u);
    setUrlInput("");
    addToast?.("URL aplicada.", "success");
  }, [urlInput, onChange, addToast]);

  return (
    <div className="col-span-2 space-y-2">
      {/* Tabs */}
      <div className="flex gap-1 bg-gray-900/40 border border-gray-700 rounded-lg p-1">
        <button type="button" onClick={() => setMode("file")} className={`flex-1 text-xs py-1.5 rounded-md transition ${mode === "file" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
          📁 Arquivo
        </button>
        <button type="button" onClick={() => setMode("url")} className={`flex-1 text-xs py-1.5 rounded-md transition ${mode === "url" ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-gray-700"}`}>
          🔗 URL
        </button>
        <button type="button" onClick={handlePaste} className="flex-1 text-xs py-1.5 rounded-md text-gray-300 hover:bg-gray-700 transition" title="Colar imagem do clipboard">
          📋 Colar
        </button>
      </div>

      {mode === "file" && (
        <div
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-4 text-center cursor-pointer transition ${dragOver ? "border-blue-500 bg-blue-500/10" : "border-gray-600 hover:border-gray-500 bg-gray-700/30"}`}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
          <p className="text-xs text-gray-300">
            {busy ? "⏳ Processando..." : "📤 Clique ou arraste a logo aqui"}
          </p>
          <p className="text-[10px] text-gray-500 mt-1">PNG, JPG, WEBP, SVG ou GIF • máx 5MB • redimensionada para 256px</p>
        </div>
      )}

      {mode === "url" && (
        <div className="flex gap-2">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://..."
            className="flex-1 bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white"
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applyUrl(); } }}
          />
          <button type="button" onClick={applyUrl} className="px-3 py-2 text-xs bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
            Aplicar
          </button>
        </div>
      )}

      {/* Preview + remover */}
      {value && (
        <div className="flex items-center gap-3 bg-gray-900/40 border border-gray-700 rounded-lg p-3">
          <img
            src={value}
            alt="preview"
            className="w-14 h-14 rounded-lg object-cover bg-gray-700"
            onError={(e) => { e.target.style.opacity = "0.3"; }}
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs text-gray-300">Logo atual</p>
            <p className="text-[10px] text-gray-500 truncate">{value.startsWith("data:") ? `Imagem incorporada (${Math.round(value.length / 1024)}KB)` : value}</p>
          </div>
          <button type="button" onClick={() => onChange("")} className="text-xs px-2 py-1 rounded-md bg-red-600/20 hover:bg-red-600/40 text-red-300 transition">
            Remover
          </button>
        </div>
      )}
    </div>
  );
}

// Componente do log de auditoria — lê master:audit:* e mostra cronologia decrescente.
function MasterAuditLog() {
  const entries = useMemo(() => {
    const list = [];
    for (let i = 0; i < window.storage.length; i++) {
      const k = window.storage.key(i);
      if (k && k.startsWith("master:audit:")) {
        try {
          const v = JSON.parse(window.storage.getItem(k));
          list.push(v);
        } catch { /* ignora entrada corrompida */ }
      }
    }
    return list.sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
  }, []);

  const labelMap = {
    create_company: { label: "Empresa criada", color: "text-green-400" },
    update_company: { label: "Empresa atualizada", color: "text-blue-400" },
    block_company: { label: "Empresa bloqueada", color: "text-yellow-400" },
    unblock_company: { label: "Empresa reativada", color: "text-green-400" },
    delete_company: { label: "Empresa EXCLUÍDA", color: "text-red-400" },
  };

  if (entries.length === 0) {
    return <p className="text-sm text-gray-400">Nenhuma ação registrada ainda.</p>;
  }
  return (
    <div className="space-y-2 max-h-[60vh] overflow-y-auto">
      {entries.map((e) => {
        const meta = labelMap[e.action] || { label: e.action, color: "text-gray-300" };
        return (
          <div key={e.id} className="bg-gray-700/50 border border-gray-700 rounded-lg p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className={`font-semibold ${meta.color}`}>{meta.label}</span>
              <span className="text-xs text-gray-400">{new Date(e.ts).toLocaleString("pt-BR")}</span>
            </div>
            <div className="text-xs text-gray-300 mt-1">
              {e.companyNome && <span>Empresa: <strong>{e.companyNome}</strong></span>}
              {typeof e.registrosRemovidos === "number" && (
                <span className="ml-2 text-red-300">• {e.registrosRemovidos} registro(s) removido(s)</span>
              )}
            </div>
            {e.masterNome && <div className="text-[11px] text-gray-500 mt-1">por {e.masterNome}</div>}
          </div>
        );
      })}
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
              {/* Stroke do grid lê variável do tema — visível em dark e light */}
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border-default)" />
              <XAxis dataKey="name" stroke="var(--color-text-muted)" fontSize={12} />
              <YAxis stroke="var(--color-text-muted)" fontSize={12} allowDecimals={false} />
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
    // Backfill: garante que toda OS já finalizada tenha sua transação no Financeiro.
    // Caso o app tenha sido aberto antes da integração estar viva, preenchemos
    // retroativamente. syncOSToFinance é idempotente, então rodar é seguro.
    const finalizedOS = DB.list("erp:os:").filter(
      (o) => ["finalizado", "concluido"].includes(o.status)
    );
    finalizedOS.forEach(syncOSToFinance);
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
        <select name="filterType"
          value={filterType}
          onChange={(e) => setFilterType(e.target.value)}
          className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 min-h-[44px]"
        >
          <option value="all">Todos os tipos</option>
          <option value="receita">Receitas</option>
          <option value="despesa">Despesas</option>
        </select>
        <select name="filterStatus"
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
        <select name="filterCategory"
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
            <input name="descricao"
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
              <input name="valor"
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
              <select name="tipo"
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
              <select name="categoria"
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
              <input name="data"
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
              <select name="status"
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
              <select name="formaPagamento"
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
            <textarea name="observacoes"
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

// Abre documento HTML em nova aba do navegador.
// Usamos Blob URL para que <script>, onclick e window.print() funcionem
// (browsers podem desabilitar scripts em documentos abertos via about:blank).
function openHTMLDoc(html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, "_blank");
  if (!w) {
    URL.revokeObjectURL(url);
    alert("Permita popups para gerar documentos.");
    return;
  }
  // Libera o blob depois que a aba carregou (1 min é suficiente)
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

// Formatação compacta de moeda (BRL) com tabular-nums implícito
function _fmtBRL(n) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(n) || 0);
}

// ─── FOLHA DE PAGAMENTO — cálculos previdenciários e fiscais 2026 ─────────────
// Tabela INSS 2026 (faixas progressivas — referência: portaria interministerial vigente).
// O cálculo é progressivo: cada faixa contribui só sobre o valor que cai DENTRO dela.
// Teto contribuição 2026: R$ 8.157,41 (alíquota efetiva máxima ~14%).
// Se as alíquotas mudarem, atualize INSS_FAIXAS_2026 — o restante do código segue igual.
const INSS_FAIXAS_2026 = [
  { ate: 1518.00, aliq: 0.075 },
  { ate: 2793.88, aliq: 0.09 },
  { ate: 4190.83, aliq: 0.12 },
  { ate: 8157.41, aliq: 0.14 },
];
function calcINSS(salarioContribuicao) {
  const sal = Math.max(0, Number(salarioContribuicao) || 0);
  let total = 0;
  let pisoAnterior = 0;
  for (const faixa of INSS_FAIXAS_2026) {
    if (sal <= pisoAnterior) break;
    const tetoFaixa = Math.min(sal, faixa.ate);
    total += (tetoFaixa - pisoAnterior) * faixa.aliq;
    pisoAnterior = faixa.ate;
    if (sal <= faixa.ate) break;
  }
  return Math.round(total * 100) / 100;
}

// Tabela IRRF 2026 (deduções por faixa, vigente a partir de fev/2024 e mantida em 2026).
// Base de cálculo = salário bruto - INSS - dependentes. Existe a opção do desconto
// simplificado (R$ 564) que é mais vantajoso para muita gente — escolhemos o menor IR.
const IRRF_FAIXAS_2026 = [
  { ate: 2428.80, aliq: 0,      deducao: 0 },
  { ate: 2826.65, aliq: 0.075,  deducao: 182.16 },
  { ate: 3751.05, aliq: 0.15,   deducao: 394.16 },
  { ate: 4664.68, aliq: 0.225,  deducao: 675.49 },
  { ate: Infinity, aliq: 0.275, deducao: 908.73 },
];
const IRRF_DEPENDENTE_2026 = 189.59;
const IRRF_DESCONTO_SIMPLIFICADO_2026 = 564.80;
function calcIRRF(salarioBruto, inss, dependentes = 0) {
  const bruto = Math.max(0, Number(salarioBruto) || 0);
  const dep = Math.max(0, Number(dependentes) || 0);
  // Base com deduções legais (INSS + dependentes)
  const baseLegal = Math.max(0, bruto - (Number(inss) || 0) - (dep * IRRF_DEPENDENTE_2026));
  // Base com desconto simplificado (substitui qualquer dedução)
  const baseSimpl = Math.max(0, bruto - IRRF_DESCONTO_SIMPLIFICADO_2026);
  const base = Math.min(baseLegal, baseSimpl);
  const faixa = IRRF_FAIXAS_2026.find((f) => base <= f.ate) || IRRF_FAIXAS_2026[IRRF_FAIXAS_2026.length - 1];
  const ir = Math.max(0, base * faixa.aliq - faixa.deducao);
  return Math.round(ir * 100) / 100;
}

// FGTS — não desconta do funcionário (empregador deposita), mas mostramos informativo.
function calcFGTS(salarioBruto) {
  return Math.round((Math.max(0, Number(salarioBruto) || 0) * 0.08) * 100) / 100;
}

// Resolve URL para absoluto. Documentos abertos via Blob URL não conseguem
// carregar caminhos relativos (`/qr.jpeg`) porque a base é blob:... — então
// transformamos em http(s)://host/path antes de injetar no HTML.
function _absUrl(url) {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  try { return new URL(url, window.location.origin).href; }
  catch { return url; }
}

// Escape HTML — qualquer valor vindo de usuário (nome de cliente, descrição de OS,
// modelo de equipamento, etc.) DEVE passar por aqui antes de ir para template literal
// que será injetado via document.write. Sem isso, "<script>" no nome do cliente vira XSS.
function _h(v) {
  if (v == null) return "";
  return String(v)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
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

    /* ─── Header: logo + identidade centralizada; doc info no canto superior direito ──── */
    .hdr{position:relative;display:flex;flex-direction:column;align-items:center;gap:10px;padding-bottom:20px;border-bottom:2px solid var(--accent);text-align:center}
    .hdr-logo{max-width:200px;max-height:140px;object-fit:contain;margin-bottom:4px}
    .hdr-brand{width:100%;padding:0 140px}
    .hdr-brand .company{font-size:22px;font-weight:800;color:var(--ink-900);letter-spacing:-0.01em;line-height:1.2}
    .hdr-brand .tagline{font-size:12px;color:var(--ink-500);margin-top:2px;font-weight:500;letter-spacing:.02em}
    .hdr-brand .contact{font-size:10.5px;color:var(--ink-500);margin-top:6px;line-height:1.6;max-width:560px;margin-left:auto;margin-right:auto}
    .hdr-doc{position:absolute;top:0;right:0;text-align:right;padding:10px 14px;background:var(--ink-50);border:1px solid var(--ink-300);border-radius:8px;display:flex;flex-direction:column;gap:2px;min-width:140px}
    .hdr-doc .doc-type{font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.12em;color:var(--accent)}
    .hdr-doc .doc-num{font-size:18px;font-weight:800;color:var(--ink-900);letter-spacing:-0.02em;tab-size:2;font-variant-numeric:tabular-nums;line-height:1.1}
    .hdr-doc .doc-date{font-size:10.5px;color:var(--ink-500);font-variant-numeric:tabular-nums}

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

// Header reutilizável — logo + identidade centralizada + badge do documento.
// A logo é resolvida nesta ordem: config.logoUrl → activeCompany.logoUrl → nenhuma.
// Todos os campos vêm do banco; aplique _h() antes de injetar (anti-XSS).
function _docHeader(config, docType, numero, dataStr) {
  const emp = config.nomeEmpresa || config.razaoSocial || "FrostERP Refrigeração";
  const cnpj = config.cnpj ? `CNPJ ${config.cnpj}` : "";
  const tel = config.telefone ? `Tel ${config.telefone}` : "";
  const email = config.email || "";
  const end = config.endereco || "";
  const contactLine = [cnpj, tel, email, end].filter(Boolean).map(_h).join(" · ");

  // Resolve logo: config explícito tem prioridade; senão tenta a empresa ativa.
  let logoUrl = config.logoUrl || "";
  if (!logoUrl) {
    const activeId = (typeof getActiveCompanyId === "function") ? getActiveCompanyId() : null;
    if (activeId) {
      const company = DB.get("erp:company:" + activeId);
      logoUrl = company?.logoUrl || "";
    }
  }
  // Documento abre em Blob URL — caminhos relativos não resolvem
  const logoAbs = _absUrl(logoUrl);

  return `
    <div class="hdr">
      ${logoAbs ? `<img class="hdr-logo" src="${_h(logoAbs)}" alt="Logo ${_h(emp)}" />` : ""}
      <div class="hdr-brand">
        <div class="company">${_h(emp)}</div>
        <div class="tagline">Refrigeração e Climatização</div>
        ${contactLine ? `<div class="contact">${contactLine}</div>` : ""}
      </div>
      <div class="hdr-doc">
        <div class="doc-type">${_h(docType)}</div>
        <div class="doc-num">${_h(numero)}</div>
        <div class="doc-date">${_h(dataStr)}</div>
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

// ─── Bloco PIX (dados de recebimento) ────────────────────────────────────────
// Lê config.pixChave / pixFavorecido / pixBanco / pixQrUrl. Se nenhum desses
// estiver setado, cai em valores padrão (THIAGO GONÇALVES PRADO — Sicredi)
// para preservar comportamento prévio. QR Code default em /qr-pix-sicredi.jpeg.
function _pixBlock(config) {
  const cfg = config || {};
  const chave = cfg.pixChave || "41.080.020/0001-05";
  const tipoChave = cfg.pixTipoChave || "CNPJ";
  const favorecido = cfg.pixFavorecido || "THIAGO GONÇALVES PRADO";
  const banco = cfg.pixBanco || "Sicredi";
  const qrUrl = _absUrl(cfg.pixQrUrl || "/qr-pix-sicredi.jpeg");

  return `
    <div class="section">
      <div class="info-card" style="border-left:3px solid var(--accent)">
        <div class="section-title" style="margin-bottom:10px">Pagamento via PIX</div>
        <div style="display:flex;gap:18px;align-items:center">
          ${qrUrl ? `<img src="${_h(qrUrl)}" alt="QR Code PIX" style="width:140px;height:140px;object-fit:contain;border:1px solid var(--ink-300);border-radius:6px;background:#fff;padding:4px;flex-shrink:0" />` : ""}
          <div style="flex:1;min-width:0">
            <div class="info-grid" style="grid-template-columns:1fr;gap:8px">
              <div class="info-item mono"><label>Chave PIX (${_h(tipoChave)})</label><span>${_h(chave)}</span></div>
              <div class="info-item"><label>Favorecido</label><span>${_h(favorecido)}</span></div>
              <div class="info-item"><label>Banco</label><span>${_h(banco)}</span></div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
}

// ─── Bloco do Cliente ────────────────────────────────────────────────────────
// Mostra nome, endereço, telefone e CNPJ/CPF (conforme tipo do cadastro).
// Formato compacto em info-card; campos faltantes ficam ocultos.
function _clienteBlock(cliente, os) {
  const nome = cliente.nome || os.clienteNome || "—";
  const tel = cliente.telefone || "";
  const docTipo = cliente.tipo === "pj" ? "CNPJ" : "CPF";
  const docVal = cliente.tipo === "pj" ? cliente.cnpj : cliente.cpf;
  const endereco = (cliente.endereco && (cliente.endereco.rua || cliente.endereco.cidade))
    ? `${cliente.endereco.rua || ""}${cliente.endereco.numero ? ", " + cliente.endereco.numero : ""}${cliente.endereco.bairro ? " · " + cliente.endereco.bairro : ""}${cliente.endereco.cidade ? " — " + cliente.endereco.cidade : ""}${cliente.endereco.estado ? "/" + cliente.endereco.estado : ""}`
    : (os.endereco || "");

  return `
    <div class="section">
      <div class="info-card">
        <div class="section-title" style="margin-bottom:10px">Cliente</div>
        <div class="info-grid" style="grid-template-columns:1fr 1fr;gap:8px 24px">
          <div class="info-item"><label>Nome / Razão Social</label><span>${_h(nome)}</span></div>
          ${docVal ? `<div class="info-item mono"><label>${docTipo}</label><span>${_h(docVal)}</span></div>` : ""}
          ${tel ? `<div class="info-item mono"><label>Telefone</label><span>${_h(tel)}</span></div>` : ""}
          ${endereco ? `<div class="info-item" style="grid-column:1 / -1"><label>Endereço</label><span>${_h(endereco)}</span></div>` : ""}
        </div>
      </div>
    </div>
  `;
}

// ─── Bloco de Agradecimento (Recibo) ─────────────────────────────────────────
// Mensagem cordial exibida no Recibo no lugar do bloco PIX. Texto custom
// pode ser passado via config.mensagemAgradecimento; fallback é genérico.
function _agradecimentoBlock(config) {
  const msg = (config && config.mensagemAgradecimento) ||
    "Agradecemos a preferência! Foi um prazer atender você. Conte com a Minas Refrigeração sempre que precisar.";
  return `
    <div class="section">
      <div class="info-card" style="text-align:center;border:1px solid var(--accent-border);background:var(--accent-soft)">
        <div style="font-size:14px;font-weight:600;color:var(--ink-900);line-height:1.5">${_h(msg)}</div>
      </div>
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

// Gera HTML do Orçamento — versão compacta para envio ao cliente.
// Mostra apenas o essencial: cliente, serviços, materiais com preços, total,
// garantia e dados de PIX. Sem cards de cliente extensos, sem assinaturas.
function generateOrcamentoHTML(os, clients) {
  const config = DB.get("erp:config") || {};
  const cliente = (clients || []).find((c) => c.id === os.clienteId) || {};
  const dataHoje = new Date().toLocaleDateString("pt-BR");
  const validade = new Date(Date.now() + 15 * 86400000).toLocaleDateString("pt-BR");
  const valorServico = os.valor || 0;

  // Serviços e peças (campos de usuário escapados nos rows abaixo)
  const servicos = Array.isArray(os.servicos) && os.servicos.length > 0
    ? os.servicos
    : [{ tipo: os.tipo, descricao: os.equipamentoModelo || "Serviço de Refrigeração", valor: valorServico }];
  const pecas = Array.isArray(os.pecas) && os.pecas.length > 0 ? os.pecas : (os.itensUtilizados || []);

  const rowsServicos = servicos.map((s) => {
    const v = Number(s.valor) || 0;
    const desc = s.descricao
      ? `<strong style="color:var(--ink-900)">${_h(s.tipo)}</strong><div style="font-size:11px;color:var(--ink-500);margin-top:2px">${_h(s.descricao)}</div>`
      : `<strong style="color:var(--ink-900)">${_h(s.tipo)}</strong>`;
    return `<tr><td>${desc}</td><td class="num">${_fmtBRL(v)}</td></tr>`;
  }).join("");

  const rowsPecas = pecas.map((p) => {
    const qtd = Number(p.quantidade) || 1;
    const valU = Number(p.valorUnit) || 0;
    const sub = qtd * valU;
    const valStr = valU > 0 ? _fmtBRL(valU) : "—";
    const subStr = valU > 0 ? _fmtBRL(sub) : "<span class=\"muted\">Incluso</span>";
    return `<tr><td>${_h(p.nome || "Material")}</td><td class="num">${qtd}</td><td class="num">${valStr}</td><td class="num">${subStr}</td></tr>`;
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

    ${_clienteBlock(cliente, os)}

    <!-- Serviços -->
    <div class="section">
      <div class="section-title">Serviços</div>
      <table>
        <thead>
          <tr>
            <th>Descrição</th>
            <th class="num" style="width:140px">Valor</th>
          </tr>
        </thead>
        <tbody>${rowsServicos}</tbody>
      </table>
    </div>

    ${pecas.length > 0 ? `
    <!-- Materiais -->
    <div class="section">
      <div class="section-title">Materiais</div>
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th class="num" style="width:60px">Qtd</th>
            <th class="num" style="width:110px">Valor Unit.</th>
            <th class="num" style="width:120px">Subtotal</th>
          </tr>
        </thead>
        <tbody>${rowsPecas}</tbody>
      </table>
    </div>` : ""}

    <!-- Totais -->
    <div class="totals">
      <div class="totals-inner">
        <div class="total-row"><span>Mão de obra</span><span>${_fmtBRL(totServ)}</span></div>
        <div class="total-row"><span>Peças e Materiais</span><span>${totPecas > 0 ? _fmtBRL(totPecas) : "Incluso"}</span></div>
        <div class="total-row grand"><span class="label">Total</span><span class="value">${_fmtBRL(total)}</span></div>
      </div>
    </div>

    <!-- Garantia -->
    <div class="terms">
      <strong>Garantia</strong>
      Validade do orçamento até <strong style="color:var(--ink-900)">${_h(validade)}</strong>. Serviço com garantia de 90 dias contados a partir da execução, cobrindo defeitos de execução. Equipamentos seguem garantia do fabricante. Não cobre mau uso, sobrecarga elétrica ou falta de manutenção.
    </div>

    ${_pixBlock(config)}

    <div class="watermark">Documento gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// Gera HTML da Ordem de Serviço — versão compacta para apresentar ao cliente.
// Mostra apenas: cliente, serviços executados, materiais com preços, total
// e garantia. Sem PIX (PIX só aparece em Orçamento e Recibo). Sem assinaturas.
function generateOSHTML(os, clients) {
  const config = DB.get("erp:config") || {};
  const cliente = (clients || []).find((c) => c.id === os.clienteId) || {};
  const dataAbertura = os.dataAbertura ? new Date(os.dataAbertura).toLocaleDateString("pt-BR") : "—";

  const servicos = Array.isArray(os.servicos) && os.servicos.length > 0 ? os.servicos : null;
  const pecas = Array.isArray(os.pecas) && os.pecas.length > 0 ? os.pecas : (os.itensUtilizados || []);

  const rowsServicos = servicos ? servicos.map((s) => {
    const v = Number(s.valor) || 0;
    return `<tr>
      <td><strong style="color:var(--ink-900)">${_h(s.tipo || "—")}</strong></td>
      <td class="muted">${_h(s.descricao || "—")}</td>
      <td class="num">${_fmtBRL(v)}</td>
    </tr>`;
  }).join("") : "";

  const rowsPecas = pecas.map((i) => {
    const qtd = Number(i.quantidade) || 1;
    const valU = Number(i.valorUnit) || 0;
    const sub = qtd * valU;
    return `<tr>
      <td>${_h(i.nome || "—")}</td>
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

    ${_clienteBlock(cliente, os)}

    ${servicos ? `
    <!-- Serviços executados -->
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
      <div class="section-title">Serviços Executados</div>
      <div class="obs-box">${_h(os.descricao || os.observacoes || "Sem descrição informada.")}</div>
    </div>`}

    ${pecas.length > 0 ? `
    <!-- Materiais -->
    <div class="section">
      <div class="section-title">Materiais</div>
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

    <!-- Garantia -->
    <div class="terms">
      <strong>Garantia</strong>
      Serviço com garantia de 90 dias contados a partir da execução, cobrindo defeitos de execução. Equipamentos seguem garantia do fabricante conforme manual. Não cobre danos por mau uso, sobrecarga elétrica, sinistros ou falta de manutenção periódica.
    </div>

    <div class="watermark">Documento gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// Gera HTML do Recibo — versão compacta com valor em destaque.
// Mostra: cliente, serviços executados, materiais com preços, garantia,
// PIX (chave + QR Code) e mensagem de agradecimento.
function generateReciboHTML(os, clients) {
  const config = DB.get("erp:config") || {};
  const cliente = (clients || []).find((c) => c.id === os.clienteId) || {};
  const dataConclusao = os.dataConclusao
    ? new Date(os.dataConclusao).toLocaleDateString("pt-BR")
    : new Date().toLocaleDateString("pt-BR");
  const valor = os.valor || 0;
  const valorExtenso = valor.toLocaleString("pt-BR", { minimumFractionDigits: 2 });

  const servicos = Array.isArray(os.servicos) && os.servicos.length > 0 ? os.servicos : null;
  const pecas = Array.isArray(os.pecas) && os.pecas.length > 0 ? os.pecas : (os.itensUtilizados || []);

  const rowsServicos = servicos ? servicos.map((s) => {
    const v = Number(s.valor) || 0;
    return `<tr>
      <td><strong style="color:var(--ink-900)">${_h(s.tipo || "—")}</strong></td>
      <td class="muted">${_h(s.descricao || "—")}</td>
      <td class="num">${_fmtBRL(v)}</td>
    </tr>`;
  }).join("") : "";

  const rowsPecas = pecas.map((i) => {
    const qtd = Number(i.quantidade) || 1;
    const valU = Number(i.valorUnit) || 0;
    const sub = qtd * valU;
    return `<tr>
      <td>${_h(i.nome || "—")}</td>
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

    ${_clienteBlock(cliente, os)}

    ${servicos ? `
    <!-- Serviços executados -->
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
    </div>` : (os.descricao || os.observacoes ? `
    <div class="section">
      <div class="section-title">Serviços Executados</div>
      <div class="obs-box">${_h(os.descricao || os.observacoes)}</div>
    </div>` : "")}

    ${pecas.length > 0 ? `
    <!-- Materiais -->
    <div class="section">
      <div class="section-title">Materiais</div>
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

    <!-- Garantia -->
    <div class="terms">
      <strong>Garantia</strong>
      Este serviço possui garantia de 90 dias contados a partir da data de conclusão, cobrindo defeitos de execução. Equipamentos seguem garantia do fabricante conforme manual do produto. Não cobre danos por mau uso, sobrecargas elétricas, sinistros ou falta de manutenção periódica.
    </div>

    ${_pixBlock(config)}

    ${_agradecimentoBlock(config)}

    <div class="watermark">Documento gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// ─── Contracheque — gerador HTML imprimível (padrão dos outros documentos) ───
// O HTML usa o mesmo _docStyles/_docHeader das demais peças (orçamento/OS/recibo)
// para manter identidade visual. Print-friendly via @media print já incluído no _docStyles.
// Em Chrome/Edge o usuário pode "Imprimir → Salvar como PDF" pra baixar.
function generateContrachequeHTML(contracheque, employee) {
  const config = DB.get("erp:config") || {};
  const emp = employee || {};
  const [ano, mes] = String(contracheque.mesRef || "").split("-");
  const mesNome = ["", "Janeiro","Fevereiro","Março","Abril","Maio","Junho","Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"][Number(mes)] || mes || "—";
  const adicionais = Array.isArray(contracheque.adicionais) ? contracheque.adicionais : [];
  const descontos = Array.isArray(contracheque.descontos) ? contracheque.descontos : [];

  const totalAdicionais = adicionais.reduce((s, a) => s + (Number(a.valor) || 0), 0);
  const totalProventos = (Number(contracheque.salarioBase) || 0) + totalAdicionais;
  const inss = Number(contracheque.inss) || 0;
  const irrf = Number(contracheque.irrf) || 0;
  const totalOutrosDesc = descontos.reduce((s, d) => s + (Number(d.valor) || 0), 0);
  const totalDescontos = inss + irrf + totalOutrosDesc;
  const liquido = totalProventos - totalDescontos;
  const fgts = calcFGTS(totalProventos);

  const rowsAdic = [
    `<tr><td>Salário Base</td><td class="num">${_fmtBRL(contracheque.salarioBase || 0)}</td></tr>`,
    ...adicionais.map((a) => `<tr><td>${_h(a.descricao || "Adicional")}</td><td class="num">${_fmtBRL(a.valor || 0)}</td></tr>`),
  ].join("");

  const rowsDesc = [
    `<tr><td>INSS</td><td class="num">${_fmtBRL(inss)}</td></tr>`,
    `<tr><td>IRRF</td><td class="num">${_fmtBRL(irrf)}</td></tr>`,
    ...descontos.map((d) => `<tr><td>${_h(d.descricao || d.tipo || "Desconto")}</td><td class="num">${_fmtBRL(d.valor || 0)}</td></tr>`),
  ].join("");

  const dataEmissao = new Date().toLocaleDateString("pt-BR");

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Contracheque ${_h(emp.nome || "")} — ${mesNome}/${ano}</title>
<style>${_docStyles("#0f766e")}</style>
</head>
<body>
<main class="page">
  <div class="page-inner">
    ${_docHeader(config, "Recibo de Pagamento de Salário", `${mesNome}/${ano}`, `Emitido em ${dataEmissao}`)}

    <!-- Bloco de dados do funcionário -->
    <div class="section">
      <div class="section-title">Funcionário</div>
      <table>
        <tr><td style="width:30%"><strong>Nome</strong></td><td>${_h(emp.nome || "—")}</td></tr>
        ${emp.cpf ? `<tr><td><strong>CPF</strong></td><td>${_h(emp.cpf)}</td></tr>` : ""}
        ${emp.cargo ? `<tr><td><strong>Cargo</strong></td><td>${_h(emp.cargo)}</td></tr>` : ""}
        ${emp.dataAdmissao ? `<tr><td><strong>Admissão</strong></td><td>${_h(emp.dataAdmissao)}</td></tr>` : ""}
        <tr><td><strong>Competência</strong></td><td>${mesNome}/${ano}</td></tr>
      </table>
    </div>

    <!-- Proventos -->
    <div class="section">
      <div class="section-title">Proventos</div>
      <table>
        <thead><tr><th>Descrição</th><th class="num" style="width:160px">Valor</th></tr></thead>
        <tbody>${rowsAdic}</tbody>
        <tfoot><tr><td><strong>Total de Proventos</strong></td><td class="num"><strong>${_fmtBRL(totalProventos)}</strong></td></tr></tfoot>
      </table>
    </div>

    <!-- Descontos -->
    <div class="section">
      <div class="section-title">Descontos</div>
      <table>
        <thead><tr><th>Descrição</th><th class="num" style="width:160px">Valor</th></tr></thead>
        <tbody>${rowsDesc}</tbody>
        <tfoot><tr><td><strong>Total de Descontos</strong></td><td class="num"><strong>${_fmtBRL(totalDescontos)}</strong></td></tr></tfoot>
      </table>
    </div>

    <!-- Valor líquido em destaque -->
    <div class="hero-amount">
      <div class="hero-label">Valor Líquido a Receber</div>
      <div class="hero-value">${_fmtBRL(liquido)}</div>
      <div class="hero-hint">Base FGTS (informativa): ${_fmtBRL(totalProventos)} — Depósito FGTS (8%): ${_fmtBRL(fgts)}</div>
    </div>

    <!-- Assinatura -->
    <div class="section" style="margin-top:40px">
      <div style="display:flex;gap:32px;justify-content:space-between">
        <div style="flex:1;border-top:1px solid #94a3b8;padding-top:8px;text-align:center">
          <div style="font-size:12px;color:#475569">Assinatura do Funcionário</div>
          <div style="font-size:13px;margin-top:4px"><strong>${_h(emp.nome || "")}</strong></div>
        </div>
        <div style="flex:1;border-top:1px solid #94a3b8;padding-top:8px;text-align:center">
          <div style="font-size:12px;color:#475569">Assinatura da Empresa</div>
          <div style="font-size:13px;margin-top:4px"><strong>${_h(config.nomeEmpresa || config.empresa || "")}</strong></div>
        </div>
      </div>
    </div>

    <div class="watermark">Contracheque ${contracheque.id} · gerado por FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// ─── Vale — recibo simples imprimível ────────────────────────────────────────
function generateValeHTML(vale, employee) {
  const config = DB.get("erp:config") || {};
  const emp = employee || {};
  const data = vale.data ? new Date(vale.data + "T00:00:00").toLocaleDateString("pt-BR") : "—";
  const valor = Number(vale.valor) || 0;
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Vale — ${_h(emp.nome || "")} — ${data}</title>
<style>${_docStyles("#b45309")}</style>
</head>
<body>
<main class="page">
  <div class="page-inner">
    ${_docHeader(config, "Recibo de Vale (Adiantamento Salarial)", vale.id || "", `Data: ${data}`)}

    <div class="hero-amount">
      <div class="hero-label">Valor Recebido</div>
      <div class="hero-value">${_fmtBRL(valor)}</div>
      <div class="hero-hint">Será descontado do próximo contracheque</div>
    </div>

    <div class="section">
      <div class="section-title">Funcionário</div>
      <table>
        <tr><td style="width:30%"><strong>Nome</strong></td><td>${_h(emp.nome || "—")}</td></tr>
        ${emp.cpf ? `<tr><td><strong>CPF</strong></td><td>${_h(emp.cpf)}</td></tr>` : ""}
        ${emp.cargo ? `<tr><td><strong>Cargo</strong></td><td>${_h(emp.cargo)}</td></tr>` : ""}
        <tr><td><strong>Motivo</strong></td><td>${_h(vale.motivo || "—")}</td></tr>
        <tr><td><strong>Status</strong></td><td>${vale.status === "descontado" ? "Descontado" : "Pendente"}</td></tr>
      </table>
    </div>

    <p style="margin-top:32px;font-size:13px;line-height:1.6">
      Eu, <strong>${_h(emp.nome || "")}</strong>${emp.cpf ? `, portador do CPF <strong>${_h(emp.cpf)}</strong>,` : ""}
      declaro ter recebido nesta data, da empresa <strong>${_h(config.nomeEmpresa || config.empresa || "—")}</strong>,
      a importância de <strong>${_fmtBRL(valor)}</strong> a título de <strong>${_h(vale.motivo || "adiantamento salarial")}</strong>,
      que será descontado integralmente do meu próximo pagamento de salário.
    </p>

    <div class="section" style="margin-top:48px">
      <div style="border-top:1px solid #94a3b8;padding-top:8px;text-align:center;max-width:60%;margin:0 auto">
        <div style="font-size:12px;color:#475569">Assinatura do Funcionário</div>
        <div style="font-size:13px;margin-top:4px"><strong>${_h(emp.nome || "")}</strong></div>
      </div>
    </div>

    <div class="watermark">FrostERP · ${new Date().toLocaleString("pt-BR")}</div>
  </div>
</main>
${_actionBar()}
</body></html>`;
}

// ─── PROCESS MODULE (OS) ────────────────────────────────────────────────────

function ProcessModule({ user, dateFilter, addToast, clients, employees, reloadData }) {
  const [orders, setOrders] = useState([]);
  // ─── Cadastros integrados (produtos/estoque/serviços) ──────────────────
  // Carregamos os catálogos do DB para alimentar os pickers da OS:
  // serviço cadastrado vira opção pré-preenchida no card "Serviço";
  // produto cadastrado idem para "Peça/Material" — e também valida saldo de estoque.
  const [products, setProducts] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [serviceCatalog, setServiceCatalog] = useState([]);
  const reloadCatalogs = useCallback(() => {
    setProducts(DB.list("erp:product:"));
    setStocks(DB.list("erp:stock:"));
    setServiceCatalog(DB.list("erp:service:"));
  }, []);
  useEffect(() => { reloadCatalogs(); }, [reloadCatalogs]);
  // Index por id evita lookup O(N*M) nos pickers
  const productById = useMemo(() => {
    const m = new Map();
    products.forEach((p) => m.set(p.id, p));
    return m;
  }, [products]);
  const stockByProductId = useMemo(() => {
    const m = new Map();
    stocks.forEach((s) => m.set(s.produtoId, s));
    return m;
  }, [stocks]);
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

  // ─── Cadastro rápido de cliente direto da OS ───────────────────────────────
  // Mantém o usuário no fluxo: ao perceber que o cliente não está cadastrado,
  // abre um mini-formulário, salva em erp:client: e auto-seleciona na OS.
  const EMPTY_QUICK_CLIENT = {
    nome: "", tipo: "pf", cpf: "", cnpj: "",
    telefone: "", email: "",
    rua: "", numero: "", bairro: "", cidade: "", estado: "",
  };
  const [quickClientOpen, setQuickClientOpen] = useState(false);
  const [quickClient, setQuickClient] = useState(EMPTY_QUICK_CLIENT);

  const handleSaveQuickClient = useCallback(() => {
    if (!quickClient.nome.trim()) { addToast("Informe o nome do cliente.", "error"); return; }
    if (!quickClient.telefone.trim()) { addToast("Informe o telefone.", "error"); return; }

    const newClient = {
      id: genId(),
      nome: quickClient.nome.trim(),
      tipo: quickClient.tipo,
      cpf: quickClient.tipo === "pf" ? quickClient.cpf : "",
      cnpj: quickClient.tipo === "pj" ? quickClient.cnpj : "",
      telefone: quickClient.telefone,
      email: quickClient.email.trim(),
      endereco: {
        rua: quickClient.rua.trim(),
        numero: quickClient.numero.trim(),
        bairro: quickClient.bairro.trim(),
        cidade: quickClient.cidade.trim(),
        estado: quickClient.estado.trim(),
        cep: "",
      },
      observacoes: "",
      status: "ativo",
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:client:" + newClient.id, newClient);

    // Atualiza lista local + auto-seleciona o novo cliente na OS atual
    setAllClients((prev) => [...prev, newClient]);
    const enderecoStr = newClient.endereco.rua
      ? `${newClient.endereco.rua}${newClient.endereco.numero ? ", " + newClient.endereco.numero : ""}${newClient.endereco.bairro ? " - " + newClient.endereco.bairro : ""}${newClient.endereco.cidade ? " - " + newClient.endereco.cidade : ""}${newClient.endereco.estado ? "/" + newClient.endereco.estado : ""}`
      : "";
    setForm((f) => ({ ...f, clienteId: newClient.id, endereco: enderecoStr || f.endereco }));

    addToast(`Cliente ${newClient.nome} cadastrado.`, "success");
    setQuickClient(EMPTY_QUICK_CLIENT);
    setQuickClientOpen(false);
    if (reloadData) reloadData();
  }, [quickClient, addToast, reloadData]);

  // Cada OS pode conter múltiplos serviços e peças/materiais — cada linha tem valor próprio.
  // valorTotal = soma de todos os serviços + soma de todas as peças (qtd × valor unit).
  // Cada serviço tem seu próprio tipo de equipamento — uma OS pode ter
  // múltiplos serviços, cada um para um equipamento diferente.
  const emptyServico = {
    // servicoId opcional: quando preenchido, vincula a um serviço cadastrado em erp:service:
    servicoId: "",
    tipo: "Instalação",
    descricao: "",
    valor: "",
    equipamentoTipo: "central",
    equipamentoModelo: "",
    equipamentoCapacidade: "",
  };
  // Peças/materiais: nome obrigatório, quantidade e valor unitário opcionais.
  // produtoId/stockId opcionais: quando preenchidos, baixa automática no estoque ao salvar a OS.
  const emptyPeca = { produtoId: "", stockId: "", nome: "", quantidade: "1", valorUnit: "" };
  const emptyForm = {
    clienteId: "", endereco: "",
    servicos: [{ ...emptyServico }],
    pecas: [],
    // Equipamento agora vive dentro de cada serviço (não mais no nível da OS).
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
    // Migração: OS antigas têm tipo/valor soltos — convertemos para o array de serviços.
    // Equipamento por serviço: se vier vazio, herda do top-level (compat com OS antigas).
    const servicos = Array.isArray(row.servicos) && row.servicos.length > 0
      ? row.servicos.map((s) => ({
          servicoId: s.servicoId || "",
          tipo: s.tipo || "Instalação",
          descricao: s.descricao || "",
          valor: s.valor !== undefined && s.valor !== null ? String(s.valor) : "",
          equipamentoTipo: s.equipamentoTipo || row.equipamentoTipo || "central",
          equipamentoModelo: s.equipamentoModelo || row.equipamentoModelo || "",
          equipamentoCapacidade: s.equipamentoCapacidade || row.equipamentoCapacidade || row.equipamentoBTUs || "",
        }))
      : [{
          servicoId: "",
          tipo: row.tipo || "Instalação",
          descricao: row.descricao || "",
          valor: row.valor !== undefined && row.valor !== null ? String(row.valor) : "",
          equipamentoTipo: row.equipamentoTipo || "central",
          equipamentoModelo: row.equipamentoModelo || "",
          equipamentoCapacidade: row.equipamentoCapacidade || row.equipamentoBTUs || "",
        }];
    // Peças: estrutura { produtoId, stockId, nome, quantidade, valorUnit } — migra itensUtilizados antigo
    const pecas = Array.isArray(row.pecas) && row.pecas.length > 0
      ? row.pecas.map((p) => ({
          produtoId: p.produtoId || "",
          stockId: p.stockId || "",
          nome: p.nome || "",
          quantidade: p.quantidade !== undefined && p.quantidade !== null ? String(p.quantidade) : "1",
          valorUnit: p.valorUnit !== undefined && p.valorUnit !== null ? String(p.valorUnit) : "",
        }))
      : Array.isArray(row.itensUtilizados) && row.itensUtilizados.length > 0
        ? row.itensUtilizados.map((i) => ({
            produtoId: "",
            stockId: "",
            nome: i.nome || "",
            quantidade: i.quantidade !== undefined && i.quantidade !== null ? String(i.quantidade) : "1",
            valorUnit: i.valorUnit !== undefined && i.valorUnit !== null ? String(i.valorUnit) : "",
          }))
        : [];
    setForm({
      clienteId: row.clienteId || "",
      endereco: row.endereco || "",
      servicos,
      pecas,
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
        // Mantém vínculo com serviço cadastrado quando informado
        servicoId: s.servicoId || "",
        tipo: (s.tipo || "").trim(),
        descricao: (s.descricao || "").trim(),
        valor: parseFloat(String(s.valor || "0").replace(",", ".")) || 0,
        // Cada serviço carrega seu próprio tipo de equipamento
        equipamentoTipo: s.equipamentoTipo || "central",
        equipamentoModelo: (s.equipamentoModelo || "").trim(),
        equipamentoCapacidade: (s.equipamentoCapacidade || "").trim(),
      }))
      .filter((s) => s.tipo);

    if (!form.clienteId || servicosLimpos.length === 0) {
      addToast("Preencha o cliente e pelo menos um serviço.", "error");
      return;
    }

    // Normaliza peças/materiais — só mantém linhas com nome preenchido
    const pecasLimpas = (form.pecas || [])
      .map((p) => ({
        produtoId: p.produtoId || "",
        stockId: p.stockId || "",
        nome: (p.nome || "").trim(),
        quantidade: parseFloat(String(p.quantidade || "1").replace(",", ".")) || 1,
        valorUnit: parseFloat(String(p.valorUnit || "0").replace(",", ".")) || 0,
      }))
      .filter((p) => p.nome);

    // ─── Validação e cálculo do delta de estoque (peças com produtoId) ──────
    // Para cada produto, comparamos quantidade nova vs quantidade atual da OS
    // (apenas no modo edição). Saldo deve cobrir o consumo adicional.
    const prevPecasByProd = new Map();
    if (editing && Array.isArray(editing.pecas)) {
      editing.pecas.forEach((p) => {
        if (p.produtoId) {
          prevPecasByProd.set(p.produtoId, (prevPecasByProd.get(p.produtoId) || 0) + (Number(p.quantidade) || 0));
        }
      });
    }
    const newPecasByProd = new Map();
    pecasLimpas.forEach((p) => {
      if (p.produtoId) {
        newPecasByProd.set(p.produtoId, (newPecasByProd.get(p.produtoId) || 0) + p.quantidade);
      }
    });
    const allProdIds = new Set([...prevPecasByProd.keys(), ...newPecasByProd.keys()]);
    const stockOps = []; // {stk, delta, prod}
    for (const pid of allProdIds) {
      const prev = prevPecasByProd.get(pid) || 0;
      const next = newPecasByProd.get(pid) || 0;
      const delta = next - prev; // >0 = saída adicional; <0 = devolução
      if (delta === 0) continue;
      const stk = stocks.find((s) => s.produtoId === pid);
      const prod = productById.get(pid);
      if (!stk) {
        addToast(`Produto ${prod?.nome || ''} não possui estoque cadastrado.`, "error");
        return;
      }
      const saldoAtual = Number(stk.saldo) || 0;
      if (delta > 0 && delta > saldoAtual) {
        addToast(`Saldo insuficiente para ${prod?.nome || 'produto'}. Disponível: ${saldoAtual}`, "error");
        return;
      }
      stockOps.push({ stk, delta, prod });
    }

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

    // Compat: campos top-level de equipamento derivam do PRIMEIRO serviço
    // (apps/relatórios antigos ainda leem os.equipamentoTipo em vez de iterar serviços)
    const primeiro = servicosLimpos[0] || {};
    const formEquipTipo = primeiro.equipamentoTipo || "central";
    const formEquipModelo = primeiro.equipamentoModelo || "";
    const equipCapacidade = primeiro.equipamentoCapacidade || "";
    const equipBTUs = formEquipTipo === "central" ? equipCapacidade : "";

    let osNumeroNovo = "";
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
        equipamentoTipo: formEquipTipo,
        equipamentoModelo: formEquipModelo,
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
      // Se a OS já estava finalizada, propaga mudança de valor/dados para o Financeiro
      if (["finalizado", "concluido"].includes(updated.status)) {
        syncOSToFinance(updated);
      }
      addToast("OS atualizada.", "success");
    } else {
      const numero = getNextNumber("OS", orders);
      osNumeroNovo = numero; // captura para o log do estoque
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
        equipamentoTipo: formEquipTipo,
        equipamentoModelo: formEquipModelo,
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

    // ─── Aplica baixas/devoluções no estoque após salvar a OS ──────────────
    // Cada operação registra também histórico em erp:stockMov para rastreio.
    const osNumeroLog = editing ? editing.numero : (osNumeroNovo || "(nova)");
    stockOps.forEach(({ stk, delta, prod }) => {
      const saldoAtual = Number(stk.saldo) || 0;
      const novoSaldo = saldoAtual - delta;
      DB.set("erp:stock:" + stk.id, {
        ...stk,
        saldo: novoSaldo,
        ultimaMovimentacao: new Date().toISOString(),
      });
      const mov = {
        id: genId(),
        produtoId: stk.produtoId,
        stockId: stk.id,
        tipo: delta > 0 ? "saida" : "entrada",
        quantidade: Math.abs(delta),
        saldoAnterior: saldoAtual,
        saldoNovo: novoSaldo,
        motivo: `OS ${osNumeroLog || '(nova)'} - ${delta > 0 ? 'Consumo em OS' : 'Devolução de OS'}${prod?.nome ? ' - ' + prod.nome : ''}`,
        data: toISODate(new Date()),
        usuarioId: user?.id || "",
        usuarioNome: user?.nome || "",
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:stockMov:" + mov.id, mov);
    });

    setModalOpen(false);
    loadOrders();
    reloadCatalogs();
    if (reloadData) reloadData();
  }, [form, editing, orders, allClients, tecnicos, loadOrders, addToast, stocks, productById, user, reloadCatalogs, reloadData]);

  const handleDelete = useCallback((row) => {
    setConfirmDelete(row);
  }, []);

  const confirmDeleteAction = useCallback(() => {
    if (confirmDelete) {
      // ─── Devolução de peças ao estoque ────────────────────────────────────
      // Ao excluir uma OS, qualquer peça vinculada a um produto cadastrado
      // tem sua quantidade devolvida ao saldo (entrada com motivo de cancelamento).
      const pecasOS = Array.isArray(confirmDelete.pecas) ? confirmDelete.pecas : [];
      const devolverPorProd = new Map();
      pecasOS.forEach((p) => {
        if (p.produtoId) {
          const q = Number(p.quantidade) || 0;
          if (q > 0) devolverPorProd.set(p.produtoId, (devolverPorProd.get(p.produtoId) || 0) + q);
        }
      });
      devolverPorProd.forEach((qtd, pid) => {
        const stk = stocks.find((s) => s.produtoId === pid);
        if (!stk) return;
        const saldoAtual = Number(stk.saldo) || 0;
        const novoSaldo = saldoAtual + qtd;
        DB.set("erp:stock:" + stk.id, { ...stk, saldo: novoSaldo, ultimaMovimentacao: new Date().toISOString() });
        const prod = productById.get(pid);
        const mov = {
          id: genId(),
          produtoId: pid,
          stockId: stk.id,
          tipo: "entrada",
          quantidade: qtd,
          saldoAnterior: saldoAtual,
          saldoNovo: novoSaldo,
          motivo: `OS ${confirmDelete.numero || ''} - Devolução por exclusão${prod?.nome ? ' - ' + prod.nome : ''}`,
          data: toISODate(new Date()),
          usuarioId: user?.id || "",
          usuarioNome: user?.nome || "",
          createdAt: new Date().toISOString(),
        };
        DB.set("erp:stockMov:" + mov.id, mov);
      });
      DB.delete("erp:os:" + confirmDelete.id);
      addToast(`OS excluída${devolverPorProd.size > 0 ? ` (${devolverPorProd.size} item(s) devolvido(s) ao estoque)` : ""}.`, "success");
      setConfirmDelete(null);
      loadOrders();
      reloadCatalogs();
      if (reloadData) reloadData();
    }
  }, [confirmDelete, loadOrders, addToast, stocks, productById, user, reloadCatalogs, reloadData]);

  const changeStatus = useCallback((os, newStatus) => {
    const updated = { ...os, status: newStatus, updatedAt: new Date().toISOString() };
    if (newStatus === "finalizado") {
      updated.dataConclusao = new Date().toISOString();
    }
    DB.set("erp:os:" + updated.id, updated);
    // OS finalizada gera receita no Financeiro automaticamente
    if (newStatus === "finalizado") {
      syncOSToFinance(updated);
    }
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
        <select name="filterStatus"
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
          <select name="filterTecnico"
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
          <select name="filterCliente"
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
            <div className="flex gap-2">
              <Combobox
                className="flex-1"
                value={form.clienteId}
                onChange={(cid) => {
                  const c = (allClients || []).find((cl) => cl.id === cid);
                  setForm({
                    ...form,
                    clienteId: cid,
                    endereco: c?.endereco ? `${c.endereco.rua}, ${c.endereco.bairro} - ${c.endereco.cidade}/${c.endereco.estado}` : form.endereco,
                  });
                }}
                options={(allClients || []).map((c) => ({
                  value: c.id,
                  label: c.nome,
                  // Permite buscar por CPF/CNPJ e telefone também
                  searchText: `${c.cpf || ""} ${c.cnpj || ""} ${c.telefone || ""}`,
                }))}
                placeholder="Buscar cliente por nome, CPF/CNPJ ou telefone..."
                emptyLabel="— Nenhum cliente selecionado —"
              />
              <button
                type="button"
                onClick={() => { setQuickClient(EMPTY_QUICK_CLIENT); setQuickClientOpen(true); }}
                className="px-3 py-2.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition flex items-center gap-1 shrink-0"
                title="Cadastrar novo cliente"
              >
                + Novo
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Endereço</label>
            <input name="endereco"
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
              {(form.servicos || []).map((s, idx) => {
                const equipMeta = EQUIPMENT_TYPES[s.equipamentoTipo] || EQUIPMENT_TYPES.central;
                return (
                  <div key={idx} className="bg-gray-700/40 border border-gray-700 rounded-lg p-3 space-y-2.5">
                    {/* Cabeçalho do card com índice + remover */}
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-300">
                        Serviço #{idx + 1}
                      </span>
                      <button
                        type="button"
                        onClick={() => removeServico(idx)}
                        disabled={(form.servicos || []).length <= 1}
                        className="p-1.5 rounded-lg text-gray-400 hover:text-red-400 hover:bg-gray-700 transition disabled:opacity-30 disabled:cursor-not-allowed inline-flex items-center justify-center"
                        aria-label="Remover serviço"
                        title="Remover serviço"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                      </button>
                    </div>

                    {/* Picker de serviço cadastrado — preenche tipo/descrição/valor automaticamente */}
                    {serviceCatalog.length > 0 && (
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">Serviço cadastrado (opcional)</label>
                        <Combobox
                          value={s.servicoId || ""}
                          onChange={(id) => {
                            if (!id) { updateServico(idx, { servicoId: "" }); return; }
                            const sv = serviceCatalog.find((x) => x.id === id);
                            if (sv) {
                              const tipoMatched = SERVICE_TYPES.find((t) => t.toLowerCase() === (sv.categoria || "").toLowerCase()) || s.tipo;
                              updateServico(idx, {
                                servicoId: id,
                                tipo: tipoMatched,
                                descricao: sv.nome || s.descricao,
                                valor: sv.precoBase != null ? String(sv.precoBase) : s.valor,
                              });
                            }
                          }}
                          options={serviceCatalog
                            .filter((sv) => (sv.status || "ativo") === "ativo")
                            .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""))
                            .map((sv) => ({
                              value: sv.id,
                              label: `${sv.nome}${sv.precoBase ? ` — ${formatCurrency(Number(sv.precoBase) || 0)}` : ""}`,
                              searchText: `${sv.codigo || ""} ${sv.categoria || ""}`,
                            }))}
                          placeholder="Buscar serviço por nome, código ou categoria..."
                          emptyLabel="— Personalizado —"
                          size="sm"
                        />
                      </div>
                    )}

                    {/* Linha 1: Tipo serviço | Descrição | Valor */}
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-12 sm:col-span-3">
                        <label className="block text-xs text-gray-400 mb-1">Tipo</label>
                        <select name="tipo"
                          value={s.tipo}
                          onChange={(e) => updateServico(idx, { tipo: e.target.value, servicoId: "" })}
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                        >
                          {SERVICE_TYPES.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                      </div>
                      <div className="col-span-12 sm:col-span-6">
                        <label className="block text-xs text-gray-400 mb-1">Descrição</label>
                        <input name="descricao"
                          type="text"
                          value={s.descricao}
                          onChange={(e) => updateServico(idx, { descricao: e.target.value })}
                          placeholder="Detalhe do serviço (opcional)"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div className="col-span-12 sm:col-span-3">
                        <label className="block text-xs text-gray-400 mb-1">Valor (R$)</label>
                        <input name="valor"
                          type="number"
                          step="0.01"
                          min="0"
                          value={s.valor}
                          onChange={(e) => updateServico(idx, { valor: e.target.value })}
                          placeholder="0,00"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                    </div>

                    {/* Linha 2: Equipamento por serviço — tipo / picker de modelo cadastrado */}
                    <div className="grid grid-cols-12 gap-2 pt-2 border-t border-gray-700/60">
                      <div className="col-span-12 sm:col-span-5">
                        <label className="block text-xs text-gray-400 mb-1">Tipo de Equipamento</label>
                        <select name="equipamentoTipo"
                          value={s.equipamentoTipo || "central"}
                          onChange={(e) => updateServico(idx, { equipamentoTipo: e.target.value, equipamentoModelo: "", equipamentoCapacidade: "" })}
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                        >
                          {Object.entries(EQUIPMENT_TYPES).map(([key, meta]) => (
                            <option key={key} value={key}>{meta.label}</option>
                          ))}
                        </select>
                      </div>
                      {/* Picker de modelo cadastrado: ao escolher, preenche modelo + capacidade abaixo */}
                      <div className="col-span-12 sm:col-span-7">
                        <label className="block text-xs text-gray-400 mb-1">Modelo Cadastrado</label>
                        <Combobox
                          value={(() => {
                            const list = EQUIPMENT_CATALOG_BY_KEY[s.equipamentoTipo || "central"] || [];
                            const match = list.find((it) =>
                              (`${it.marca} ${it.modelo}`.trim() === (s.equipamentoModelo || "").trim()) &&
                              (String(it.capacidade) === String(s.equipamentoCapacidade || ""))
                            );
                            return match ? `${match.marca}|${match.modelo}|${match.capacidade}` : "";
                          })()}
                          onChange={(v) => {
                            if (!v) {
                              updateServico(idx, { equipamentoModelo: "", equipamentoCapacidade: "" });
                              return;
                            }
                            const [marca, modelo, capacidade] = v.split("|");
                            const modeloFull = `${marca}${marca && modelo ? " " : ""}${modelo}`.trim();
                            updateServico(idx, { equipamentoModelo: modeloFull, equipamentoCapacidade: capacidade || "" });
                          }}
                          options={(EQUIPMENT_CATALOG_BY_KEY[s.equipamentoTipo || "central"] || []).map((it) => ({
                            value: `${it.marca}|${it.modelo}|${it.capacidade}`,
                            label: it.label,
                            searchText: `${it.marca} ${it.modelo} ${it.capacidade} ${it.voltagem} ${it.descricao || ""}`,
                          }))}
                          placeholder="Buscar modelo por marca, capacidade, voltagem..."
                          emptyLabel="— Manual / Personalizado —"
                          size="sm"
                        />
                      </div>
                    </div>
                    {/* Linha 3: Modelo + Capacidade (livres — preenchidos pelo picker ou manualmente) */}
                    <div className="grid grid-cols-12 gap-2">
                      <div className="col-span-7 sm:col-span-9">
                        <label className="block text-xs text-gray-400 mb-1">Modelo</label>
                        <input name="equipamentoModelo"
                          type="text"
                          value={s.equipamentoModelo || ""}
                          onChange={(e) => updateServico(idx, { equipamentoModelo: e.target.value })}
                          placeholder="Marca/modelo (livre)"
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                      <div className="col-span-5 sm:col-span-3">
                        <label className="block text-xs text-gray-400 mb-1">{equipMeta.capacityLabel}</label>
                        <input name="equipamentoCapacidade"
                          type="text"
                          value={s.equipamentoCapacidade || ""}
                          onChange={(e) => updateServico(idx, { equipamentoCapacidade: e.target.value })}
                          placeholder={equipMeta.capacityPlaceholder}
                          className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
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
                  // Saldo disponível considerando consumo já registrado nesta OS (modo edição)
                  const stkLinha = p.produtoId ? stockByProductId.get(p.produtoId) : null;
                  const saldoBase = Number(stkLinha?.saldo) || 0;
                  let qtdAtualOSItem = 0;
                  if (editing && Array.isArray(editing.pecas)) {
                    editing.pecas.filter((ep) => ep.produtoId === p.produtoId).forEach((ep) => {
                      qtdAtualOSItem += Number(ep.quantidade) || 0;
                    });
                  }
                  const saldoDisponivel = saldoBase + qtdAtualOSItem; // o que esta OS já reservou volta ao limite
                  const insuficiente = p.produtoId && qtd > saldoDisponivel;
                  return (
                    <div key={idx} className="grid grid-cols-12 gap-2 items-end bg-gray-700/40 border border-gray-700 rounded-lg p-2.5">
                      <div className="col-span-12 sm:col-span-5 space-y-1.5">
                        <label className="block text-xs text-gray-400 mb-1">Peça/Material</label>
                        {/* Picker de produto cadastrado — quando selecionado, baixa de estoque é automática */}
                        {products.length > 0 && (
                          <select
                            value={p.produtoId || ""}
                            onChange={(e) => {
                              const id = e.target.value;
                              if (!id) {
                                updatePeca(idx, { produtoId: "", stockId: "" });
                                return;
                              }
                              const prod = productById.get(id);
                              const stk = stockByProductId.get(id);
                              if (prod) {
                                updatePeca(idx, {
                                  produtoId: id,
                                  stockId: stk?.id || "",
                                  nome: prod.nome,
                                  valorUnit: prod.precoVenda != null ? String(prod.precoVenda) : (p.valorUnit || ""),
                                });
                              }
                            }}
                            className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500 transition"
                          >
                            <option value="">— Avulso (digite manual) —</option>
                            {products
                              .filter((pr) => (pr.status || "ativo") === "ativo")
                              .sort((a, b) => (a.nome || "").localeCompare(b.nome || ""))
                              .map((pr) => {
                                const stk = stockByProductId.get(pr.id);
                                const saldo = Number(stk?.saldo) || 0;
                                return (
                                  <option key={pr.id} value={pr.id}>
                                    {pr.nome} (Saldo: {saldo} {pr.unidade || "UN"})
                                  </option>
                                );
                              })}
                          </select>
                        )}
                        <input name="nome"
                          type="text"
                          value={p.nome}
                          onChange={(e) => updatePeca(idx, { nome: e.target.value, produtoId: "", stockId: "" })}
                          placeholder="Ex: Compressor, Gás R-410A, Filtro..."
                          readOnly={!!p.produtoId}
                          className={`w-full bg-gray-700 border rounded-lg px-3 py-2 text-sm text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition ${p.produtoId ? "border-gray-700 opacity-70" : "border-gray-600"}`}
                        />
                        {p.produtoId && (
                          <p className={`text-xs ${insuficiente ? "text-red-400" : "text-emerald-400"}`}>
                            {insuficiente
                              ? `⚠ Saldo insuficiente. Disponível: ${saldoDisponivel}`
                              : `Saldo disponível: ${saldoDisponivel}`}
                          </p>
                        )}
                      </div>
                      <div className="col-span-4 sm:col-span-2">
                        <label className="block text-xs text-gray-400 mb-1">Qtd</label>
                        <input name="quantidade"
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
                        <input name="valorUnit"
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

          {/* Bloco de equipamento global removido — agora é por serviço (ver acima). */}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Técnico</label>
              <Combobox
                value={form.tecnicoId}
                onChange={(v) => setForm({ ...form, tecnicoId: v })}
                options={tecnicos.map((t) => ({
                  value: t.id,
                  label: t.nome,
                  searchText: `${t.email || ""} ${t.telefone || ""}`,
                }))}
                placeholder="Buscar técnico..."
                emptyLabel="— Sem técnico —"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Data Agendada</label>
              <input name="dataAgendada"
                type="date"
                value={form.dataAgendada}
                onChange={(e) => setForm({ ...form, dataAgendada: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              {/* Hora agendada — usada pelo app do técnico para saber horário do compromisso */}
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hora Agendada</label>
              <input name="horaAgendada"
                type="time"
                value={form.horaAgendada || ""}
                onChange={(e) => setForm({ ...form, horaAgendada: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Relatos do Cliente</label>
            <textarea name="observacoes"
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

      {/* ─── Modal Cadastro Rápido de Cliente ─── */}
      {quickClientOpen && (
        <Modal isOpen={true} title="Novo Cliente" onClose={() => setQuickClientOpen(false)} size="md">
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Tipo</label>
                <select
                  value={quickClient.tipo}
                  onChange={(e) => setQuickClient({ ...quickClient, tipo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                >
                  <option value="pf">Pessoa Física</option>
                  <option value="pj">Pessoa Jurídica</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">{quickClient.tipo === "pj" ? "CNPJ" : "CPF"}</label>
                <input
                  type="text"
                  value={quickClient.tipo === "pj" ? quickClient.cnpj : quickClient.cpf}
                  onChange={(e) => {
                    const v = e.target.value;
                    setQuickClient(quickClient.tipo === "pj"
                      ? { ...quickClient, cnpj: formatCNPJ(v) }
                      : { ...quickClient, cpf: formatCPF(v) });
                  }}
                  placeholder={quickClient.tipo === "pj" ? "00.000.000/0000-00" : "000.000.000-00"}
                  maxLength={quickClient.tipo === "pj" ? 18 : 14}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-300 mb-1">Nome / Razão Social *</label>
              <input
                type="text"
                value={quickClient.nome}
                onChange={(e) => setQuickClient({ ...quickClient, nome: e.target.value })}
                placeholder="Nome completo"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Telefone *</label>
                <input
                  type="text"
                  value={quickClient.telefone}
                  onChange={(e) => setQuickClient({ ...quickClient, telefone: formatPhone(e.target.value) })}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Email</label>
                <input
                  type="email"
                  value={quickClient.email}
                  onChange={(e) => setQuickClient({ ...quickClient, email: e.target.value })}
                  placeholder="email@exemplo.com"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2">
                <label className="block text-xs font-medium text-gray-300 mb-1">Rua</label>
                <input
                  type="text"
                  value={quickClient.rua}
                  onChange={(e) => setQuickClient({ ...quickClient, rua: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Número</label>
                <input
                  type="text"
                  value={quickClient.numero}
                  onChange={(e) => setQuickClient({ ...quickClient, numero: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Bairro</label>
                <input
                  type="text"
                  value={quickClient.bairro}
                  onChange={(e) => setQuickClient({ ...quickClient, bairro: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">Cidade</label>
                <input
                  type="text"
                  value={quickClient.cidade}
                  onChange={(e) => setQuickClient({ ...quickClient, cidade: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-300 mb-1">UF</label>
                <input
                  type="text"
                  value={quickClient.estado}
                  onChange={(e) => setQuickClient({ ...quickClient, estado: e.target.value.toUpperCase().slice(0, 2) })}
                  maxLength={2}
                  placeholder="SP"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white text-sm focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setQuickClientOpen(false)}
                className="px-4 py-2 text-sm rounded-lg bg-gray-700 hover:bg-gray-600 text-white transition"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveQuickClient}
                className="px-4 py-2 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition"
              >
                Cadastrar e Selecionar
              </button>
            </div>
          </div>
        </Modal>
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
                <div className="font-semibold">
                  {(() => {
                    // Lista equipamentos únicos a partir dos serviços (modelo novo).
                    // Fallback para campo top-level se a OS antiga não tiver por serviço.
                    const list = [...new Set((reviewing.servicos || [])
                      .map((s) => EQUIPMENT_TYPES[s.equipamentoTipo]?.label)
                      .filter(Boolean))];
                    if (list.length > 0) return list.join(", ");
                    return EQUIPMENT_TYPES[reviewing.equipamentoTipo]?.label || "—";
                  })()}
                </div>
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
                  // Cria transação de receita pendente no Financeiro
                  syncOSToFinance(updated);
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
              <input name="data"
                type="date"
                value={form.data}
                onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hora Início *</label>
              <input name="horaInicio"
                type="time"
                value={form.horaInicio}
                onChange={(e) => setForm({ ...form, horaInicio: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Hora Fim *</label>
              <input name="horaFim"
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
              <Combobox
                value={form.clienteId}
                onChange={(cid) => {
                  const c = (allClients || []).find((cl) => cl.id === cid);
                  setForm({
                    ...form,
                    clienteId: cid,
                    endereco: c?.endereco ? `${c.endereco.rua}, ${c.endereco.bairro}` : form.endereco,
                  });
                }}
                options={(allClients || []).map((c) => ({
                  value: c.id,
                  label: c.nome,
                  searchText: `${c.cpf || ""} ${c.cnpj || ""} ${c.telefone || ""}`,
                }))}
                placeholder="Buscar cliente..."
                emptyLabel="— Nenhum cliente —"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Técnico *</label>
              <Combobox
                value={form.tecnicoId}
                onChange={(v) => setForm({ ...form, tecnicoId: v })}
                options={tecnicos.map((t) => ({
                  value: t.id,
                  label: t.nome,
                  searchText: `${t.email || ""} ${t.telefone || ""}`,
                }))}
                placeholder="Buscar técnico..."
                emptyLabel="— Nenhum técnico —"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo de Serviço</label>
              <select name="tipo"
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
              <input name="endereco"
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
            <textarea name="observacoes"
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

const PRODUTO_CATEGORIAS = ["Peça", "Equipamento", "Gás Refrigerante", "Acessório", "Ferramenta", "Consumível", "Outro"];
const PRODUTO_UNIDADES = ["UN", "PC", "CX", "KG", "G", "L", "ML", "M", "M²", "M³", "PAR"];
const FORNECEDOR_CATEGORIAS = ["Peças", "Equipamentos", "Gás Refrigerante", "Ferramentas", "Serviços", "Frete", "Outros"];
const SERVICO_CATEGORIAS = ["Manutenção", "Instalação", "Limpeza", "Solda", "Recarga de Gás", "Inspeção", "Projeto", "Outros"];
const SERVICO_UNIDADES = ["Serviço", "Hora", "Visita", "Diária", "M²"];
const STOCK_MOV_TIPOS = { entrada: "Entrada", saida: "Saída", ajuste: "Ajuste" };
const MOV_TIPO_COLOR = { entrada: "text-green-400", saida: "text-red-400", ajuste: "text-yellow-400" };

// Formulários vazios mantidos no escopo do módulo: estabilizam useCallback (deps reais ficam vazias)
// e evitam recriar o objeto em cada render do CadastroModule.
const EMPTY_SUPPLIER_FORM = {
  nome: "", tipo: "pj", cpf: "", cnpj: "", ie: "",
  contato: "", telefone: "", email: "",
  categoria: "Peças",
  rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "",
  observacoes: "", status: "ativo",
};
const EMPTY_PRODUCT_FORM = {
  codigo: "", codigoBarras: "", nome: "",
  categoria: "Peça", unidade: "UN",
  precoCusto: "", precoVenda: "",
  fornecedorId: "", ncm: "",
  descricao: "", status: "ativo",
};
const EMPTY_STOCK_FORM = {
  produtoId: "",
  saldo: "0",
  estoqueMinimo: "0",
  estoqueMaximo: "",
  localizacao: "",
  observacoes: "",
};
const EMPTY_SERVICE_FORM = {
  codigo: "", nome: "",
  categoria: "Manutenção", unidade: "Serviço",
  precoBase: "", duracaoMin: "60",
  descricao: "", status: "ativo",
};

function CadastroModule({ user, addToast, reloadData }) {
  const [activeTab, setActiveTab] = useState("clientes");
  const [clients, setClients] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [products, setProducts] = useState([]);
  const [stocks, setStocks] = useState([]);
  const [stockMovs, setStockMovs] = useState([]);
  const [services, setServices] = useState([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [confirmDelete, setConfirmDelete] = useState(null);
  const [search, setSearch] = useState("");
  const [detailView, setDetailView] = useState(null);
  const [detailTab, setDetailTab] = useState("dados");
  // Modal extra dedicado a movimentação de estoque (entrada/saída/ajuste)
  const [movModal, setMovModal] = useState(null);

  const loadClients = useCallback(() => { setClients(DB.list("erp:client:")); }, []);
  const loadEmployees = useCallback(() => { setEmployees(DB.list("erp:employee:")); }, []);
  const loadSuppliers = useCallback(() => { setSuppliers(DB.list("erp:supplier:")); }, []);
  const loadProducts = useCallback(() => { setProducts(DB.list("erp:product:")); }, []);
  const loadStocks = useCallback(() => { setStocks(DB.list("erp:stock:")); }, []);
  const loadStockMovs = useCallback(() => { setStockMovs(DB.list("erp:stockMov:")); }, []);
  const loadServices = useCallback(() => { setServices(DB.list("erp:service:")); }, []);

  useEffect(() => {
    loadClients();
    loadEmployees();
    loadSuppliers();
    loadProducts();
    loadStocks();
    loadStockMovs();
    loadServices();
  }, [loadClients, loadEmployees, loadSuppliers, loadProducts, loadStocks, loadStockMovs, loadServices]);

  // ─── Client Form ───
  // rg: apenas para pessoa física
  const emptyClientForm = {
    nome: "", tipo: "pf", cpf: "", rg: "", cnpj: "", telefone: "", email: "",
    rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "",
    observacoes: "",
  };

  // Funcionário agora tem endereço completo (rua, número, bairro, cidade, estado, CEP)
  // descontaINSS/IRRF e dependentes alimentam o cálculo automático do contracheque
  // (módulo Folha de Pagamento). MEI/autônomo costuma vir com ambos false.
  const emptyEmployeeForm = {
    nome: "", cpf: "", rg: "", telefone: "", email: "",
    cargo: "Técnico em Refrigeração", salario: "", dataAdmissao: toISODate(new Date()), status: "ativo",
    rua: "", numero: "", bairro: "", cidade: "", estado: "", cep: "",
    descontaINSS: true, descontaIRRF: true, dependentes: 0,
  };

  const [clientForm, setClientForm] = useState(emptyClientForm);
  const [employeeForm, setEmployeeForm] = useState(emptyEmployeeForm);
  const [supplierForm, setSupplierForm] = useState(EMPTY_SUPPLIER_FORM);
  const [productForm, setProductForm] = useState(EMPTY_PRODUCT_FORM);
  const [stockForm, setStockForm] = useState(EMPTY_STOCK_FORM);
  const [serviceForm, setServiceForm] = useState(EMPTY_SERVICE_FORM);
  const [movForm, setMovForm] = useState({ tipo: "entrada", quantidade: "", motivo: "", data: toISODate(new Date()) });

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

  const filteredSuppliers = useMemo(() => {
    const sorted = [...suppliers].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter(
      (f) =>
        (f.nome || "").toLowerCase().includes(s) ||
        (f.cnpj || "").replace(/\D/g, "").includes(s.replace(/\D/g, "")) ||
        (f.cpf || "").replace(/\D/g, "").includes(s.replace(/\D/g, "")) ||
        (f.contato || "").toLowerCase().includes(s) ||
        (f.categoria || "").toLowerCase().includes(s) ||
        (f.telefone || "").replace(/\D/g, "").includes(s.replace(/\D/g, ""))
    );
  }, [suppliers, search]);

  const filteredProducts = useMemo(() => {
    const sorted = [...products].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter(
      (p) =>
        (p.nome || "").toLowerCase().includes(s) ||
        (p.codigo || "").toLowerCase().includes(s) ||
        (p.codigoBarras || "").toLowerCase().includes(s) ||
        (p.categoria || "").toLowerCase().includes(s)
    );
  }, [products, search]);

  // Index por id evita lookup O(N*M) ao enriquecer estoques com dados do produto
  const productsById = useMemo(() => {
    const map = new Map();
    products.forEach((p) => map.set(p.id, p));
    return map;
  }, [products]);

  const stockRows = useMemo(() => {
    return stocks.map((st) => {
      const prod = productsById.get(st.produtoId);
      const saldo = Number(st.saldo) || 0;
      const min = Number(st.estoqueMinimo) || 0;
      const custo = Number(prod?.precoCusto) || 0;
      const status = saldo <= 0 ? "zerado" : saldo <= min ? "critico" : "ok";
      return {
        ...st,
        nome: prod?.nome || "(produto removido)",
        produtoNome: prod?.nome || "(produto removido)",
        produtoCodigo: prod?.codigo || "—",
        unidade: prod?.unidade || "UN",
        categoriaProduto: prod?.categoria || "—",
        precoCusto: custo,
        valorTotal: saldo * custo,
        statusEstoque: status,
      };
    });
  }, [stocks, productsById]);

  const filteredStocks = useMemo(() => {
    const sorted = [...stockRows].sort((a, b) => (a.produtoNome || "").localeCompare(b.produtoNome || ""));
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter(
      (st) =>
        (st.produtoNome || "").toLowerCase().includes(s) ||
        (st.produtoCodigo || "").toLowerCase().includes(s) ||
        (st.localizacao || "").toLowerCase().includes(s)
    );
  }, [stockRows, search]);

  const filteredServices = useMemo(() => {
    const sorted = [...services].sort((a, b) => (a.nome || "").localeCompare(b.nome || ""));
    if (!search.trim()) return sorted;
    const s = search.toLowerCase();
    return sorted.filter(
      (sv) =>
        (sv.nome || "").toLowerCase().includes(s) ||
        (sv.codigo || "").toLowerCase().includes(s) ||
        (sv.categoria || "").toLowerCase().includes(s)
    );
  }, [services, search]);

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
      cargo: row.cargo || "Técnico em Refrigeração",
      salario: row.salario || "",
      dataAdmissao: row.dataAdmissao || toISODate(new Date()),
      status: row.status || "ativo",
      rua: row.endereco?.rua || "",
      numero: row.endereco?.numero || "",
      bairro: row.endereco?.bairro || "",
      cidade: row.endereco?.cidade || "",
      estado: row.endereco?.estado || "",
      cep: row.endereco?.cep || "",
      // Flags fiscais — preserva default true em registros antigos (sem o campo)
      descontaINSS: row.descontaINSS !== false,
      descontaIRRF: row.descontaIRRF !== false,
      dependentes: row.dependentes || 0,
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
      // Deriva tipo a partir do cargo — controla quais módulos o user vê e
      // se entra no relatório de produtividade do técnico.
      tipo: CARGOS_TECNICOS.includes(employeeForm.cargo) ? "tecnico"
          : CARGOS_GERENCIA.includes(employeeForm.cargo) ? "gerente"
          : "administrativo",
      salario: parseFloat(String(employeeForm.salario).replace(",", ".")) || 0,
      // Flags fiscais — controlam se o contracheque desconta INSS/IRRF deste
      // funcionário. CLT desconta os dois (true/true). MEI/autônomo/PJ pode
      // ter ambos false. Default true pra manter comportamento de folha CLT.
      descontaINSS: employeeForm.descontaINSS !== false,
      descontaIRRF: employeeForm.descontaIRRF !== false,
      dependentes: Number(employeeForm.dependentes) || 0,
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

  // ─── Supplier (Fornecedor) CRUD ───
  const openCreateSupplier = useCallback(() => {
    setEditing(null);
    setSupplierForm(EMPTY_SUPPLIER_FORM);
    setModalOpen(true);
  }, []);

  const openEditSupplier = useCallback((row) => {
    setEditing(row);
    setSupplierForm({
      nome: row.nome || "",
      tipo: row.tipo || "pj",
      cpf: row.cpf || "",
      cnpj: row.cnpj || "",
      ie: row.ie || "",
      contato: row.contato || "",
      telefone: row.telefone || "",
      email: row.email || "",
      categoria: row.categoria || "Peças",
      rua: row.endereco?.rua || "",
      numero: row.endereco?.numero || "",
      bairro: row.endereco?.bairro || "",
      cidade: row.endereco?.cidade || "",
      estado: row.endereco?.estado || "",
      cep: row.endereco?.cep || "",
      observacoes: row.observacoes || "",
      status: row.status || "ativo",
    });
    setModalOpen(true);
  }, []);

  const handleSaveSupplier = useCallback(() => {
    if (!supplierForm.nome.trim()) { addToast("Informe o nome do fornecedor.", "error"); return; }
    if (!supplierForm.telefone.trim()) { addToast("Informe o telefone do fornecedor.", "error"); return; }

    const data = {
      nome: supplierForm.nome.trim(),
      tipo: supplierForm.tipo,
      cpf: supplierForm.tipo === "pf" ? supplierForm.cpf : "",
      cnpj: supplierForm.tipo === "pj" ? supplierForm.cnpj : "",
      ie: supplierForm.ie.trim(),
      contato: supplierForm.contato.trim(),
      telefone: supplierForm.telefone,
      email: supplierForm.email.trim(),
      categoria: supplierForm.categoria,
      endereco: {
        rua: supplierForm.rua.trim(),
        numero: supplierForm.numero.trim(),
        bairro: supplierForm.bairro.trim(),
        cidade: supplierForm.cidade.trim(),
        estado: supplierForm.estado.trim(),
        cep: supplierForm.cep.trim(),
      },
      observacoes: supplierForm.observacoes.trim(),
      status: supplierForm.status,
    };

    if (editing) {
      DB.set("erp:supplier:" + editing.id, { ...editing, ...data, updatedAt: new Date().toISOString() });
      addToast("Fornecedor atualizado com sucesso.", "success");
    } else {
      const newRow = { ...data, id: genId(), createdAt: new Date().toISOString() };
      DB.set("erp:supplier:" + newRow.id, newRow);
      addToast(`Fornecedor ${newRow.nome} cadastrado com sucesso.`, "success");
    }
    setModalOpen(false);
    loadSuppliers();
    if (reloadData) reloadData();
  }, [supplierForm, editing, loadSuppliers, addToast, reloadData]);

  const confirmDeleteSupplierAction = useCallback(() => {
    if (!confirmDelete) return;
    // Bloqueia exclusão de fornecedor referenciado por produtos — mantém integridade referencial
    const linkedCount = products.filter((p) => p.fornecedorId === confirmDelete.id).length;
    if (linkedCount > 0) {
      addToast(`Fornecedor possui ${linkedCount} produto(s) vinculado(s). Remova-os antes.`, "error");
      setConfirmDelete(null);
      return;
    }
    DB.delete("erp:supplier:" + confirmDelete.id);
    addToast("Fornecedor excluído.", "success");
    setConfirmDelete(null);
    loadSuppliers();
    if (reloadData) reloadData();
  }, [confirmDelete, products, loadSuppliers, addToast, reloadData]);

  // ─── Product (Produto) CRUD ───
  const openCreateProduct = useCallback(() => {
    setEditing(null);
    setProductForm(EMPTY_PRODUCT_FORM);
    setModalOpen(true);
  }, []);

  const openEditProduct = useCallback((row) => {
    setEditing(row);
    setProductForm({
      codigo: row.codigo || "",
      codigoBarras: row.codigoBarras || "",
      nome: row.nome || "",
      categoria: row.categoria || "Peça",
      unidade: row.unidade || "UN",
      precoCusto: row.precoCusto != null ? String(row.precoCusto) : "",
      precoVenda: row.precoVenda != null ? String(row.precoVenda) : "",
      fornecedorId: row.fornecedorId || "",
      ncm: row.ncm || "",
      descricao: row.descricao || "",
      status: row.status || "ativo",
    });
    setModalOpen(true);
  }, []);

  const handleSaveProduct = useCallback(() => {
    if (!productForm.nome.trim()) { addToast("Informe o nome do produto.", "error"); return; }
    if (!productForm.codigo.trim()) { addToast("Informe o código (SKU) do produto.", "error"); return; }
    // Garante código único (case-insensitive)
    const codeNorm = productForm.codigo.trim().toLowerCase();
    const dup = products.find((p) => (p.codigo || "").toLowerCase() === codeNorm && (!editing || p.id !== editing.id));
    if (dup) { addToast("Já existe produto com esse código.", "error"); return; }

    const fornecedor = suppliers.find((s) => s.id === productForm.fornecedorId);
    const data = {
      codigo: productForm.codigo.trim(),
      codigoBarras: productForm.codigoBarras.trim(),
      nome: productForm.nome.trim(),
      categoria: productForm.categoria,
      unidade: productForm.unidade,
      precoCusto: parseFloat(String(productForm.precoCusto).replace(",", ".")) || 0,
      precoVenda: parseFloat(String(productForm.precoVenda).replace(",", ".")) || 0,
      fornecedorId: productForm.fornecedorId || "",
      fornecedorNome: fornecedor?.nome || "",
      ncm: productForm.ncm.trim(),
      descricao: productForm.descricao.trim(),
      status: productForm.status,
    };

    if (editing) {
      DB.set("erp:product:" + editing.id, { ...editing, ...data, updatedAt: new Date().toISOString() });
      addToast("Produto atualizado com sucesso.", "success");
    } else {
      const newRow = { ...data, id: genId(), createdAt: new Date().toISOString() };
      DB.set("erp:product:" + newRow.id, newRow);
      // Cria automaticamente um registro de estoque zerado para o novo produto
      const stk = {
        id: genId(),
        produtoId: newRow.id,
        saldo: 0,
        estoqueMinimo: 0,
        estoqueMaximo: 0,
        localizacao: "",
        observacoes: "",
        createdAt: new Date().toISOString(),
      };
      DB.set("erp:stock:" + stk.id, stk);
      addToast(`Produto ${newRow.nome} cadastrado com estoque inicial zerado.`, "success");
    }
    setModalOpen(false);
    loadProducts();
    loadStocks();
    if (reloadData) reloadData();
  }, [productForm, editing, products, suppliers, loadProducts, loadStocks, addToast, reloadData]);

  const confirmDeleteProductAction = useCallback(() => {
    if (!confirmDelete) return;
    // Cascata: remove produto + estoques + movimentações usando arrays já carregados em state
    const stks = stocks.filter((s) => s.produtoId === confirmDelete.id);
    stks.forEach((s) => DB.delete("erp:stock:" + s.id));
    const movs = stockMovs.filter((m) => m.produtoId === confirmDelete.id);
    movs.forEach((m) => DB.delete("erp:stockMov:" + m.id));
    DB.delete("erp:product:" + confirmDelete.id);
    addToast(`Produto e ${stks.length + movs.length} registro(s) vinculado(s) removidos.`, "success");
    setConfirmDelete(null);
    loadProducts();
    loadStocks();
    loadStockMovs();
    if (reloadData) reloadData();
  }, [confirmDelete, stocks, stockMovs, loadProducts, loadStocks, loadStockMovs, addToast, reloadData]);

  // ─── Stock (Estoque) CRUD ───
  // Edição direta de estoque ajusta saldo/min/max/localização. Movimentações
  // (entrada/saída/ajuste) ficam no modal `movModal` e geram histórico em erp:stockMov.
  const openCreateStock = useCallback(() => {
    if (products.length === 0) {
      addToast("Cadastre um produto antes de criar um estoque.", "error");
      return;
    }
    setEditing(null);
    setStockForm(EMPTY_STOCK_FORM);
    setModalOpen(true);
  }, [products, addToast]);

  const openEditStock = useCallback((row) => {
    setEditing(row);
    setStockForm({
      produtoId: row.produtoId || "",
      saldo: String(row.saldo ?? 0),
      estoqueMinimo: String(row.estoqueMinimo ?? 0),
      estoqueMaximo: row.estoqueMaximo != null ? String(row.estoqueMaximo) : "",
      localizacao: row.localizacao || "",
      observacoes: row.observacoes || "",
    });
    setModalOpen(true);
  }, []);

  const handleSaveStock = useCallback(() => {
    if (!stockForm.produtoId) { addToast("Selecione o produto.", "error"); return; }
    // Não permite mais de um registro de estoque por produto
    const dup = stocks.find((s) => s.produtoId === stockForm.produtoId && (!editing || s.id !== editing.id));
    if (dup) { addToast("Esse produto já possui registro de estoque.", "error"); return; }

    const data = {
      produtoId: stockForm.produtoId,
      saldo: parseFloat(String(stockForm.saldo).replace(",", ".")) || 0,
      estoqueMinimo: parseFloat(String(stockForm.estoqueMinimo).replace(",", ".")) || 0,
      estoqueMaximo: stockForm.estoqueMaximo === "" ? 0 : parseFloat(String(stockForm.estoqueMaximo).replace(",", ".")) || 0,
      localizacao: stockForm.localizacao.trim(),
      observacoes: stockForm.observacoes.trim(),
    };

    if (editing) {
      DB.set("erp:stock:" + editing.id, { ...editing, ...data, updatedAt: new Date().toISOString() });
      addToast("Estoque atualizado.", "success");
    } else {
      const newRow = { ...data, id: genId(), createdAt: new Date().toISOString() };
      DB.set("erp:stock:" + newRow.id, newRow);
      addToast("Estoque registrado.", "success");
    }
    setModalOpen(false);
    loadStocks();
    if (reloadData) reloadData();
  }, [stockForm, editing, stocks, loadStocks, addToast, reloadData]);

  const confirmDeleteStockAction = useCallback(() => {
    if (!confirmDelete) return;
    const movs = stockMovs.filter((m) => m.produtoId === confirmDelete.produtoId);
    movs.forEach((m) => DB.delete("erp:stockMov:" + m.id));
    DB.delete("erp:stock:" + confirmDelete.id);
    addToast(`Estoque e ${movs.length} movimentação(ões) removida(s).`, "success");
    setConfirmDelete(null);
    loadStocks();
    loadStockMovs();
    if (reloadData) reloadData();
  }, [confirmDelete, stockMovs, loadStocks, loadStockMovs, addToast, reloadData]);

  // Abre modal de movimentação para uma linha de estoque
  const openMovModal = useCallback((stockRow) => {
    setMovForm({ tipo: "entrada", quantidade: "", motivo: "", data: toISODate(new Date()) });
    setMovModal(stockRow);
  }, []);

  // Aplica movimentação: ajusta saldo do estoque + grava histórico em erp:stockMov
  const handleSaveMov = useCallback(() => {
    if (!movModal) return;
    const qtd = parseFloat(String(movForm.quantidade).replace(",", ".")) || 0;
    if (qtd <= 0) { addToast("Quantidade deve ser maior que zero.", "error"); return; }

    const stk = DB.get("erp:stock:" + movModal.id);
    if (!stk) { addToast("Estoque não encontrado.", "error"); setMovModal(null); return; }

    const saldoAtual = Number(stk.saldo) || 0;
    let novoSaldo = saldoAtual;
    if (movForm.tipo === "entrada") novoSaldo = saldoAtual + qtd;
    else if (movForm.tipo === "saida") {
      if (qtd > saldoAtual) { addToast("Saldo insuficiente para essa saída.", "error"); return; }
      novoSaldo = saldoAtual - qtd;
    } else if (movForm.tipo === "ajuste") novoSaldo = qtd;

    const updatedStock = { ...stk, saldo: novoSaldo, ultimaMovimentacao: new Date().toISOString() };
    DB.set("erp:stock:" + stk.id, updatedStock);

    const mov = {
      id: genId(),
      produtoId: stk.produtoId,
      stockId: stk.id,
      tipo: movForm.tipo,
      quantidade: qtd,
      saldoAnterior: saldoAtual,
      saldoNovo: novoSaldo,
      motivo: movForm.motivo.trim(),
      data: movForm.data,
      usuarioId: user?.id || "",
      usuarioNome: user?.nome || "",
      createdAt: new Date().toISOString(),
    };
    DB.set("erp:stockMov:" + mov.id, mov);

    addToast(`${STOCK_MOV_TIPOS[movForm.tipo]} registrada. Saldo: ${novoSaldo}`, "success");
    setMovModal(null);
    loadStocks();
    loadStockMovs();
    if (reloadData) reloadData();
  }, [movModal, movForm, user, loadStocks, loadStockMovs, addToast, reloadData]);

  // ─── Service (Serviço) CRUD ───
  const openCreateService = useCallback(() => {
    setEditing(null);
    setServiceForm(EMPTY_SERVICE_FORM);
    setModalOpen(true);
  }, []);

  const openEditService = useCallback((row) => {
    setEditing(row);
    setServiceForm({
      codigo: row.codigo || "",
      nome: row.nome || "",
      categoria: row.categoria || "Manutenção",
      unidade: row.unidade || "Serviço",
      precoBase: row.precoBase != null ? String(row.precoBase) : "",
      duracaoMin: row.duracaoMin != null ? String(row.duracaoMin) : "60",
      descricao: row.descricao || "",
      status: row.status || "ativo",
    });
    setModalOpen(true);
  }, []);

  const handleSaveService = useCallback(() => {
    if (!serviceForm.nome.trim()) { addToast("Informe o nome do serviço.", "error"); return; }
    if (!serviceForm.codigo.trim()) { addToast("Informe o código do serviço.", "error"); return; }
    const codeNorm = serviceForm.codigo.trim().toLowerCase();
    const dup = services.find((s) => (s.codigo || "").toLowerCase() === codeNorm && (!editing || s.id !== editing.id));
    if (dup) { addToast("Já existe serviço com esse código.", "error"); return; }

    const data = {
      codigo: serviceForm.codigo.trim(),
      nome: serviceForm.nome.trim(),
      categoria: serviceForm.categoria,
      unidade: serviceForm.unidade,
      precoBase: parseFloat(String(serviceForm.precoBase).replace(",", ".")) || 0,
      duracaoMin: parseInt(String(serviceForm.duracaoMin), 10) || 0,
      descricao: serviceForm.descricao.trim(),
      status: serviceForm.status,
    };

    if (editing) {
      DB.set("erp:service:" + editing.id, { ...editing, ...data, updatedAt: new Date().toISOString() });
      addToast("Serviço atualizado.", "success");
    } else {
      const newRow = { ...data, id: genId(), createdAt: new Date().toISOString() };
      DB.set("erp:service:" + newRow.id, newRow);
      addToast(`Serviço ${newRow.nome} cadastrado.`, "success");
    }
    setModalOpen(false);
    loadServices();
    if (reloadData) reloadData();
  }, [serviceForm, editing, services, loadServices, addToast, reloadData]);

  const confirmDeleteServiceAction = useCallback(() => {
    if (!confirmDelete) return;
    DB.delete("erp:service:" + confirmDelete.id);
    addToast("Serviço excluído.", "success");
    setConfirmDelete(null);
    loadServices();
    if (reloadData) reloadData();
  }, [confirmDelete, loadServices, addToast, reloadData]);

  // Apenas admin/gerente podem excluir produtos/fornecedores/estoques/serviços
  const canDelete = user.role === "admin" || user.role === "gerente";

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

  // ─── Supplier columns ───
  const supplierColumns = [
    { key: "nome", label: "Nome / Razão Social" },
    {
      key: "documento", label: "CPF/CNPJ",
      render: (_, row) => row.tipo === "pf" ? (row.cpf || "—") : (row.cnpj || "—"),
    },
    { key: "contato", label: "Contato", render: (v) => v || "—" },
    { key: "telefone", label: "Telefone", render: (v) => v || "—" },
    { key: "categoria", label: "Categoria", render: (v) => v || "—" },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
  ];

  // ─── Product columns ───
  const productColumns = [
    { key: "codigo", label: "Código" },
    { key: "nome", label: "Produto" },
    { key: "categoria", label: "Categoria" },
    { key: "unidade", label: "Un." },
    { key: "precoCusto", label: "Custo", render: (v) => formatCurrency(v) },
    { key: "precoVenda", label: "Venda", render: (v) => formatCurrency(v) },
    {
      key: "fornecedorNome", label: "Fornecedor",
      render: (v) => v || "—",
    },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
  ];

  // ─── Stock columns ───
  const stockColumns = [
    { key: "produtoCodigo", label: "Código" },
    { key: "produtoNome", label: "Produto" },
    { key: "categoriaProduto", label: "Categoria" },
    {
      key: "saldo", label: "Saldo",
      render: (v, row) => `${Number(v) || 0} ${row.unidade || ""}`.trim(),
    },
    {
      key: "estoqueMinimo", label: "Mínimo",
      render: (v) => v ?? 0,
    },
    {
      key: "valorTotal", label: "Valor em Estoque",
      render: (v) => formatCurrency(v),
    },
    { key: "localizacao", label: "Localização", render: (v) => v || "—" },
    {
      key: "statusEstoque", label: "Situação",
      render: (v) => {
        const map = { ok: { label: "OK", color: "bg-green-500" }, critico: { label: "Crítico", color: "bg-yellow-500" }, zerado: { label: "Zerado", color: "bg-red-500" } };
        const it = map[v] || map.ok;
        return <span className={`text-xs px-2 py-0.5 rounded-full text-white ${it.color}`}>{it.label}</span>;
      },
    },
  ];

  // ─── Service columns ───
  const serviceColumns = [
    { key: "codigo", label: "Código" },
    { key: "nome", label: "Serviço" },
    { key: "categoria", label: "Categoria" },
    { key: "unidade", label: "Unidade" },
    { key: "precoBase", label: "Preço Base", render: (v) => formatCurrency(v) },
    {
      key: "duracaoMin", label: "Duração",
      render: (v) => v ? (v >= 60 ? `${Math.floor(v / 60)}h${v % 60 ? ` ${v % 60}min` : ""}` : `${v}min`) : "—",
    },
    { key: "status", label: "Status", render: (v) => <StatusBadge status={v} /> },
  ];

  // Histórico de movimentações do estoque selecionado (ultimas 20)
  const movHistory = useMemo(() => {
    if (!movModal) return [];
    return stockMovs
      .filter((m) => m.stockId === movModal.id || m.produtoId === movModal.produtoId)
      .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
      .slice(0, 20);
  }, [movModal, stockMovs]);

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
          onClick={() => {
            if (activeTab === "clientes") openCreateClient();
            else if (activeTab === "funcionarios") openCreateEmployee();
            else if (activeTab === "fornecedores") openCreateSupplier();
            else if (activeTab === "produtos") openCreateProduct();
            else if (activeTab === "estoques") openCreateStock();
            else if (activeTab === "servicos") openCreateService();
          }}
          className="px-4 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition flex items-center gap-2"
        >
          + {{
            clientes: "Novo Cliente",
            funcionarios: "Novo Funcionário",
            fornecedores: "Novo Fornecedor",
            produtos: "Novo Produto",
            estoques: "Novo Estoque",
            servicos: "Novo Serviço",
          }[activeTab]}
        </button>
      </div>

      {/* Tabs — abas de cadastro */}
      <div className="flex gap-2 flex-wrap">
        {[
          { id: "clientes", label: `👥 Clientes (${clients.length})` },
          { id: "funcionarios", label: `👷 Funcionários (${employees.length})` },
          { id: "fornecedores", label: `🏭 Fornecedores (${suppliers.length})` },
          { id: "produtos", label: `📦 Produtos (${products.length})` },
          { id: "estoques", label: `🗃️ Estoques (${stocks.length})` },
          { id: "servicos", label: `🛠️ Serviços (${services.length})` },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
              setSearch("");
              // Fecha modal pendente ao trocar de aba — evita modal de outra entidade reaparecer
              setModalOpen(false);
              setEditing(null);
            }}
            className={`px-4 py-2 text-sm rounded-lg transition ${activeTab === tab.id ? "bg-blue-600 text-white" : "bg-gray-700 text-gray-300 hover:bg-gray-600"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="max-w-sm">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder={{
            clientes: "Buscar por nome, CPF ou telefone...",
            funcionarios: "Buscar por nome, CPF ou cargo...",
            fornecedores: "Buscar por nome, CNPJ, contato...",
            produtos: "Buscar por código, nome ou categoria...",
            estoques: "Buscar por produto, código ou local...",
            servicos: "Buscar por código, nome ou categoria...",
          }[activeTab] || "Buscar..."}
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

      {/* Fornecedores Tab */}
      {activeTab === "fornecedores" && (
        <DataTable
          columns={supplierColumns}
          data={filteredSuppliers}
          onEdit={openEditSupplier}
          onDelete={canDelete ? (row) => setConfirmDelete(row) : undefined}
          emptyMessage="Nenhum fornecedor cadastrado."
        />
      )}

      {/* Produtos Tab */}
      {activeTab === "produtos" && (
        <DataTable
          columns={productColumns}
          data={filteredProducts}
          onEdit={openEditProduct}
          onDelete={canDelete ? (row) => setConfirmDelete(row) : undefined}
          emptyMessage="Nenhum produto cadastrado."
        />
      )}

      {/* Estoques Tab — botão extra "Movimentar" abre modal de entrada/saída */}
      {activeTab === "estoques" && (
        <DataTable
          columns={stockColumns}
          data={filteredStocks}
          onEdit={openEditStock}
          onDelete={canDelete ? (row) => setConfirmDelete(row) : undefined}
          actions={(row) => (
            <button
              onClick={() => openMovModal(row)}
              className="p-1.5 rounded-lg text-gray-400 hover:text-green-400 hover:bg-gray-700 transition"
              title="Registrar entrada/saída"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" /></svg>
            </button>
          )}
          emptyMessage="Nenhum estoque registrado. Cadastre produtos para gerar registros de estoque."
        />
      )}

      {/* Serviços Tab */}
      {activeTab === "servicos" && (
        <DataTable
          columns={serviceColumns}
          data={filteredServices}
          onEdit={openEditService}
          onDelete={canDelete ? (row) => setConfirmDelete(row) : undefined}
          emptyMessage="Nenhum serviço cadastrado."
        />
      )}

      {/* Client Modal */}
      {activeTab === "clientes" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Cliente" : "Novo Cliente"} onClose={() => setModalOpen(false)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome *</label>
                <input name="nome"
                  type="text"
                  value={clientForm.nome}
                  onChange={(e) => setClientForm({ ...clientForm, nome: e.target.value })}
                  placeholder="Nome completo ou Razão Social"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
                <select name="tipo"
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
                    <input name="cpf"
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
                    <input name="cnpj"
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
                  <input name="rg"
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
                <input name="telefone"
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
                <input name="email"
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
                  <input name="rua"
                    type="text"
                    value={clientForm.rua}
                    onChange={(e) => setClientForm({ ...clientForm, rua: e.target.value })}
                    placeholder="Rua, Avenida..."
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Número</label>
                  <input name="numero"
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
                  <input name="bairro"
                    type="text"
                    value={clientForm.bairro}
                    onChange={(e) => setClientForm({ ...clientForm, bairro: e.target.value })}
                    placeholder="Bairro"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Cidade</label>
                  <input name="cidade"
                    type="text"
                    value={clientForm.cidade}
                    onChange={(e) => setClientForm({ ...clientForm, cidade: e.target.value })}
                    placeholder="Cidade"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Estado</label>
                  <input name="estado"
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
                  <input name="cep"
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
              <textarea name="observacoes"
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
              <input name="nome"
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
                <input name="cpf"
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
                <input name="rg"
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
                <input name="telefone"
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
              <input name="email"
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
                <select name="cargo"
                  value={employeeForm.cargo}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, cargo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  {CARGOS_FUNCIONARIO.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Salário (R$)</label>
                <input name="salario"
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
                <input name="dataAdmissao"
                  type="date"
                  value={employeeForm.dataAdmissao}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, dataAdmissao: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
                <select name="status"
                  value={employeeForm.status}
                  onChange={(e) => setEmployeeForm({ ...employeeForm, status: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            </div>

            {/* Configuração fiscal — controla o cálculo automático do contracheque */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Configuração Fiscal (Folha de Pagamento)</h4>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <label className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-gray-700">
                  <input type="checkbox" checked={employeeForm.descontaINSS !== false}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, descontaINSS: e.target.checked })}
                    className="w-4 h-4 accent-blue-500" />
                  <span className="text-sm text-white">Descontar INSS</span>
                </label>
                <label className="flex items-center gap-2 bg-gray-700/50 rounded-lg px-3 py-2.5 cursor-pointer hover:bg-gray-700">
                  <input type="checkbox" checked={employeeForm.descontaIRRF !== false}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, descontaIRRF: e.target.checked })}
                    className="w-4 h-4 accent-blue-500" />
                  <span className="text-sm text-white">Descontar IRRF</span>
                </label>
                <div>
                  <label className="block text-sm text-gray-300 mb-1">Dependentes (IRRF)</label>
                  <input type="number" min="0" value={employeeForm.dependentes || 0}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, dependentes: Number(e.target.value) || 0 })}
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2">Desmarque INSS/IRRF para autônomo, MEI ou PJ. CLT mantém ambos marcados.</p>
            </div>

            {/* Endereço residencial do funcionário — mesmo padrão usado no cadastro de cliente */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Endereço Residencial</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Rua</label>
                  <input name="rua"
                    type="text"
                    value={employeeForm.rua}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, rua: e.target.value })}
                    placeholder="Rua, Avenida..."
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Número</label>
                  <input name="numero"
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
                  <input name="bairro"
                    type="text"
                    value={employeeForm.bairro}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, bairro: e.target.value })}
                    placeholder="Bairro"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Cidade</label>
                  <input name="cidade"
                    type="text"
                    value={employeeForm.cidade}
                    onChange={(e) => setEmployeeForm({ ...employeeForm, cidade: e.target.value })}
                    placeholder="Cidade"
                    className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-300 mb-1.5">Estado</label>
                  <input name="estado"
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
                  <input name="cep"
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

      {/* ─── Modal: Fornecedor ─── */}
      {activeTab === "fornecedores" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Fornecedor" : "Novo Fornecedor"} onClose={() => setModalOpen(false)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome / Razão Social *</label>
                <input
                  type="text"
                  value={supplierForm.nome}
                  onChange={(e) => setSupplierForm({ ...supplierForm, nome: e.target.value })}
                  placeholder="Nome do fornecedor"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
                <select
                  value={supplierForm.tipo}
                  onChange={(e) => setSupplierForm({ ...supplierForm, tipo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="pj">Pessoa Jurídica</option>
                  <option value="pf">Pessoa Física</option>
                </select>
              </div>
              <div>
                {supplierForm.tipo === "pj" ? (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">CNPJ</label>
                    <input
                      type="text"
                      value={supplierForm.cnpj}
                      onChange={(e) => setSupplierForm({ ...supplierForm, cnpj: formatCNPJ(e.target.value) })}
                      placeholder="00.000.000/0000-00"
                      maxLength={18}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                    />
                  </>
                ) : (
                  <>
                    <label className="block text-sm font-medium text-gray-300 mb-1.5">CPF</label>
                    <input
                      type="text"
                      value={supplierForm.cpf}
                      onChange={(e) => setSupplierForm({ ...supplierForm, cpf: formatCPF(e.target.value) })}
                      placeholder="000.000.000-00"
                      maxLength={14}
                      className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                    />
                  </>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Inscrição Estadual</label>
                <input
                  type="text"
                  value={supplierForm.ie}
                  onChange={(e) => setSupplierForm({ ...supplierForm, ie: e.target.value })}
                  placeholder="ISENTO ou nº IE"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
                <select
                  value={supplierForm.categoria}
                  onChange={(e) => setSupplierForm({ ...supplierForm, categoria: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  {FORNECEDOR_CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Contato</label>
                <input
                  type="text"
                  value={supplierForm.contato}
                  onChange={(e) => setSupplierForm({ ...supplierForm, contato: e.target.value })}
                  placeholder="Pessoa de contato"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Telefone *</label>
                <input
                  type="text"
                  value={supplierForm.telefone}
                  onChange={(e) => setSupplierForm({ ...supplierForm, telefone: formatPhone(e.target.value) })}
                  placeholder="(00) 00000-0000"
                  maxLength={15}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
                <input
                  type="email"
                  value={supplierForm.email}
                  onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })}
                  placeholder="email@fornecedor.com"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-sm font-medium text-gray-300 mb-3">Endereço</h4>
              <div className="grid grid-cols-3 gap-4">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-400 mb-1">Rua</label>
                  <input type="text" value={supplierForm.rua} onChange={(e) => setSupplierForm({ ...supplierForm, rua: e.target.value })} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Número</label>
                  <input type="text" value={supplierForm.numero} onChange={(e) => setSupplierForm({ ...supplierForm, numero: e.target.value })} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
              <div className="grid grid-cols-4 gap-4 mt-3">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Bairro</label>
                  <input type="text" value={supplierForm.bairro} onChange={(e) => setSupplierForm({ ...supplierForm, bairro: e.target.value })} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">Cidade</label>
                  <input type="text" value={supplierForm.cidade} onChange={(e) => setSupplierForm({ ...supplierForm, cidade: e.target.value })} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">UF</label>
                  <input type="text" value={supplierForm.estado} onChange={(e) => setSupplierForm({ ...supplierForm, estado: e.target.value.toUpperCase().slice(0, 2) })} maxLength={2} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">CEP</label>
                  <input type="text" value={supplierForm.cep} onChange={(e) => setSupplierForm({ ...supplierForm, cep: formatCEP(e.target.value) })} maxLength={9} className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-blue-500" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
                <textarea
                  value={supplierForm.observacoes}
                  onChange={(e) => setSupplierForm({ ...supplierForm, observacoes: e.target.value })}
                  rows={2}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
                <select
                  value={supplierForm.status}
                  onChange={(e) => setSupplierForm({ ...supplierForm, status: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
              <button onClick={handleSaveSupplier} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {editing ? "Salvar Alterações" : "Cadastrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Modal: Produto ─── */}
      {activeTab === "produtos" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Produto" : "Novo Produto"} onClose={() => setModalOpen(false)} size="lg">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Código (SKU) *</label>
                <input
                  type="text"
                  value={productForm.codigo}
                  onChange={(e) => setProductForm({ ...productForm, codigo: e.target.value.toUpperCase() })}
                  placeholder="PRD-0001"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome do Produto *</label>
                <input
                  type="text"
                  value={productForm.nome}
                  onChange={(e) => setProductForm({ ...productForm, nome: e.target.value })}
                  placeholder="Compressor 1HP"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
                <select
                  value={productForm.categoria}
                  onChange={(e) => setProductForm({ ...productForm, categoria: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  {PRODUTO_CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Unidade</label>
                <select
                  value={productForm.unidade}
                  onChange={(e) => setProductForm({ ...productForm, unidade: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  {PRODUTO_UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Preço Custo</label>
                <input
                  type="number" step="0.01" min="0"
                  value={productForm.precoCusto}
                  onChange={(e) => setProductForm({ ...productForm, precoCusto: e.target.value })}
                  placeholder="0,00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Preço Venda</label>
                <input
                  type="number" step="0.01" min="0"
                  value={productForm.precoVenda}
                  onChange={(e) => setProductForm({ ...productForm, precoVenda: e.target.value })}
                  placeholder="0,00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Código de Barras</label>
                <input
                  type="text"
                  value={productForm.codigoBarras}
                  onChange={(e) => setProductForm({ ...productForm, codigoBarras: e.target.value.replace(/\D/g, "") })}
                  placeholder="EAN/GTIN"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">NCM</label>
                <input
                  type="text"
                  value={productForm.ncm}
                  onChange={(e) => setProductForm({ ...productForm, ncm: e.target.value })}
                  placeholder="0000.00.00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Fornecedor</label>
                <select
                  value={productForm.fornecedorId}
                  onChange={(e) => setProductForm({ ...productForm, fornecedorId: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="">— Sem fornecedor —</option>
                  {suppliers.filter((s) => s.status !== "inativo").map((s) => (
                    <option key={s.id} value={s.id}>{s.nome}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição</label>
              <textarea
                value={productForm.descricao}
                onChange={(e) => setProductForm({ ...productForm, descricao: e.target.value })}
                rows={2}
                placeholder="Detalhes técnicos, modelo, voltagem..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
                <select
                  value={productForm.status}
                  onChange={(e) => setProductForm({ ...productForm, status: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="ativo">Ativo</option>
                  <option value="inativo">Inativo</option>
                </select>
              </div>
              {/* Margem calculada automaticamente — apenas leitura */}
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Margem Estimada</label>
                <div className="w-full bg-gray-900 border border-gray-700 rounded-lg px-4 py-2.5 text-blue-300 text-sm">
                  {(() => {
                    const c = parseFloat(String(productForm.precoCusto).replace(",", ".")) || 0;
                    const v = parseFloat(String(productForm.precoVenda).replace(",", ".")) || 0;
                    if (c <= 0) return "—";
                    const m = ((v - c) / c) * 100;
                    return `${m.toFixed(1)}% (${formatCurrency(v - c)})`;
                  })()}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
              <button onClick={handleSaveProduct} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {editing ? "Salvar Alterações" : "Cadastrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Modal: Estoque ─── */}
      {activeTab === "estoques" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Estoque" : "Novo Estoque"} onClose={() => setModalOpen(false)} size="md">
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Produto *</label>
              <select
                value={stockForm.produtoId}
                onChange={(e) => setStockForm({ ...stockForm, produtoId: e.target.value })}
                disabled={!!editing}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition disabled:opacity-60"
              >
                <option value="">Selecione um produto...</option>
                {products
                  .filter((p) => editing || !stocks.some((st) => st.produtoId === p.id))
                  .map((p) => (
                    <option key={p.id} value={p.id}>{p.codigo} — {p.nome}</option>
                  ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Saldo Atual</label>
                <input
                  type="number" step="0.01" min="0"
                  value={stockForm.saldo}
                  onChange={(e) => setStockForm({ ...stockForm, saldo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Estoque Mínimo</label>
                <input
                  type="number" step="0.01" min="0"
                  value={stockForm.estoqueMinimo}
                  onChange={(e) => setStockForm({ ...stockForm, estoqueMinimo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Estoque Máximo</label>
                <input
                  type="number" step="0.01" min="0"
                  value={stockForm.estoqueMaximo}
                  onChange={(e) => setStockForm({ ...stockForm, estoqueMaximo: e.target.value })}
                  placeholder="Opcional"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Localização</label>
              <input
                type="text"
                value={stockForm.localizacao}
                onChange={(e) => setStockForm({ ...stockForm, localizacao: e.target.value })}
                placeholder="Ex: Prateleira A3, Galpão 2..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Observações</label>
              <textarea
                value={stockForm.observacoes}
                onChange={(e) => setStockForm({ ...stockForm, observacoes: e.target.value })}
                rows={2}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
              />
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
              <button onClick={handleSaveStock} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {editing ? "Salvar Alterações" : "Cadastrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Modal: Movimentação de Estoque ─── */}
      {movModal && (
        <Modal isOpen={!!movModal} title={`Movimentar Estoque — ${movModal.produtoNome}`} onClose={() => setMovModal(null)} size="md">
          <div className="space-y-4">
            <div className="bg-gray-700/50 rounded-lg px-4 py-3 text-sm">
              <p className="text-gray-300">
                Saldo atual: <strong className="text-white">{movModal.saldo} {movModal.unidade}</strong>
                {Number(movModal.saldo) <= Number(movModal.estoqueMinimo) && Number(movModal.estoqueMinimo) > 0 && (
                  <span className="ml-2 text-yellow-400 text-xs">⚠ abaixo do mínimo ({movModal.estoqueMinimo})</span>
                )}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo</label>
                <select
                  value={movForm.tipo}
                  onChange={(e) => setMovForm({ ...movForm, tipo: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="entrada">{STOCK_MOV_TIPOS.entrada} (compra/recebimento)</option>
                  <option value="saida">{STOCK_MOV_TIPOS.saida} (uso/venda/perda)</option>
                  <option value="ajuste">{STOCK_MOV_TIPOS.ajuste} (define saldo)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Quantidade *</label>
                <input
                  type="number" step="0.01" min="0"
                  value={movForm.quantidade}
                  onChange={(e) => setMovForm({ ...movForm, quantidade: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Data</label>
                <input
                  type="date"
                  value={movForm.data}
                  onChange={(e) => setMovForm({ ...movForm, data: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Motivo</label>
                <input
                  type="text"
                  value={movForm.motivo}
                  onChange={(e) => setMovForm({ ...movForm, motivo: e.target.value })}
                  placeholder="NF entrada, OS-123, perda..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            {/* Histórico recente */}
            {movHistory.length > 0 && (
              <div className="border-t border-gray-700 pt-4">
                <h4 className="text-sm font-medium text-gray-300 mb-2">Últimas movimentações</h4>
                <div className="max-h-40 overflow-y-auto bg-gray-900/40 rounded-lg divide-y divide-gray-700">
                  {movHistory.map((m) => (
                    <div key={m.id} className="px-3 py-2 text-xs text-gray-300 flex justify-between">
                      <span>
                        <span className={`inline-block w-16 ${MOV_TIPO_COLOR[m.tipo] || "text-gray-400"}`}>
                          {STOCK_MOV_TIPOS[m.tipo]}
                        </span>
                        {m.quantidade} · {m.motivo || "—"}
                      </span>
                      <span className="text-gray-500">{formatDate(m.data)} · saldo: {m.saldoNovo}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setMovModal(null)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
              <button onClick={handleSaveMov} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                Registrar Movimentação
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ─── Modal: Serviço ─── */}
      {activeTab === "servicos" && (
        <Modal isOpen={modalOpen} title={editing ? "Editar Serviço" : "Novo Serviço"} onClose={() => setModalOpen(false)} size="md">
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Código *</label>
                <input
                  type="text"
                  value={serviceForm.codigo}
                  onChange={(e) => setServiceForm({ ...serviceForm, codigo: e.target.value.toUpperCase() })}
                  placeholder="SRV-001"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div className="col-span-2">
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Nome do Serviço *</label>
                <input
                  type="text"
                  value={serviceForm.nome}
                  onChange={(e) => setServiceForm({ ...serviceForm, nome: e.target.value })}
                  placeholder="Manutenção preventiva de split"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div className="grid grid-cols-4 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Categoria</label>
                <select
                  value={serviceForm.categoria}
                  onChange={(e) => setServiceForm({ ...serviceForm, categoria: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  {SERVICO_CATEGORIAS.map((c) => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Unidade</label>
                <select
                  value={serviceForm.unidade}
                  onChange={(e) => setServiceForm({ ...serviceForm, unidade: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  {SERVICO_UNIDADES.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Preço Base</label>
                <input
                  type="number" step="0.01" min="0"
                  value={serviceForm.precoBase}
                  onChange={(e) => setServiceForm({ ...serviceForm, precoBase: e.target.value })}
                  placeholder="0,00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Duração (min)</label>
                <input
                  type="number" min="0" step="5"
                  value={serviceForm.duracaoMin}
                  onChange={(e) => setServiceForm({ ...serviceForm, duracaoMin: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Descrição / Escopo</label>
              <textarea
                value={serviceForm.descricao}
                onChange={(e) => setServiceForm({ ...serviceForm, descricao: e.target.value })}
                rows={3}
                placeholder="O que está incluso, ferramentas necessárias, garantias..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Status</label>
              <select
                value={serviceForm.status}
                onChange={(e) => setServiceForm({ ...serviceForm, status: e.target.value })}
                className="w-full max-w-xs bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
              >
                <option value="ativo">Ativo</option>
                <option value="inativo">Inativo</option>
              </select>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t border-gray-700">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm rounded-lg bg-gray-700 text-gray-300 hover:bg-gray-600 transition">Cancelar</button>
              <button onClick={handleSaveService} className="px-6 py-2 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700 transition">
                {editing ? "Salvar Alterações" : "Cadastrar"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* Confirm Delete — mensagem e ação dependem da aba ativa */}
      {confirmDelete && (
        <ConfirmDialog
          message={(() => {
            const nome = confirmDelete.nome || confirmDelete.produtoNome || "";
            if (activeTab === "clientes") return `Excluir "${nome}" e todos os registros vinculados (OS, transações, tickets, agendamentos)? Esta ação não pode ser desfeita.`;
            if (activeTab === "produtos") return `Excluir produto "${nome}"? Estoque e movimentações vinculadas também serão removidos.`;
            if (activeTab === "estoques") return `Excluir registro de estoque de "${nome}" e todas as movimentações? O produto NÃO será excluído.`;
            return `Excluir "${nome}"? Esta ação não pode ser desfeita.`;
          })()}
          onConfirm={() => {
            if (activeTab === "clientes") return confirmDeleteClientAction();
            if (activeTab === "funcionarios") return confirmDeleteEmployeeAction();
            if (activeTab === "fornecedores") return confirmDeleteSupplierAction();
            if (activeTab === "produtos") return confirmDeleteProductAction();
            if (activeTab === "estoques") return confirmDeleteStockAction();
            if (activeTab === "servicos") return confirmDeleteServiceAction();
          }}
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
      // Limite de usuários por empresa (definido pelo Master).
      // Considera apenas usuários ativos no scope da company atual.
      if (currentUser?.companyId) {
        const company = DB.get("erp:company:" + currentUser.companyId);
        const limit = company?.maxUsuarios || 0;
        if (limit > 0) {
          const ativos = users.filter((u) => u.status !== "inativo").length;
          if (ativos >= limit) {
            addToast(`Limite de ${limit} usuário(s) atingido. Solicite ampliação ao Master.`, "error");
            return;
          }
        }
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
          {/* Mostra uso vs. limite definido pelo Master */}
          {(() => {
            if (!currentUser?.companyId) return null;
            const company = DB.get("erp:company:" + currentUser.companyId);
            const limit = company?.maxUsuarios || 0;
            if (limit <= 0) return null;
            const ativos = users.filter((u) => u.status !== "inativo").length;
            const cor = ativos >= limit ? "text-red-400" : ativos >= limit * 0.8 ? "text-yellow-400" : "text-gray-400";
            return (
              <p className={`text-xs mt-1 ${cor}`}>
                Uso: <strong>{ativos}</strong> de <strong>{limit}</strong> usuário(s) permitidos
                {ativos >= limit && " — limite atingido"}
              </p>
            );
          })()}
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
              <input name="nome"
                type="text"
                value={form.nome}
                onChange={(e) => setForm({ ...form, nome: e.target.value })}
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Email</label>
              <input name="email"
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
              <PasswordInput name="password"
                autoComplete="new-password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Mínimo 8 caracteres"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Confirmar senha</label>
              <PasswordInput name="confirmPassword"
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
              <select name="role"
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
              <select name="status"
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
              <input name="useCustomPermissions"
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
                  <input name="includes"
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
            <input name="httpsURL"
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
            <input name="webcalURL"
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

// Painel de auditoria da empresa — lista mutações scoped por companyId via DB.list("erp:audit:")
function CompanyAuditPanel() {
  const [entries, setEntries] = useState([]);
  const [filterAction, setFilterAction] = useState("all"); // all | create | update | delete
  const [filterEntity, setFilterEntity] = useState("all");
  const [search, setSearch] = useState("");
  const [reload, setReload] = useState(0);

  useEffect(() => {
    const list = DB.list("erp:audit:").sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    setEntries(list);
  }, [reload]);

  const filtered = useMemo(() => {
    const s = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (filterAction !== "all" && e.action !== filterAction) return false;
      if (filterEntity !== "all" && e.entity !== filterEntity) return false;
      if (!s) return true;
      return (
        (e.summary || "").toLowerCase().includes(s) ||
        (e.userNome || "").toLowerCase().includes(s)
      );
    });
  }, [entries, filterAction, filterEntity, search]);

  const actionColor = {
    create: "text-green-400",
    update: "text-blue-400",
    delete: "text-red-400",
  };
  const actionLabel = { create: "criou", update: "alterou", delete: "excluiu" };

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold text-white">Auditoria da Empresa</h3>
          <p className="text-gray-400 text-sm mt-0.5">Quem alterou o quê (OS, clientes, funcionários, finanças, usuários).</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar..."
            className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white w-48"
          />
          <select value={filterAction} onChange={(e) => setFilterAction(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white">
            <option value="all">Toda ação</option>
            <option value="create">Criou</option>
            <option value="update">Alterou</option>
            <option value="delete">Excluiu</option>
          </select>
          <select value={filterEntity} onChange={(e) => setFilterEntity(e.target.value)} className="bg-gray-700 border border-gray-600 rounded-lg px-3 py-1.5 text-sm text-white">
            <option value="all">Toda entidade</option>
            <option value="os">OS</option>
            <option value="client">Clientes</option>
            <option value="employee">Funcionários</option>
            <option value="finance">Financeiro</option>
            <option value="user">Usuários</option>
          </select>
          <button onClick={() => setReload((r) => r + 1)} className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200">
            Atualizar
          </button>
        </div>
      </div>
      {filtered.length === 0 ? (
        <p className="text-sm text-gray-400 py-6 text-center">Nenhum registro de auditoria.</p>
      ) : (
        <div className="space-y-1.5 max-h-96 overflow-y-auto">
          {filtered.slice(0, 200).map((e) => (
            <div key={e.id} className="bg-gray-700/50 border border-gray-700 rounded-lg px-3 py-2 text-sm flex items-center gap-3">
              <span className={`text-xs font-bold whitespace-nowrap ${actionColor[e.action] || "text-gray-300"}`}>
                {actionLabel[e.action] || e.action}
              </span>
              <span className="text-gray-300 truncate flex-1" title={e.summary}>{e.summary || "(sem resumo)"}</span>
              <span className="text-xs text-gray-400 whitespace-nowrap">{e.userNome}</span>
              <span className="text-[10px] text-gray-500 whitespace-nowrap">{new Date(e.ts).toLocaleString("pt-BR")}</span>
            </div>
          ))}
        </div>
      )}
      {filtered.length > 200 && (
        <p className="text-xs text-gray-500 mt-2">Mostrando 200 mais recentes de {filtered.length}.</p>
      )}
    </div>
  );
}

// Painel de backups automáticos — lista snapshots da empresa e permite download/restore
function AutoBackupPanel({ addToast }) {
  const [backups, setBackups] = useState([]);
  const [meta, setMeta] = useState(null);
  const [reload, setReload] = useState(0);
  const [restoring, setRestoring] = useState(null);

  useEffect(() => {
    const list = DB.list("erp:autoBackup:").sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));
    setBackups(list);
    setMeta(DB.get("erp:autoBackupMeta"));
  }, [reload]);

  const triggerNow = useCallback(() => {
    // Força próxima geração ignorando cooldown — útil pra testar/garantir snapshot
    DB.set("erp:autoBackupMeta", { lastTs: null });
    const result = ensureAutoBackup(getActiveCompanyId());
    if (result) {
      addToast("Backup automático gerado.", "success");
    } else {
      addToast("Não foi possível gerar agora.", "error");
    }
    setReload((r) => r + 1);
  }, [addToast]);

  const downloadBackup = useCallback((b) => {
    try {
      const blob = new Blob([JSON.stringify(b, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `frost-backup-${b.id}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      addToast("Falha ao exportar backup.", "error");
    }
  }, [addToast]);

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h3 className="text-lg font-semibold text-white">Backup Automático</h3>
          <p className="text-gray-400 text-sm mt-0.5">
            Snapshot semanal automático. Mantém os últimos 4.
            {meta?.lastTs && <> Último: <strong>{new Date(meta.lastTs).toLocaleString("pt-BR")}</strong>.</>}
          </p>
        </div>
        <button onClick={triggerNow} className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition">
          Gerar agora
        </button>
      </div>
      {backups.length === 0 ? (
        <p className="text-sm text-gray-400 py-4 text-center">Nenhum backup automático ainda.</p>
      ) : (
        <div className="space-y-2">
          {backups.map((b) => {
            const counts = (b.clients?.length || 0) + (b.services?.length || 0) + (b.finance?.length || 0) + (b.employees?.length || 0) + (b.users?.length || 0);
            return (
              <div key={b.id} className="bg-gray-700/50 border border-gray-700 rounded-lg p-3 flex items-center gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-white">{new Date(b.ts).toLocaleString("pt-BR")}</p>
                  <p className="text-[11px] text-gray-400">
                    {counts} registros • clientes:{b.clients?.length || 0} • OS:{b.services?.length || 0} • finanças:{b.finance?.length || 0} • usuários:{b.users?.length || 0}
                  </p>
                </div>
                <button onClick={() => downloadBackup(b)} className="px-3 py-1.5 text-xs rounded-lg bg-gray-700 hover:bg-gray-600 text-gray-200">
                  Baixar JSON
                </button>
              </div>
            );
          })}
        </div>
      )}
      <p className="text-[11px] text-gray-500 mt-3">
        Backup contém clientes, OS, agenda, funcionários, finanças, configuração e usuários (sem senhas).
        Use o exportar manual em "Backup &amp; Restore" pra restaurar.
      </p>
    </div>
  );
}

function SettingsModule({ user, addToast, reloadData, theme, setTheme }) {
  const [config, setConfig] = useState({
    razaoSocial: "", cnpj: "", telefone: "", email: "", endereco: "",
    logoUrl: "",
    pixChave: "", pixTipoChave: "CNPJ", pixFavorecido: "", pixBanco: "", pixQrUrl: "",
    mensagemAgradecimento: "",
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
      // ─── Logo da empresa (aparece centralizada nos documentos) ───────────
      logoUrl: cfg.logoUrl || "",
      // ─── Dados de PIX (Orçamento + OS) ───────────────────────────────────
      pixChave: cfg.pixChave || "",
      pixTipoChave: cfg.pixTipoChave || "CNPJ",
      pixFavorecido: cfg.pixFavorecido || "",
      pixBanco: cfg.pixBanco || "",
      pixQrUrl: cfg.pixQrUrl || "",
      // ─── Mensagem de agradecimento (Recibo) ──────────────────────────────
      mensagemAgradecimento: cfg.mensagemAgradecimento || "",
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
      logoUrl: config.logoUrl,
      pixChave: config.pixChave,
      pixTipoChave: config.pixTipoChave,
      pixFavorecido: config.pixFavorecido,
      pixBanco: config.pixBanco,
      pixQrUrl: config.pixQrUrl,
      mensagemAgradecimento: config.mensagemAgradecimento,
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

      {/* Aparência — alterna entre Dark e Light Mode (persistido em erp:theme) */}
      {typeof setTheme === "function" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
          <h3 className="text-lg font-semibold text-white mb-1">Aparência</h3>
          <p className="text-sm text-gray-400 mb-4">
            Escolha o tema da interface. A preferência é salva e aplicada em todos os dispositivos.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => setTheme("dark")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${
                theme === "dark"
                  ? "border-blue-500 bg-blue-600/15 text-white"
                  : "border-gray-600 bg-gray-700/40 text-gray-300 hover:bg-gray-700"
              }`}
              aria-pressed={theme === "dark"}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
              </svg>
              <div className="text-left">
                <div className="text-sm font-medium">Dark Mode</div>
                <div className="text-xs text-gray-400">Padrão • menor cansaço visual</div>
              </div>
            </button>

            <button
              type="button"
              onClick={() => setTheme("light")}
              className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition ${
                theme === "light"
                  ? "border-blue-500 bg-blue-600/15 text-white"
                  : "border-gray-600 bg-gray-700/40 text-gray-300 hover:bg-gray-700"
              }`}
              aria-pressed={theme === "light"}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.05 16.95l-1.41 1.41m12.72 0l-1.41-1.41M7.05 7.05L5.64 5.64M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
              <div className="text-left">
                <div className="text-sm font-medium">Light Mode</div>
                <div className="text-xs text-gray-400">Claro • ambientes iluminados</div>
              </div>
            </button>
          </div>
        </div>
      )}

      {/* Company Info */}
      <div className="bg-gray-800 border border-gray-700 rounded-xl p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Dados da Empresa</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Razão Social</label>
              <input name="razaoSocial"
                type="text"
                value={config.razaoSocial}
                onChange={(e) => setConfig({ ...config, razaoSocial: e.target.value })}
                placeholder="Razão Social da empresa"
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">CNPJ</label>
              <input name="cnpj"
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
              <input name="telefone"
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
              <input name="email"
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
            <input name="endereco"
              type="text"
              value={config.endereco}
              onChange={(e) => setConfig({ ...config, endereco: e.target.value })}
              placeholder="Endereço completo"
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
          </div>

          {/* ─── Logo da Empresa (centralizada nos documentos PDF) ───────────── */}
          <div className="border-t border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Logo da Empresa (URL ou data URL)</label>
            <input name="logoUrl"
              type="text"
              value={config.logoUrl}
              onChange={(e) => setConfig({ ...config, logoUrl: e.target.value })}
              placeholder="https://...  ou  /logo.svg  ou  data:image/png;base64,..."
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
            />
            <p className="text-xs text-gray-500 mt-1">Aparece centralizada no topo do Orçamento, OS e Recibo.</p>
            {config.logoUrl ? (
              <div className="mt-2 inline-block bg-white p-2 rounded-lg">
                <img src={config.logoUrl} alt="Preview da logo" className="max-h-16 max-w-[160px] object-contain" />
              </div>
            ) : null}
          </div>

          {/* ─── PIX (Orçamento + OS) ────────────────────────────────────────── */}
          <div className="border-t border-gray-700 pt-4">
            <h4 className="text-base font-semibold text-white mb-1">Chave PIX e QR Code</h4>
            <p className="text-xs text-gray-500 mb-3">Esses dados aparecem no Orçamento e no Recibo (não aparecem na Ordem de Serviço).</p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Tipo da Chave</label>
                <select
                  value={config.pixTipoChave}
                  onChange={(e) => setConfig({ ...config, pixTipoChave: e.target.value })}
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white focus:outline-none focus:border-blue-500 transition"
                >
                  <option value="CNPJ">CNPJ</option>
                  <option value="CPF">CPF</option>
                  <option value="E-mail">E-mail</option>
                  <option value="Telefone">Telefone</option>
                  <option value="Aleatória">Aleatória</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Chave PIX</label>
                <input name="pixChave"
                  type="text"
                  value={config.pixChave}
                  onChange={(e) => setConfig({ ...config, pixChave: e.target.value })}
                  placeholder="00.000.000/0000-00"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Favorecido</label>
                <input name="pixFavorecido"
                  type="text"
                  value={config.pixFavorecido}
                  onChange={(e) => setConfig({ ...config, pixFavorecido: e.target.value })}
                  placeholder="Nome do titular da conta"
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-300 mb-1.5">Banco</label>
                <input name="pixBanco"
                  type="text"
                  value={config.pixBanco}
                  onChange={(e) => setConfig({ ...config, pixBanco: e.target.value })}
                  placeholder="Sicredi, Caixa, Nubank..."
                  className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
                />
              </div>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-gray-300 mb-1.5">QR Code do PIX (URL ou data URL)</label>
              <input name="pixQrUrl"
                type="text"
                value={config.pixQrUrl}
                onChange={(e) => setConfig({ ...config, pixQrUrl: e.target.value })}
                placeholder="/qr-pix-sicredi.jpeg  ou  https://..."
                className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition"
              />
              <p className="text-xs text-gray-500 mt-1">Imagem do QR Code que será impressa ao lado dos dados do PIX. Padrão: <code>/qr-pix-sicredi.jpeg</code>.</p>
              {config.pixQrUrl ? (
                <div className="mt-2 inline-block bg-white p-2 rounded-lg">
                  <img src={config.pixQrUrl} alt="Preview do QR Code" className="max-h-32 max-w-[140px] object-contain" />
                </div>
              ) : null}
            </div>
          </div>

          {/* ─── Mensagem de agradecimento (Recibo) ──────────────────────────── */}
          <div className="border-t border-gray-700 pt-4">
            <label className="block text-sm font-medium text-gray-300 mb-1.5">Mensagem de Agradecimento (Recibo)</label>
            <textarea
              value={config.mensagemAgradecimento}
              onChange={(e) => setConfig({ ...config, mensagemAgradecimento: e.target.value })}
              placeholder="Agradecemos a preferência! Foi um prazer atender você..."
              rows={3}
              className="w-full bg-gray-700 border border-gray-600 rounded-lg px-4 py-2.5 text-white placeholder-gray-400 focus:outline-none focus:border-blue-500 transition resize-none"
            />
            <p className="text-xs text-gray-500 mt-1">Aparece no Recibo no lugar dos dados de PIX. Deixe em branco para usar a mensagem padrão.</p>
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

      {/* Auditoria por empresa — admin pode revisar mutações de OS, clientes,
          funcionários, finanças e usuários (quem fez, o quê, quando) */}
      {user.role === "admin" && <CompanyAuditPanel />}

      {/* Backup automático semanal — admin acompanha snapshots gerados */}
      {user.role === "admin" && <AutoBackupPanel addToast={addToast} />}

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
          <input name="mes"
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
                              {(() => {
                                const list = [...new Set((o.servicos || [])
                                  .map((sv) => EQUIPMENT_TYPES[sv.equipamentoTipo]?.label)
                                  .filter(Boolean))];
                                return list.length > 0 ? list.join(", ") : (EQUIPMENT_TYPES[o.equipamentoTipo]?.label || "—");
                              })()}
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

// ─── FOLHA DE PAGAMENTO ─────────────────────────────────────────────────────
// Módulo de RH leve: vales (adiantamentos salariais) + contracheques mensais.
// Vales: simples (funcionário/data/valor/motivo/status). Quando contracheque
// é gerado, os vales pendentes do funcionário no mês entram automaticamente
// como desconto e mudam pra status="descontado" ao fechar o contracheque.
// Contracheque calcula INSS/IRRF/FGTS via tabelas 2026 (calcINSS, calcIRRF).
// HTML imprimível segue o mesmo padrão dos outros docs do app.
function FolhaModule({ user, addToast, employees, reloadData }) {
  const [tab, setTab] = useState("vales");
  const [vales, setVales] = useState([]);
  const [contracheques, setContracheques] = useState([]);
  const [showValeForm, setShowValeForm] = useState(false);
  const [showCcForm, setShowCcForm] = useState(false);
  const [editingVale, setEditingVale] = useState(null);
  const [editingCc, setEditingCc] = useState(null);
  const [reload, setReload] = useState(0);

  // Carrega dados locais via DB (que já está company-scoped)
  useEffect(() => {
    setVales((DB.list("erp:vale:") || []).sort((a, b) => (b.data || "").localeCompare(a.data || "")));
    setContracheques((DB.list("erp:contracheque:") || []).sort((a, b) => (b.mesRef || "").localeCompare(a.mesRef || "")));
  }, [reload]);

  const reloadLocal = () => setReload((r) => r + 1);
  const empById = useMemo(() => {
    const m = {};
    (employees || []).forEach((e) => { m[e.id] = e; });
    return m;
  }, [employees]);

  // ─── Vales: CRUD ──────────────────────────────────────────────────────────
  const saveVale = (data) => {
    const id = data.id || ("vale_" + genId());
    const vale = {
      id,
      employeeId: data.employeeId,
      data: data.data,
      valor: Number(data.valor) || 0,
      motivo: data.motivo || "",
      status: data.status || "pendente",
      criadoEm: data.criadoEm || new Date().toISOString(),
      criadoPor: user?.nome || user?.email || "",
    };
    DB.set("erp:vale:" + id, vale);
    addToast?.(data.id ? "Vale atualizado" : "Vale registrado", "success");
    setShowValeForm(false);
    setEditingVale(null);
    reloadLocal();
  };
  const deleteVale = (vale) => {
    if (!window.confirm(`Excluir vale de ${_fmtBRL(vale.valor)}? Esta ação não pode ser desfeita.`)) return;
    DB.delete("erp:vale:" + vale.id);
    addToast?.("Vale excluído", "success");
    reloadLocal();
  };
  const printVale = (vale) => {
    openHTMLDoc(generateValeHTML(vale, empById[vale.employeeId]));
  };

  // ─── Contracheque: geração + cálculo ──────────────────────────────────────
  const saveContracheque = (data) => {
    const id = data.id || ("cc_" + genId());
    const cc = {
      id,
      employeeId: data.employeeId,
      mesRef: data.mesRef,
      salarioBase: Number(data.salarioBase) || 0,
      adicionais: (data.adicionais || []).filter((a) => Number(a.valor) > 0),
      descontos: (data.descontos || []).filter((d) => Number(d.valor) > 0),
      dependentes: Number(data.dependentes) || 0,
      // Flags fiscais — salvas no contracheque pra reproduzir o cálculo histórico
      // mesmo se o funcionário for editado depois (auditoria preserva contexto).
      descontaINSS: data.descontaINSS !== false,
      descontaIRRF: data.descontaIRRF !== false,
      inss: Number(data.inss) || 0,
      irrf: Number(data.irrf) || 0,
      totalProventos: Number(data.totalProventos) || 0,
      totalDescontos: Number(data.totalDescontos) || 0,
      liquido: Number(data.liquido) || 0,
      status: data.status || "rascunho",
      paidAt: data.paidAt || null,
      criadoEm: data.criadoEm || new Date().toISOString(),
      criadoPor: user?.nome || user?.email || "",
    };
    DB.set("erp:contracheque:" + id, cc);
    addToast?.(data.id ? "Contracheque atualizado" : "Contracheque gerado", "success");
    setShowCcForm(false);
    setEditingCc(null);
    reloadLocal();
  };

  // Fecha contracheque: marca como pago, liga vales como descontados,
  // e lança despesa de salário no financeiro pra fechar o ciclo contábil.
  const fecharContracheque = (cc) => {
    if (cc.status === "pago") {
      addToast?.("Contracheque já foi fechado", "warning");
      return;
    }
    if (!window.confirm(`Fechar e marcar como PAGO o contracheque de ${empById[cc.employeeId]?.nome || ""} (${cc.mesRef})?\nIsso vai:\n• Marcar vales descontados como quitados\n• Lançar despesa no financeiro`)) return;
    const updated = { ...cc, status: "pago", paidAt: new Date().toISOString() };
    DB.set("erp:contracheque:" + cc.id, updated);

    // Marca vales referenciados como descontados
    (cc.descontos || []).forEach((d) => {
      if (d.valeId) {
        const vale = DB.get("erp:vale:" + d.valeId);
        if (vale && vale.status !== "descontado") {
          DB.set("erp:vale:" + d.valeId, { ...vale, status: "descontado", contrachequeId: cc.id });
        }
      }
    });

    // Lança despesa no financeiro (categoria Salário)
    const txId = "fin_" + genId();
    const emp = empById[cc.employeeId] || {};
    const tx = {
      id: txId,
      tipo: "despesa",
      categoria: "Salário",
      descricao: `Salário ${cc.mesRef} — ${emp.nome || "Funcionário"}`,
      valor: Number(cc.liquido) || 0,
      data: new Date().toISOString().split("T")[0],
      formaPagamento: "Transferência",
      pagoEm: new Date().toISOString(),
      origem: "folha",
      contrachequeId: cc.id,
    };
    DB.set("erp:finance:" + txId, tx);

    addToast?.("Contracheque fechado e lançado no financeiro", "success");
    reloadLocal();
    reloadData?.();
  };

  const deleteContracheque = (cc) => {
    if (cc.status === "pago") {
      addToast?.("Não é possível excluir contracheque já pago. Reabra antes.", "warning");
      return;
    }
    if (!window.confirm(`Excluir contracheque ${cc.mesRef}?`)) return;
    DB.delete("erp:contracheque:" + cc.id);
    addToast?.("Contracheque excluído", "success");
    reloadLocal();
  };

  const reabrirContracheque = (cc) => {
    if (!window.confirm("Reabrir o contracheque para edição? A despesa no financeiro NÃO será removida automaticamente — remova manualmente se necessário.")) return;
    DB.set("erp:contracheque:" + cc.id, { ...cc, status: "rascunho", paidAt: null });
    addToast?.("Contracheque reaberto", "success");
    reloadLocal();
  };

  const printContracheque = (cc) => {
    openHTMLDoc(generateContrachequeHTML(cc, empById[cc.employeeId]));
  };

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-white">Folha de Pagamento</h1>
          <p className="text-sm text-slate-400">Vales e contracheques mensais</p>
        </div>
        <div className="flex gap-2">
          {tab === "vales" && (
            <button onClick={() => { setEditingVale(null); setShowValeForm(true); }}
              className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium">
              + Novo Vale
            </button>
          )}
          {tab === "contracheques" && (
            <button onClick={() => { setEditingCc(null); setShowCcForm(true); }}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium">
              + Gerar Contracheque
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-4 border-b border-slate-700">
        <button onClick={() => setTab("vales")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === "vales" ? "border-amber-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
          Vales ({vales.length})
        </button>
        <button onClick={() => setTab("contracheques")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition ${tab === "contracheques" ? "border-teal-500 text-white" : "border-transparent text-slate-400 hover:text-slate-200"}`}>
          Contracheques ({contracheques.length})
        </button>
      </div>

      {tab === "vales" && (
        <FolhaValesTab vales={vales} empById={empById}
          onEdit={(v) => { setEditingVale(v); setShowValeForm(true); }}
          onDelete={deleteVale} onPrint={printVale} />
      )}
      {tab === "contracheques" && (
        <FolhaContrachequesTab contracheques={contracheques} empById={empById}
          onEdit={(c) => { setEditingCc(c); setShowCcForm(true); }}
          onDelete={deleteContracheque} onPrint={printContracheque}
          onFechar={fecharContracheque} onReabrir={reabrirContracheque} />
      )}

      {showValeForm && (
        <ValeForm initial={editingVale} employees={employees || []}
          onSave={saveVale} onClose={() => { setShowValeForm(false); setEditingVale(null); }} />
      )}
      {showCcForm && (
        <ContrachequeForm initial={editingCc} employees={employees || []}
          vales={vales} onSave={saveContracheque}
          onClose={() => { setShowCcForm(false); setEditingCc(null); }} />
      )}
    </div>
  );
}

// ─── Sub-componente: tabela de vales ────────────────────────────────────────
function FolhaValesTab({ vales, empById, onEdit, onDelete, onPrint }) {
  if (vales.length === 0) {
    return <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-400">
      Nenhum vale cadastrado. Clique em <strong>+ Novo Vale</strong> para registrar.
    </div>;
  }
  return (
    <div className="bg-slate-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-700/60 text-xs uppercase text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left">Data</th>
            <th className="px-3 py-2 text-left">Funcionário</th>
            <th className="px-3 py-2 text-left">Motivo</th>
            <th className="px-3 py-2 text-right">Valor</th>
            <th className="px-3 py-2 text-center">Status</th>
            <th className="px-3 py-2 text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {vales.map((v) => {
            const emp = empById[v.employeeId];
            return (
              <tr key={v.id} className="border-t border-slate-700/50 text-white">
                <td className="px-3 py-2">{v.data ? new Date(v.data + "T00:00:00").toLocaleDateString("pt-BR") : "—"}</td>
                <td className="px-3 py-2">{emp?.nome || <span className="text-slate-500">(removido)</span>}</td>
                <td className="px-3 py-2 text-slate-300">{v.motivo || "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{_fmtBRL(v.valor)}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${v.status === "descontado" ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                    {v.status === "descontado" ? "Descontado" : "Pendente"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-2 justify-center">
                    <button onClick={() => onPrint(v)} className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded">Imprimir</button>
                    <button onClick={() => onEdit(v)} className="text-xs px-2 py-1 bg-blue-600/40 hover:bg-blue-600/60 rounded">Editar</button>
                    <button onClick={() => onDelete(v)} className="text-xs px-2 py-1 bg-red-600/30 hover:bg-red-600/50 rounded">Excluir</button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Sub-componente: tabela de contracheques ────────────────────────────────
function FolhaContrachequesTab({ contracheques, empById, onEdit, onDelete, onPrint, onFechar, onReabrir }) {
  if (contracheques.length === 0) {
    return <div className="bg-slate-800 rounded-lg p-8 text-center text-slate-400">
      Nenhum contracheque gerado. Clique em <strong>+ Gerar Contracheque</strong>.
    </div>;
  }
  return (
    <div className="bg-slate-800 rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-700/60 text-xs uppercase text-slate-300">
          <tr>
            <th className="px-3 py-2 text-left">Competência</th>
            <th className="px-3 py-2 text-left">Funcionário</th>
            <th className="px-3 py-2 text-right">Proventos</th>
            <th className="px-3 py-2 text-right">Descontos</th>
            <th className="px-3 py-2 text-right">Líquido</th>
            <th className="px-3 py-2 text-center">Status</th>
            <th className="px-3 py-2 text-center">Ações</th>
          </tr>
        </thead>
        <tbody>
          {contracheques.map((c) => {
            const emp = empById[c.employeeId];
            return (
              <tr key={c.id} className="border-t border-slate-700/50 text-white">
                <td className="px-3 py-2 font-mono">{c.mesRef}</td>
                <td className="px-3 py-2">{emp?.nome || <span className="text-slate-500">(removido)</span>}</td>
                <td className="px-3 py-2 text-right font-mono">{_fmtBRL(c.totalProventos)}</td>
                <td className="px-3 py-2 text-right font-mono text-red-400">{_fmtBRL(c.totalDescontos)}</td>
                <td className="px-3 py-2 text-right font-mono font-bold text-emerald-400">{_fmtBRL(c.liquido)}</td>
                <td className="px-3 py-2 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded ${c.status === "pago" ? "bg-emerald-500/20 text-emerald-400" : "bg-slate-600/40 text-slate-300"}`}>
                    {c.status === "pago" ? "Pago" : "Rascunho"}
                  </span>
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1 justify-center flex-wrap">
                    <button onClick={() => onPrint(c)} className="text-xs px-2 py-1 bg-slate-700 hover:bg-slate-600 rounded">Imprimir</button>
                    {c.status !== "pago" && (
                      <>
                        <button onClick={() => onEdit(c)} className="text-xs px-2 py-1 bg-blue-600/40 hover:bg-blue-600/60 rounded">Editar</button>
                        <button onClick={() => onFechar(c)} className="text-xs px-2 py-1 bg-emerald-600/40 hover:bg-emerald-600/60 rounded">Fechar</button>
                        <button onClick={() => onDelete(c)} className="text-xs px-2 py-1 bg-red-600/30 hover:bg-red-600/50 rounded">Excluir</button>
                      </>
                    )}
                    {c.status === "pago" && (
                      <button onClick={() => onReabrir(c)} className="text-xs px-2 py-1 bg-amber-600/30 hover:bg-amber-600/50 rounded">Reabrir</button>
                    )}
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Form de Vale ───────────────────────────────────────────────────────────
function ValeForm({ initial, employees, onSave, onClose }) {
  const [form, setForm] = useState(() => initial || {
    employeeId: employees[0]?.id || "",
    data: new Date().toISOString().split("T")[0],
    valor: "",
    motivo: "",
    status: "pendente",
  });
  const submit = () => {
    if (!form.employeeId) return alert("Selecione um funcionário");
    if (!form.data) return alert("Informe a data");
    if (!Number(form.valor) || Number(form.valor) <= 0) return alert("Valor deve ser maior que zero");
    onSave(form);
  };
  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-lg max-w-md w-full p-6">
        <h2 className="text-xl font-bold text-white mb-4">{initial ? "Editar Vale" : "Novo Vale"}</h2>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Funcionário</label>
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm">
              <option value="">— selecione —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-slate-300 mb-1">Data</label>
              <input type="date" value={form.data} onChange={(e) => setForm({ ...form, data: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
            </div>
            <div>
              <label className="block text-sm text-slate-300 mb-1">Valor (R$)</label>
              <input type="number" step="0.01" min="0" value={form.valor} onChange={(e) => setForm({ ...form, valor: e.target.value })}
                className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Motivo</label>
            <input value={form.motivo} onChange={(e) => setForm({ ...form, motivo: e.target.value })}
              placeholder="Adiantamento, emergência médica, etc"
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Status</label>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm">
              <option value="pendente">Pendente (será descontado no próximo contracheque)</option>
              <option value="descontado">Descontado</option>
            </select>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button onClick={onClose} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm">Cancelar</button>
          <button onClick={submit} className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm font-medium">Salvar</button>
        </div>
      </div>
    </div>
  );
}

// ─── Form de Contracheque (com cálculo automático) ──────────────────────────
function ContrachequeForm({ initial, employees, vales, onSave, onClose }) {
  const [form, setForm] = useState(() => {
    if (initial) return {
      ...initial,
      adicionais: initial.adicionais || [],
      descontos: initial.descontos || [],
      descontaINSS: initial.descontaINSS !== false,
      descontaIRRF: initial.descontaIRRF !== false,
    };
    return {
      employeeId: employees[0]?.id || "",
      mesRef: new Date().toISOString().slice(0, 7), // YYYY-MM
      salarioBase: "",
      adicionais: [],
      descontos: [],
      dependentes: 0,
      // Defaults: descontar INSS e IRRF (CLT). Para MEI/autônomo, desligar.
      descontaINSS: true,
      descontaIRRF: true,
    };
  });

  const emp = employees.find((e) => e.id === form.employeeId);

  // Quando muda funcionário, sugere salário base, dependentes e flags fiscais
  // a partir do cadastro do funcionário. Vales pendentes viram desconto automático.
  useEffect(() => {
    if (!emp || initial) return;
    const valesPendentes = (vales || []).filter((v) => v.employeeId === emp.id && v.status === "pendente");
    setForm((prev) => ({
      ...prev,
      salarioBase: prev.salarioBase || emp.salario || emp.salarioBase || "",
      dependentes: prev.dependentes || emp.dependentes || 0,
      descontaINSS: emp.descontaINSS !== false,
      descontaIRRF: emp.descontaIRRF !== false,
      descontos: valesPendentes.length > 0
        ? valesPendentes.map((v) => ({
            tipo: "vale",
            descricao: `Vale ${new Date(v.data + "T00:00:00").toLocaleDateString("pt-BR")} — ${v.motivo || "adiantamento"}`,
            valor: Number(v.valor) || 0,
            valeId: v.id,
          }))
        : prev.descontos,
    }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.employeeId]);

  const addAdicional = () => setForm({ ...form, adicionais: [...form.adicionais, { descricao: "", valor: "" }] });
  const updAdicional = (i, key, val) => {
    const next = [...form.adicionais];
    next[i] = { ...next[i], [key]: val };
    setForm({ ...form, adicionais: next });
  };
  const rmAdicional = (i) => setForm({ ...form, adicionais: form.adicionais.filter((_, idx) => idx !== i) });

  const addDesc = () => setForm({ ...form, descontos: [...form.descontos, { tipo: "outro", descricao: "", valor: "" }] });
  const updDesc = (i, key, val) => {
    const next = [...form.descontos];
    next[i] = { ...next[i], [key]: val };
    setForm({ ...form, descontos: next });
  };
  const rmDesc = (i) => setForm({ ...form, descontos: form.descontos.filter((_, idx) => idx !== i) });

  // Cálculos em tempo real — INSS/IRRF zerados se flag desligado (autônomo/MEI/PJ)
  const totalAdic = (form.adicionais || []).reduce((s, a) => s + (Number(a.valor) || 0), 0);
  const totalProventos = (Number(form.salarioBase) || 0) + totalAdic;
  const inss = form.descontaINSS ? calcINSS(totalProventos) : 0;
  const irrf = form.descontaIRRF ? calcIRRF(totalProventos, inss, form.dependentes) : 0;
  const totalOutrosDesc = (form.descontos || []).reduce((s, d) => s + (Number(d.valor) || 0), 0);
  const totalDescontos = inss + irrf + totalOutrosDesc;
  const liquido = totalProventos - totalDescontos;
  const fgts = calcFGTS(totalProventos);

  const submit = () => {
    if (!form.employeeId) return alert("Selecione um funcionário");
    if (!form.mesRef) return alert("Informe o mês de referência");
    if (!Number(form.salarioBase) || Number(form.salarioBase) <= 0) return alert("Informe o salário base");
    onSave({
      ...form,
      inss, irrf, totalProventos, totalDescontos, liquido,
      descontaINSS: !!form.descontaINSS,
      descontaIRRF: !!form.descontaIRRF,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-lg max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6">
        <h2 className="text-xl font-bold text-white mb-4">{initial ? "Editar Contracheque" : "Gerar Contracheque"}</h2>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
          <div>
            <label className="block text-sm text-slate-300 mb-1">Funcionário</label>
            <select value={form.employeeId} onChange={(e) => setForm({ ...form, employeeId: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm">
              <option value="">— selecione —</option>
              {employees.map((e) => <option key={e.id} value={e.id}>{e.nome}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Competência (mês/ano)</label>
            <input type="month" value={form.mesRef} onChange={(e) => setForm({ ...form, mesRef: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Salário base (R$)</label>
            <input type="number" step="0.01" min="0" value={form.salarioBase} onChange={(e) => setForm({ ...form, salarioBase: e.target.value })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
          </div>
          <div>
            <label className="block text-sm text-slate-300 mb-1">Dependentes (para IRRF)</label>
            <input type="number" min="0" value={form.dependentes} onChange={(e) => setForm({ ...form, dependentes: Number(e.target.value) || 0 })}
              className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
          </div>
        </div>

        {/* Toggles fiscais — puxam default do funcionário, mas podem ser sobrescritos */}
        <div className="bg-slate-900/40 rounded p-3 mb-4">
          <div className="text-xs uppercase text-slate-400 mb-2">Descontos previdenciários / fiscais</div>
          <div className="flex flex-wrap gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.descontaINSS}
                onChange={(e) => setForm({ ...form, descontaINSS: e.target.checked })}
                className="w-4 h-4 accent-red-500" />
              <span className="text-sm text-white">Descontar INSS {form.descontaINSS && totalProventos > 0 ? <span className="text-red-400 font-mono ml-1">(-{_fmtBRL(inss)})</span> : null}</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input type="checkbox" checked={!!form.descontaIRRF}
                onChange={(e) => setForm({ ...form, descontaIRRF: e.target.checked })}
                className="w-4 h-4 accent-red-500" />
              <span className="text-sm text-white">Descontar IRRF {form.descontaIRRF && totalProventos > 0 ? <span className="text-red-400 font-mono ml-1">(-{_fmtBRL(irrf)})</span> : null}</span>
            </label>
          </div>
          <p className="text-xs text-slate-500 mt-2">
            Default vem do cadastro do funcionário ({emp?.nome ? `"${emp.nome}"` : "selecione um"}).
            Desmarque para autônomo, MEI ou PJ.
          </p>
        </div>

        {/* Adicionais */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-semibold text-emerald-400">Adicionais / Proventos</h3>
            <button onClick={addAdicional} className="text-xs px-2 py-1 bg-emerald-600/30 hover:bg-emerald-600/50 text-emerald-300 rounded">+ Adicionar</button>
          </div>
          {form.adicionais.map((a, i) => (
            <div key={i} className="flex gap-2 mb-1">
              <input value={a.descricao} onChange={(e) => updAdicional(i, "descricao", e.target.value)}
                placeholder="Ex: Horas extras, comissão"
                className="flex-1 px-2 py-1 bg-slate-700 text-white rounded text-sm" />
              <input type="number" step="0.01" min="0" value={a.valor} onChange={(e) => updAdicional(i, "valor", e.target.value)}
                placeholder="R$"
                className="w-28 px-2 py-1 bg-slate-700 text-white rounded text-sm" />
              <button onClick={() => rmAdicional(i)} className="px-2 text-red-400 hover:text-red-300">×</button>
            </div>
          ))}
          {form.adicionais.length === 0 && <div className="text-xs text-slate-500">Nenhum adicional</div>}
        </div>

        {/* Descontos */}
        <div className="mb-4">
          <div className="flex justify-between items-center mb-2">
            <h3 className="text-sm font-semibold text-red-400">Descontos adicionais</h3>
            <button onClick={addDesc} className="text-xs px-2 py-1 bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded">+ Adicionar</button>
          </div>
          <p className="text-xs text-slate-500 mb-2">INSS e IRRF são calculados automaticamente. Vales pendentes do funcionário aparecem aqui.</p>
          {form.descontos.map((d, i) => (
            <div key={i} className="flex gap-2 mb-1 items-center">
              <input value={d.descricao} onChange={(e) => updDesc(i, "descricao", e.target.value)}
                placeholder="Descrição"
                className="flex-1 px-2 py-1 bg-slate-700 text-white rounded text-sm" />
              <input type="number" step="0.01" min="0" value={d.valor} onChange={(e) => updDesc(i, "valor", e.target.value)}
                placeholder="R$"
                className="w-28 px-2 py-1 bg-slate-700 text-white rounded text-sm" />
              {d.tipo === "vale" && <span className="text-xs text-amber-400 px-1">Vale</span>}
              <button onClick={() => rmDesc(i)} className="px-2 text-red-400 hover:text-red-300">×</button>
            </div>
          ))}
          {form.descontos.length === 0 && <div className="text-xs text-slate-500">Nenhum desconto adicional</div>}
        </div>

        {/* Resumo do cálculo */}
        <div className="bg-slate-900/60 rounded p-3 text-sm space-y-1 mb-4">
          <div className="flex justify-between"><span className="text-slate-400">Total proventos:</span><span className="text-emerald-400 font-mono">{_fmtBRL(totalProventos)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">INSS:</span><span className="text-red-400 font-mono">- {_fmtBRL(inss)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">IRRF:</span><span className="text-red-400 font-mono">- {_fmtBRL(irrf)}</span></div>
          <div className="flex justify-between"><span className="text-slate-400">Outros descontos:</span><span className="text-red-400 font-mono">- {_fmtBRL(totalOutrosDesc)}</span></div>
          <div className="border-t border-slate-700 pt-1 mt-1 flex justify-between"><span className="text-white font-semibold">Líquido a receber:</span><span className="text-emerald-300 font-mono font-bold text-base">{_fmtBRL(liquido)}</span></div>
          <div className="flex justify-between text-xs text-slate-500"><span>FGTS depositado pela empresa (8%):</span><span className="font-mono">{_fmtBRL(fgts)}</span></div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm">Cancelar</button>
          <button onClick={submit} className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded text-sm font-medium">Salvar Rascunho</button>
        </div>
      </div>
    </div>
  );
}

// ─── IA / ATENDIMENTO WhatsApp ──────────────────────────────────────────────
// Módulo que exibe as conversas geradas pelo agente N8N+Evolution e permite
// ao admin/atendente acompanhar em tempo real, intervir manualmente, encerrar
// a conversa e ver qual OS foi gerada. Lê das tabelas Supabase ai_conversations
// e ai_messages (criadas via docs/ai-agent/01-supabase-schema.sql).
//
// Realtime: usa supabase.channel para escutar INSERT em ai_messages — não
// precisa de polling. Fora do scope do kv_store/DB layer (são tabelas nativas).
function IAAtendimentoModule({ user, addToast }) {
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [config, setConfig] = useState(null);
  const [showConfig, setShowConfig] = useState(false);
  const member = getCurrentMember();
  const companyId = member?.company_id;
  const isAdmin = user?.role === "admin";

  // Carrega lista de conversas da empresa, ordenadas por última mensagem
  const loadConversations = useCallback(async () => {
    if (!supabase || !companyId) { setLoading(false); return; }
    const { data, error } = await supabase
      .from("ai_conversations")
      .select("*")
      .eq("company_id", companyId)
      .order("last_message_at", { ascending: false })
      .limit(200);
    if (error) { console.warn("Conversas:", error.message); addToast?.("Erro ao carregar conversas", "error"); }
    setConversations(data || []);
    setLoading(false);
  }, [companyId, addToast]);

  // Carrega histórico de mensagens da conversa selecionada
  const loadMessages = useCallback(async (convId) => {
    if (!supabase || !convId) { setMessages([]); return; }
    const { data, error } = await supabase
      .from("ai_messages")
      .select("*")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: true });
    if (error) { console.warn("Mensagens:", error.message); return; }
    setMessages(data || []);
    // Zera unread_count ao abrir
    await supabase.from("ai_conversations").update({ unread_count: 0 }).eq("id", convId);
  }, []);

  // Carrega config do agente (prompt, instância evolution, etc)
  const loadConfig = useCallback(async () => {
    if (!supabase || !companyId) return;
    const { data } = await supabase.from("ai_agent_config").select("*").eq("company_id", companyId).maybeSingle();
    setConfig(data || { company_id: companyId, enabled: false, evolution_instance: "", evolution_url: "", system_prompt: "", out_of_hours_message: "" });
  }, [companyId]);

  useEffect(() => { loadConversations(); loadConfig(); }, [loadConversations, loadConfig]);
  useEffect(() => { if (selectedId) loadMessages(selectedId); }, [selectedId, loadMessages]);

  // Realtime: escuta novas mensagens da empresa e atualiza UI ao vivo.
  // Recarrega a lista (para reordenar) e, se a mensagem for da conversa aberta, anexa.
  useEffect(() => {
    if (!supabase || !companyId) return;
    const ch = supabase
      .channel(`ai_msgs_${companyId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ai_messages", filter: `company_id=eq.${companyId}` },
        (payload) => {
          const msg = payload.new;
          loadConversations();
          if (msg.conversation_id === selectedId) {
            setMessages((prev) => [...prev, msg]);
          }
        })
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_conversations", filter: `company_id=eq.${companyId}` },
        () => loadConversations())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [companyId, selectedId, loadConversations]);

  const selected = conversations.find((c) => c.id === selectedId) || null;

  // Envia mensagem manual (admin) via Evolution API + grava no banco
  const sendManual = async () => {
    if (!draft.trim() || !selected || !config?.evolution_url || !config?.evolution_instance) {
      addToast?.("Configure a Evolution API antes de enviar", "warning");
      return;
    }
    setSending(true);
    try {
      // Envia pro WhatsApp
      const resp = await fetch(`${config.evolution_url.replace(/\/$/, "")}/message/sendText/${config.evolution_instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: config.metadata?.evolution_apikey || "" },
        body: JSON.stringify({ number: selected.customer_phone, text: draft }),
      });
      if (!resp.ok) throw new Error("Falha Evolution API");
      // Grava no histórico como admin
      await supabase.from("ai_messages").insert({
        conversation_id: selected.id,
        company_id: companyId,
        role: "admin",
        content: draft,
        metadata: { sent_by: user?.nome || user?.email },
      });
      setDraft("");
    } catch (err) {
      addToast?.(`Erro ao enviar: ${err.message}`, "error");
    } finally {
      setSending(false);
    }
  };

  // Encerra conversa (status=closed)
  const closeConversation = async () => {
    if (!selected) return;
    if (!window.confirm("Encerrar esta conversa? O cliente não receberá mais respostas da IA.")) return;
    await supabase.from("ai_conversations").update({ status: "closed" }).eq("id", selected.id);
    addToast?.("Conversa encerrada", "success");
  };

  // Devolve para a IA (status=active) — útil após admin intervir e quer reativar bot
  const reactivateAI = async () => {
    if (!selected) return;
    await supabase.from("ai_conversations").update({ status: "active", ai_handoff_reason: null }).eq("id", selected.id);
    addToast?.("IA reativada para essa conversa", "success");
  };

  // Salva config do agente
  const saveConfig = async () => {
    if (!supabase || !companyId) return;
    const { error } = await supabase.from("ai_agent_config").upsert({ ...config, company_id: companyId, updated_at: new Date().toISOString() });
    if (error) { addToast?.(`Erro: ${error.message}`, "error"); return; }
    addToast?.("Configuração salva", "success");
    setShowConfig(false);
  };

  if (!supabase) {
    return (
      <div className="p-6 text-center text-slate-400">
        <p>Supabase não configurado. O módulo de IA exige conexão com o banco.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-2xl font-bold text-white">IA / Atendimento WhatsApp</h1>
          <p className="text-sm text-slate-400">Conversas geradas pelo agente automático</p>
        </div>
        {isAdmin && (
          <button onClick={() => setShowConfig(true)} className="px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg text-sm">
            Configurações do Agente
          </button>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 flex-1 min-h-0">
        {/* Lista de conversas */}
        <div className="bg-slate-800 rounded-lg overflow-hidden flex flex-col">
          <div className="px-3 py-2 border-b border-slate-700 text-xs uppercase text-slate-400 font-semibold">
            Conversas ({conversations.length})
          </div>
          <div className="overflow-y-auto flex-1">
            {loading && <div className="p-4 text-slate-500 text-sm">Carregando...</div>}
            {!loading && conversations.length === 0 && (
              <div className="p-4 text-slate-500 text-sm">Nenhuma conversa ainda. Quando o cliente mandar WhatsApp, vai aparecer aqui.</div>
            )}
            {conversations.map((c) => (
              <button key={c.id} onClick={() => setSelectedId(c.id)}
                className={`w-full text-left px-3 py-3 border-b border-slate-700/50 hover:bg-slate-700/40 ${selectedId === c.id ? "bg-slate-700/60" : ""}`}>
                <div className="flex items-center justify-between">
                  <span className="font-medium text-white text-sm truncate">{c.customer_name || c.customer_phone}</span>
                  {c.unread_count > 0 && (
                    <span className="bg-blue-500 text-white text-xs px-2 py-0.5 rounded-full">{c.unread_count}</span>
                  )}
                </div>
                <div className="flex items-center justify-between mt-1">
                  <span className="text-xs text-slate-400">{c.customer_phone}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${
                    c.status === "active" ? "bg-green-500/20 text-green-400" :
                    c.status === "pending_human" ? "bg-yellow-500/20 text-yellow-400" :
                    "bg-slate-600/40 text-slate-400"
                  }`}>
                    {c.status === "active" ? "IA" : c.status === "pending_human" ? "Aguarda admin" : "Encerrada"}
                  </span>
                </div>
                <div className="text-xs text-slate-500 mt-1">{new Date(c.last_message_at).toLocaleString("pt-BR")}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Painel da conversa selecionada */}
        <div className="md:col-span-2 bg-slate-800 rounded-lg flex flex-col">
          {!selected && (
            <div className="flex-1 flex items-center justify-center text-slate-500">
              Selecione uma conversa
            </div>
          )}
          {selected && (
            <>
              <div className="px-4 py-3 border-b border-slate-700 flex items-center justify-between">
                <div>
                  <div className="font-semibold text-white">{selected.customer_name || selected.customer_phone}</div>
                  <div className="text-xs text-slate-400">{selected.customer_phone}{selected.linked_os_id ? ` · OS #${selected.linked_os_id}` : ""}</div>
                  {selected.ai_handoff_reason && (
                    <div className="text-xs text-yellow-400 mt-1">⚠ {selected.ai_handoff_reason}</div>
                  )}
                </div>
                <div className="flex gap-2">
                  {selected.status === "active" && (
                    <button onClick={() => supabase.from("ai_conversations").update({ status: "pending_human" }).eq("id", selected.id)}
                      className="px-3 py-1 text-xs bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 rounded">
                      Assumir
                    </button>
                  )}
                  {selected.status === "pending_human" && (
                    <button onClick={reactivateAI} className="px-3 py-1 text-xs bg-green-500/20 text-green-400 hover:bg-green-500/30 rounded">
                      Devolver à IA
                    </button>
                  )}
                  {selected.status !== "closed" && (
                    <button onClick={closeConversation} className="px-3 py-1 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded">
                      Encerrar
                    </button>
                  )}
                </div>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
                {messages.map((m) => (
                  <div key={m.id} className={`flex ${m.role === "customer" ? "justify-start" : "justify-end"}`}>
                    <div className={`max-w-[75%] px-3 py-2 rounded-lg text-sm ${
                      m.role === "customer" ? "bg-slate-700 text-white" :
                      m.role === "agent" ? "bg-blue-600 text-white" :
                      m.role === "admin" ? "bg-emerald-600 text-white" :
                      "bg-slate-600 text-slate-300 italic"
                    }`}>
                      <div className="text-xs opacity-70 mb-1">
                        {m.role === "customer" ? "Cliente" : m.role === "agent" ? "IA" : m.role === "admin" ? "Admin" : "Sistema"}
                        <span className="ml-2">{new Date(m.created_at).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}</span>
                      </div>
                      <div className="whitespace-pre-wrap break-words">{m.content}</div>
                    </div>
                  </div>
                ))}
              </div>

              {selected.status !== "closed" && (
                <div className="border-t border-slate-700 p-3 flex gap-2">
                  <input value={draft} onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && sendManual()}
                    placeholder="Digite uma mensagem manual..."
                    className="flex-1 px-3 py-2 bg-slate-700 text-white rounded text-sm" />
                  <button onClick={sendManual} disabled={sending || !draft.trim()}
                    className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded text-sm">
                    {sending ? "..." : "Enviar"}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Modal de configuração */}
      {showConfig && config && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
          <div className="bg-slate-800 rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6">
            <h2 className="text-xl font-bold text-white mb-4">Configurações do Agente IA</h2>
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-white">
                <input type="checkbox" checked={!!config.enabled} onChange={(e) => setConfig({ ...config, enabled: e.target.checked })} />
                Agente ativo (responde mensagens automaticamente)
              </label>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Nome da instância (Evolution API)</label>
                <input value={config.evolution_instance || ""} onChange={(e) => setConfig({ ...config, evolution_instance: e.target.value })}
                  placeholder="frost-empresa1" className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">URL pública da Evolution API</label>
                <input value={config.evolution_url || ""} onChange={(e) => setConfig({ ...config, evolution_url: e.target.value })}
                  placeholder="https://evolution.seudominio.com" className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Prompt do sistema</label>
                <textarea value={config.system_prompt || ""} onChange={(e) => setConfig({ ...config, system_prompt: e.target.value })}
                  rows={10} className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm font-mono" />
              </div>
              <div>
                <label className="block text-sm text-slate-300 mb-1">Mensagem fora do horário</label>
                <textarea value={config.out_of_hours_message || ""} onChange={(e) => setConfig({ ...config, out_of_hours_message: e.target.value })}
                  rows={2} className="w-full px-3 py-2 bg-slate-700 text-white rounded text-sm" />
              </div>
              <p className="text-xs text-slate-400">
                Ver guia completo em <code>docs/ai-agent/03-setup-guide.md</code>
              </p>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setShowConfig(false)} className="px-4 py-2 bg-slate-600 hover:bg-slate-500 text-white rounded text-sm">Cancelar</button>
              <button onClick={saveConfig} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded text-sm">Salvar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TÉCNICO MOBILE APP ─────────────────────────────────────────────────────
// Shell totalmente separado renderizado quando o usuário logado tem role="tecnico".
// Não usa sidebar — UI mobile-first focada exclusivamente nas demandas do técnico.
// Fluxo: vê OS atribuídas → marca chegada → preenche relatório+fotos → finaliza.
function TecnicoMobileApp({ user, onLogout, addToast, theme, setTheme }) {
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
        <div className="flex items-center gap-2">
          {/* Toggle tema — técnico também alterna entre dark e light */}
          {typeof setTheme === "function" && (
            <button
              type="button"
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              className="p-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
              title={theme === "dark" ? "Mudar para Light Mode" : "Mudar para Dark Mode"}
              aria-label="Alternar tema"
            >
              {theme === "dark" ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.05 16.95l-1.41 1.41m12.72 0l-1.41-1.41M7.05 7.05L5.64 5.64M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>
          )}
          <button
            onClick={onLogout}
            className="text-xs px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 transition"
          >
            Sair
          </button>
        </div>
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
              {(() => {
                const list = [...new Set((os.servicos || [])
                  .map((s) => EQUIPMENT_TYPES[s.equipamentoTipo]?.label)
                  .filter(Boolean))];
                if (list.length === 0) return EQUIPMENT_TYPES[os.equipamentoTipo]?.label || "—";
                if (list.length === 1) return list[0];
                return `${list.length} equipamentos`;
              })()}
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
  const [fotos, setFotos] = useState(os.fotos || []); // array de URLs (publicas e blob: temporarias durante upload)
  // Conjunto de URLs que sao videos (necessario para blob: que nao tem extensao)
  const [videoUrls, setVideoUrls] = useState(() => {
    const s = new Set();
    (os.fotos || []).forEach((u) => { if (isVideoUrl(u)) s.add(u); });
    return s;
  });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  // ─── Botão "voltar" Android/navegador fecha esta tela ao invés de sair do app ───
  // Mesmo motivo do Modal: deps vazias + ref para onClose, senão re-render do pai
  // dispararia cleanup → history.back() → tela fecharia sozinha ao interagir.
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);
  useEffect(() => {
    let poppedByBack = false;
    window.history.pushState({ tecnicoDetail: true }, "");
    const onPop = () => {
      poppedByBack = true;
      closeRef.current?.();
    };
    window.addEventListener("popstate", onPop);
    return () => {
      window.removeEventListener("popstate", onPop);
      if (!poppedByBack && window.history.state?.tecnicoDetail) {
        window.history.back();
      }
    };
  }, []);

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

  // ─── Upload de fotos/videos: captura/galeria (mobile) ───
  // Estrategia otimista: cria blob: URL imediatamente para preview, depois
  // sobe pro Supabase em paralelo e troca o blob: pelo URL publico quando
  // terminar. Em caso de falha no upload, remove o blob: da lista.
  const handleFotosChange = async (e) => {
    const files = Array.from(e.target.files || []);
    if (files.length === 0) return;
    setUploading(true);

    const blobUrls = files.map((f) => URL.createObjectURL(f));
    const isVideoFlags = files.map((f) => (f.type || "").startsWith("video/"));

    // Marca quais blob: sao videos antes de inseri-los na grid
    setVideoUrls((prev) => {
      const next = new Set(prev);
      blobUrls.forEach((u, i) => { if (isVideoFlags[i]) next.add(u); });
      return next;
    });
    setFotos((prev) => [...prev, ...blobUrls]);

    let okCount = 0;
    await Promise.all(files.map(async (file, i) => {
      const tempUrl = blobUrls[i];
      try {
        const url = await uploadFotoOS(file, os.id);
        if (url) {
          okCount++;
          setFotos((prev) => prev.map((u) => (u === tempUrl ? url : u)));
          setVideoUrls((prev) => {
            const next = new Set(prev);
            if (next.delete(tempUrl) && isVideoFlags[i]) next.add(url);
            return next;
          });
        } else {
          // upload falhou — remove blob: da lista
          setFotos((prev) => prev.filter((u) => u !== tempUrl));
          setVideoUrls((prev) => { const n = new Set(prev); n.delete(tempUrl); return n; });
        }
      } catch (err) {
        setFotos((prev) => prev.filter((u) => u !== tempUrl));
        setVideoUrls((prev) => { const n = new Set(prev); n.delete(tempUrl); return n; });
      } finally {
        URL.revokeObjectURL(tempUrl);
      }
    }));

    setUploading(false);
    if (okCount > 0) addToast(`${okCount} arquivo(s) enviado(s)`, "success");
    else addToast("Falha no upload", "error");
    e.target.value = "";
  };

  // ─── Remove foto/video antes de finalizar ───
  const removeFoto = async (url) => {
    if (!confirm("Remover este arquivo?")) return;
    if (!url.startsWith("blob:")) await deleteFotoOS(url);
    setFotos((prev) => prev.filter((u) => u !== url));
    setVideoUrls((prev) => { const n = new Set(prev); n.delete(url); return n; });
  };

  // Helper local: combina deteccao por extensao + Set de blobs identificados como video
  const isVideoLocal = (url) => isVideoUrl(url) || videoUrls.has(url);

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
            <span className="text-right">
              {(() => {
                const list = [...new Set((os.servicos || [])
                  .map((s) => EQUIPMENT_TYPES[s.equipamentoTipo]?.label)
                  .filter(Boolean))];
                if (list.length === 0) return EQUIPMENT_TYPES[os.equipamentoTipo]?.label || "—";
                return list.length > 1 ? `${list.length} equipamentos (ver abaixo)` : list[0];
              })()}
            </span>
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

        {/* Lista de serviços previstos — cada serviço com seu próprio equipamento */}
        {(os.servicos || []).length > 0 && (
          <section className="bg-gray-800 border border-gray-700 rounded-xl p-4">
            <h3 className="text-xs font-semibold text-gray-400 mb-2">SERVIÇOS PREVISTOS</h3>
            <ul className="text-sm space-y-3">
              {os.servicos.map((s, i) => {
                const equipLabel = EQUIPMENT_TYPES[s.equipamentoTipo]?.label;
                const detalhes = [
                  equipLabel,
                  s.equipamentoModelo,
                  s.equipamentoCapacidade,
                ].filter(Boolean).join(" • ");
                return (
                  <li key={i} className="border-l-2 border-cyan-500/50 pl-3">
                    <div className="font-semibold">{s.tipo}</div>
                    {s.descricao && <div className="text-xs text-gray-300">{s.descricao}</div>}
                    {detalhes && <div className="text-xs text-cyan-400 mt-1">🔧 {detalhes}</div>}
                  </li>
                );
              })}
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
              <textarea name="descricao"
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
                // Dois botoes para que o tecnico possa abrir camera ou pegar
                // arquivos ja salvos (fotos e videos) na galeria
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <label className="block py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-center text-sm font-semibold cursor-pointer transition">
                    {uploading ? "..." : "📷 Câmera"}
                    <input
                      name="cameraFotos"
                      type="file"
                      accept="image/*,video/*"
                      capture="environment"
                      multiple
                      onChange={handleFotosChange}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                  <label className="block py-3 rounded-lg bg-gray-700 hover:bg-gray-600 text-center text-sm font-semibold cursor-pointer transition">
                    {uploading ? "..." : "🖼️ Galeria"}
                    <input
                      name="galeriaFotos"
                      type="file"
                      accept="image/*,video/*"
                      multiple
                      onChange={handleFotosChange}
                      disabled={uploading}
                      className="hidden"
                    />
                  </label>
                </div>
              )}

              {fotos.length > 0 && (
                <div className="grid grid-cols-3 gap-2">
                  {fotos.map((url) => (
                    <div key={url} className="relative aspect-square bg-gray-900 rounded-lg overflow-hidden">
                      {/* Renderiza video com controles quando o arquivo for video; caso contrario imagem */}
                      {isVideoLocal(url) ? (
                        <video
                          src={url}
                          controls
                          playsInline
                          preload="metadata"
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <img
                          src={url}
                          alt="Foto serviço"
                          className="w-full h-full object-cover"
                        />
                      )}
                      {!finalizado && (
                        <button
                          onClick={() => removeFoto(url)}
                          className="absolute -top-1 -right-1 w-6 h-6 rounded-full bg-red-600 text-xs flex items-center justify-center z-10"
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
  // ─── Tema (dark/light) — persistido em DB e aplicado no body via data-theme ───
  const [theme, setTheme] = useState(() => {
    try {
      return DB.get("erp:theme") || "dark";
    } catch {
      return "dark";
    }
  });
  useEffect(() => {
    document.body.setAttribute("data-theme", theme);
    DB.set("erp:theme", theme);
  }, [theme]);
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
  // ─── Master mode (multi-tenant) ───────────────────────────────────────────
  // masterMode: ?master=1 na URL OU sessão master ativa. Mostra fluxo de login master.
  const [masterMode, setMasterMode] = useState(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      if (params.get("master") === "1") return true;
      const raw = sessionStorage.getItem("frost_master_session");
      return !!raw;
    } catch { return false; }
  });
  const [masterUser, setMasterUser] = useState(null);
  const [needsFirstMaster, setNeedsFirstMaster] = useState(false);
  const searchRef = useRef(null);
  const lastActivityRef = useRef(Date.now());

  // ─── Load All Data ───
  // Precisa ser declarado ANTES dos useEffect que o referenciam no array
  // de deps — caso contrário, o array `[user, loadAllData]` cai no TDZ
  // durante o primeiro render (TDZ = Temporal Dead Zone, runtime).
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

  // ─── Init com Splash de 3 segundos + restauração de sessão ───
  useEffect(() => {
    // Splash de 3s com fade-out
    const t1 = setTimeout(() => {
      setSplashFading(true);
      const t2 = setTimeout(() => setSplashVisible(false), 600);
      return () => clearTimeout(t2);
    }, 3000);

    // Real init — restaura sessão Supabase (se houver), só então hidrata.
    // RLS bloqueia leitura sem auth, então sem session hydrate é no-op (e isso é OK).
    ensureMemberLoaded().then(() => hydrateFromSupabase()).then(async () => {
      // Inicialização: popula dados demo se for o primeiro acesso (sem usuários)
      await seedDatabase();
      // Multi-tenant: garante company padrão e tagga registros legados
      ensureCompanyMigration();
      // Catálogo padrão de serviços (idempotente — pula códigos já cadastrados)
      seedServiceCatalog();
      // Catálogo padrão de produtos + estoque inicial 10 (idempotente)
      seedProductCatalog();
      loadAllData();
      setLoading(false);
      // Master mode: verifica se já existe master cadastrado
      if (masterMode) {
        // Hidrata masters do Supabase (cross-device sync) antes de decidir
        // se mostra FirstMasterSetup ou MasterLoginScreen.
        let remoteMasters = [];
        try {
          remoteMasters = await listMastersRemote();
          remoteMasters.forEach(m => {
            window.storage.setItem(MASTER_PREFIX + m.id, JSON.stringify(m));
          });
        } catch { /* offline — usa local */ }
        // Migracao: masters cadastrados antes da feature de sync ainda só
        // existem local. Faz upload pra ficarem disponiveis em outros devices.
        try {
          const remoteIds = new Set(remoteMasters.map(m => m.id));
          const localMasters = DB.listAll(MASTER_PREFIX);
          for (const m of localMasters) {
            if (m.id && !remoteIds.has(m.id)) {
              await upsertMasterRemote(m);
            }
          }
        } catch { /* ignora — nao bloqueia boot */ }
        const masters = DB.listAll(MASTER_PREFIX);
        if (masters.length === 0) setNeedsFirstMaster(true);
        // Restaura sessão master se houver
        try {
          const raw = sessionStorage.getItem("frost_master_session");
          if (raw) {
            const sess = JSON.parse(raw);
            const found = DB.get(MASTER_PREFIX + sess.id);
            if (found) setMasterUser(found);
            else sessionStorage.removeItem("frost_master_session");
          }
        } catch { /* ignora */ }
      }
      // Se não há nenhum usuário cadastrado, exige criação do super admin
      const usersCount = DB.listAll("erp:user:").length;
      if (usersCount === 0 && !masterMode) setNeedsFirstUser(true);
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
              // Empresa bloqueada pelo Master também invalida a sessão
              const companyOk = (() => {
                if (!savedUser.companyId) return true;
                const c = DB.get("erp:company:" + savedUser.companyId);
                return !c || c.ativo !== false;
              })();
              if (!companyOk) {
                sessionStorage.removeItem("frost_session");
              } else {
                // Restaura scope da company antes de marcar user (loadAllData pode rodar em seguida)
                setActiveCompanyId(savedUser.companyId || DEFAULT_COMPANY_ID);
                setActiveUser(savedUser);
                migrateLegacyConfigOnce(savedUser.companyId || DEFAULT_COMPANY_ID);
                try { ensureAutoBackup(savedUser.companyId || DEFAULT_COMPANY_ID); } catch { /* ignora */ }
                setUser(savedUser);
                lastActivityRef.current = Date.now();
                sessionStorage.setItem("frost_session", JSON.stringify({ ...session, lastActivity: Date.now() }));
              }
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

    // (Realtime foi movido para useEffect próprio que depende de `user`,
    //  porque o canal precisa do company_id que só existe pós-login.)

    return () => { clearTimeout(t1); };
  }, []);

  // Realtime: re-assina quando o usuário muda (login estabelece scope de company)
  useEffect(() => {
    if (!user) return; // sem login → sem canal
    let realtimeTimer = null;
    const unsubscribe = subscribeToChanges(() => {
      if (realtimeTimer) clearTimeout(realtimeTimer);
      realtimeTimer = setTimeout(() => { loadAllData(); }, 300);
    });
    return () => {
      if (realtimeTimer) clearTimeout(realtimeTimer);
      unsubscribe();
    };
  }, [user, loadAllData]);

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
    // Ícones agora usam FrostIcon (variante minimal). Campo `iconName` mapeia para FrostIcons.jsx.
    const items = [
      { id: "dashboard", label: "Dashboard", iconName: "dashboard", module: "dashboard" },
      { id: "processos", label: "Ordens de Serviço", iconName: "os", module: "os" },
      { id: "agenda", label: "Agenda", iconName: "agenda", module: "agenda" },
      { id: "financeiro", label: "Financeiro", iconName: "financeiro", module: "financeiro" },
      { id: "cadastro", label: "Cadastros", iconName: "cadastros", module: "clientes" },
      { id: "ia", label: "IA / Atendimento", iconName: "agenda", module: "ia" },
      { id: "folha", label: "Folha de Pagamento", iconName: "financeiro", module: "folha" },
      { id: "config", label: "Configurações", iconName: "config", module: "config" },
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
    // Multi-tenant: ativa scope da company desse usuário (afeta DB.list/DB.set posteriores)
    setActiveCompanyId(updated.companyId || DEFAULT_COMPANY_ID);
    setActiveUser(updated);
    // Migração one-shot do erp:config legado (global) para a primeira company que logar.
    // Empresas criadas depois NÃO herdam — começam com config em branco.
    migrateLegacyConfigOnce(updated.companyId || DEFAULT_COMPANY_ID);
    // Backup automático semanal — se já passou 7+ dias do último, gera novo
    try { ensureAutoBackup(updated.companyId || DEFAULT_COMPANY_ID); } catch { /* não bloqueia login */ }
    sessionStorage.setItem("frost_session", JSON.stringify({
      userId: updated.id, loginAt: Date.now(), lastActivity: Date.now(), token,
    }));
    return updated;
  }, []);

  // ─── Master: handlers de login/logout (sessão paralela à do tenant) ─────
  const handleMasterLogin = useCallback((m) => {
    setActiveCompanyId(null); // master não tem company
    sessionStorage.setItem("frost_master_session", JSON.stringify({ id: m.id, loginAt: Date.now() }));
    setMasterUser(m);
    setNeedsFirstMaster(false);
  }, []);

  const handleMasterLogout = useCallback(() => {
    sessionStorage.removeItem("frost_master_session");
    setMasterUser(null);
    // Sai do modo master e volta para login normal — limpa ?master=1
    setMasterMode(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("master");
      window.history.replaceState({}, "", url.toString());
    } catch { /* ignora */ }
  }, []);

  const handleFirstMasterCreated = useCallback((m) => {
    handleMasterLogin(m);
  }, [handleMasterLogin]);

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
    // Limpa scope da company para evitar leak entre logins
    setActiveCompanyId(null);
    setActiveUser(null);
    setUser(null);
    setPendingPasswordChange(null);
    setActiveModule("dashboard");
    setGlobalSearch("");
    setGlobalSearchResults([]);
    sessionStorage.removeItem("frost_session");
    // Encerra a sessão do Supabase Auth (limpa JWT do localStorage do supabase-js)
    signOutSupabase();
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
        {/* Splash: logo animada completa (frosterp_logo_animated) ocupa ~95% da tela */}
        <AnimatedLogo
          className="drop-shadow-[0_8px_24px_rgba(96,165,250,0.45)]"
          style={{ width: "95vmin", height: "auto" }}
        />
      </div>
    );
  }

  // ─── Master mode: fluxos paralelos ao login da empresa ──────────────────
  if (masterMode && !masterUser) {
    if (needsFirstMaster) {
      return (
        <>
          <StyleSheet />
          <FirstMasterSetup onComplete={handleFirstMasterCreated} theme={theme} setTheme={setTheme} />
        </>
      );
    }
    return (
      <>
        <StyleSheet />
        <MasterLoginScreen
          onLogin={handleMasterLogin}
          onCancel={() => setMasterMode(false)}
          theme={theme}
          setTheme={setTheme}
        />
      </>
    );
  }

  if (masterUser) {
    return (
      <>
        <StyleSheet />
        <ToastContainer toasts={toasts} removeToast={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
        <MasterApp
          master={masterUser}
          onLogout={handleMasterLogout}
          addToast={addToast}
          theme={theme}
          setTheme={setTheme}
        />
      </>
    );
  }

  // Primeiro acesso: nenhum usuário cadastrado → cria super admin.
  // Botão "já tenho conta" pula pra LoginScreen (caso novo device com conta sincronizável).
  if (needsFirstUser && !user) {
    return (
      <>
        <StyleSheet />
        <FirstUserSetup
          onComplete={handleFirstUserCreated}
          onSwitchToLogin={() => setNeedsFirstUser(false)}
        />
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
        <LoginScreen
          onLogin={handleLogin}
          theme={theme}
          setTheme={setTheme}
          onSwitchToMaster={() => setMasterMode(true)}
        />
      </>
    );
  }

  // ─── Roteamento por role: técnico vê app mobile dedicado, sem sidebar ───
  if (user.role === "tecnico") {
    return (
      <>
        <ToastContainer toasts={toasts} removeToast={(id) => setToasts((prev) => prev.filter((x) => x.id !== id))} />
        <TecnicoMobileApp user={user} onLogout={handleLogout} addToast={addToast} theme={theme} setTheme={setTheme} />
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
        {/* Logo + identificação da empresa logada — substitui marca padrão pela logo+nome
            da empresa do usuário ativo. Quando não há logoUrl cadastrada, mostra fallback
            (snowflake do FrostERP) com inicial da empresa para distinção visual. */}
        {(() => {
          const activeCompany = user?.companyId ? DB.get("erp:company:" + user.companyId) : null;
          const companyName = activeCompany?.nome || "FROSTErp";
          const companyLogo = activeCompany?.logoUrl;
          // Logo expandida: ocupa quase toda largura da sidebar (w-64), height alto, sem moldura.
          // Logos retangulares (a maioria) ficam grandes e legíveis.
          // Colapsada: só ícone quadrado pequeno (sem nome).
          return sidebarCollapsed ? (
            <div className="flex items-center justify-center px-2 py-3 border-b border-gray-700">
              {companyLogo ? (
                <img
                  src={companyLogo}
                  alt={companyName}
                  className="h-10 w-10 rounded-md object-contain"
                  onError={(e) => { e.target.onerror = null; e.target.src = "/frosterp-snowflake.svg"; }}
                />
              ) : (
                <img src="/frosterp-snowflake.svg" alt={companyName} className="h-10 w-auto" />
              )}
            </div>
          ) : (
            <div className="flex flex-col items-center gap-2 px-3 py-4 border-b border-gray-700">
              {companyLogo ? (
                <img
                  src={companyLogo}
                  alt={companyName}
                  className="max-h-20 w-auto max-w-full object-contain"
                  onError={(e) => { e.target.onerror = null; e.target.src = "/frosterp-snowflake.svg"; }}
                />
              ) : (
                <img src="/frosterp-snowflake.svg" alt={companyName} className="h-16 w-auto" />
              )}
              <div className="text-center w-full">
                <p className="text-sm font-bold text-white truncate leading-tight" title={companyName}>{companyName}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">Gestão Integrada</p>
              </div>
            </div>
          );
        })()}

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
              {/* Ícone minimal — branco quando ativo, cinza quando inativo (segue padrão FrostERP Icon Pack) */}
              <span className="flex-shrink-0">
                <FrostIcon
                  name={item.iconName}
                  variant="minimal"
                  size={18}
                  color={activeModule === item.id ? "#ffffff" : "#94a3b8"}
                />
              </span>
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

            {/* Toggle Tema (Dark/Light) — alterna data-theme no body e persiste em DB */}
            <button
              onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
              className="p-2 rounded-lg text-gray-400 hover:text-white hover:bg-gray-700 transition"
              title={theme === "dark" ? "Mudar para Light Mode" : "Mudar para Dark Mode"}
              aria-label="Alternar tema"
            >
              {theme === "dark" ? (
                // Sol — usuário irá para light
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M12 3v2m0 14v2m9-9h-2M5 12H3m15.36-6.36l-1.42 1.42M7.05 16.95l-1.41 1.41m12.72 0l-1.41-1.41M7.05 7.05L5.64 5.64M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                // Lua — usuário irá para dark
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
                </svg>
              )}
            </button>

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

        {/* Content Area — ErrorBoundary isola crashes; ModuleSwitcher faz crossfade entre módulos */}
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-4 md:p-6">
         <ModuleErrorBoundary moduleKey={activeModule}>
          <ModuleSwitcher moduleKey={activeModule}>
            {activeModule === "dashboard" && (
              <Dashboard user={user} dateFilter={dateFilter} onNavigate={setActiveModule} />
            )}
            {activeModule === "processos" && (
              <ProcessModule user={user} dateFilter={dateFilter} addToast={addToast} clients={data.clients} employees={data.employees} reloadData={loadAllData} />
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
            {activeModule === "ia" && (
              <IAAtendimentoModule user={user} addToast={addToast} />
            )}
            {activeModule === "folha" && (
              <FolhaModule user={user} addToast={addToast} employees={data.employees} reloadData={loadAllData} />
            )}
            {activeModule === "config" && (
              <SettingsModule user={user} addToast={addToast} reloadData={loadAllData} theme={theme} setTheme={setTheme} />
            )}
          </ModuleSwitcher>
         </ModuleErrorBoundary>
        </main>
      </div>

      {/* Toast Container */}
      <ToastContainer toasts={toasts} removeToast={removeToast} />
    </div>
  );
}
