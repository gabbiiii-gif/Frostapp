// ─── Lib pura: domínio do módulo Escola ──────────────────────────────────────
// Sem JSX, sem React. Recebe um `db` (interface { get, set, delete, list }) e
// devolve operações de domínio. Mantemos puro para testar com Vitest.
//
// Convenções:
//   - id de demanda: "erp:escola:<uuid>"
//   - id de evento: "erp:evento_escola:<uuid>"
//   - prefixos batem com SCOPED_PREFIXES em src/App.jsx (sincronização automática)

import { genId } from "../utils.js";

// Níveis de urgência (ordem importa: usada em sort)
export const URGENCIA = {
  baixo: { label: "Baixo", color: "bg-gray-500", rank: 0 },
  medio: { label: "Médio", color: "bg-blue-500", rank: 1 },
  alto: { label: "Alto", color: "bg-orange-500", rank: 2 },
  urgente: { label: "Urgente", color: "bg-red-500", rank: 3 },
};
export const URGENCIA_OPCOES = ["baixo", "medio", "alto", "urgente"];

// ─── Anexo de ofício (validação client-side, pura) ───────────────────────────
// Limite de 10 MB por arquivo; só PDF ou imagem. Retorna { ok, motivo? }.
export const OFICIO_MAX_BYTES = 10 * 1024 * 1024;

export function validarOficio(file) {
  if (!file) return { ok: false, motivo: "Arquivo inválido" };
  const tipo = file.type || "";
  const tipoOk = tipo === "application/pdf" || tipo.startsWith("image/");
  if (!tipoOk) return { ok: false, motivo: "Apenas PDF ou imagem" };
  if (file.size > OFICIO_MAX_BYTES) return { ok: false, motivo: "Máximo 10 MB por arquivo" };
  return { ok: true };
}

// Estados possíveis de uma demanda. Mantemos o nome alinhado com STATUS_MAP
// global (constants.js) sempre que possível para reusar StatusBadge.
export const STATUS_ESCOLA = ["aguardando", "em_execucao", "concluido", "cancelado"];

// Transições válidas de status. Bloqueia mudanças inválidas no lib (defesa em
// profundidade — UI também esconde botões, mas confiamos no lib como source of truth).
const TRANSICOES = {
  aguardando: ["em_execucao", "cancelado"],
  em_execucao: ["concluido", "cancelado", "aguardando"], // permite "desfazer" assumir
  concluido: [],            // estado terminal — apenas admin via DB pode reverter
  cancelado: ["aguardando"], // admin pode reabrir
};

