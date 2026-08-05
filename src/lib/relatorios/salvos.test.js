import { describe, it, expect } from "vitest";
import {
  PREFIXO_RELATORIO, montarRegistroSalvo, listarSalvos, salvarRelatorio,
  excluirRelatorio, duplicarRegistro,
} from "./salvos.js";

// DB falso com a mesma superfície usada pelo módulo (list/get/set/delete).
function fakeDB(inicial = []) {
  const mapa = new Map(inicial.map((r) => [PREFIXO_RELATORIO + r.id, r]));
  return {
    list: (prefixo) => [...mapa.entries()].filter(([k]) => k.startsWith(prefixo)).map(([, v]) => v),
    get: (k) => mapa.get(k) || null,
    set: (k, v) => { mapa.set(k, v); },
    delete: (k) => { mapa.delete(k); },
  };
}

const spec = {
  fonte: "os",
  periodo: { campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [],
  agrupamento: ["tecnicoId"],
  metricas: [{ agregacao: "contagem" }],
  ordenacao: null,
  limite: 500,
  grafico: null,
};

describe("salvos.montarRegistroSalvo", () => {
  it("monta o registro com carimbos e autor", () => {
    const agora = "2026-03-05T12:00:00.000Z";
    const r = montarRegistroSalvo({ id: "r1", nome: "Faturamento", descricao: "mensal", spec, usuarioNome: "Ana", agora });
    expect(r).toMatchObject({
      id: "r1", nome: "Faturamento", descricao: "mensal",
      criadoPor: "Ana", criadoEm: agora, atualizadoEm: agora,
    });
    expect(r.spec.fonte).toBe("os");
  });

  it("preserva criadoEm em edição", () => {
    const r = montarRegistroSalvo({
      id: "r1", nome: "Novo nome", spec, usuarioNome: "Ana",
      agora: "2026-04-01T00:00:00.000Z", criadoEm: "2026-03-05T12:00:00.000Z",
    });
    expect(r.criadoEm).toBe("2026-03-05T12:00:00.000Z");
    expect(r.atualizadoEm).toBe("2026-04-01T00:00:00.000Z");
  });

  it("nome vazio ganha rótulo padrão em vez de ficar em branco", () => {
    expect(montarRegistroSalvo({ id: "r1", nome: "   ", spec }).nome).toBe("Relatório sem nome");
  });
});

describe("salvos — CRUD", () => {
  it("salva sob o prefixo certo", () => {
    const db = fakeDB();
    salvarRelatorio(db, montarRegistroSalvo({ id: "r1", nome: "A", spec, usuarioNome: "Ana", agora: "2026-01-01T00:00:00.000Z" }));
    expect(db.get("erp:relatorio:r1").nome).toBe("A");
  });

  it("lista ordenando do mais recente para o mais antigo", () => {
    const db = fakeDB([
      { id: "a", nome: "Antigo", spec, atualizadoEm: "2026-01-01T00:00:00.000Z" },
      { id: "b", nome: "Novo", spec, atualizadoEm: "2026-05-01T00:00:00.000Z" },
    ]);
    expect(listarSalvos(db).map((r) => r.nome)).toEqual(["Novo", "Antigo"]);
  });

  it("descarta registro corrompido sem spec", () => {
    const db = fakeDB([{ id: "x", nome: "Quebrado" }]);
    expect(listarSalvos(db)).toEqual([]);
  });

  it("exclui pelo id", () => {
    const db = fakeDB([{ id: "a", nome: "A", spec, atualizadoEm: "2026-01-01T00:00:00.000Z" }]);
    excluirRelatorio(db, "a");
    expect(listarSalvos(db)).toEqual([]);
  });

  it("salvar de novo com o mesmo id sobrescreve, não duplica", () => {
    const db = fakeDB();
    salvarRelatorio(db, montarRegistroSalvo({ id: "r1", nome: "A", spec }));
    salvarRelatorio(db, montarRegistroSalvo({ id: "r1", nome: "B", spec }));
    const lista = listarSalvos(db);
    expect(lista.length).toBe(1);
    expect(lista[0].nome).toBe("B");
  });
});

describe("salvos.duplicarRegistro", () => {
  it("gera cópia com id e nome novos, preservando o spec", () => {
    const orig = montarRegistroSalvo({ id: "r1", nome: "Faturamento", spec, usuarioNome: "Ana", agora: "2026-01-01T00:00:00.000Z" });
    const copia = duplicarRegistro(orig, { novoId: "r2", agora: "2026-02-01T00:00:00.000Z" });
    expect(copia.id).toBe("r2");
    expect(copia.nome).toBe("Faturamento (cópia)");
    expect(copia.criadoEm).toBe("2026-02-01T00:00:00.000Z");
    expect(copia.spec).toEqual(orig.spec);
    expect(orig.nome).toBe("Faturamento"); // original intacto
  });
});
