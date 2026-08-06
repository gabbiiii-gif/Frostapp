import { describe, it, expect } from "vitest";
import { relatorioHTML } from "./html.js";

const entrada = {
  nome: "Faturamento por técnico",
  resumo: "Ordens de Serviço · 01/03/2026 a 31/03/2026 · agrupado por Técnico",
  colunas: [
    { id: "tecnicoId", label: "Técnico", tipo: "texto" },
    { id: "valor_soma", label: "Soma de Valor", tipo: "moeda" },
  ],
  linhas: [{ tecnicoId: "João Silva", valor_soma: 1234.5 }],
  totais: { valor_soma: 1234.5 },
  truncado: false,
  empresa: { nome: "Frost Refrigeração", cnpj: "12.345.678/0001-90" },
};

describe("html.relatorioHTML", () => {
  const html = relatorioHTML(entrada);

  it("é um documento completo com title", () => {
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("<title>Faturamento por técnico</title>");
  });

  it("traz os ids da barra de ações que o abridor liga por fora", () => {
    expect(html).toContain('id="btn-pdf"');
    expect(html).toContain('id="btn-print"');
    expect(html).toContain('id="btn-close"');
  });

  it("mostra empresa, nome e resumo do relatório", () => {
    expect(html).toContain("Frost Refrigeração");
    expect(html).toContain("12.345.678/0001-90");
    expect(html).toContain("agrupado por Técnico");
  });

  it("monta cabeçalho e células da tabela", () => {
    expect(html).toContain("<th>Técnico</th>");
    expect(html).toContain("João Silva");
  });

  it("formata moeda em pt-BR", () => {
    expect(html).toMatch(/1\.234,50/);
  });

  it("alinha coluna numérica à direita", () => {
    expect(html).toContain('<th class="num">Soma de Valor</th>');
  });

  it("tem linha de total", () => {
    expect(html).toContain("TOTAL");
  });

  it("escapa HTML vindo dos dados", () => {
    const perigoso = relatorioHTML({
      ...entrada,
      linhas: [{ tecnicoId: "<script>alert(1)</script>", valor_soma: 0 }],
    });
    expect(perigoso).not.toContain("<script>alert(1)</script>");
    expect(perigoso).toContain("&lt;script&gt;");
  });

  it("escapa também o nome do relatório e os dados da empresa", () => {
    const perigoso = relatorioHTML({
      ...entrada,
      nome: '"><script>x</script>',
      empresa: { nome: "<b>Frost</b>" },
    });
    expect(perigoso).not.toContain("<script>x</script>");
    expect(perigoso).not.toContain("<b>Frost</b>");
  });

  it("avisa quando o resultado foi truncado", () => {
    const t = relatorioHTML({ ...entrada, truncado: true });
    expect(t).toContain("limite de 50.000 registros");
  });

  it("resultado vazio não quebra e não imprime linha de total", () => {
    const v = relatorioHTML({ ...entrada, linhas: [], totais: {} });
    expect(v).toContain("Nenhum registro");
    expect(v).not.toContain("TOTAL");
  });

  it("célula vazia vira travessão", () => {
    const v = relatorioHTML({ ...entrada, linhas: [{ tecnicoId: null, valor_soma: null }], totais: {} });
    expect(v).toContain("—");
  });

  it("só desenha a logo quando ela existe", () => {
    expect(html).not.toContain("<img");
    const comLogo = relatorioHTML({ ...entrada, empresa: { ...entrada.empresa, logo: "https://x/l.png" } });
    expect(comLogo).toContain('<img src="https://x/l.png"');
  });

  it("carimba a data de geração recebida", () => {
    const v = relatorioHTML({ ...entrada, geradoEm: new Date(2026, 2, 5, 14, 30) });
    expect(v).toContain("05/03/2026");
  });
});
