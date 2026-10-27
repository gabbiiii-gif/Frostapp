import { describe, it, expect } from "vitest";
import {
  visualStatusOS,
  passoFluxoOS,
  proximoStatusOS,
  diaAgendadoOS,
  semanaDe,
  gradeMes,
  rotuloDia,
  iniciais,
  casaBusca,
  nomesEquipe,
  itensAgenda,
  horariosDoDia,
  resumoOS,
  filtrarOS,
  contagemAbasOS,
  concluidasPorSemana,
  nivelEstoque,
  produtosComEstoque,
  estoqueBaixo,
  resumoFinanceiro,
  gruposFinanceiro,
  diasDeAtraso,
  tempoRelativo,
} from "./dados.js";

const os = (over = {}) => ({
  id: "1",
  numero: "OS-001",
  clienteNome: "Clínica Bem Estar",
  status: "aguardando",
  tipo: "Manutenção",
  dataAbertura: "2026-10-20T12:00:00.000Z",
  ...over,
});

describe("status da OS", () => {
  it("traduz status em rótulo e tom", () => {
    expect(visualStatusOS("em_execucao")).toEqual({ label: "Em execução", tom: "info" });
    expect(visualStatusOS("aguardando_finalizacao").label).toBe("Em revisão");
    expect(visualStatusOS("xyz").tom).toBe("mute");
  });

  it("avança no fluxo e para na revisão do técnico", () => {
    expect(proximoStatusOS("aguardando")).toBe("em_deslocamento");
    expect(proximoStatusOS("em_execucao")).toBe("finalizado");
    expect(proximoStatusOS("agendado")).toBe("em_deslocamento");
    expect(proximoStatusOS("aguardando_finalizacao")).toBeNull();
    expect(proximoStatusOS("finalizado")).toBeNull();
    expect(proximoStatusOS("cancelado")).toBeNull();
    expect(passoFluxoOS("em_servico")).toBe(2);
  });
});

describe("datas", () => {
  it("lê o dia agendado sem deslocar fuso", () => {
    expect(diaAgendadoOS({ dataAgendada: "2026-10-29T00:00:00.000Z" })).toBe("2026-10-29");
    expect(diaAgendadoOS({})).toBeNull();
  });

  it("monta a semana de segunda a domingo", () => {
    const s = semanaDe("2026-10-27"); // terça
    expect(s[0]).toMatchObject({ iso: "2026-10-26", curto: "SEG" });
    expect(s[6]).toMatchObject({ iso: "2026-11-01", curto: "DOM" });
  });

  it("monta a grade do mês começando na segunda", () => {
    const g = gradeMes(2026, 9); // outubro/2026 começa numa quinta
    expect(g.slice(0, 3)).toEqual([null, null, null]);
    expect(g[3]).toBe("2026-10-01");
    expect(g.length % 7).toBe(0);
  });

  it("rotula dias relativos", () => {
    expect(rotuloDia("2026-10-27", "2026-10-27")).toBe("Hoje");
    expect(rotuloDia("2026-10-28", "2026-10-27")).toBe("Amanhã");
    expect(rotuloDia("2026-10-29", "2026-10-27")).toBe("qui, 29/10");
  });

  it("escreve tempo relativo", () => {
    const agora = new Date("2026-10-27T14:00:00");
    expect(tempoRelativo("2026-10-27T13:48:00", agora)).toBe("há 12 min");
    expect(tempoRelativo("2026-10-27T11:00:00", agora)).toBe("há 3 h");
    expect(tempoRelativo("2026-10-26T10:00:00", agora)).toBe("ontem");
  });
});

describe("texto", () => {
  it("gera iniciais", () => {
    expect(iniciais("Ana Carolina Ferreira")).toBe("AF");
    expect(iniciais("Restaurante Sabor & Arte")).toBe("RA");
    expect(iniciais("")).toBe("?");
  });

  it("busca sem acento e por dígitos", () => {
    expect(casaBusca("clinica", "Clínica Bem Estar")).toBe(true);
    expect(casaBusca("98765", "(11) 98765-4321")).toBe(true);
    expect(casaBusca("maria", "João", "(11) 98765-4321")).toBe(false);
    expect(casaBusca("", "qualquer")).toBe(true);
  });

  it("nomesEquipe devolve vazio sem técnico", () => {
    expect(nomesEquipe({ tecnicoNome: "—" })).toBe("");
    expect(nomesEquipe({ tecnicos: [{ id: "a", nome: "Ana" }, { id: "b", nome: "Beto" }] })).toBe("Ana, Beto");
  });
});

describe("agenda", () => {
  const lista = [
    os({ id: "1", dataAgendada: "2026-10-27T00:00:00.000Z", horaAgendada: "13:30", tecnicos: [{ id: "t1", nome: "Carlos" }] }),
    os({ id: "2", dataAgendada: "2026-10-27T00:00:00.000Z", horaAgendada: "09:00", status: "cancelado" }),
  ];
  const ags = [{ id: "a", data: "2026-10-27T11:00", dataFim: "2026-10-27T11:45", clienteNome: "Padaria", tipo: "Visita", tecnicos: [{ id: "t2", nome: "Paulo" }] }];

  it("une OS e agendamentos, sem canceladas, ordenados por hora", () => {
    const itens = itensAgenda(lista, ags);
    expect(itens.map((i) => i.id)).toEqual(["ag-a", "os-1"]);
    expect(itens[1]).toMatchObject({ inicio: "13:30", fim: "14:30", origem: "os" });
  });

  it("marca horário ocupado do técnico", () => {
    const itens = itensAgenda(lista, ags);
    const h = horariosDoDia(itens, "2026-10-27", "t1");
    expect(h.find((x) => x.hora === "13:00").ocupado).toBe(true);
    expect(h.find((x) => x.hora === "14:00").ocupado).toBe(true);
    expect(h.find((x) => x.hora === "15:00").ocupado).toBe(false);
    expect(horariosDoDia(itens, "2026-10-27", "t2").find((x) => x.hora === "11:00").ocupado).toBe(true);
  });
});

