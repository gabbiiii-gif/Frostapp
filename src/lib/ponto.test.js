// ─── Testes Vitest — domínio Ponto Eletrônico ────────────────────────────────

import { describe, it, expect, beforeEach } from "vitest";
import {
  TIPOS_PONTO,
  JANELA_DUP_MS,
  hashPin,
  verifyPin,
  registrarPonto,
  ultimoRegistro,
  dentroJanelaDuplicacao,
  proximaAcao,
  listarRegistrosDia,
  listarRegistrosPeriodo,
  listarRegistrosDiaTodos,
  minutosTrabalhadosDia,
  formatMinutos,
  distanciaMetros,
  avaliarGeofence,
} from "./ponto.js";

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

const JOAO = "func_joao";

describe("ponto.hashPin / verifyPin", () => {
  it("aceita PIN válido de 4 a 8 dígitos", async () => {
    const h = await hashPin(JOAO, "1234");
    expect(typeof h).toBe("string");
    expect(h.length).toBe(64); // sha256 hex
    expect(await verifyPin(JOAO, "1234", h)).toBe(true);
    expect(await verifyPin(JOAO, "1235", h)).toBe(false);
  });

  it("rejeita PIN inválido", async () => {
    await expect(hashPin(JOAO, "abc")).rejects.toThrow(/dígitos/);
    await expect(hashPin(JOAO, "12")).rejects.toThrow(/dígitos/);
    await expect(hashPin(JOAO, "123456789")).rejects.toThrow(/dígitos/);
  });

  it("salt por funcionário evita colisão entre users", async () => {
    const h1 = await hashPin("func_a", "1234");
    const h2 = await hashPin("func_b", "1234");
    expect(h1).not.toBe(h2);
  });
});

describe("ponto.dentroJanelaDuplicacao", () => {
  it("true quando está dentro de 5 min", () => {
    const ult = new Date();
    const agora = new Date(ult.getTime() + 2 * 60 * 1000);
    expect(dentroJanelaDuplicacao(ult.toISOString(), agora.toISOString())).toBe(true);
  });
  it("false quando passou de 5 min", () => {
    const ult = new Date();
    const agora = new Date(ult.getTime() + 6 * 60 * 1000);
    expect(dentroJanelaDuplicacao(ult.toISOString(), agora.toISOString())).toBe(false);
  });
  it("false quando não há último registro", () => {
    expect(dentroJanelaDuplicacao(null)).toBe(false);
  });
});

describe("ponto.proximaAcao", () => {
  it("entrada quando dia vazio", () => {
    expect(proximaAcao([])).toBe("entrada");
  });
  it("saida após entrada", () => {
    const r = [{ tipo: "entrada", datahora: "2026-06-02T08:00:00" }];
    expect(proximaAcao(r)).toBe("saida");
  });
  it("entrada de novo após saida (novo ciclo)", () => {
    const r = [
      { tipo: "entrada", datahora: "2026-06-02T08:00:00" },
      { tipo: "saida",   datahora: "2026-06-02T17:00:00" },
    ];
    expect(proximaAcao(r)).toBe("entrada");
  });
  it("ignora batidas de intervalo legadas (trata última real)", () => {
    const r = [
      { tipo: "entrada",          datahora: "2026-06-02T08:00:00" },
      { tipo: "intervalo_inicio", datahora: "2026-06-02T12:00:00" },
      { tipo: "intervalo_fim",    datahora: "2026-06-02T13:00:00" },
    ];
    // última batida não-saida → ainda espera saida
    expect(proximaAcao(r)).toBe("saida");
  });
});

describe("ponto.registrarPonto", () => {
  let db;
  beforeEach(() => { db = makeMemDb(); });

  it("cria registro com defaults", () => {
    const r = registrarPonto(db, {
      funcionario_id: JOAO,
      tipo: "entrada",
      metodo: "pin",
      gps: { lat: -23.5, lng: -46.6, acc: 10 },
    });
    expect(r.id).toMatch(/^erp:ponto:/);
    expect(r.tipo).toBe("entrada");
    expect(r.gps_lat).toBe(-23.5);
    expect(r.created_at).toBeDefined();
  });

  it("bloqueia duplicação em janela de 5 min", () => {
    registrarPonto(db, { funcionario_id: JOAO, tipo: "entrada" });
    expect(() =>
      registrarPonto(db, { funcionario_id: JOAO, tipo: "intervalo_inicio" })
    ).toThrow(/Aguarde/);
  });

  it("permite registro manual mesmo dentro da janela", () => {
    registrarPonto(db, { funcionario_id: JOAO, tipo: "entrada" });
    const r = registrarPonto(db, {
      funcionario_id: JOAO,
      tipo: "saida",
      metodo: "manual",
      manual_motivo: "Bateu fora do horário e me pediu",
      manual_por: "admin_xyz",
    });
    expect(r.metodo).toBe("manual");
  });

  it("manual sem motivo é rejeitado", () => {
    expect(() => registrarPonto(db, {
      funcionario_id: JOAO, tipo: "entrada", metodo: "manual",
    })).toThrow(/motivo/);
  });

  it("rejeita tipo inválido", () => {
    expect(() => registrarPonto(db, { funcionario_id: JOAO, tipo: "almoco" }))
      .toThrow(/Tipo/);
  });
});

