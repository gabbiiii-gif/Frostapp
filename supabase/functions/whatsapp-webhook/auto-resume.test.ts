import { describe, it, expect } from "vitest";
import { podeAutoReligar } from "./auto-resume";

// Threshold de exemplo usado nos testes: 6 horas.
const SEIS_H = 6 * 3600 * 1000;
const AGORA = 1_700_000_000_000; // instante fixo de referência

describe("podeAutoReligar", () => {
  it("não mexe em conversa 'active' (nunca religa o que já está ativo)", () => {
    // mesmo com muito tempo passado, status active não deve ser tocado
    expect(podeAutoReligar("active", AGORA - 100 * SEIS_H, AGORA, SEIS_H)).toBe(false);
  });

  it("religa quando o humano ficou sem responder além do threshold", () => {
    const lastAgent = AGORA - 7 * 3600 * 1000; // 7h atrás > 6h
    expect(podeAutoReligar("pending_human", lastAgent, AGORA, SEIS_H)).toBe(true);
  });

  it("mantém pausada quando o humano respondeu há pouco (dentro do threshold)", () => {
    const lastAgent = AGORA - 1 * 3600 * 1000; // 1h atrás < 6h
    expect(podeAutoReligar("pending_human", lastAgent, AGORA, SEIS_H)).toBe(false);
  });

  it("religa quando pausou sem nenhuma resposta do time registrada (lastAgent null)", () => {
    expect(podeAutoReligar("pending_human", null, AGORA, SEIS_H)).toBe(true);
  });

  it("religa exatamente no limite do threshold (>=)", () => {
    const lastAgent = AGORA - SEIS_H; // exatamente 6h
    expect(podeAutoReligar("pending_human", lastAgent, AGORA, SEIS_H)).toBe(true);
  });
});
