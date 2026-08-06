import { describe, it, expect } from "vitest";
import {
  hasPermission, papelPermite, montarPermissoesSalvas, modulosNovosDesdeOSave,
} from "./permissoes.js";

// Snapshot de módulos "de ontem" — sem lembrete nem relatorios, com escola
// (vocabulário antigo). É o formato real encontrado em produção.
const MODULOS_ONTEM = [
  "dashboard", "processos", "agenda", "financeiro", "cadastro", "ia",
  "pos-venda", "folha", "ponto", "escola", "config",
];
const MODULOS_HOJE = [
  "dashboard", "processos", "agenda", "financeiro", "cadastro", "ia",
  "pos-venda", "folha", "ponto", "lembrete", "relatorios", "config",
];

describe("permissoes.papelPermite", () => {
  it("admin tem all", () => {
    expect(papelPermite("admin", "relatorios")).toBe(true);
    expect(papelPermite("admin", "modulo_que_nao_existe")).toBe(true);
  });
  it("gerente segue a matriz do papel", () => {
    expect(papelPermite("gerente", "financeiro")).toBe(true);
    expect(papelPermite("gerente", "relatorios")).toBe(true);
  });
  it("tecnico não tem financeiro", () => {
    expect(papelPermite("tecnico", "financeiro")).toBe(false);
  });
  it("papel desconhecido não libera nada", () => {
    expect(papelPermite("inexistente", "dashboard")).toBe(false);
  });
});

describe("permissoes.hasPermission — sem customPermissions", () => {
  it("cai no papel", () => {
    expect(hasPermission({ role: "gerente" }, "financeiro")).toBe(true);
    expect(hasPermission({ role: "tecnico" }, "financeiro")).toBe(false);
  });
  it("usuário nulo ou sem papel não passa", () => {
    expect(hasPermission(null, "dashboard")).toBe(false);
    expect(hasPermission({}, "dashboard")).toBe(false);
    expect(hasPermission({ role: "admin" }, "")).toBe(false);
  });
});

describe("permissoes.hasPermission — com customPermissions", () => {
  const isadora = {
    role: "gerente",
    customPermissions: ["dashboard", "financeiro", "cadastro", "processos"],
    permissionsKnownModules: MODULOS_ONTEM,
  };

  it("libera o que está marcado", () => {
    expect(hasPermission(isadora, "financeiro")).toBe(true);
  });

  it("nega o que o admin desmarcou (existia no snapshot)", () => {
    expect(hasPermission(isadora, "folha")).toBe(false);
    expect(hasPermission(isadora, "ponto")).toBe(false);
  });

  it("módulo criado DEPOIS do save cai no papel, em vez de sumir", () => {
    // É o bug relatado: relatorios e lembrete nasceram invisíveis.
    expect(hasPermission(isadora, "relatorios")).toBe(true);
    expect(hasPermission(isadora, "lembrete")).toBe(true);
  });

  it("módulo novo continua negado quando o papel também nega", () => {
    const atendente = { ...isadora, role: "atendente" };
    expect(hasPermission(atendente, "relatorios")).toBe(false);
  });

  it('"all" na lista libera tudo', () => {
    expect(hasPermission({ role: "tecnico", customPermissions: ["all"] }, "financeiro")).toBe(true);
  });

  it("lista vazia nega tudo que já existia", () => {
    const zerado = { role: "gerente", customPermissions: [], permissionsKnownModules: MODULOS_ONTEM };
    expect(hasPermission(zerado, "financeiro")).toBe(false);
  });
});

describe("permissoes.hasPermission — registro legado sem snapshot", () => {
  // Sem permissionsKnownModules não dá para saber se a ausência foi decisão do
  // admin ou módulo novo. Mantém o comportamento estrito de antes: não afrouxa
  // permissão sozinho. Passa a valer no próximo save.
  const legado = { role: "gerente", customPermissions: ["dashboard", "financeiro"] };

  it("nega o que não está na lista", () => {
    expect(hasPermission(legado, "relatorios")).toBe(false);
    expect(hasPermission(legado, "folha")).toBe(false);
  });

  it("libera o que está na lista", () => {
    expect(hasPermission(legado, "financeiro")).toBe(true);
  });
});

describe("permissoes.montarPermissoesSalvas", () => {
  it("sem custom, zera os dois campos", () => {
    expect(montarPermissoesSalvas({ usarCustom: false, selecionados: ["x"], modulosAtuais: MODULOS_HOJE }))
      .toEqual({ customPermissions: null, permissionsKnownModules: null });
  });

  it("grava o snapshot dos módulos atuais junto da seleção", () => {
    const r = montarPermissoesSalvas({
      usarCustom: true,
      selecionados: ["dashboard", "relatorios"],
      modulosAtuais: MODULOS_HOJE,
    });
    expect(r.customPermissions).toEqual(["dashboard", "relatorios"]);
    expect(r.permissionsKnownModules).toEqual(MODULOS_HOJE);
  });

  it("descarta id de módulo aposentado em vez de arrastá-lo para sempre", () => {
    const r = montarPermissoesSalvas({
      usarCustom: true,
      selecionados: ["dashboard", "escola"],
      modulosAtuais: MODULOS_HOJE,
    });
    expect(r.customPermissions).toEqual(["dashboard"]);
  });

  it("snapshot é cópia, não referência ao array de entrada", () => {
    const atuais = [...MODULOS_HOJE];
    const r = montarPermissoesSalvas({ usarCustom: true, selecionados: [], modulosAtuais: atuais });
    atuais.push("intruso");
    expect(r.permissionsKnownModules).not.toContain("intruso");
  });
});

describe("permissoes.modulosNovosDesdeOSave", () => {
  it("lista os módulos que surgiram depois do último save", () => {
    const u = { role: "gerente", customPermissions: ["dashboard"], permissionsKnownModules: MODULOS_ONTEM };
    expect(modulosNovosDesdeOSave(u, MODULOS_HOJE)).toEqual(["lembrete", "relatorios"]);
  });

  it("vazio para quem não usa permissão customizada", () => {
    expect(modulosNovosDesdeOSave({ role: "admin" }, MODULOS_HOJE)).toEqual([]);
  });

  it("vazio para registro legado sem snapshot", () => {
    expect(modulosNovosDesdeOSave({ role: "gerente", customPermissions: ["dashboard"] }, MODULOS_HOJE)).toEqual([]);
  });
});