export function podeTransicionar(de, para) {
  if (!TRANSICOES[de]) return false;
  return TRANSICOES[de].includes(para);
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

// Cria uma demanda. Solicitante é tipicamente a Vanda (role=cliente_escola).
// data_solicitacao vira data de início conforme spec do cliente.
export function criarDemanda(db, { escola_nome, descricao, urgencia, solicitante_id, solicitante_nome }) {
  if (!escola_nome || !escola_nome.trim()) throw new Error("Nome da escola é obrigatório");
  if (!descricao || !descricao.trim()) throw new Error("Descrição é obrigatória");
  if (!URGENCIA[urgencia]) throw new Error("Urgência inválida");
  if (!solicitante_id) throw new Error("Solicitante é obrigatório");

  const agora = new Date().toISOString();
  const id = "erp:escola:" + genId();
  const demanda = {
    id,
    escola_nome: escola_nome.trim(),
    descricao: descricao.trim(),
    urgencia,
    data_solicitacao: agora,
    status: "aguardando",
    solicitante_id,
    solicitante_nome: solicitante_nome || "",
    responsavel_id: null,
    responsavel_nome: null,
    assumido_em: null,
    concluido_em: null,
    observacao_conclusao: null,
    created_at: agora,
    updated_at: agora,
  };

  db.set(id, demanda);
  registrarEvento(db, id, "criada", solicitante_id, { urgencia, escola_nome });
  return demanda;
}

// Atualiza status com validação de transição. Retorna a demanda atualizada.
export function atualizarStatus(db, demandaId, novoStatus, ator, extras = {}) {
  const demanda = db.get(demandaId);
  if (!demanda) throw new Error("Demanda não encontrada");
  if (!podeTransicionar(demanda.status, novoStatus)) {
    throw new Error(`Transição inválida: ${demanda.status} → ${novoStatus}`);
  }

  const agora = new Date().toISOString();
  const atualizada = {
    ...demanda,
    status: novoStatus,
    updated_at: agora,
    ...extras,
  };

  // Marcações específicas por transição
  if (novoStatus === "em_execucao" && !atualizada.assumido_em) {
    atualizada.assumido_em = agora;
  }
  if (novoStatus === "concluido") {
    atualizada.concluido_em = agora;
  }

  db.set(demandaId, atualizada);
  registrarEvento(db, demandaId, novoStatus, ator?.id, {
    de: demanda.status,
    para: novoStatus,
    ator_nome: ator?.nome,
    obs: extras.observacao_conclusao || extras.motivo_cancelamento,
  });
  return atualizada;
}

// Helpers semânticos (camada fina sobre atualizarStatus)
export function assumirDemanda(db, demandaId, responsavel) {
  return atualizarStatus(db, demandaId, "em_execucao", responsavel, {
    responsavel_id: responsavel.id,
    responsavel_nome: responsavel.nome || "",
  });
}

export function concluirDemanda(db, demandaId, ator, observacao_conclusao = "") {
  return atualizarStatus(db, demandaId, "concluido", ator, { observacao_conclusao });
}

export function cancelarDemanda(db, demandaId, ator, motivo_cancelamento = "") {
  return atualizarStatus(db, demandaId, "cancelado", ator, { motivo_cancelamento });
}

// ─── Queries ─────────────────────────────────────────────────────────────────

// Lista demandas de um solicitante específico (uso: portal Vanda).
export function listarDemandasUsuario(db, solicitanteId) {
  return db.list("erp:escola:")
    .filter((d) => d && d.solicitante_id === solicitanteId)
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Lista todas as demandas (uso: painel interno).
export function listarTodasDemandas(db, { status, urgencia, escola, responsavelId } = {}) {
  let demandas = db.list("erp:escola:").filter(Boolean);
  if (status) demandas = demandas.filter((d) => d.status === status);
  if (urgencia) demandas = demandas.filter((d) => d.urgencia === urgencia);
  if (escola) {
    const q = escola.toLowerCase();
    demandas = demandas.filter((d) => (d.escola_nome || "").toLowerCase().includes(q));
  }
  if (responsavelId) demandas = demandas.filter((d) => d.responsavel_id === responsavelId);
  // Mais recentes primeiro; em empate, urgência maior primeiro.
  return demandas.sort((a, b) => {
    const t = new Date(b.created_at) - new Date(a.created_at);
    if (t !== 0) return t;
    return (URGENCIA[b.urgencia]?.rank || 0) - (URGENCIA[a.urgencia]?.rank || 0);
  });
}

// ─── Eventos / Timeline ──────────────────────────────────────────────────────

// Registra um evento na timeline da demanda. Não falha o fluxo se quebrar
// (timeline é auxiliar, não bloqueia transição).
export function registrarEvento(db, demandaId, evento, atorId, payload = {}) {
  try {
    const id = "erp:evento_escola:" + genId();
    const entry = {
      id,
      demanda_id: demandaId,
      evento,
      ator_id: atorId || null,
      payload,
      created_at: new Date().toISOString(),
    };
    db.set(id, entry);
    return entry;
  } catch {
    return null;
  }
}

export function listarTimeline(db, demandaId) {
  return db.list("erp:evento_escola:")
    .filter((e) => e && e.demanda_id === demandaId)
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

// ─── Métricas ────────────────────────────────────────────────────────────────

// Diferença em horas entre dois ISO timestamps (positiva).
function diffHoras(isoA, isoB) {
  if (!isoA || !isoB) return null;
  const ms = Math.abs(new Date(isoA) - new Date(isoB));
  return ms / (1000 * 60 * 60);
}

// Filtra demandas criadas dentro de [inicio, fim] (Date ou ISO string).
export function filtrarPorPeriodo(demandas, inicio, fim) {
  const ini = inicio ? new Date(inicio).getTime() : -Infinity;
  const end = fim ? new Date(fim).getTime() : Infinity;
  return demandas.filter((d) => {
    const t = new Date(d.created_at).getTime();
    return t >= ini && t <= end;
  });
}

// Snapshot de métricas para relatório (semanal/mensal). Não monta HTML — apenas
// devolve números para a UI ou para geradores externos.
export function calcularMetricas(demandas) {
  const concluidas = demandas.filter((d) => d.status === "concluido");
  const tempos = concluidas
    .map((d) => diffHoras(d.concluido_em, d.data_solicitacao))
    .filter((h) => h !== null);
  const respostas = demandas
    .filter((d) => d.assumido_em)
    .map((d) => diffHoras(d.assumido_em, d.data_solicitacao))
    .filter((h) => h !== null);

  const porUrgencia = URGENCIA_OPCOES.reduce((acc, u) => {
    acc[u] = demandas.filter((d) => d.urgencia === u).length;
    return acc;
  }, {});

  const porEscola = demandas.reduce((acc, d) => {
    const k = d.escola_nome || "—";
    acc[k] = (acc[k] || 0) + 1;
    return acc;
  }, {});

  return {
    total: demandas.length,
    concluidas: concluidas.length,
    em_execucao: demandas.filter((d) => d.status === "em_execucao").length,
    aguardando: demandas.filter((d) => d.status === "aguardando").length,
    canceladas: demandas.filter((d) => d.status === "cancelado").length,
    taxa_conclusao: demandas.length ? (concluidas.length / demandas.length) : 0,
    tempo_medio_atendimento_h: tempos.length ? (tempos.reduce((a, b) => a + b, 0) / tempos.length) : null,
    tempo_medio_resposta_h: respostas.length ? (respostas.reduce((a, b) => a + b, 0) / respostas.length) : null,
    por_urgencia: porUrgencia,
    por_escola: porEscola,
  };
}
