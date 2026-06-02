// ─── Testes Vitest — domínio Ocorrências ─────────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  TIPOS_OCORRENCIA,
  STATUS_OCORRENCIA,
  podeTransicionar,
  criarOcorrencia,
  decidirOcorrencia,
  reabrirOcorrencia,
  listarPorFuncionario,
  listarPendentes,
  listarTodas,
  contarPendentes,
} from "./ocorrencias.js";

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

const ADMIN = { id: "admin_a", nome: "Admin" };
const FUNC = "func_joao";

describe("podeTransicionar", () => {
  it("pendente → aprovado/rejeitado", () => {
    expect(podeTransicionar("pendente", "aprovado")).toBe(true);
    expect(podeTransicionar("pendente", "rejeitado")).toBe(true);
  });
  it("aprovado/rejeitado → pendente (reanálise)", () => {
    expect(podeTransicionar("aprovado", "pendente")).toBe(true);
    expect(podeTransicionar("rejeitado", "pendente")).toBe(true);
  });
  it("aprovado → rejeitado direto não permitido", () => {
    expect(podeTransicionar("aprovado", "rejeitado")).toBe(false);
  });
});

describe("criarOcorrencia", () => {
  let db;
  beforeEach(() => { db = makeMemDb(); });

  it("cria pendente por default", () => {
    const o = criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "outros",
      data_ref: "2026-06-02", descricao: "Saída antecipada",
    });
    expect(o.id).toMatch(/^erp:ocorrencia:/);
    expect(o.status).toBe("pendente");
    expect(o.zera_debito).toBe(false);
  });

  it("rejeita tipo inválido", () => {
    expect(() => criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "ferias", data_ref: "2026-06-02",
    })).toThrow(/Tipo/);
  });

  it("rejeita data_ref mal formatada", () => {
    expect(() => criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "outros", data_ref: "02/06/2026",
    })).toThrow(/Data/);
  });

  it("exige documento para atestado", () => {
    expect(() => criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "atestado_medico", data_ref: "2026-06-02",
    })).toThrow(/Anexo/);
    const ok = criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "atestado_medico", data_ref: "2026-06-02",
      documento_path: "x/y/file.pdf", documento_nome: "atestado.pdf",
    });
    expect(ok.documento_path).toBe("x/y/file.pdf");
  });

  it("tipos sem doc obrigatório aceitam sem anexo", () => {
    const o = criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "atraso_justificado", data_ref: "2026-06-02",
    });
    expect(o.documento_path).toBe(null);
  });
});

describe("decidirOcorrencia", () => {
  let db, oc;
  beforeEach(() => {
    db = makeMemDb();
    oc = criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "atestado_medico", data_ref: "2026-06-02",
      documento_path: "x/y/a.pdf", documento_nome: "a.pdf",
    });
  });

  it("aprova atestado → zera_debito=true", () => {
    const r = decidirOcorrencia(db, oc.id, "aprovado", ADMIN, "OK CID atestado válido");
    expect(r.status).toBe("aprovado");
    expect(r.zera_debito).toBe(true);
    expect(r.decidido_por).toBe(ADMIN.id);
    expect(r.decisao_obs).toBe("OK CID atestado válido");
  });

  it("rejeita não marca zera_debito", () => {
    const r = decidirOcorrencia(db, oc.id, "rejeitado", ADMIN, "documento ilegível");
    expect(r.status).toBe("rejeitado");
    expect(r.zera_debito).toBe(false);
  });

  it("aprovar tipo que NÃO zera débito (atraso) mantém zera_debito=false", () => {
    const oc2 = criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "atraso_justificado", data_ref: "2026-06-02",
    });
    const r = decidirOcorrencia(db, oc2.id, "aprovado", ADMIN);
    expect(r.zera_debito).toBe(false);
  });

  it("aprovar duas vezes em sequência falha (já está aprovado)", () => {
    decidirOcorrencia(db, oc.id, "aprovado", ADMIN);
    expect(() => decidirOcorrencia(db, oc.id, "aprovado", ADMIN)).toThrow(/Transição/);
  });

  it("reabrir volta para pendente e tira zera_debito", () => {
    decidirOcorrencia(db, oc.id, "aprovado", ADMIN);
    const r = reabrirOcorrencia(db, oc.id, ADMIN);
    expect(r.status).toBe("pendente");
    expect(r.zera_debito).toBe(false);
  });
});

describe("queries", () => {
  it("listarPorFuncionario + filtro status", () => {
    const db = makeMemDb();
    const a = criarOcorrencia(db, { funcionario_id: FUNC, tipo: "outros", data_ref: "2026-06-02" });
    criarOcorrencia(db, { funcionario_id: FUNC, tipo: "outros", data_ref: "2026-06-03" });
    criarOcorrencia(db, { funcionario_id: "outro", tipo: "outros", data_ref: "2026-06-02" });
    decidirOcorrencia(db, a.id, "aprovado", ADMIN);

    expect(listarPorFuncionario(db, FUNC).length).toBe(2);
    expect(listarPorFuncionario(db, FUNC, { status: "aprovado" }).length).toBe(1);
    expect(listarPorFuncionario(db, FUNC, { status: "pendente" }).length).toBe(1);
  });

  it("listarPendentes e contarPendentes coerentes", () => {
    const db = makeMemDb();
    criarOcorrencia(db, { funcionario_id: FUNC, tipo: "outros", data_ref: "2026-06-02" });
    const b = criarOcorrencia(db, { funcionario_id: FUNC, tipo: "outros", data_ref: "2026-06-03" });
    decidirOcorrencia(db, b.id, "aprovado", ADMIN);
    expect(listarPendentes(db).length).toBe(1);
    expect(contarPendentes(db)).toBe(1);
  });

  it("listarTodas com múltiplos filtros", () => {
    const db = makeMemDb();
    criarOcorrencia(db, { funcionario_id: FUNC, tipo: "outros", data_ref: "2026-06-02" });
    criarOcorrencia(db, {
      funcionario_id: FUNC, tipo: "atestado_medico", data_ref: "2026-06-03",
      documento_path: "p", documento_nome: "p.pdf",
    });
    expect(listarTodas(db, { tipo: "atestado_medico" }).length).toBe(1);
    expect(listarTodas(db, { funcionarioId: "outro" }).length).toBe(0);
  });
});

describe("constantes", () => {
  it("STATUS_OCORRENCIA tem 3 estados canônicos", () => {
    expect(STATUS_OCORRENCIA).toEqual(["pendente", "aprovado", "rejeitado"]);
  });
  it("TIPOS_OCORRENCIA tem 5 tipos", () => {
    expect(Object.keys(TIPOS_OCORRENCIA).length).toBe(5);
  });
});
