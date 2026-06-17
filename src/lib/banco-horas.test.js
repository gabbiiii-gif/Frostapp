// ─── Testes Vitest — banco de horas ──────────────────────────────────────────

import { describe, it, expect } from "vitest";
import {
  JORNADA_DEFAULT,
  ehDiaUtil,
  calcularSaldoDia,
  calcularSaldoPeriodo,
  enumerarDias,
  periodoMes,
  totalSaldo,
  contarPorStatus,
  getJornada,
  setJornada,
  migrarJornada,
} from "./banco-horas.js";

function makeMemDb() {
  const store = new Map();
  return {
    get: (k) => (store.has(k) ? structuredClone(store.get(k)) : null),
    set: (k, v) => { store.set(k, structuredClone(v)); return true; },
    delete: (k) => { store.delete(k); return true; },
    list: (prefix) => Array.from(store.entries())
      .filter(([k]) => k.startsWith(prefix))
      .map(([, v]) => structuredClone(v)),
  };
}

describe("ehDiaUtil", () => {
  it("seg–sex são úteis no default", () => {
    expect(ehDiaUtil("2026-06-01")).toBe(true); // segunda
    expect(ehDiaUtil("2026-06-05")).toBe(true); // sexta
  });
  it("sáb/dom não são úteis no default", () => {
    expect(ehDiaUtil("2026-06-06")).toBe(false); // sábado
    expect(ehDiaUtil("2026-06-07")).toBe(false); // domingo
  });
  it("jornada custom respeita dias_semana", () => {
    expect(ehDiaUtil("2026-06-06", { dias_semana: [6] })).toBe(true);
  });
});

describe("calcularSaldoDia", () => {
  const jornada = { ...JORNADA_DEFAULT };
  const make = (hStart, hEnd) => ({
    tipo: hStart === hEnd ? "entrada" : "entrada",
    datahora: `2026-06-01T${hStart}:00Z`,
  });

  it("dia exato sem saldo (8h trabalhadas, jornada 8h)", () => {
    // 8h - 0h = 8h trabalhadas. mas precisa de pares entrada/saida.
    const regs = [
      { tipo: "entrada", datahora: "2026-06-01T11:00:00Z" }, // 11 UTC = manhã local
      { tipo: "saida",   datahora: "2026-06-01T19:00:00Z" }, // +8h
    ];
    const r = calcularSaldoDia("2026-06-01", regs, jornada);
    expect(r.minutos_trabalhados).toBe(480);
    expect(r.minutos_esperados).toBe(480);
    expect(r.saldo).toBe(0);
    expect(r.status).toBe("ok");
  });

  it("saldo positivo vira crédito", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-01T11:00:00Z" },
      { tipo: "saida",   datahora: "2026-06-01T20:00:00Z" }, // +9h
    ];
    const r = calcularSaldoDia("2026-06-01", regs, jornada);
    expect(r.minutos_trabalhados).toBe(540);
    expect(r.saldo).toBe(60); // 9h - 8h = +1h
    expect(r.status).toBe("credito");
  });

  it("saldo negativo vira débito", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-01T11:00:00Z" },
      { tipo: "saida",   datahora: "2026-06-01T18:00:00Z" }, // +7h
    ];
    const r = calcularSaldoDia("2026-06-01", regs, jornada);
    expect(r.saldo).toBe(-60); // 7h - 8h = -1h
    expect(r.status).toBe("debito");
  });

  it("tolerância anula saldo pequeno", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-01T11:00:00Z" },
      { tipo: "saida",   datahora: "2026-06-01T18:55:00Z" }, // 7h55 = -5min
    ];
    const r = calcularSaldoDia("2026-06-01", regs, { ...jornada, tolerancia_min: 10 });
    expect(r.saldo_bruto).toBe(-5);
    expect(r.saldo).toBe(0); // tolerância absorve
    expect(r.status).toBe("ok");
  });

  it("falta: dia útil sem registros = débito jornada inteira", () => {
    const r = calcularSaldoDia("2026-06-01", [], jornada);
    expect(r.minutos_trabalhados).toBe(0);
    expect(r.saldo).toBe(-480);
    expect(r.status).toBe("falta");
  });

  it("dia não útil sem trabalho = folga", () => {
    const r = calcularSaldoDia("2026-06-06", [], jornada); // sábado
    expect(r.status).toBe("folga");
    expect(r.saldo).toBe(0);
  });

  it("dia não útil COM trabalho = feriado_extra", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-06T11:00:00Z" },
      { tipo: "saida",   datahora: "2026-06-06T15:00:00Z" }, // +4h
    ];
    const r = calcularSaldoDia("2026-06-06", regs, jornada);
    expect(r.minutos_trabalhados).toBe(240);
    expect(r.saldo).toBe(240); // sem esperado, tudo vira crédito
    expect(r.status).toBe("feriado_extra");
  });

  it("atestado aprovado zera débito do dia", () => {
    const r = calcularSaldoDia("2026-06-01", [], jornada, [
      { tipo: "atestado_medico", status: "aprovado", zera_debito: true },
    ]);
    expect(r.status).toBe("atestado");
    expect(r.saldo).toBe(0);
  });
});

