// ─── Lib pura: ocorrências/justificativas do ponto ───────────────────────────
// Sem JSX, sem React. Recebe um `db` e devolve operações de domínio.
//
// Tipos suportados (alinhados ao SPEC do cliente):
//   - atraso_justificado          (doc opcional)
//   - falta_justificada           (doc obrigatório)
//   - atestado_medico             (doc obrigatório · zera débito ao aprovar)
//   - declaracao_comparecimento   (doc obrigatório)
//   - outros                      (doc opcional)
//
// Persistência:
//   erp:ocorrencia:<uuid>
//
// Fluxo:
//   1. Funcionário cria → status="pendente"
//   2. Admin/gerente decide → status="aprovado" ou "rejeitado"
//   3. Se atestado_medico aprovado → marca zera_debito=true (banco-horas lê)

import { genId } from "../utils.js";

export const TIPOS_OCORRENCIA = {
  atraso_justificado:        { label: "Atraso justificado",      docObrigatorio: false, zeraDebito: false },
  falta_justificada:         { label: "Falta justificada",       docObrigatorio: true,  zeraDebito: true  },
  atestado_medico:           { label: "Atestado médico",          docObrigatorio: true,  zeraDebito: true  },
  declaracao_comparecimento: { label: "Declaração de comparecimento", docObrigatorio: true, zeraDebito: true },
  outros:                    { label: "Outros",                   docObrigatorio: false, zeraDebito: false },
};

export const STATUS_OCORRENCIA = ["pendente", "aprovado", "rejeitado"];

// Transições válidas — uma vez decidida, admin pode reabrir (volta a pendente)
// se precisar revogar. Não tem transição direta entre aprovado↔rejeitado.
const TRANSICOES = {
  pendente:  ["aprovado", "rejeitado"],
  aprovado:  ["pendente"],   // revogar/reanalisar
  rejeitado: ["pendente"],
};
export function podeTransicionar(de, para) {
  return TRANSICOES[de]?.includes(para) === true;
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

// Cria uma ocorrência (sempre nasce pendente). Valida tipo + documento
// obrigatório conforme TIPOS_OCORRENCIA.
//
// dados:
//   - funcionario_id          (obrigatório)
//   - funcionario_nome        (opcional, snapshot)
//   - tipo                    (obrigatório, key de TIPOS_OCORRENCIA)
//   - data_ref                (YYYY-MM-DD — dia ao qual a justificativa se aplica)
//   - descricao               (string livre)
//   - documento_path          (path do bucket Storage; obrigatório se tipo exige)
//   - documento_nome          (filename original — para UI)
export function criarOcorrencia(db, dados) {
  const {
    funcionario_id,
    funcionario_nome,
    tipo,
    data_ref,
    descricao = "",
    documento_path = null,
    documento_nome = null,
  } = dados || {};

  if (!funcionario_id) throw new Error("Funcionário é obrigatório.");
  if (!TIPOS_OCORRENCIA[tipo]) throw new Error("Tipo de ocorrência inválido.");
  if (!data_ref || !/^\d{4}-\d{2}-\d{2}$/.test(String(data_ref))) {
    throw new Error("Data de referência inválida.");
  }
  if (TIPOS_OCORRENCIA[tipo].docObrigatorio && !documento_path) {
    throw new Error(`Anexo é obrigatório para ${TIPOS_OCORRENCIA[tipo].label.toLowerCase()}.`);
  }

  const agora = new Date().toISOString();
  const id = "erp:ocorrencia:" + genId();
  const oc = {
    id,
    funcionario_id,
    funcionario_nome: funcionario_nome || null,
    tipo,
    data_ref,
    descricao: String(descricao || "").trim(),
    documento_path,
    documento_nome,
    status: "pendente",
    decidido_por: null,
    decidido_em: null,
    decisao_obs: null,
    zera_debito: false, // só marcado true quando atestado é aprovado
    created_at: agora,
    updated_at: agora,
  };
  db.set(id, oc);
  return oc;
}

// Decide uma ocorrência (admin/gerente). action = "aprovado" | "rejeitado".
// Caller é responsável por gating de role.
export function decidirOcorrencia(db, ocorrenciaId, action, ator, observacao = "") {
  const oc = db.get(ocorrenciaId);
  if (!oc) throw new Error("Ocorrência não encontrada.");
  if (!podeTransicionar(oc.status, action)) {
    throw new Error(`Transição inválida: ${oc.status} → ${action}`);
  }
  const meta = TIPOS_OCORRENCIA[oc.tipo];
  const atualizado = {
    ...oc,
    status: action,
    decidido_por: ator?.id || null,
    decidido_em: new Date().toISOString(),
    decisao_obs: String(observacao || "").trim() || null,
    // Atestado/falta/comparecimento aprovado → zera débito do dia em banco-horas
    zera_debito: action === "aprovado" && !!meta?.zeraDebito,
    updated_at: new Date().toISOString(),
  };
  db.set(ocorrenciaId, atualizado);
  return atualizado;
}

// Reverte para pendente (revogação / reanálise). Caller já validou que pode.
export function reabrirOcorrencia(db, ocorrenciaId, ator) {
  return decidirOcorrencia(db, ocorrenciaId, "pendente", ator, "Reaberta para reanálise.");
}

// ─── Queries ────────────────────────────────────────────────────────────────

export function listarPorFuncionario(db, funcionarioId, { status } = {}) {
  let r = db.list("erp:ocorrencia:")
    .filter((o) => o && o.funcionario_id === funcionarioId);
  if (status) r = r.filter((o) => o.status === status);
  return r.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

export function listarPendentes(db) {
  return db.list("erp:ocorrencia:")
    .filter((o) => o && o.status === "pendente")
    .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));
}

export function listarTodas(db, { status, tipo, funcionarioId } = {}) {
  let r = db.list("erp:ocorrencia:").filter(Boolean);
  if (status) r = r.filter((o) => o.status === status);
  if (tipo) r = r.filter((o) => o.tipo === tipo);
  if (funcionarioId) r = r.filter((o) => o.funcionario_id === funcionarioId);
  return r.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
}

// Conta pendentes (uso: badge de notificação no menu).
export function contarPendentes(db) {
  return db.list("erp:ocorrencia:").filter((o) => o && o.status === "pendente").length;
}
