import { describe, it, expect } from "vitest";
import {
  chaveMes,
  limitesDoMes,
  mesEncerrado,
  mesesAFechar,
  montarFechamento,
  fechamentoTemMovimento,
} from "./fechamento-mensal.js";

describe("limitesDoMes", () => {
  it("julho/2026 vai de 01/07 00:00 a 31/07 23:59:59.999", () => {
    const { inicio, fim } = limitesDoMes("2026-07");
    expect(inicio.getDate()).toBe(1);
    expect(inicio.getMonth()).toBe(6); // 0-based
    expect(inicio.getHours()).toBe(0);
    expect(fim.getDate()).toBe(31);
    expect(fim.getMonth()).toBe(6);
    expect(fim.getHours()).toBe(23);
    expect(fim.getMilliseconds()).toBe(999);
  });

  it("pega o último dia real de meses de 30 dias", () => {
    expect(limitesDoMes("2026-06").fim.getDate()).toBe(30);
  });

  it("acerta fevereiro em ano bissexto", () => {
    expect(limitesDoMes("2024-02").fim.getDate()).toBe(29);
    expect(limitesDoMes("2026-02").fim.getDate()).toBe(28);
  });
});

describe("chaveMes", () => {
  it("formata com zero à esquerda", () => {
    expect(chaveMes(new Date(2026, 0, 15))).toBe("2026-01");
    expect(chaveMes(new Date(2026, 11, 1))).toBe("2026-12");
  });
});

describe("mesEncerrado", () => {
  it("mês em curso ainda não encerrou", () => {
    expect(mesEncerrado("2026-08", new Date(2026, 7, 27))).toBe(false);
  });

  it("mês anterior já encerrou", () => {
    expect(mesEncerrado("2026-07", new Date(2026, 7, 1, 0, 0, 1))).toBe(true);
  });

  it("no último instante do mês ele ainda NÃO encerrou", () => {
    expect(mesEncerrado("2026-07", new Date(2026, 6, 31, 23, 59, 59, 999))).toBe(false);
  });
});

describe("mesesAFechar", () => {
  const agora = new Date(2026, 7, 27); // 27/ago/2026

  it("não inclui o mês corrente", () => {
    expect(mesesAFechar(agora, [], 3)).not.toContain("2026-08");
  });

  it("lista os encerrados do mais antigo pro mais novo", () => {
    expect(mesesAFechar(agora, [], 3)).toEqual(["2026-05", "2026-06", "2026-07"]);
  });

  it("pula os que já têm fechamento (idempotência)", () => {
    expect(mesesAFechar(agora, ["2026-06"], 3)).toEqual(["2026-05", "2026-07"]);
  });

  it("com tudo fechado, não devolve nada", () => {
    expect(mesesAFechar(agora, ["2026-05", "2026-06", "2026-07"], 3)).toEqual([]);
  });
});

describe("montarFechamento", () => {
  const serviceOrders = [
    // aberta em junho, finalizada em julho → abertura de junho, produção de julho
    { id: "a", status: "finalizado", dataAbertura: "2026-06-28T10:00:00.000Z", dataConclusao: "2026-07-03T15:00:00.000Z", valor: 300, tecnicoNome: "Ana" },
    { id: "b", status: "finalizado", dataAbertura: "2026-07-05T10:00:00.000Z", dataConclusao: "2026-07-06T11:00:00.000Z", valor: 500, tecnicoNome: "Ana" },
    { id: "c", status: "em_execucao", dataAbertura: "2026-07-20T10:00:00.000Z", dataConclusao: null, valor: 200, tecnicoNome: "Beto" },
    { id: "d", status: "cancelado", dataAbertura: "2026-07-22T10:00:00.000Z", dataConclusao: null, valor: 0 },
    // agosto: fora da janela
    { id: "e", status: "finalizado", dataAbertura: "2026-08-01T10:00:00.000Z", dataConclusao: "2026-08-02T10:00:00.000Z", valor: 999, tecnicoNome: "Ana" },
  ];
  const transactions = [
    { id: "t1", tipo: "receita", status: "pago", data: "2026-07-06T00:00:00.000Z", valor: 500, categoria: "Serviços" },
    { id: "t2", tipo: "receita", status: "pago", data: "2026-07-03T00:00:00.000Z", valor: 300, categoria: "Serviços" },
    { id: "t3", tipo: "despesa", status: "pago", data: "2026-07-10T00:00:00.000Z", valor: 120, categoria: "Combustível" },
    { id: "t4", tipo: "receita", status: "pendente", data: "2026-07-28T00:00:00.000Z", valor: 700, categoria: "Serviços" },
    { id: "t5", tipo: "receita", status: "pago", data: "2026-08-02T00:00:00.000Z", valor: 999, categoria: "Serviços" },
  ];
  const clients = [
    { id: "c1", createdAt: "2026-07-11T00:00:00.000Z" },
    { id: "c2", createdAt: "2026-05-11T00:00:00.000Z" },
  ];

  const f = montarFechamento({ mes: "2026-07", serviceOrders, transactions, clients, agora: new Date(2026, 7, 1) });

  it("conta aberturas pelo mês da abertura", () => {
    expect(f.osAbertas).toBe(3); // b, c, d
  });

  it("conta concluídas pelo mês da conclusão, inclusive a aberta no mês anterior", () => {
    expect(f.osConcluidas).toBe(2); // a (aberta em junho) + b
  });

  it("não deixa vazar registro do mês seguinte", () => {
    expect(f.receita).toBe(800);
    expect(f.osConcluidas).not.toBe(3);
  });

  it("soma só os lançamentos pagos; o pendente vira aReceber", () => {
    expect(f.receita).toBe(800);
    expect(f.despesas).toBe(120);
    expect(f.saldo).toBe(680);
    expect(f.aReceber).toBe(700);
  });

  it("calcula ticket médio das concluídas", () => {
    expect(f.valorConcluidas).toBe(800);
    expect(f.ticketMedio).toBe(400);
  });

  it("conta canceladas e clientes novos do mês", () => {
    expect(f.osCanceladas).toBe(1);
    expect(f.clientesNovos).toBe(1);
  });

  it("apura produção por técnico e o destaque", () => {
    expect(f.concluidasPorTecnico).toEqual({ Ana: 2 });
    expect(f.tecnicoDestaque).toBe("Ana");
  });

  it("carrega o recorte do mês para consulta posterior", () => {
    expect(f.mes).toBe("2026-07");
    expect(f.id).toBe("2026-07");
    expect(new Date(f.inicio).getDate()).toBe(1);
    expect(new Date(f.fim).getDate()).toBe(31);
  });

  it("mês sem movimento nenhum é descartável", () => {
    const vazio = montarFechamento({ mes: "2026-01", serviceOrders, transactions, clients });
    expect(fechamentoTemMovimento(vazio)).toBe(false);
    expect(fechamentoTemMovimento(f)).toBe(true);
  });

  it("ticket médio não divide por zero em mês sem conclusão", () => {
    const vazio = montarFechamento({ mes: "2026-01", serviceOrders, transactions, clients });
    expect(vazio.ticketMedio).toBe(0);
  });
});
