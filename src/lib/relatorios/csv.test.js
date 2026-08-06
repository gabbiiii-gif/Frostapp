import { describe, it, expect } from "vitest";
import { paraCSV, nomeArquivoCSV, paraBase64 } from "./csv.js";

const resultado = {
  colunas: [
    { id: "tecnicoId", label: "Técnico", tipo: "texto" },
    { id: "valor_soma", label: "Soma de Valor", tipo: "moeda" },
    { id: "contagem", label: "Contagem", tipo: "numero" },
  ],
  linhas: [
    { tecnicoId: "João Silva", valor_soma: 1234.5, contagem: 3 },
    { tecnicoId: 'Empresa "X"; Ltda', valor_soma: 0, contagem: 1 },
  ],
  totais: { valor_soma: 1234.5, contagem: 4 },
};

describe("csv.paraCSV", () => {
  const csv = paraCSV(resultado);
  const linhas = csv.replace(/^\uFEFF/, "").trim().split("\r\n");

  it("começa com BOM UTF-8 para o Excel não quebrar acento", () => {
    expect(csv.charCodeAt(0)).toBe(0xfeff);
  });

  it("usa ponto-e-vírgula como separador", () => {
    expect(linhas[0]).toBe("Técnico;Soma de Valor;Contagem");
  });

  it("usa vírgula decimal em moeda, com duas casas", () => {
    expect(linhas[1]).toContain("1234,50");
  });

  it("inteiro em campo numero sai sem casas decimais", () => {
    expect(linhas[1].split(";")[2]).toBe("3");
  });

  it("escapa aspas e ponto-e-vírgula com aspas duplas", () => {
    expect(linhas[2]).toContain('"Empresa ""X""; Ltda"');
  });

  it("acrescenta linha de totais no fim", () => {
    expect(linhas[linhas.length - 1]).toBe("TOTAL;1234,50;4");
  });

  it("respeita incluirTotais=false", () => {
    const semTotais = paraCSV(resultado, { incluirTotais: false }).trim().split("\r\n");
    expect(semTotais.length).toBe(3);
  });

  it("resultado vazio devolve só o cabeçalho, sem linha de total", () => {
    const vazio = paraCSV({ colunas: resultado.colunas, linhas: [], totais: {} });
    expect(vazio.replace(/^\uFEFF/, "").trim()).toBe("Técnico;Soma de Valor;Contagem");
  });

  it("célula nula vira string vazia, não 'null'", () => {
    const csvNulo = paraCSV({
      colunas: [{ id: "a", label: "A", tipo: "texto" }, { id: "b", label: "B", tipo: "moeda" }],
      linhas: [{ a: null, b: undefined }],
      totais: {},
    });
    expect(csvNulo.replace(/^\uFEFF/, "").trim().split("\r\n")[1]).toBe(";");
  });

  it("quebra de linha dentro da célula é escapada", () => {
    const csvQuebra = paraCSV({
      colunas: [{ id: "a", label: "A", tipo: "texto" }],
      linhas: [{ a: "linha1\nlinha2" }],
      totais: {},
    });
    expect(csvQuebra).toContain('"linha1\nlinha2"');
  });
});

describe("csv.nomeArquivoCSV", () => {
  it("gera slug sem acento, com data", () => {
    expect(nomeArquivoCSV("Faturamento por Técnico", new Date(2026, 2, 5)))
      .toBe("faturamento-por-tecnico-2026-03-05.csv");
  });

  it("cai em 'relatorio' quando o nome é vazio", () => {
    expect(nomeArquivoCSV("", new Date(2026, 2, 5))).toBe("relatorio-2026-03-05.csv");
  });

  it("usa data local, não UTC", () => {
    // 31/12 às 22h no Brasil ainda é 31/12 — em UTC já seria 01/01 do ano seguinte.
    expect(nomeArquivoCSV("x", new Date(2026, 11, 31, 22, 0, 0))).toBe("x-2026-12-31.csv");
  });
});

describe("csv.paraBase64", () => {
  it("codifica ASCII", () => {
    expect(paraBase64("abc")).toBe("YWJj");
  });

  it("não quebra com acento e faz round-trip", () => {
    const b64 = paraBase64("ação; ç ã");
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    expect(new TextDecoder().decode(bytes)).toBe("ação; ç ã");
  });
});
