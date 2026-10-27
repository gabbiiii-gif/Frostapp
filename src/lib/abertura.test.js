import { describe, it, expect } from "vitest";
import {
  CHAVE_ABERTURA, DURACAO_ABERTURA_MS,
  diaLocal, primeiraAberturaDoDia, tempoRestanteAbertura,
} from "./abertura.js";

// Storage em memória com a mesma interface do localStorage.
function storageFalso(inicial = {}) {
  const m = new Map(Object.entries(inicial));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
  };
}

describe("abertura.diaLocal", () => {
  it("formata AAAA-MM-DD com zeros à esquerda, no fuso do aparelho", () => {
    expect(diaLocal(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(diaLocal(new Date(2026, 9, 27, 0, 1))).toBe("2026-10-27");
  });
});

describe("abertura.primeiraAberturaDoDia", () => {
  it("mostra na 1ª abertura do dia e não nas seguintes", () => {
    const s = storageFalso();
    expect(primeiraAberturaDoDia(s, "2026-10-27")).toBe(true);
    expect(primeiraAberturaDoDia(s, "2026-10-27")).toBe(false);
    expect(primeiraAberturaDoDia(s, "2026-10-27")).toBe(false);
  });

  it("volta a mostrar no dia seguinte", () => {
    const s = storageFalso({ [CHAVE_ABERTURA]: "2026-10-27" });
    expect(primeiraAberturaDoDia(s, "2026-10-28")).toBe(true);
    expect(primeiraAberturaDoDia(s, "2026-10-28")).toBe(false);
  });

  it("storage que lança (aba anônima, cota cheia) → não mostra", () => {
    const s = { getItem: () => { throw new Error("SecurityError"); }, setItem: () => {} };
    expect(primeiraAberturaDoDia(s, "2026-10-27")).toBe(false);
  });

  it("storage que não guarda nada → não mostra (senão seria em toda entrada)", () => {
    const s = { getItem: () => null, setItem: () => {} };
    expect(primeiraAberturaDoDia(s, "2026-10-27")).toBe(false);
  });
});

describe("abertura.tempoRestanteAbertura", () => {
  it("app rápido: espera o resto até completar 1,2 s desde o logo", () => {
    expect(tempoRestanteAbertura(100, 300)).toBe(DURACAO_ABERTURA_MS - 200);
  });

  it("app que já demorou mais que 1,2 s para carregar: não espera nada", () => {
    expect(tempoRestanteAbertura(900, 2400)).toBe(0);
  });

  it("relógio fora de ordem não gera espera maior que a duração", () => {
    expect(tempoRestanteAbertura(500, 400)).toBe(DURACAO_ABERTURA_MS);
  });
});