describe("enumerarDias / periodoMes", () => {
  it("enumerarDias inclusivo", () => {
    expect(enumerarDias("2026-06-01", "2026-06-03"))
      .toEqual(["2026-06-01", "2026-06-02", "2026-06-03"]);
  });
  it("periodoMes retorna primeiro e último", () => {
    const p = periodoMes("2026-02");
    expect(p.ini).toBe("2026-02-01");
    expect(p.fim).toBe("2026-02-28");
  });
  it("periodoMes lida com fevereiro bissexto", () => {
    const p = periodoMes("2024-02");
    expect(p.fim).toBe("2024-02-29");
  });
});

describe("calcularSaldoPeriodo", () => {
  it("itera dias e devolve um saldo por dia", () => {
    const db = makeMemDb();
    // dia 1: 8h, dia 2: nada, dia 3: 9h
    db.set("erp:ponto:1", { id: "1", funcionario_id: "f", tipo: "entrada", datahora: "2026-06-01T11:00:00Z" });
    db.set("erp:ponto:2", { id: "2", funcionario_id: "f", tipo: "saida",   datahora: "2026-06-01T19:00:00Z" });
    db.set("erp:ponto:3", { id: "3", funcionario_id: "f", tipo: "entrada", datahora: "2026-06-03T11:00:00Z" });
    db.set("erp:ponto:4", { id: "4", funcionario_id: "f", tipo: "saida",   datahora: "2026-06-03T20:00:00Z" });
    const r = calcularSaldoPeriodo(db, "f", "2026-06-01", "2026-06-03");
    expect(r.length).toBe(3);
    expect(r[0].status).toBe("ok");
    expect(r[1].status).toBe("falta");
    expect(r[2].status).toBe("credito");
    expect(totalSaldo(r)).toBe(0 + (-480) + 60); // -420
  });
});

describe("contarPorStatus", () => {
  it("conta cada status corretamente", () => {
    const c = contarPorStatus([
      { status: "ok" }, { status: "ok" },
      { status: "credito" }, { status: "debito" }, { status: "falta" },
      { status: "folga" }, { status: "atestado" },
    ]);
    expect(c.ok).toBe(2);
    expect(c.credito).toBe(1);
    expect(c.debito).toBe(1);
    expect(c.falta).toBe(1);
    expect(c.folga).toBe(1);
    expect(c.atestado).toBe(1);
  });
});

describe("getJornada / setJornada", () => {
  it("getJornada devolve default quando não há salva", () => {
    const db = makeMemDb();
    const j = getJornada(db, "f");
    expect(j.horas_dia).toBe(8);
    expect(j.dias_semana).toEqual([1, 2, 3, 4, 5]);
  });

  it("setJornada persiste e mescla com default", () => {
    const db = makeMemDb();
    const j = setJornada(db, "f", { horas_dia: 6, tolerancia_min: 5 });
    expect(j.horas_dia).toBe(6);
    expect(j.tolerancia_min).toBe(5);
    expect(j.dias_semana).toEqual([1, 2, 3, 4, 5]); // veio do default
    expect(j.updated_at).toBeDefined();
    const j2 = getJornada(db, "f");
    expect(j2.horas_dia).toBe(6);
  });
});

describe("banco-horas.migrarJornada", () => {
  it("deriva horas_por_dia de dias_semana + horas_dia (legado)", () => {
    const out = migrarJornada({ horas_dia: 8, dias_semana: [1, 2, 3, 4, 5, 6] });
    expect(out.horas_por_dia[1]).toBe(8);
    expect(out.horas_por_dia[6]).toBe(8); // sábado trabalhado
    expect(out.horas_por_dia[0]).toBe(0); // domingo folga
  });

  it("deriva janela de almoço de intervalo_min (legado)", () => {
    const out = migrarJornada({ horas_dia: 8, dias_semana: [1], intervalo_min: 60 });
    expect(out.almoco_inicio).toBe("12:00");
    expect(out.almoco_fim).toBe("13:00");
  });

  it("intervalo_min 0 → sem almoço", () => {
    const out = migrarJornada({ horas_dia: 8, dias_semana: [1], intervalo_min: 0 });
    expect(out.almoco_inicio).toBeNull();
    expect(out.almoco_fim).toBeNull();
  });

  it("jornada nova (já tem horas_por_dia) passa intacta", () => {
    const nova = {
      horas_por_dia: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4 },
      almoco_inicio: "11:30", almoco_fim: "12:30",
    };
    const out = migrarJornada(nova);
    expect(out.horas_por_dia[6]).toBe(4);
    expect(out.almoco_inicio).toBe("11:30");
  });
});
