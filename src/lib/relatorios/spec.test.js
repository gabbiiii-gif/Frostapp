import { describe, it, expect } from "vitest";
import { specVazio, validarSpec, resumoSpec, colunaMetrica, primeiroEUltimoDiaDoMes } from "./spec.js";

const specOk = {
  fonte: "os",
  periodo: { campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" },
  filtros: [{ campo: "status", op: "igual", valor: "finalizado" }],
  agrupamento: ["tecnicoId"],
  metricas: [{ campo: "valor", agregacao: "soma" }, { agregacao: "contagem" }],
  ordenacao: { campo: "valor_soma", direcao: "desc" },
  limite: 100,
  grafico: { tipo: "barra", eixoX: "tecnicoId", series: ["valor_soma"] },
};

describe("spec.primeiroEUltimoDiaDoMes", () => {
  it("cobre o mês inteiro em datas locais", () => {
    expect(primeiroEUltimoDiaDoMes(new Date(2026, 1, 15))).toEqual({ de: "2026-02-01", ate: "2026-02-28" });
    expect(primeiroEUltimoDiaDoMes(new Date(2024, 1, 10)).ate).toBe("2024-02-29");
  });
});

describe("spec.specVazio", () => {
  it("usa o campoData do dataset e o mês corrente", () => {
    const s = specVazio("os", new Date(2026, 2, 10));
    expect(s.fonte).toBe("os");
    expect(s.periodo).toEqual({ campo: "dataAbertura", de: "2026-03-01", ate: "2026-03-31" });
    expect(s.metricas).toEqual([{ agregacao: "contagem" }]);
    expect(s.filtros).toEqual([]);
  });
});

describe("spec.colunaMetrica", () => {
  it("nomeia campo_agregacao e contagem pura", () => {
    expect(colunaMetrica({ campo: "valor", agregacao: "soma" })).toBe("valor_soma");
    expect(colunaMetrica({ agregacao: "contagem" })).toBe("contagem");
  });
});

describe("spec.validarSpec", () => {
  it("aceita um spec completo e válido", () => {
    const r = validarSpec(specOk);
    expect(r.ok).toBe(true);
    expect(r.erros).toEqual([]);
  });

  it("rejeita fonte inexistente", () => {
    const r = validarSpec({ ...specOk, fonte: "planilha_magica" });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("planilha_magica");
  });

  it("rejeita campo que não existe na fonte", () => {
    const r = validarSpec({ ...specOk, agrupamento: ["cor_favorita"] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("cor_favorita");
  });

  it("rejeita soma sobre campo de texto", () => {
    const r = validarSpec({ ...specOk, metricas: [{ campo: "descricao", agregacao: "soma" }] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("soma");
  });

  it("rejeita operador incompatível com o tipo do campo", () => {
    const r = validarSpec({ ...specOk, filtros: [{ campo: "valor", op: "contem", valor: "x" }] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("contem");
  });

  it("exige período", () => {
    const r = validarSpec({ ...specOk, periodo: null });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("Período");
  });

  it("exige ao menos uma métrica", () => {
    const r = validarSpec({ ...specOk, metricas: [] });
    expect(r.ok).toBe(false);
    expect(r.erros.join(" ")).toContain("métrica");
  });

  it("normaliza limite ausente para 500 e corta acima de 5000", () => {
    expect(validarSpec({ ...specOk, limite: undefined }).spec.limite).toBe(500);
    expect(validarSpec({ ...specOk, limite: 999999 }).spec.limite).toBe(5000);
  });

  it("descarta gráfico cujo eixo não está no agrupamento", () => {
    const r = validarSpec({ ...specOk, grafico: { tipo: "barra", eixoX: "status", series: ["valor_soma"] } });
    expect(r.ok).toBe(true);
    expect(r.spec.grafico).toBeNull();
  });

  it("descarta ordenação por coluna que o resultado não terá", () => {
    const r = validarSpec({ ...specOk, ordenacao: { campo: "nao_existe", direcao: "asc" } });
    expect(r.ok).toBe(true);
    expect(r.spec.ordenacao).toBeNull();
  });
});

describe("spec.resumoSpec", () => {
  it("descreve o spec em português", () => {
    const texto = resumoSpec(specOk);
    expect(texto).toContain("Ordens de Serviço");
    expect(texto).toContain("01/03/2026");
    expect(texto).toContain("Técnico");
    expect(texto).toContain("Soma de Valor");
  });
});
