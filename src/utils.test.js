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
  it('extrai YYYY-MM-DD de Date', () => {
    expect(toISODate(new Date('2026-05-06T18:30:00Z'))).toBe('2026-05-06');
  });

  it('aceita string como entrada', () => {
    expect(toISODate('2026-05-06T00:00:00Z')).toBe('2026-05-06');
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
