import { describe, it, expect } from "vitest";
import {
  DATASETS, getDataset, getCampo, listarDatasets, registryCompacto, TIPOS_CAMPO,
} from "./datasets.js";

describe("datasets — integridade do registry", () => {
  it("todo dataset tem id, label, prefixo terminado em ':' e campos", () => {
    expect(DATASETS.length).toBeGreaterThan(0);
    for (const d of DATASETS) {
      expect(d.id).toBeTruthy();
      expect(d.label).toBeTruthy();
      expect(d.prefixo.endsWith(":")).toBe(true);
      expect(Array.isArray(d.campos)).toBe(true);
      expect(d.campos.length).toBeGreaterThan(0);
    }
  });

  it("todo campo tem tipo válido", () => {
    for (const d of DATASETS) {
      for (const c of d.campos) {
        expect(TIPOS_CAMPO).toContain(c.tipo);
      }
    }
  });

  it("campoData aponta para um campo existente do tipo data", () => {
    for (const d of DATASETS) {
      const campo = d.campos.find((c) => c.id === d.campoData);
      expect(campo, `dataset ${d.id} sem campoData válido`).toBeTruthy();
      expect(campo.tipo).toBe("data");
    }
  });

  it("campo do tipo referencia aponta para um dataset existente", () => {
    for (const d of DATASETS) {
      for (const c of d.campos.filter((x) => x.tipo === "referencia")) {
        expect(getDataset(c.ref), `${d.id}.${c.id} → ${c.ref}`).toBeTruthy();
      }
    }
  });

  it("não há id de dataset duplicado", () => {
    const ids = DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("datasets — acessores", () => {
  it("getDataset devolve null para id inexistente", () => {
    expect(getDataset("nao_existe")).toBeNull();
  });

  it("getCampo acha campo por dataset", () => {
    expect(getCampo("os", "valor").tipo).toBe("moeda");
    expect(getCampo("os", "nao_existe")).toBeNull();
  });

  it("listarDatasets esconde fontes sensíveis por padrão", () => {
    const visiveis = listarDatasets({ podeVerSensivel: false });
    expect(visiveis.every((d) => !d.sensivel)).toBe(true);
  });

  it("registryCompacto não vaza prefixo nem flag sensivel", () => {
    const r = registryCompacto();
    expect(r[0].prefixo).toBeUndefined();
    expect(r[0].sensivel).toBeUndefined();
    expect(r[0].campos[0].label).toBeTruthy();
  });
});
