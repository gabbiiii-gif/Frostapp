import { describe, it, expect } from "vitest";
import { filtrarPorPeriodo, aplicarFiltros, LIMITE_REGISTROS } from "./engine.js";

const oss = [
  { id: "1", status: "finalizado", valor: 300, dataAbertura: "2026-03-05T10:00:00.000Z", tecnicoId: "t1", descricao: "Limpeza de split" },
  { id: "2", status: "cancelado", valor: 0, dataAbertura: "2026-03-20", tecnicoId: "t2", descricao: "Troca de gás" },
  { id: "3", status: "finalizado", valor: 700, dataAbertura: "2026-04-02", tecnicoId: "t1", descricao: "Instalação" },
  { id: "4", status: "finalizado", valor: 150, dataAbertura: null, tecnicoId: "", descricao: "" },
];

describe("engine.filtrarPorPeriodo", () => {
  it("mantém só o que está dentro do intervalo, inclusive nas bordas", () => {
    const r = filtrarPorPeriodo(oss, "dataAbertura", "2026-03-01", "2026-03-20");
    expect(r.map((x) => x.id)).toEqual(["1", "2"]);
  });

  it("aceita ISO com hora e compara pela data local", () => {
    const r = filtrarPorPeriodo(oss, "dataAbertura", "2026-03-05", "2026-03-05");
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });

  it("descarta registro sem data no campo escolhido", () => {
    const r = filtrarPorPeriodo(oss, "dataAbertura", "2000-01-01", "2100-01-01");
    expect(r.map((x) => x.id)).toEqual(["1", "2", "3"]);
  });
});

describe("engine.aplicarFiltros", () => {
  it("igual e diferente", () => {
    expect(aplicarFiltros(oss, [{ campo: "status", op: "igual", valor: "finalizado" }], "os").length).toBe(3);
    expect(aplicarFiltros(oss, [{ campo: "status", op: "diferente", valor: "finalizado" }], "os").length).toBe(1);
  });

  it("contem é case-insensitive", () => {
    const r = aplicarFiltros(oss, [{ campo: "descricao", op: "contem", valor: "SPLIT" }], "os");
    expect(r.map((x) => x.id)).toEqual(["1"]);
  });

  it("maior, menor e entre em campo numérico", () => {
    expect(aplicarFiltros(oss, [{ campo: "valor", op: "maior", valor: 200 }], "os").map((x) => x.id)).toEqual(["1", "3"]);
    expect(aplicarFiltros(oss, [{ campo: "valor", op: "menor", valor: 200 }], "os").map((x) => x.id)).toEqual(["2", "4"]);
    expect(aplicarFiltros(oss, [{ campo: "valor", op: "entre", valor: [100, 400] }], "os").map((x) => x.id)).toEqual(["1", "4"]);
  });

  it("vazio e nao_vazio tratam string vazia e null", () => {
    expect(aplicarFiltros(oss, [{ campo: "tecnicoId", op: "vazio" }], "os").map((x) => x.id)).toEqual(["4"]);
    expect(aplicarFiltros(oss, [{ campo: "tecnicoId", op: "nao_vazio" }], "os").length).toBe(3);
  });

  it("em aceita lista de valores", () => {
    const r = aplicarFiltros(oss, [{ campo: "tecnicoId", op: "em", valor: ["t2", "t1"] }], "os");
    expect(r.length).toBe(3);
  });

  it("filtros se acumulam com E lógico", () => {
    const r = aplicarFiltros(oss, [
      { campo: "status", op: "igual", valor: "finalizado" },
      { campo: "valor", op: "maior", valor: 200 },
    ], "os");
    expect(r.map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("lista sem filtro volta intacta", () => {
    expect(aplicarFiltros(oss, [], "os").length).toBe(4);
  });
});

describe("engine — constantes", () => {
  it("teto de leitura é 50000", () => {
    expect(LIMITE_REGISTROS).toBe(50000);
  });
});
