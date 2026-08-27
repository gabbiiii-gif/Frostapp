import { describe, it, expect } from "vitest";
import { STATUS_OS_KEYS, STATUS_MAP } from "../../constants.js";
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

  it("opcoes de status do dataset OS são exatamente STATUS_OS_KEYS", () => {
    const statusCampo = getCampo("os", "status");
    expect(statusCampo).toBeTruthy();
    expect(statusCampo.tipo).toBe("enum");
    // Registry deve usar lista canônica sem cópia local que possa divergir
    expect(statusCampo.opcoes).toEqual(STATUS_OS_KEYS);
  });

  it("todos os status em STATUS_OS_KEYS existem em STATUS_MAP", () => {
    // Detecta typos de status que renderiam badges sem estilo
    for (const status of STATUS_OS_KEYS) {
      expect(status in STATUS_MAP, `status '${status}' não existe em STATUS_MAP`).toBe(true);
    }
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

describe("datasets — cobertura das fontes registradas", () => {
  const esperados = [
    "os", "clientes", "agenda", "financeiro", "despesas_recorrentes",
    "funcionarios", "ponto", "ocorrencias", "vales", "contracheques",
    "produtos", "estoque", "fornecedores", "servicos",
    // Fechamento mensal — histórico congelado de cada mês encerrado.
    "fechamentos",
  ];

  it("todas as fontes da v1 estão registradas", () => {
    for (const id of esperados) {
      expect(getDataset(id), `faltou dataset ${id}`).toBeTruthy();
    }
    expect(DATASETS.length).toBe(esperados.length);
  });

  it("ponto, ocorrencias, vales e contracheques são sensíveis", () => {
    for (const id of ["ponto", "ocorrencias", "vales", "contracheques"]) {
      expect(getDataset(id).sensivel, `${id} deveria ser sensível`).toBe(true);
    }
  });

  it("fontes não sensíveis continuam visíveis sem privilégio", () => {
    const visiveis = listarDatasets({ podeVerSensivel: false }).map((d) => d.id);
    expect(visiveis).toContain("os");
    expect(visiveis).not.toContain("contracheques");
    expect(listarDatasets({ podeVerSensivel: true }).length).toBe(DATASETS.length);
  });
});