describe("ponto — queries", () => {
  it("listarRegistrosDia filtra por funcionário + dia", () => {
    const db = makeMemDb();
    registrarPonto(db, {
      funcionario_id: JOAO, tipo: "entrada",
      datahora: "2026-06-02T08:00:00Z", metodo: "manual",
      manual_motivo: "seed", manual_por: "admin",
    });
    registrarPonto(db, {
      funcionario_id: JOAO, tipo: "saida",
      datahora: "2026-06-01T17:00:00Z", metodo: "manual",
      manual_motivo: "seed", manual_por: "admin",
    });
    registrarPonto(db, {
      funcionario_id: "outro", tipo: "entrada",
      datahora: "2026-06-02T09:00:00Z", metodo: "manual",
      manual_motivo: "seed", manual_por: "admin",
    });
    const r = listarRegistrosDia(db, JOAO, "2026-06-02");
    expect(r.length).toBe(1);
    expect(r[0].tipo).toBe("entrada");
  });

  it("listarRegistrosPeriodo respeita intervalo", () => {
    const db = makeMemDb();
    for (const dt of ["2026-06-01T09:00:00Z", "2026-06-03T09:00:00Z", "2026-06-05T09:00:00Z"]) {
      registrarPonto(db, {
        funcionario_id: JOAO, tipo: "entrada", datahora: dt,
        metodo: "manual", manual_motivo: "seed", manual_por: "admin",
      });
    }
    const r = listarRegistrosPeriodo(db, JOAO, "2026-06-02", "2026-06-04");
    expect(r.length).toBe(1);
  });

  it("listarRegistrosDiaTodos retorna de todos funcionários", () => {
    const db = makeMemDb();
    registrarPonto(db, { funcionario_id: "a", tipo: "entrada", datahora: "2026-06-02T08:00:00Z",
      metodo: "manual", manual_motivo: "seed", manual_por: "admin" });
    registrarPonto(db, { funcionario_id: "b", tipo: "entrada", datahora: "2026-06-02T09:00:00Z",
      metodo: "manual", manual_motivo: "seed", manual_por: "admin" });
    const r = listarRegistrosDiaTodos(db, "2026-06-02");
    expect(r.length).toBe(2);
  });
});

describe("ponto.minutosTrabalhadosDia", () => {
  it("dia legado com batidas de intervalo: usa os pares antigos", () => {
    const regs = [
      { tipo: "entrada",          datahora: "2026-06-02T08:00:00" },
      { tipo: "intervalo_inicio", datahora: "2026-06-02T12:00:00" },
      { tipo: "intervalo_fim",    datahora: "2026-06-02T13:00:00" },
      { tipo: "saida",            datahora: "2026-06-02T17:00:00" },
    ];
    expect(minutosTrabalhadosDia(regs)).toBe(480); // 240 + 240
  });

  it("entrada/saida com janela de almoço: desconta a sobreposição", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-02T08:00:00" },
      { tipo: "saida",   datahora: "2026-06-02T17:00:00" },
    ];
    const jornada = { almoco_inicio: "12:00", almoco_fim: "13:00" };
    // 9h bruto (540) - 60 de almoço = 480
    expect(minutosTrabalhadosDia(regs, jornada)).toBe(480);
  });

  it("meio período de manhã (sai antes do almoço): não desconta", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-02T08:00:00" },
      { tipo: "saida",   datahora: "2026-06-02T11:00:00" },
    ];
    const jornada = { almoco_inicio: "12:00", almoco_fim: "13:00" };
    expect(minutosTrabalhadosDia(regs, jornada)).toBe(180); // 3h cheias
  });

  it("sem janela de almoço: não desconta nada", () => {
    const regs = [
      { tipo: "entrada", datahora: "2026-06-02T08:00:00" },
      { tipo: "saida",   datahora: "2026-06-02T17:00:00" },
    ];
    expect(minutosTrabalhadosDia(regs, { almoco_inicio: null, almoco_fim: null })).toBe(540);
    expect(minutosTrabalhadosDia(regs)).toBe(540); // jornada ausente
  });

  it("zero quando dia vazio", () => {
    expect(minutosTrabalhadosDia([])).toBe(0);
  });

  it("ignora entrada sem saída", () => {
    const regs = [{ tipo: "entrada", datahora: "2026-06-02T08:00:00" }];
    expect(minutosTrabalhadosDia(regs)).toBe(0);
  });
});

describe("ponto.formatMinutos", () => {
  it("formata HH:MM", () => {
    expect(formatMinutos(75)).toBe("01:15");
    expect(formatMinutos(480)).toBe("08:00");
    expect(formatMinutos(0)).toBe("00:00");
  });
  it("trata negativo", () => {
    expect(formatMinutos(-90)).toBe("-01:30");
  });
  it("dash para null/NaN", () => {
    expect(formatMinutos(null)).toBe("—");
    expect(formatMinutos(NaN)).toBe("—");
  });
});

