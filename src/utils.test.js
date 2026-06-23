import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import {
  genId,
  genSecureToken,
  sha256Hex,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatCPF,
  formatCNPJ,
  formatPhone,
  filterByDate,
  toISODate,
  daysFromNow,
  monthsAgo,
  validateOSProposal,
  buildOSWhatsAppResumo,
  isModuleEnabledForCompany,
  calcDescontoOS,
  validatePasswordStrength,
  passwordChecklist,
} from './utils.js';

describe('genId', () => {
  it('gera IDs únicos em chamadas consecutivas', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(genId());
    expect(ids.size).toBe(1000);
  });

  it('retorna string base36 não-vazia', () => {
    const id = genId();
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(8);
    expect(id).toMatch(/^[a-z0-9]+$/);
  });
});

describe('genSecureToken', () => {
  it('gera token de 64 chars hex (32 bytes)', () => {
    const t = genSecureToken();
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('gera tokens diferentes em chamadas consecutivas', () => {
    expect(genSecureToken()).not.toBe(genSecureToken());
  });
});

describe('sha256Hex', () => {
  it('produz hash determinístico para a mesma entrada', async () => {
    const a = await sha256Hex('frost');
    const b = await sha256Hex('frost');
    expect(a).toBe(b);
  });

  it('produz hashes diferentes para entradas diferentes', async () => {
    const a = await sha256Hex('frost');
    const b = await sha256Hex('Frost');
    expect(a).not.toBe(b);
  });

  it('produz 64 chars hex', async () => {
    const h = await sha256Hex('teste');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('formatCurrency', () => {
  it('formata número como BRL', () => {
    expect(formatCurrency(1500)).toMatch(/R\$\s*1\.500,00/);
    expect(formatCurrency(0.5)).toMatch(/R\$\s*0,50/);
  });

  it('null/undefined viram R$ 0,00', () => {
    expect(formatCurrency(null)).toMatch(/R\$\s*0,00/);
    expect(formatCurrency(undefined)).toMatch(/R\$\s*0,00/);
  });
});

describe('formatDate', () => {
  it('converte YYYY-MM-DD em DD/MM/YYYY sem deslocar fuso', () => {
    expect(formatDate('2026-05-06')).toBe('06/05/2026');
  });

  it('aceita ISO completa preservando a parte de data', () => {
    expect(formatDate('2026-05-06T23:00:00.000Z')).toBe('06/05/2026');
  });

  it('valor falsy → travessão', () => {
    expect(formatDate(null)).toBe('—');
    expect(formatDate('')).toBe('—');
  });
});

describe('formatDateTime', () => {
  it('inclui hora e minuto no formato pt-BR', () => {
    const out = formatDateTime('2026-05-06T13:45:00');
    expect(out).toMatch(/06\/05\/2026/);
    expect(out).toMatch(/13:45/);
  });

  it('valor falsy → travessão', () => {
    expect(formatDateTime(null)).toBe('—');
  });
});

describe('formatCPF', () => {
  it('formata progressivamente conforme dígitos crescem', () => {
    expect(formatCPF('123')).toBe('123');
    expect(formatCPF('1234')).toBe('123.4');
    expect(formatCPF('1234567')).toBe('123.456.7');
    expect(formatCPF('12345678901')).toBe('123.456.789-01');
  });

  it('ignora caracteres não-numéricos', () => {
    expect(formatCPF('abc12345678901xyz')).toBe('123.456.789-01');
  });

  it('trunca em 11 dígitos', () => {
    expect(formatCPF('123456789012345')).toBe('123.456.789-01');
  });
});

describe('formatCNPJ', () => {
  it('formata progressivamente até 14 dígitos', () => {
    expect(formatCNPJ('1234')).toBe('12.34');
    expect(formatCNPJ('12345678')).toBe('12.345.678');
    expect(formatCNPJ('12345678000195')).toBe('12.345.678/0001-95');
  });

  it('trunca em 14 dígitos', () => {
    expect(formatCNPJ('123456780001950000')).toBe('12.345.678/0001-95');
  });
});

describe('formatPhone', () => {
  it('formata celular 11 dígitos', () => {
    expect(formatPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('formata fixo 10 dígitos', () => {
    expect(formatPhone('1133334444')).toBe('(11) 3333-4444');
  });

  it('parcial preserva DDD entre parênteses', () => {
    expect(formatPhone('11')).toBe('(11');
    expect(formatPhone('1198')).toBe('(11) 98');
  });
});

describe('filterByDate', () => {
  // Strings "YYYY-MM-DD" sem hora — caso real usado pelos formulários do app
  const items = [
    { id: 1, data: '2026-05-06' },
    { id: 2, data: '2026-04-01' },
    { id: 3, data: '2026-01-15' },
  ];

  it('period="all" devolve a lista intacta', () => {
    expect(filterByDate(items, 'data', { period: 'all' })).toHaveLength(3);
  });

  it('filtro=null devolve a lista intacta', () => {
    expect(filterByDate(items, 'data', null)).toHaveLength(3);
  });

  it('period="custom" inclui datas-limite (sem deslocamento de fuso)', () => {
    const out = filterByDate(items, 'data', {
      period: 'custom',
      startDate: '2026-04-01',
      endDate: '2026-05-06',
    });
    expect(out.map(i => i.id).sort()).toEqual([1, 2]);
  });
});

describe('toISODate', () => {
  // toISODate usa o fuso LOCAL (getFullYear/Month/Date). Datas abaixo são
  // construídas em horário local para o teste ser determinístico em qualquer TZ.
  it('extrai YYYY-MM-DD de Date no fuso local', () => {
    expect(toISODate(new Date(2026, 4, 6, 18, 30))).toBe('2026-05-06');
  });

  it('não desloca o dia à noite (sem bug de UTC)', () => {
    // 06/06 22:00 local não pode virar 07/06.
    expect(toISODate(new Date(2026, 5, 6, 22, 0))).toBe('2026-06-06');
  });

  it('aceita string (datetime local) como entrada', () => {
    expect(toISODate('2026-05-06T12:00:00')).toBe('2026-05-06');
  });
});

describe('daysFromNow / monthsAgo', () => {
  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-06T12:00:00Z'));
  });
  afterAll(() => {
    vi.useRealTimers();
  });

  it('daysFromNow(0) é hoje', () => {
    expect(daysFromNow(0)).toBe('2026-05-06');
  });

  it('daysFromNow(7) avança uma semana', () => {
    expect(daysFromNow(7)).toBe('2026-05-13');
  });

  it('monthsAgo(1) volta um mês', () => {
    expect(monthsAgo(1)).toBe('2026-04-06');
  });

  it('monthsAgo(12) volta um ano', () => {
    expect(monthsAgo(12)).toBe('2025-05-06');
  });
});

describe("validateOSProposal", () => {
  const base = {
    customer_name: "Maria", address: "Rua A, 10, Centro, SP",
    equipment_type: "Geladeira", equipment_brand: "Brastemp",
    equipment_model: "BRM44", problem: "não gela", phone: "5511999998888",
  };
  it("aceita payload completo e normaliza telefone", () => {
    const r = validateOSProposal({ ...base, phone: "+55 (11) 99999-8888" });
    expect(r.valid).toBe(true);
    expect(r.payload.phone).toBe("5511999998888");
    expect(r.payload.media_urls).toEqual([]);
  });
  it("rejeita quando falta campo obrigatório", () => {
    const r = validateOSProposal({ ...base, problem: "" });
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("problem");
  });
  it("preserva media_urls existentes", () => {
    const r = validateOSProposal({ ...base, media_urls: ["http://x/a.jpg"] });
    expect(r.payload.media_urls).toEqual(["http://x/a.jpg"]);
  });
  it("preserva discount_note quando informado pela IA", () => {
    const r = validateOSProposal({ ...base, discount_note: "15% à vista (aniversariante)" });
    expect(r.payload.discount_note).toBe("15% à vista (aniversariante)");
  });
  it("discount_note vazio por padrão", () => {
    const r = validateOSProposal({ ...base });
    expect(r.payload.discount_note).toBe("");
  });
  it("marca e modelo do equipamento são opcionais", () => {
    const r = validateOSProposal({ ...base, equipment_brand: "", equipment_model: "" });
    expect(r.valid).toBe(true);
    expect(r.missing).not.toContain("equipment_brand");
    expect(r.missing).not.toContain("equipment_model");
  });
});

describe("buildOSWhatsAppResumo", () => {
  const os = {
    numero: "OS 0007", clienteNome: "João Silva",
    equipamentoTipo: "Ar-condicionado", equipamentoModelo: "Springer 12000",
    descricao: "Não gela", valor: 350,
    servicos: [{ nome: "Limpeza", valor: 150 }, { nome: "Recarga de gás", valor: 200 }],
  };

  it("inclui número, cliente e total formatado", () => {
    const txt = buildOSWhatsAppResumo(os, "orcamento");
    expect(txt).toContain("OS 0007");
    expect(txt).toContain("João Silva");
    expect(txt).toMatch(/R\$\s*350,00/);
  });

  it("lista os serviços", () => {
    const txt = buildOSWhatsAppResumo(os, "orcamento");
    expect(txt).toContain("Limpeza");
    expect(txt).toContain("Recarga de gás");
  });

  it("usa rótulo diferente para tipo 'os'", () => {
    expect(buildOSWhatsAppResumo(os, "os")).toContain("Ordem de Serviço");
    expect(buildOSWhatsAppResumo(os, "orcamento")).toContain("Orçamento");
  });

  it("não quebra com OS mínima", () => {
    expect(() => buildOSWhatsAppResumo({ numero: "OS 1" }, "os")).not.toThrow();
  });
});

describe("isModuleEnabledForCompany", () => {
  it("allowedModules null/undefined → tudo habilitado", () => {
    expect(isModuleEnabledForCompany(null, "financeiro")).toBe(true);
    expect(isModuleEnabledForCompany(undefined, "ia")).toBe(true);
  });

  it("dashboard e config sempre habilitados, mesmo com array vazio", () => {
    expect(isModuleEnabledForCompany([], "dashboard")).toBe(true);
    expect(isModuleEnabledForCompany([], "config")).toBe(true);
  });

  it("array → habilita só os listados", () => {
    const allowed = ["processos", "agenda"];
    expect(isModuleEnabledForCompany(allowed, "processos")).toBe(true);
    expect(isModuleEnabledForCompany(allowed, "agenda")).toBe(true);
    expect(isModuleEnabledForCompany(allowed, "financeiro")).toBe(false);
  });

  it("array vazio desabilita todos os toggláveis", () => {
    expect(isModuleEnabledForCompany([], "financeiro")).toBe(false);
    expect(isModuleEnabledForCompany([], "ia")).toBe(false);
  });
});

describe("calcDescontoOS", () => {
  it("desconto em valor fixo abate direto do subtotal", () => {
    expect(calcDescontoOS(200, "valor", 50)).toEqual({ descontoAplicado: 50, total: 150 });
  });

  it("desconto percentual aplica a % sobre o subtotal", () => {
    expect(calcDescontoOS(200, "percentual", 10)).toEqual({ descontoAplicado: 20, total: 180 });
  });

  it("desconto nunca deixa o total negativo (limita ao subtotal)", () => {
    expect(calcDescontoOS(100, "valor", 500)).toEqual({ descontoAplicado: 100, total: 0 });
    expect(calcDescontoOS(100, "percentual", 150)).toEqual({ descontoAplicado: 100, total: 0 });
  });

  it("valores ausentes/negativos viram zero", () => {
    expect(calcDescontoOS(100, "valor", "")).toEqual({ descontoAplicado: 0, total: 100 });
    expect(calcDescontoOS(100, "valor", -30)).toEqual({ descontoAplicado: 0, total: 100 });
    expect(calcDescontoOS(0, "percentual", 10)).toEqual({ descontoAplicado: 0, total: 0 });
  });

  it("arredonda para 2 casas decimais", () => {
    expect(calcDescontoOS(99.99, "percentual", 33.333)).toEqual({ descontoAplicado: 33.33, total: 66.66 });
  });
});

describe("validatePasswordStrength", () => {
  it("rejeita senha curta", () => {
    const r = validatePasswordStrength("Aa1!");
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Mínimo 12 caracteres");
  });

  it("rejeita senha sem símbolo", () => {
    const r = validatePasswordStrength("SenhaForte123");
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Incluir símbolo (!@#$...)");
  });

  it("rejeita senha sem maiúscula", () => {
    const r = validatePasswordStrength("senhaforte123!");
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Incluir letra maiúscula");
  });

  it("rejeita senha com espaço", () => {
    const r = validatePasswordStrength("Senha Forte 123!");
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("Não pode conter espaço");
  });

  it("aceita senha forte completa", () => {
    const r = validatePasswordStrength("MinhaSenha123!");
    expect(r.ok).toBe(true);
    expect(r.score).toBe(5);
    expect(r.strength).toBe("forte");
  });

  it("classifica fraca/média/forte corretamente", () => {
    expect(validatePasswordStrength("abc").strength).toBe("fraca");
    expect(validatePasswordStrength("Abcdef123").strength).toBe("média");
    expect(validatePasswordStrength("Abcdefgh1234!").strength).toBe("forte");
  });
});

describe("passwordChecklist", () => {
  it("marca todos os requisitos numa senha forte", () => {
    const r = passwordChecklist("MinhaSenha123!"); // 14 chars
    expect(r).toEqual({
      min12: true, upper: true, lower: true,
      number: true, symbol: true, noSpace: true,
    });
  });

  it("reprova requisitos faltantes em senha fraca", () => {
    const r = passwordChecklist("abc");
    expect(r.min12).toBe(false);
    expect(r.upper).toBe(false);
    expect(r.number).toBe(false);
    expect(r.symbol).toBe(false);
    expect(r.lower).toBe(true);
  });

  it("noSpace é false quando há espaço", () => {
    expect(passwordChecklist("Minha Senha 12!").noSpace).toBe(false);
  });

  it("noSpace é false para senha vazia", () => {
    expect(passwordChecklist("").noSpace).toBe(false);
  });
});