describe("ordens de serviço", () => {
  const lista = [
    os({ id: "1", status: "aguardando", dataAgendada: "2026-10-27T00:00:00.000Z", horaAgendada: "16:00" }),
    os({ id: "2", status: "em_execucao", dataAgendada: "2026-10-27T00:00:00.000Z", horaAgendada: "09:00", tecnicos: [{ id: "t", nome: "Ricardo" }] }),
    os({ id: "3", status: "aguardando_finalizacao" }),
    os({ id: "4", status: "finalizado", dataConclusao: "2026-10-06T15:00:00" }),
    os({ id: "5", status: "cancelado" }),
  ];

  it("resume por grupo", () => {
    expect(resumoOS(lista)).toMatchObject({ pendentes: 1, andamento: 1, revisao: 1, concluidas: 1, abertas: 3, semTecnico: 1 });
    expect(contagemAbasOS(lista)).toEqual({ ativas: 2, revisao: 1, historico: 2 });
  });

  it("filtra por aba, chip e busca", () => {
    const ativas = filtrarOS(lista, { aba: "ativas", hoje: "2026-10-27" });
    expect(ativas.map((o) => o.id)).toEqual(["2", "1"]);
    expect(filtrarOS(lista, { aba: "ativas", chip: "semTecnico", hoje: "2026-10-27" }).map((o) => o.id)).toEqual(["1"]);
    expect(filtrarOS(lista, { aba: "ativas", busca: "ricardo", hoje: "2026-10-27" }).map((o) => o.id)).toEqual(["2"]);
  });

  it("conta concluídas por semana do mês", () => {
    const semanas = concluidasPorSemana(lista, new Date(2026, 9, 27));
    expect(semanas.map((s) => s.label)).toEqual(["1–4", "5–11", "12–18", "19–25", "26–31"]);
    expect(semanas[1].n).toBe(1);
    expect(semanas[4].atual).toBe(true);
  });
});

describe("estoque", () => {
  it("classifica o nível", () => {
    expect(nivelEstoque(1, 3)).toBe("bad");
    expect(nivelEstoque(3, 10)).toBe("bad");
    expect(nivelEstoque(5, 8)).toBe("warn");
    expect(nivelEstoque(6, 2)).toBe("ok");
    expect(nivelEstoque(null, 2)).toBe("sem");
  });

  it("junta produto e saldo e lista os abaixo do mínimo", () => {
    const produtos = [{ id: "p1", nome: "Gás R-410A" }, { id: "p2", nome: "Split" }, { id: "p3", nome: "Sem estoque" }];
    const estoques = [{ produtoId: "p1", saldo: 1, estoqueMinimo: 3 }, { produtoId: "p2", saldo: 6, estoqueMinimo: 2 }];
    const itens = produtosComEstoque(produtos, estoques);
    expect(itens[0].produto.id).toBe("p1");
    expect(estoqueBaixo(produtos, estoques).map((i) => i.produto.id)).toEqual(["p1"]);
  });
});

describe("financeiro", () => {
  const hoje = new Date("2026-10-27T12:00:00");
  const lanc = [
    { id: "r1", tipo: "receita", valor: 650, status: "pago", data: "2026-10-27T00:00:00.000Z" },
    { id: "d1", tipo: "despesa", valor: 180, status: "pago", data: "2026-10-27T00:00:00.000Z" },
    { id: "r2", tipo: "receita", valor: 890, status: "pendente", data: "2026-10-10T00:00:00.000Z", vencimento: "2026-10-20" },
    { id: "r3", tipo: "receita", valor: 300, status: "pendente", data: "2026-10-27T00:00:00.000Z", vencimento: "2026-11-05" },
    { id: "x", tipo: "receita", valor: 999, status: "cancelado", data: "2026-10-27T00:00:00.000Z" },
  ];

  it("resume realizado e pipeline", () => {
    const r = resumoFinanceiro(lanc, "30dias", hoje);
    expect(r.receitaPaga).toBe(650);
    expect(r.despesaPaga).toBe(180);
    expect(r.saldo).toBe(470);
    expect(r.aReceber).toBe(300);
    expect(r.vencidos).toBe(890);
    expect(r.vencReceber).toBe(1);
  });

  it("agrupa por prioridade", () => {
    const grupos = gruposFinanceiro(lanc, "todos", hoje);
    expect(grupos.map((g) => g.id)).toEqual(["vencidos", "proximos", "pagos"]);
    expect(gruposFinanceiro(lanc, "vencidos", hoje).map((g) => g.id)).toEqual(["vencidos"]);
    expect(gruposFinanceiro(lanc, "pagar", hoje)[0].itens[0].lancamento.id).toBe("d1");
  });

  it("conta dias de atraso pelo vencimento", () => {
    expect(diasDeAtraso({ vencimento: "2026-10-20" }, "2026-10-27")).toBe(7);
  });
});

describe("lerValor", () => {
  it("entende formatos brasileiros", async () => {
    const { lerValor } = await import("./dados.js");
    expect(lerValor("R$ 1.234,56")).toBe(1234.56);
    expect(lerValor("650")).toBe(650);
    expect(lerValor("89,9")).toBe(89.9);
    expect(lerValor("1234.5")).toBe(1234.5);
    expect(lerValor("1.234.567")).toBe(1234567);
    expect(lerValor("")).toBe(0);
  });
});
