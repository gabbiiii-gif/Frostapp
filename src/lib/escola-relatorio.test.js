// ─── Testes Vitest — relatórios Escola ───────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  montarRelatorio,
  gerarHtmlRelatorio,
  gerarCsvRelatorio,
  periodoSemana,
  periodoMesCorrente,
} from "./escola-relatorio.js";

function demandaStub(over = {}) {
  return {
    id: "erp:escola:" + Math.random().toString(36).slice(2),
    escola_nome: "EMEF Teste",
    descricao: "Algo",
    urgencia: "medio",
    status: "concluido",
    data_solicitacao: "2026-06-01T10:00:00Z",
    concluido_em: "2026-06-01T14:00:00Z",
    assumido_em: "2026-06-01T12:00:00Z",
    created_at: "2026-06-01T10:00:00Z",
    solicitante_id: "v",
    ...over,
  };
}

describe("montarRelatorio", () => {
  it("filtra por período e calcula métricas", () => {
    const demandas = [
      demandaStub({ created_at: "2026-06-01T10:00:00Z" }),
      demandaStub({ created_at: "2026-06-05T10:00:00Z" }),
      demandaStub({ created_at: "2026-06-10T10:00:00Z" }),
    ];
    const r = montarRelatorio(demandas, "2026-06-04", "2026-06-08");
    expect(r.demandas.length).toBe(1);
    expect(r.metricas.total).toBe(1);
  });

  it("filtra por escola (case-insensitive substring)", () => {
    const demandas = [
      demandaStub({ escola_nome: "EMEF Vila Nova", created_at: "2026-06-01T10:00:00Z" }),
      demandaStub({ escola_nome: "EMEI Centro",    created_at: "2026-06-01T10:00:00Z" }),
    ];
    const r = montarRelatorio(demandas, "2026-06-01", "2026-06-10", "vila");
    expect(r.demandas.length).toBe(1);
    expect(r.demandas[0].escola_nome).toBe("EMEF Vila Nova");
  });
});

describe("gerarHtmlRelatorio", () => {
  it("retorna HTML válido com dados", () => {
    const r = montarRelatorio([demandaStub()], "2026-06-01", "2026-06-07");
    const html = gerarHtmlRelatorio(r, "Empresa X");
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Relatório Escola");
    expect(html).toContain("Empresa X");
    expect(html).toContain("EMEF Teste");
  });

  it("rotula período como Semanal quando intervalo <= 7 dias", () => {
    const r = montarRelatorio([demandaStub()], "2026-06-01", "2026-06-07");
    expect(gerarHtmlRelatorio(r)).toContain("Semanal");
  });

  it("rotula período como Mensal entre 9 e 32 dias", () => {
    const r = montarRelatorio([demandaStub()], "2026-06-01", "2026-06-25");
    expect(gerarHtmlRelatorio(r)).toContain("Mensal");
  });

  it("escapa HTML em campos do usuário", () => {
    const r = montarRelatorio([demandaStub({ escola_nome: "<script>x</script>" })], "2026-06-01", "2026-06-07");
    const html = gerarHtmlRelatorio(r);
    expect(html).not.toMatch(/<script>x<\/script>/);
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("gerarCsvRelatorio", () => {
  it("CSV tem BOM + cabeçalho + linhas", () => {
    const r = montarRelatorio([demandaStub()], "2026-06-01", "2026-06-07");
    const csv = gerarCsvRelatorio(r);
    expect(csv.charCodeAt(0)).toBe(0xFEFF);
    expect(csv).toContain("Escola;Urgência");
    expect(csv).toContain("EMEF Teste");
  });

  it("escapa campos com ; e aspas", () => {
    const r = montarRelatorio(
      [demandaStub({ descricao: 'tem ; ponto-e-vírgula e "aspas"' })],
      "2026-06-01", "2026-06-07",
    );
    const csv = gerarCsvRelatorio(r);
    expect(csv).toContain('"tem ; ponto-e-vírgula e ""aspas"""');
  });
});

describe("atalhos de período", () => {
  it("periodoSemana cobre 7 dias", () => {
    const p = periodoSemana();
    const diff = (new Date(p.fim) - new Date(p.ini)) / (1000 * 60 * 60 * 24);
    expect(diff).toBe(6); // 7 dias inclusive
  });

  it("periodoMesCorrente começa no dia 1", () => {
    const p = periodoMesCorrente();
    expect(p.ini.slice(-2)).toBe("01");
  });
});