describe("ponto.distanciaMetros (haversine)", () => {
  it("zero para o mesmo ponto", () => {
    expect(distanciaMetros(-23.5, -46.6, -23.5, -46.6)).toBe(0);
  });
  it("calcula distância curta com precisão razoável (~111m por 0.001° lat)", () => {
    // 0.001 grau de latitude ≈ 111 m
    const d = distanciaMetros(-23.5000, -46.6, -23.5010, -46.6);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(115);
  });
  it("NaN quando argumento inválido", () => {
    expect(Number.isNaN(distanciaMetros(null, -46, -23, -46))).toBe(true);
  });
});

describe("ponto.avaliarGeofence", () => {
  const centro = { ativo: true, lat: -23.5, lng: -46.6, raio_m: 100 };

  it("desativado quando cerca off ou ausente", () => {
    expect(avaliarGeofence({ lat: -23.5, lng: -46.6, acc: 5 }, null).geo_motivo).toBe("desativado");
    expect(avaliarGeofence({ lat: -23.5, lng: -46.6, acc: 5 }, { ...centro, ativo: false }).geo_motivo).toBe("desativado");
    expect(avaliarGeofence({ lat: 0, lng: 0 }, null).fora_da_area).toBe(false);
  });

  it("ok quando dentro do raio", () => {
    const r = avaliarGeofence({ lat: -23.5, lng: -46.6, acc: 10 }, centro);
    expect(r.fora_da_area).toBe(false);
    expect(r.geo_motivo).toBe("ok");
    expect(r.distancia_m).toBe(0);
  });

  it("fora quando além do raio", () => {
    // ~333 m ao norte (0.003° lat), acc 10 → bem fora dos 100 m
    const r = avaliarGeofence({ lat: -23.497, lng: -46.6, acc: 10 }, centro);
    expect(r.fora_da_area).toBe(true);
    expect(r.geo_motivo).toBe("fora");
    expect(r.distancia_m).toBeGreaterThan(100);
  });

  it("tolera acurácia do GPS na borda (não acusa falso-positivo)", () => {
    // ~111 m de distância, mas acc 50 → 111-50 = 61 <= 100 → dentro
    const r = avaliarGeofence({ lat: -23.499, lng: -46.6, acc: 50 }, centro);
    expect(r.fora_da_area).toBe(false);
    expect(r.geo_motivo).toBe("ok");
  });

  it("sem_gps quando cerca ativa mas GPS ausente (suspeito)", () => {
    const r = avaliarGeofence(null, centro);
    expect(r.fora_da_area).toBe(true);
    expect(r.geo_motivo).toBe("sem_gps");
    expect(r.distancia_m).toBeNull();
  });
});

describe("ponto.registrarPonto — geofence", () => {
  let db;
  beforeEach(() => { db = makeMemDb(); });
  const centro = { ativo: true, lat: -23.5, lng: -46.6, raio_m: 100 };

  it("marca fora_da_area + distancia quando bate longe", () => {
    const r = registrarPonto(db, {
      funcionario_id: JOAO, tipo: "entrada", metodo: "pin",
      gps: { lat: -23.497, lng: -46.6, acc: 10 }, geofence: centro,
    });
    expect(r.fora_da_area).toBe(true);
    expect(r.geo_motivo).toBe("fora");
    expect(r.distancia_m).toBeGreaterThan(100);
  });

  it("dentro da área não sinaliza", () => {
    const r = registrarPonto(db, {
      funcionario_id: JOAO, tipo: "entrada", metodo: "pin",
      gps: { lat: -23.5, lng: -46.6, acc: 8 }, geofence: centro,
    });
    expect(r.fora_da_area).toBe(false);
    expect(r.geo_motivo).toBe("ok");
  });

  it("sem cerca configurada → desativado, não sinaliza", () => {
    const r = registrarPonto(db, {
      funcionario_id: JOAO, tipo: "entrada", metodo: "pin",
      gps: { lat: 10, lng: 10, acc: 8 },
    });
    expect(r.fora_da_area).toBe(false);
    expect(r.geo_motivo).toBe("desativado");
  });

  it("registro manual nunca sinaliza geofence", () => {
    const r = registrarPonto(db, {
      funcionario_id: JOAO, tipo: "entrada", metodo: "manual",
      manual_motivo: "correção", manual_por: "admin",
      gps: { lat: -23.497, lng: -46.6, acc: 5 }, geofence: centro,
    });
    expect(r.fora_da_area).toBe(false);
    expect(r.geo_motivo).toBe("manual");
  });
});

describe("ponto — sanidade de constantes", () => {
  it("tem 4 tipos canônicos", () => {
    expect(TIPOS_PONTO).toEqual(["entrada", "intervalo_inicio", "intervalo_fim", "saida"]);
  });
  it("janela de duplicação = 5 min", () => {
    expect(JANELA_DUP_MS).toBe(5 * 60 * 1000);
  });
});
