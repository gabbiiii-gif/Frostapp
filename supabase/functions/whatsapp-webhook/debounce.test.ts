import { describe, it, expect } from "vitest";
import { janelaDebounceMs, souAUltimaMensagem, DEBOUNCE_MAX_SEGUNDOS } from "./debounce";

describe("janelaDebounceMs", () => {
  it("usa o padrão quando a env não está setada", () => {
    expect(janelaDebounceMs(undefined)).toBe(12_000);
    expect(janelaDebounceMs(null)).toBe(12_000);
    expect(janelaDebounceMs("")).toBe(12_000);
  });

  it("usa o padrão quando a env não é número", () => {
    expect(janelaDebounceMs("abc")).toBe(12_000);
  });

  it("converte segundos em ms", () => {
    expect(janelaDebounceMs("30")).toBe(30_000);
  });

  it("zero desliga o debounce (responde cada mensagem na hora)", () => {
    expect(janelaDebounceMs("0")).toBe(0);
  });

  it("valor negativo é inválido → cai no padrão (não vira espera negativa)", () => {
    expect(janelaDebounceMs("-5")).toBe(12_000);
  });

  it("limita ao teto para não estourar o wall-clock do worker", () => {
    expect(janelaDebounceMs("9999")).toBe(DEBOUNCE_MAX_SEGUNDOS * 1000);
  });
});

describe("souAUltimaMensagem", () => {
  it("responde quando a minha mensagem ainda é a última", () => {
    expect(souAUltimaMensagem("msg-1", "msg-1")).toBe(true);
  });

  it("cala quando chegou mensagem mais nova (a execução dela é que responde)", () => {
    expect(souAUltimaMensagem("msg-1", "msg-2")).toBe(false);
  });

  it("responde quando não tem id próprio (insert falhou) — não engole o atendimento", () => {
    expect(souAUltimaMensagem(null, "msg-2")).toBe(true);
  });

  it("responde quando a releitura não achou nenhuma mensagem", () => {
    expect(souAUltimaMensagem("msg-1", null)).toBe(true);
  });
});
