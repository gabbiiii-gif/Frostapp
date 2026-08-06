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

describe("engine — edge cases importante", () => {
  // Bug fix: Number(null) === 0, não deve ser confundido com zero verdadeiro
  const osComValorNull = [
    { id: "a", valor: null, status: "finalizado" },
    { id: "b", valor: 0, status: "finalizado" },
    { id: "c", valor: 100, status: "finalizado" },
  ];

  it("null em campo moeda NOT match menor/igual/maior", () => {
    // valor null deve ser excluído de comparações numéricas
    expect(aplicarFiltros(osComValorNull, [{ campo: "valor", op: "menor", valor: 50 }], "os").map((x) => x.id)).toEqual(["b"]); // só 0, não null
    expect(aplicarFiltros(osComValorNull, [{ campo: "valor", op: "igual", valor: 0 }], "os").map((x) => x.id)).toEqual(["b"]); // zero verdadeiro, não null
    expect(aplicarFiltros(osComValorNull, [{ campo: "valor", op: "maior", valor: 50 }], "os").map((x) => x.id)).toEqual(["c"]); // só 100, não null
  });

  it("null em campo moeda match vazio, zero não", () => {
    expect(aplicarFiltros(osComValorNull, [{ campo: "valor", op: "vazio" }], "os").map((x) => x.id)).toEqual(["a"]); // só null
    expect(aplicarFiltros(osComValorNull, [{ campo: "valor", op: "nao_vazio" }], "os").map((x) => x.id)).toEqual(["b", "c"]); // 0 e 100 são valores
  });

  it("0 não é vazio em campo moeda", () => {
    // Valor 0 é um valor legítimo, não vazio. Só null/undefined/"" é vazio.
    const osComZero = [
      { id: "1", valor: 0 },
      { id: "2", valor: null },
      { id: "3", valor: 100 },
    ];
    expect(aplicarFiltros(osComZero, [{ campo: "valor", op: "vazio" }], "os").map((x) => x.id)).toEqual(["2"]);
    expect(aplicarFiltros(osComZero, [{ campo: "valor", op: "nao_vazio" }], "os").map((x) => x.id)).toEqual(["1", "3"]);
  });

  it("filtro em campo desconhecido leave lista intacta (defensive)", () => {
    // Campo que não existe no dataset — já validado em spec.js, mas o filter
    // é defensivo pra ser testável isolado.
    const r = aplicarFiltros(oss, [{ campo: "campoInexistente", op: "igual", valor: "xxx" }], "os");
    expect(r.length).toBe(4); // tudo passa
  });

  it("entre com valor não-array retorna zero (sem open range)", () => {
    // Se filtro.valor não for array de 2 elementos, [null, null] => nenhum match.
    // Comportamento seguro: range incompleto/inválido não deve ser open range.
    const r1 = aplicarFiltros(oss, [{ campo: "valor", op: "entre", valor: 100 }], "os");
    expect(r1.length).toBe(0); // entre com scalar vira [null, null]

    const r2 = aplicarFiltros(oss, [{ campo: "valor", op: "entre", valor: [50] }], "os"); // 1 elemento
    expect(r2.length).toBe(0); // [50, undefined] => vf é null => nenhum match

    const r3 = aplicarFiltros(oss, [{ campo: "valor", op: "entre", valor: [] }], "os"); // array vazio
    expect(r3.length).toBe(0); // [undefined, undefined] => nenhum match
  });
});
