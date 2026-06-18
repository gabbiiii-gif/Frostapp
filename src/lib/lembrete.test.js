import { describe, it, expect } from "vitest";
import {
  tipoCliente, intervaloEfetivo, ultimaVisitaCliente,
  proximaManutencao, manutencaoDue, preencherTemplate,
} from "./lembrete.js";

describe("lembrete.tipoCliente", () => {
  it("usa o campo tipo quando existe", () => {
    expect(tipoCliente({ tipo: "pj" })).toBe("pj");
    expect(tipoCliente({ tipo: "pf" })).toBe("pf");
  });
  it("cai no cnpj→pj / cpf→pf quando não há tipo", () => {
    expect(tipoCliente({ cnpj: "11.111.111/0001-11" })).toBe("pj");
    expect(tipoCliente({ cpf: "123.456.789-00" })).toBe("pf");
  });
  it("default pf", () => {
    expect(tipoCliente({})).toBe("pf");
  });
});

describe("lembrete.intervaloEfetivo", () => {
  const cfg = { intervalo_pj_dias: 90, intervalo_pf_dias: 180 };
  it("override do cliente tem prioridade", () => {
    expect(intervaloEfetivo({ tipo: "pj", intervalo_manutencao_dias: 30 }, cfg)).toBe(30);
  });
  it("usa o padrão por tipo quando sem override", () => {
    expect(intervaloEfetivo({ tipo: "pj" }, cfg)).toBe(90);
    expect(intervaloEfetivo({ tipo: "pf" }, cfg)).toBe(180);
  });
});

describe("lembrete.ultimaVisitaCliente", () => {
  it("pega a maior dataConclusao das OS finalizadas do cliente", () => {
    const os = [
      { clienteId: "c1", status: "finalizado", dataConclusao: "2026-01-10T00:00:00Z" },
      { clienteId: "c1", status: "finalizado", dataConclusao: "2026-03-20T00:00:00Z" },
      { clienteId: "c1", status: "aguardando", dataConclusao: null },
      { clienteId: "c2", status: "finalizado", dataConclusao: "2026-05-01T00:00:00Z" },
    ];
    expect(ultimaVisitaCliente(os, "c1")).toBe("2026-03-20T00:00:00Z");
  });
  it("null quando o cliente não tem OS finalizada", () => {
    expect(ultimaVisitaCliente([{ clienteId: "c1", status: "aguardando" }], "c1")).toBeNull();
  });
});

describe("lembrete.proximaManutencao / manutencaoDue", () => {
  it("soma os dias do intervalo à última visita", () => {
    const p = proximaManutencao("2026-01-01T00:00:00Z", 90);
    expect(p.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  it("due quando faltam <= antecedência e >= 0 dias", () => {
    const proxima = new Date("2026-06-20T00:00:00Z");
    expect(manutencaoDue(proxima, new Date("2026-06-10T00:00:00Z"), 15)).toBe(true);  // faltam 10
    expect(manutencaoDue(proxima, new Date("2026-06-01T00:00:00Z"), 15)).toBe(false); // faltam 19
    expect(manutencaoDue(proxima, new Date("2026-06-21T00:00:00Z"), 15)).toBe(false); // já passou
  });
});

describe("lembrete.preencherTemplate", () => {
  it("substitui {variaveis}", () => {
    const out = preencherTemplate("Olá {cliente}, próxima {proxima_visita}", {
      cliente: "João", proxima_visita: "20/06/2026",
    });
    expect(out).toBe("Olá João, próxima 20/06/2026");
  });
  it("variável ausente vira string vazia", () => {
    expect(preencherTemplate("oi {nada}", {})).toBe("oi ");
  });
});
