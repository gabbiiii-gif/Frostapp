// ─── Testes Vitest — helpers puros de face.js ────────────────────────────────
// Importa apenas helpers puros (não toca em loadFaceModels/detectAndDescribe,
// que dependem de WebGL/TFJS — não rodam em happy-dom).

import { describe, it, expect } from "vitest";
import {
  euclideanDistance,
  averageDescriptors,
  serializeDescriptor,
  deserializeDescriptor,
  similarityScore,
  isMatch,
  DEFAULT_MATCH_THRESHOLD,
} from "./face.js";

describe("face.euclideanDistance", () => {
  it("0 quando vetores iguais", () => {
    expect(euclideanDistance([1, 2, 3], [1, 2, 3])).toBe(0);
  });
  it("calcula distância simples", () => {
    expect(euclideanDistance([0, 0], [3, 4])).toBe(5);
  });
  it("-1 quando tamanhos diferentes", () => {
    expect(euclideanDistance([1, 2], [1, 2, 3])).toBe(-1);
  });
  it("-1 quando input inválido", () => {
    expect(euclideanDistance(null, [1])).toBe(-1);
    expect(euclideanDistance([1], null)).toBe(-1);
    expect(euclideanDistance("a", "b")).toBe(-1);
  });
});

describe("face.averageDescriptors", () => {
  it("retorna média element-wise", () => {
    const r = averageDescriptors([[0, 0], [2, 4], [4, 8]]);
    expect(r).toEqual([2, 4]);
  });
  it("descarta descritores com tamanho errado", () => {
    const r = averageDescriptors([[1, 1], [2, 2, 2], [3, 3]]);
    expect(r).toEqual([2, 2]);
  });
  it("null para input vazio", () => {
    expect(averageDescriptors([])).toBe(null);
    expect(averageDescriptors(null)).toBe(null);
  });
});

describe("face.serializeDescriptor / deserializeDescriptor", () => {
  it("Float32Array vira Array", () => {
    const f = new Float32Array([0.1, 0.2, 0.3]);
    const s = serializeDescriptor(f);
    expect(Array.isArray(s)).toBe(true);
    expect(s.length).toBe(3);
    expect(s[0]).toBeCloseTo(0.1, 5);
  });
  it("Array passa direto (cópia)", () => {
    const a = [1, 2, 3];
    const s = serializeDescriptor(a);
    expect(s).toEqual(a);
    expect(s).not.toBe(a); // cópia, não a mesma referência
  });
  it("deserializeDescriptor aceita objeto numérico legado", () => {
    const obj = { 0: 0.1, 1: 0.2, 2: 0.3 };
    const r = deserializeDescriptor(obj);
    expect(r).toEqual([0.1, 0.2, 0.3]);
  });
  it("deserializeDescriptor null para input inválido", () => {
    expect(deserializeDescriptor(null)).toBe(null);
    expect(deserializeDescriptor(42)).toBe(null);
  });
});

describe("face.similarityScore", () => {
  it("100 para distância 0", () => {
    expect(similarityScore(0)).toBe(100);
  });
  it("0 para distância >= 1", () => {
    expect(similarityScore(1)).toBe(0);
    expect(similarityScore(1.5)).toBe(0);
  });
  it("50 para distância 0.5", () => {
    expect(similarityScore(0.5)).toBe(50);
  });
  it("0 para distância negativa (inválida)", () => {
    expect(similarityScore(-1)).toBe(0);
  });
});

describe("face.isMatch", () => {
  it("usa threshold default 0.5", () => {
    expect(DEFAULT_MATCH_THRESHOLD).toBe(0.5);
    expect(isMatch(0.4)).toBe(true);
    expect(isMatch(0.5)).toBe(false);
    expect(isMatch(0.6)).toBe(false);
  });
  it("aceita threshold custom", () => {
    expect(isMatch(0.6, 0.7)).toBe(true);
  });
  it("rejeita distance negativo (inválido)", () => {
    expect(isMatch(-1)).toBe(false);
  });
});
