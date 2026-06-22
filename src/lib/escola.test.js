// ─── Testes Vitest — domínio Escola ──────────────────────────────────────────
// Mock de `db` em memória para isolar lógica do storage real.

import { describe, it, expect, beforeEach } from "vitest";
import {
  criarDemanda,
  assumirDemanda,
  concluirDemanda,
  cancelarDemanda,
  podeTransicionar,
  listarDemandasUsuario,
  listarTodasDemandas,
  listarTimeline,
  calcularMetricas,
  filtrarPorPeriodo,
  URGENCIA,
  validarOficio,
  OFICIO_MAX_BYTES,
} from "./escola.js";

function makeMemDb() {
  const store = new Map();
  return {
    get: (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: (k, v) => { store.set(k, structuredClone(v)); return true; },
    delete: (k) => { store.delete(k); return true; },
    list: (prefix) => Array.from(store.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => structuredClone(v)),
  };
}

const VANDA = { id: "user_vanda", nome: "Vanda" };
const RESP = { id: "user_carlos", nome: "Carlos" };

describe("escola.podeTransicionar", () => {
  it("aceita aguardando → em_execucao", () => {
    expect(podeTransicionar("aguardando", "em_execucao")).toBe(true);
  });
  it("rejeita concluido → aguardando", () => {
    expect(podeTransicionar("concluido", "aguardando")).toBe(false);
  });
  it("aceita cancelado → aguardando (reabertura)", () => {
    expect(podeTransicionar("cancelado", "aguardando")).toBe(true);
  });
});

describe("escola.criarDemanda", () => {
  it("cria demanda com defaults corretos", () => {
    const db = makeMemDb();
    const d = criarDemanda(db, {
      escola_nome: "EMEF Vila Nova",
      descricao: "Trocar split sala 12",
      urgencia: "urgente",
      solicitante_id: VANDA.id,
      solicitante_nome: VANDA.nome,
    });
    expect(d.id).toMatch(/^erp:escola:/);
    expect(d.status).toBe("aguardando");
    expect(d.escola_nome).toBe("EMEF Vila Nova");
    expect(d.urgencia).toBe("urgente");
    expect(d.data_solicitacao).toBeDefined();
    // Evento de criação foi gravado
    const eventos = listarTimeline(db, d.id);
    expect(eventos.length).toBe(1);
    expect(eventos[0].evento).toBe("criada");
  });

  it("rejeita urgência inválida", () => {
    const db = makeMemDb();
    expect(() => criarDemanda(db, {
      escola_nome: "X", descricao: "Y", urgencia: "extremo", solicitante_id: "u",
    })).toThrow(/Urgência/);
  });

  it("rejeita campos obrigatórios vazios", () => {
    const db = makeMemDb();
    expect(() => criarDemanda(db, {
      escola_nome: "", descricao: "Y", urgencia: "baixo", solicitante_id: "u",
    })).toThrow(/escola/);
    expect(() => criarDemanda(db, {
      escola_nome: "X", descricao: "  ", urgencia: "baixo", solicitante_id: "u",
    })).toThrow(/Descrição/);
  });
});

describe("escola — fluxo completo", () => {
  let db, demanda;
  beforeEach(() => {
    db = makeMemDb();
    demanda = criarDemanda(db, {
      escola_nome: "EMEI Centro", descricao: "Bebedouro", urgencia: "medio",
      solicitante_id: VANDA.id, solicitante_nome: VANDA.nome,
    });
  });

  it("assumir muda status + grava responsavel + marca timestamp", () => {
    const r = assumirDemanda(db, demanda.id, RESP);
    expect(r.status).toBe("em_execucao");
    expect(r.responsavel_id).toBe(RESP.id);
    expect(r.responsavel_nome).toBe("Carlos");
    expect(r.assumido_em).toBeDefined();
  });

  it("concluir só funciona após assumir, registra observação", () => {
    expect(() => concluirDemanda(db, demanda.id, RESP, "OK")).toThrow();
    assumirDemanda(db, demanda.id, RESP);
    const r = concluirDemanda(db, demanda.id, RESP, "Trocado o filtro.");
    expect(r.status).toBe("concluido");
    expect(r.concluido_em).toBeDefined();
    expect(r.observacao_conclusao).toBe("Trocado o filtro.");
  });

  it("cancelar de aguardando funciona; cancelado→em_execucao não é permitido", () => {
    const r = cancelarDemanda(db, demanda.id, RESP, "Demanda duplicada");
    expect(r.status).toBe("cancelado");
    // Cancelado → em_execucao direto é proibido (precisa reabrir antes).
    expect(podeTransicionar("cancelado", "em_execucao")).toBe(false);
    // Cancelado → aguardando é permitido (reabertura).
    expect(podeTransicionar("cancelado", "aguardando")).toBe(true);
  });

  it("timeline registra cada transição", () => {
    assumirDemanda(db, demanda.id, RESP);
    concluirDemanda(db, demanda.id, RESP, "feito");
    const t = listarTimeline(db, demanda.id);
    expect(t.map((e) => e.evento)).toEqual(["criada", "em_execucao", "concluido"]);
  });
});

describe("escola — queries", () => {
  it("listarDemandasUsuario filtra por solicitante", () => {
    const db = makeMemDb();
    criarDemanda(db, { escola_nome: "A", descricao: "x", urgencia: "baixo", solicitante_id: "v1" });
    criarDemanda(db, { escola_nome: "B", descricao: "y", urgencia: "alto", solicitante_id: "v2" });
    const r = listarDemandasUsuario(db, "v1");
    expect(r.length).toBe(1);
    expect(r[0].escola_nome).toBe("A");
  });

  it("listarTodasDemandas filtra por status e urgência", () => {
    const db = makeMemDb();
    const d1 = criarDemanda(db, { escola_nome: "A", descricao: "x", urgencia: "baixo", solicitante_id: "v1" });
    criarDemanda(db, { escola_nome: "B", descricao: "y", urgencia: "alto", solicitante_id: "v1" });
    assumirDemanda(db, d1.id, RESP);
    expect(listarTodasDemandas(db, { status: "aguardando" }).length).toBe(1);
    expect(listarTodasDemandas(db, { urgencia: "alto" }).length).toBe(1);
  });
});

describe("escola.calcularMetricas", () => {
  it("calcula totais, taxa de conclusão e tempos médios", () => {
    const db = makeMemDb();
    const d1 = criarDemanda(db, { escola_nome: "A", descricao: "x", urgencia: "baixo", solicitante_id: "v" });
    const d2 = criarDemanda(db, { escola_nome: "B", descricao: "y", urgencia: "alto", solicitante_id: "v" });
    criarDemanda(db, { escola_nome: "C", descricao: "z", urgencia: "medio", solicitante_id: "v" });
    assumirDemanda(db, d1.id, RESP);
    concluirDemanda(db, d1.id, RESP);
    assumirDemanda(db, d2.id, RESP);
    const m = calcularMetricas(listarTodasDemandas(db));
    expect(m.total).toBe(3);
    expect(m.concluidas).toBe(1);
    expect(m.em_execucao).toBe(1);
    expect(m.aguardando).toBe(1);
    expect(m.taxa_conclusao).toBeCloseTo(1 / 3, 2);
    expect(m.por_urgencia.baixo).toBe(1);
    expect(m.por_urgencia.alto).toBe(1);
  });
});

describe("escola.filtrarPorPeriodo", () => {
  it("filtra por intervalo inclusivo", () => {
    const ontem = new Date(Date.now() - 86400000).toISOString();
    const amanha = new Date(Date.now() + 86400000).toISOString();
    const ds = [
      { created_at: ontem },
      { created_at: new Date().toISOString() },
      { created_at: new Date(Date.now() + 2 * 86400000).toISOString() },
    ];
    const r = filtrarPorPeriodo(ds, ontem, amanha);
    expect(r.length).toBe(2);
  });
});

describe("URGENCIA constantes", () => {
  it("tem rank crescente", () => {
    expect(URGENCIA.baixo.rank).toBeLessThan(URGENCIA.medio.rank);
    expect(URGENCIA.medio.rank).toBeLessThan(URGENCIA.alto.rank);
    expect(URGENCIA.alto.rank).toBeLessThan(URGENCIA.urgente.rank);
  });
});

describe("validarOficio", () => {
  it("aceita PDF dentro do limite", () => {
    const r = validarOficio({ name: "oficio.pdf", type: "application/pdf", size: 1024 });
    expect(r.ok).toBe(true);
  });

  it("aceita imagem dentro do limite", () => {
    const r = validarOficio({ name: "foto.jpg", type: "image/jpeg", size: 2048 });
    expect(r.ok).toBe(true);
  });

  it("rejeita tipo não permitido", () => {
    const r = validarOficio({ name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/PDF ou imagem/i);
  });

  it("rejeita arquivo acima do limite", () => {
    const r = validarOficio({ name: "grande.pdf", type: "application/pdf", size: OFICIO_MAX_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/10 MB/i);
  });

  it("rejeita arquivo nulo", () => {
    expect(validarOficio(null).ok).toBe(false);
  });
});
