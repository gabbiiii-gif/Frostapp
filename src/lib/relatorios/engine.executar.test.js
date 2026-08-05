// Testes do executarRelatorio (agrupamento, agregações, ordenação, limite,
// resolução de referência e teto de leitura). Ficam em arquivo próprio para não
// inflar engine.test.js, que cobre o recorte de período e os operadores.
import { describe, it, expect } from "vitest";
import { executarRelatorio, indexarPorId, LIMITE_REGISTROS } from "./engine.js";

const dadosOS = [
  { id: "1", status: "finalizado", valor: 300, dataAbertura: "2026-03-05", tecnicoId: "t1" },
  { id: "2", status: "finalizado", valor: 500, dataAbertura: "2026-03-06", tecnicoId: "t1" },
  { id: "3", status: "finalizado", valor: 200, dataAbertura: "2026-03-07", tecnicoId: "t2" },
  { id: "4", status: "cancelado", valor: 999, dataAbertura: "2026-03-08", tecnicoId: "t2" },
  { id: "5", status: "finalizado", valor: 100, dataAbertura: "2026-04-01", tecnicoId: "t1" },
];

const funcionarios = [
  { id: "t1", nome: "João Silva" },
  { id: "t2", nome: "Maria Souza" },
];

const base = {
  fonte: "os",
  periodo: { campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [{ campo: "status", op: "igual", valor: "finalizado" }],
  agrupamento: ["tecnicoId"],
  metricas: [{ campo: "valor", agregacao: "soma" }, { agregacao: "contagem" }],
  ordenacao: { campo: "valor_soma", direcao: "desc" },
  limite: 100,
  grafico: null,
};

describe("engine.indexarPorId", () => {
  it("indexa por id em string e ignora registro sem id", () => {
    const idx = indexarPorId([{ id: 7, nome: "Sete" }, { nome: "Sem id" }, null]);
    expect(idx.get("7").nome).toBe("Sete");
    expect(idx.size).toBe(1);
  });
});

describe("engine.executarRelatorio — agrupado", () => {
  const r = executarRelatorio(base, { dados: dadosOS, refs: { funcionarios } });

  it("agrupa, soma e conta", () => {
    expect(r.linhas.length).toBe(2);
    expect(r.linhas[0]).toMatchObject({ tecnicoId: "João Silva", valor_soma: 800, contagem: 2 });
    expect(r.linhas[1]).toMatchObject({ tecnicoId: "Maria Souza", valor_soma: 200, contagem: 1 });
  });

  it("resolve referência para o nome, não o id", () => {
    expect(r.linhas.map((l) => l.tecnicoId)).toEqual(["João Silva", "Maria Souza"]);
  });

  it("ordena desc pela coluna pedida", () => {
    expect(r.linhas[0].valor_soma).toBeGreaterThan(r.linhas[1].valor_soma);
  });

  it("monta colunas com label do registry", () => {
    expect(r.colunas.map((c) => c.id)).toEqual(["tecnicoId", "valor_soma", "contagem"]);
    expect(r.colunas[0].label).toBe("Técnico");
    expect(r.colunas[1].label).toBe("Soma de Valor");
  });

  it("coluna de referência sai como texto", () => {
    expect(r.colunas[0].tipo).toBe("texto");
  });

  it("totaliza as métricas numéricas", () => {
    expect(r.totais.valor_soma).toBe(1000);
    expect(r.totais.contagem).toBe(3);
  });

  it("não vem truncado em volume pequeno", () => {
    expect(r.truncado).toBe(false);
    expect(r.lidos).toBe(5);
  });
});

describe("engine.executarRelatorio — sem agrupamento", () => {
  it("devolve uma linha só com os totais gerais", () => {
    const r = executarRelatorio({ ...base, agrupamento: [], ordenacao: null }, { dados: dadosOS, refs: {} });
    expect(r.linhas.length).toBe(1);
    expect(r.linhas[0].valor_soma).toBe(1000);
    expect(r.linhas[0].contagem).toBe(3);
  });
});

describe("engine.executarRelatorio — agregações", () => {
  const mk = (metricas) => executarRelatorio(
    { ...base, agrupamento: [], ordenacao: null, metricas },
    { dados: dadosOS, refs: {} },
  ).linhas[0];

  it("media", () => {
    expect(mk([{ campo: "valor", agregacao: "media" }]).valor_media).toBeCloseTo(333.333, 2);
  });

  it("minimo e maximo", () => {
    expect(mk([{ campo: "valor", agregacao: "minimo" }]).valor_minimo).toBe(200);
    expect(mk([{ campo: "valor", agregacao: "maximo" }]).valor_maximo).toBe(500);
  });

  it("contagem_distinta ignora repetidos", () => {
    expect(mk([{ campo: "tecnicoId", agregacao: "contagem_distinta" }]).tecnicoId_contagem_distinta).toBe(2);
  });
});

describe("engine.executarRelatorio — vazio numérico não vira zero", () => {
  // Number(null) e Number("") valem 0. Sem limpeza, um valor em branco entraria
  // como zero de verdade: puxaria a média para baixo e viraria um mínimo falso.
  const comVazios = [
    { id: "a", status: "finalizado", valor: 100, dataAbertura: "2026-03-02", tecnicoId: "t1" },
    { id: "b", status: "finalizado", valor: null, dataAbertura: "2026-03-03", tecnicoId: "t1" },
    { id: "c", status: "finalizado", valor: "", dataAbertura: "2026-03-04", tecnicoId: "t1" },
    { id: "d", status: "finalizado", valor: 300, dataAbertura: "2026-03-05", tecnicoId: "t1" },
  ];

  const mk = (agregacao) => executarRelatorio(
    { ...base, agrupamento: [], ordenacao: null, metricas: [{ campo: "valor", agregacao }] },
    { dados: comVazios, refs: {} },
  ).linhas[0][`valor_${agregacao}`];

  it("media ignora null e string vazia no denominador", () => {
    expect(mk("media")).toBe(200); // (100+300)/2, e não (100+0+0+300)/4
  });

  it("minimo não devolve zero fantasma", () => {
    expect(mk("minimo")).toBe(100);
  });

  it("soma continua correta", () => {
    expect(mk("soma")).toBe(400);
  });

  it("contagem conta registros, não valores preenchidos", () => {
    const r = executarRelatorio(
      { ...base, agrupamento: [], ordenacao: null, metricas: [{ agregacao: "contagem" }] },
      { dados: comVazios, refs: {} },
    );
    expect(r.linhas[0].contagem).toBe(4);
  });
});

describe("engine.executarRelatorio — agrupamento múltiplo e limite", () => {
  it("agrupa por dois campos", () => {
    const r = executarRelatorio(
      { ...base, filtros: [], agrupamento: ["tecnicoId", "status"], ordenacao: null },
      { dados: dadosOS, refs: { funcionarios } },
    );
    expect(r.linhas.length).toBe(3);
  });

  it("limite corta as linhas exibidas mas não os totais", () => {
    const r = executarRelatorio(
      { ...base, filtros: [], agrupamento: ["tecnicoId", "status"], ordenacao: null, limite: 2 },
      { dados: dadosOS, refs: { funcionarios } },
    );
    expect(r.linhas.length).toBe(2);
    expect(r.totais.contagem).toBe(4); // as 4 OS de março, não só as 2 linhas
  });

  it("id sem correspondente na fonte de referência cai no próprio id", () => {
    const r = executarRelatorio(
      { ...base, filtros: [], agrupamento: ["tecnicoId"], ordenacao: null },
      {
        dados: [{ id: "x", status: "finalizado", valor: 10, dataAbertura: "2026-03-02", tecnicoId: "fantasma" }],
        refs: { funcionarios },
      },
    );
    expect(r.linhas[0].tecnicoId).toBe("fantasma");
  });

  it("agrupamento com valor vazio vira travessão", () => {
    const r = executarRelatorio(
      { ...base, filtros: [], agrupamento: ["tecnicoId"], ordenacao: null },
      {
        dados: [{ id: "y", status: "finalizado", valor: 10, dataAbertura: "2026-03-02", tecnicoId: "" }],
        refs: { funcionarios },
      },
    );
    expect(r.linhas[0].tecnicoId).toBe("—");
  });
});

describe("engine.executarRelatorio — teto de registros", () => {
  it("marca truncado quando passa de LIMITE_REGISTROS", () => {
    const muitos = Array.from({ length: LIMITE_REGISTROS + 10 }, (_, i) => ({
      id: String(i), status: "finalizado", valor: 1, dataAbertura: "2026-03-10", tecnicoId: "t1",
    }));
    const r = executarRelatorio({ ...base, ordenacao: null }, { dados: muitos, refs: { funcionarios } });
    expect(r.truncado).toBe(true);
    expect(r.linhas[0].contagem).toBe(LIMITE_REGISTROS);
  });
});

describe("engine.executarRelatorio — bordas", () => {
  it("período sem registro devolve linhas vazias sem quebrar", () => {
    const r = executarRelatorio(
      { ...base, periodo: { campo: "dataAbertura", de: "2020-01-01", ate: "2020-01-31" } },
      { dados: dadosOS, refs: { funcionarios } },
    );
    expect(r.linhas).toEqual([]);
    expect(r.totais.valor_soma).toBe(0);
  });

  it("fonte desconhecida devolve resultado vazio em vez de estourar", () => {
    const r = executarRelatorio({ ...base, fonte: "inexistente" }, { dados: dadosOS, refs: {} });
    expect(r).toEqual({ colunas: [], linhas: [], totais: {}, lidos: 0, truncado: false });
  });
});
