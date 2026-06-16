# Ponto: só entrada/saída, jornada por dia, almoço por janela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Todos batem só entrada/saída; jornada com carga horária por dia da semana (sábado meio período possível); almoço descontado por janela fixa configurável por funcionário.

**Architecture:** Mudança concentrada nas libs puras `ponto.js` (fluxo de batida + minutos trabalhados) e `banco-horas.js` (jornada por dia + saldo), com retrocompatibilidade na leitura da jornada. UI do modal de jornada em `PontoBancoHoras.jsx` passa a editar carga por dia + janela de almoço. Call-sites em `PontoModule.jsx` repassam a jornada.

**Tech Stack:** React 19 (JSX), Vitest + happy-dom, `window.storage`/DB layer.

Spec: `docs/superpowers/specs/2026-06-16-ponto-jornada-entrada-saida-design.md`

---

## File Structure

- `src/lib/ponto.js` — `proximaAcao` (só entrada/saída), `minutosTrabalhadosDia` (desconto por janela de almoço + helpers `horaParaData`, `sobreposicaoAlmocoMin`).
- `src/lib/banco-horas.js` — `JORNADA_DEFAULT` (+`horas_por_dia`,`almoco_*`), `migrarJornada` (novo), `getJornada` (usa migração), `ehDiaUtil`/`calcularSaldoDia` (carga por dia), helper `resumoDiasJornada`.
- `src/lib/ponto.test.js`, `src/lib/banco-horas.test.js` — testes.
- `src/modules/PontoBancoHoras.jsx` — `ConfigJornadaModal` redesenhado.
- `src/modules/PontoModule.jsx` — call-sites de `minutosTrabalhadosDia`.

Comandos: `npm run test` (suite), `npm run build` (Vite).

---

### Task 1: `proximaAcao` só entrada/saída

**Files:**
- Modify: `src/lib/ponto.js:137-153`
- Test: `src/lib/ponto.test.js:74-97`

- [ ] **Step 1: Reescrever os testes de `proximaAcao`**

Substituir o bloco `describe("ponto.proximaAcao", ...)` (linhas 74-97) por:

```js
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
```

- [ ] **Step 2: Rodar os testes e ver falhar**

Run: `npm run test -- src/lib/ponto.test.js`
Expected: FAIL em "saida após entrada" (hoje retorna `intervalo_inicio` só com `intervalo_min`, mas sem 2º arg cai em `saida`… o caso que falha é o de "ignora intervalo legadas": hoje `ultimo==='intervalo_fim'` retorna `"saida"` — confere; o que falha é o ciclo sem o 2º argumento de jornada e a remoção do caminho de intervalo). Confirmar a falha real no output antes de seguir.

- [ ] **Step 3: Reescrever `proximaAcao`**

Substituir a função (linhas 137-153) por:

```js
// Próximo tipo esperado: só entrada/saída. Almoço NÃO é mais batido (vira
// desconto por janela na jornada). Batidas de intervalo legadas são ignoradas
// no fluxo — só contam no histórico de minutos trabalhados.
export function proximaAcao(registrosDia) {
  const ordenados = [...(registrosDia || [])].sort(
    (a, b) => new Date(a.datahora) - new Date(b.datahora)
  );
  // Considera apenas entrada/saida pra decidir o próximo passo.
  const reais = ordenados.filter((r) => r.tipo === "entrada" || r.tipo === "saida");
  const ultimo = reais[reais.length - 1]?.tipo;
  if (ultimo === "entrada") return "saida";
  return "entrada"; // vazio, ou último foi saida
}
```

- [ ] **Step 4: Rodar os testes e ver passar**

Run: `npm run test -- src/lib/ponto.test.js -t proximaAcao`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ponto.js src/lib/ponto.test.js
git commit -m "feat(ponto): proximaAcao so entrada/saida (sem intervalo)"
```

---

### Task 2: `minutosTrabalhadosDia` com desconto por janela de almoço

**Files:**
- Modify: `src/lib/ponto.js:260-275`
- Test: `src/lib/ponto.test.js:194-214`

- [ ] **Step 1: Escrever os testes novos**

Substituir o bloco `describe("ponto.minutosTrabalhadosDia", ...)` (194-214) por:

```js
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
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/lib/ponto.test.js -t minutosTrabalhadosDia`
Expected: FAIL (a função ainda não aceita jornada nem desconta janela).

- [ ] **Step 3: Reescrever `minutosTrabalhadosDia` + helpers**

Substituir a função `minutosTrabalhadosDia` (260-275) por:

```js
// Converte "HH:MM" para um Date no MESMO dia local de `ref`. null se inválido.
function horaParaData(ref, hhmm) {
  if (!hhmm || !/^\d{1,2}:\d{2}$/.test(String(hhmm))) return null;
  const [h, m] = String(hhmm).split(":").map(Number);
  const d = new Date(ref);
  d.setHours(h, m, 0, 0);
  return d;
}

// Minutos de interseção entre o trabalho [entrada, saida] e a janela de almoço
// da jornada (mesmo dia). 0 quando não há janela ou não há sobreposição.
function sobreposicaoAlmocoMin(entrada, saida, jornada) {
  const ai = horaParaData(entrada, jornada?.almoco_inicio);
  const af = horaParaData(entrada, jornada?.almoco_fim);
  if (!ai || !af || af <= ai) return 0;
  const ini = Math.max(entrada.getTime(), ai.getTime());
  const fim = Math.min(saida.getTime(), af.getTime());
  return fim > ini ? (fim - ini) / 60000 : 0;
}

// Minutos trabalhados no dia.
// - Dia com batidas de intervalo (LEGADO) → cálculo por pares (preserva histórico).
// - Só entrada/saida → soma os pares e desconta a janela de almoço da jornada.
export function minutosTrabalhadosDia(registrosDia, jornada = null) {
  const ordenados = [...(registrosDia || [])].sort(
    (a, b) => new Date(a.datahora) - new Date(b.datahora)
  );
  const temIntervalo = ordenados.some(
    (r) => r.tipo === "intervalo_inicio" || r.tipo === "intervalo_fim"
  );
  let total = 0;
  let entradaAtual = null;
  for (const r of ordenados) {
    if (temIntervalo) {
      if (r.tipo === "entrada" || r.tipo === "intervalo_fim") {
        entradaAtual = r;
      } else if ((r.tipo === "saida" || r.tipo === "intervalo_inicio") && entradaAtual) {
        total += (new Date(r.datahora) - new Date(entradaAtual.datahora)) / 60000;
        entradaAtual = null;
      }
    } else {
      if (r.tipo === "entrada") {
        entradaAtual = r;
      } else if (r.tipo === "saida" && entradaAtual) {
        const ent = new Date(entradaAtual.datahora);
        const sai = new Date(r.datahora);
        const bruto = (sai - ent) / 60000;
        const almoco = sobreposicaoAlmocoMin(ent, sai, jornada);
        total += Math.max(0, bruto - almoco);
        entradaAtual = null;
      }
    }
  }
  return Math.max(0, Math.round(total));
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- src/lib/ponto.test.js`
Expected: PASS (todo o arquivo).

- [ ] **Step 5: Commit**

```bash
git add src/lib/ponto.js src/lib/ponto.test.js
git commit -m "feat(ponto): minutos trabalhados descontam janela de almoco"
```

---

### Task 3: Jornada — `JORNADA_DEFAULT`, `migrarJornada`, `getJornada`

**Files:**
- Modify: `src/lib/banco-horas.js:18-34`
- Test: `src/lib/banco-horas.test.js` (adicionar bloco)

- [ ] **Step 1: Escrever testes de migração**

Adicionar ao fim de `src/lib/banco-horas.test.js` (ajustar o import no topo do arquivo para incluir `migrarJornada`):

```js
describe("banco-horas.migrarJornada", () => {
  it("deriva horas_por_dia de dias_semana + horas_dia (legado)", () => {
    const out = migrarJornada({ horas_dia: 8, dias_semana: [1, 2, 3, 4, 5, 6] });
    expect(out.horas_por_dia[1]).toBe(8);
    expect(out.horas_por_dia[6]).toBe(8); // sábado trabalhado
    expect(out.horas_por_dia[0]).toBe(0); // domingo folga
  });

  it("deriva janela de almoço de intervalo_min (legado)", () => {
    const out = migrarJornada({ horas_dia: 8, dias_semana: [1], intervalo_min: 60 });
    expect(out.almoco_inicio).toBe("12:00");
    expect(out.almoco_fim).toBe("13:00");
  });

  it("intervalo_min 0 → sem almoço", () => {
    const out = migrarJornada({ horas_dia: 8, dias_semana: [1], intervalo_min: 0 });
    expect(out.almoco_inicio).toBeNull();
    expect(out.almoco_fim).toBeNull();
  });

  it("jornada nova (já tem horas_por_dia) passa intacta", () => {
    const nova = {
      horas_por_dia: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4 },
      almoco_inicio: "11:30", almoco_fim: "12:30",
    };
    const out = migrarJornada(nova);
    expect(out.horas_por_dia[6]).toBe(4);
    expect(out.almoco_inicio).toBe("11:30");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/lib/banco-horas.test.js -t migrarJornada`
Expected: FAIL ("migrarJornada is not exported").

- [ ] **Step 3: Atualizar `JORNADA_DEFAULT` + adicionar `migrarJornada` + usar no `getJornada`**

Substituir `JORNADA_DEFAULT` (18-27) e `getJornada` (30-34) por:

```js
export const JORNADA_DEFAULT = {
  // Carga esperada por dia da semana (0=dom..6=sáb), em horas. 0 = não trabalha.
  horas_por_dia: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 },
  // Janela fixa de almoço (HH:MM). null/"" = sem almoço.
  almoco_inicio: "12:00",
  almoco_fim: "13:00",
  tolerancia_min: 10,
  ativo: true,
  // Campos legados (tolerados na leitura; não escritos pela UI nova):
  horas_dia: 8,
  horas_semana: 44,
  dias_semana: [1, 2, 3, 4, 5],
  intervalo_min: 60,
  hora_entrada: "08:00",
  hora_saida: "17:00",
};

// Converte uma jornada legada (horas_dia + dias_semana + intervalo_min) para o
// formato novo (horas_por_dia + janela de almoço). Jornada já nova passa intacta.
export function migrarJornada(raw) {
  const j = { ...raw };
  if (!j.horas_por_dia || typeof j.horas_por_dia !== "object") {
    const horas = Number(j.horas_dia) || JORNADA_DEFAULT.horas_dia;
    const dias = Array.isArray(j.dias_semana) ? j.dias_semana : JORNADA_DEFAULT.dias_semana;
    const mapa = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0 };
    dias.forEach((d) => { if (d >= 0 && d <= 6) mapa[d] = horas; });
    j.horas_por_dia = mapa;
  }
  if (j.almoco_inicio === undefined && j.almoco_fim === undefined) {
    const intv = Number(j.intervalo_min);
    if (intv > 0) {
      j.almoco_inicio = "12:00";
      const fimH = 12 + Math.floor(intv / 60);
      const fimM = intv % 60;
      j.almoco_fim = `${String(fimH).padStart(2, "0")}:${String(fimM).padStart(2, "0")}`;
    } else {
      j.almoco_inicio = null;
      j.almoco_fim = null;
    }
  }
  if (j.tolerancia_min === undefined) j.tolerancia_min = JORNADA_DEFAULT.tolerancia_min;
  if (j.ativo === undefined) j.ativo = true;
  return j;
}

// Lê a jornada de um funcionário (migrando legado), com fallback ao default.
export function getJornada(db, funcionarioId) {
  if (!db || !funcionarioId) return JORNADA_DEFAULT;
  const raw = db.get(`erp:jornada:${funcionarioId}`);
  return raw ? migrarJornada(raw) : JORNADA_DEFAULT;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- src/lib/banco-horas.test.js -t migrarJornada`
Expected: PASS (4 testes).

- [ ] **Step 5: Commit**

```bash
git add src/lib/banco-horas.js src/lib/banco-horas.test.js
git commit -m "feat(jornada): horas_por_dia + janela almoco com migracao do legado"
```

---

### Task 4: Saldo por carga horária do dia

**Files:**
- Modify: `src/lib/banco-horas.js:54-60` (`ehDiaUtil`), `:75-92` (`calcularSaldoDia`)
- Test: `src/lib/banco-horas.test.js`

- [ ] **Step 1: Escrever testes de saldo por dia**

Adicionar a `src/lib/banco-horas.test.js`:

```js
describe("banco-horas.calcularSaldoDia (carga por dia)", () => {
  const jornada = {
    horas_por_dia: { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 4 },
    almoco_inicio: "12:00", almoco_fim: "13:00", tolerancia_min: 10,
  };
  const dia = (data, ent, sai) => [
    { tipo: "entrada", datahora: `${data}T${ent}:00` },
    { tipo: "saida",   datahora: `${data}T${sai}:00` },
  ];

  it("sábado meio período: esperado 4h, cumpriu 4h → saldo 0", () => {
    // 2026-06-06 é sábado. 08:00–12:00 = 4h, sem cruzar almoço (12:00 borda) → 240
    const r = calcularSaldoDia("2026-06-06", dia("2026-06-06", "08", "12"), jornada);
    expect(r.eh_dia_util).toBe(true);
    expect(r.minutos_esperados).toBe(240);
    expect(r.minutos_trabalhados).toBe(240);
    expect(r.saldo).toBe(0);
  });

  it("domingo é folga: esperado 0", () => {
    const r = calcularSaldoDia("2026-06-07", [], jornada); // domingo
    expect(r.eh_dia_util).toBe(false);
    expect(r.minutos_esperados).toBe(0);
    expect(r.status).toBe("folga");
  });

  it("dia útil integral: 08–17 menos almoço = 8h, esperado 8h → saldo 0", () => {
    const r = calcularSaldoDia("2026-06-01", dia("2026-06-01", "08", "17"), jornada); // segunda
    expect(r.minutos_esperados).toBe(480);
    expect(r.minutos_trabalhados).toBe(480);
    expect(r.saldo).toBe(0);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/lib/banco-horas.test.js -t "carga por dia"`
Expected: FAIL (esperado ainda usa `horas_dia` único e não passa jornada ao cálculo de minutos).

- [ ] **Step 3: Atualizar `ehDiaUtil` e `calcularSaldoDia`**

Substituir `ehDiaUtil` (54-60):

```js
// data: string "YYYY-MM-DD". Dia útil = carga esperada > 0 nesse dia da semana.
export function ehDiaUtil(data, jornada = JORNADA_DEFAULT) {
  const dia = String(data).slice(0, 10);
  const d = new Date(dia + "T12:00:00");
  if (isNaN(d.getTime())) return false;
  const mapa = jornada.horas_por_dia || {};
  return (Number(mapa[d.getDay()]) || 0) > 0;
}
```

Em `calcularSaldoDia`, trocar as linhas 77-79:

```js
  const trabalhados = minutosTrabalhadosDia(registros, jornada);
  const ehUtil = ehDiaUtil(dia, jornada);
  const dow = new Date(dia + "T12:00:00").getDay();
  const horasDia = Number((jornada.horas_por_dia || {})[dow]) || 0;
  const esperado = Math.round(horasDia * 60);
```

(O resto de `calcularSaldoDia` — atestado, tolerância, retorno — permanece igual.)

- [ ] **Step 4: Rodar a suite inteira**

Run: `npm run test`
Expected: PASS em tudo (ponto + banco-horas). Se algum teste antigo de banco-horas usava `horas_dia`/`dias_semana` diretamente, ajustar o fixture para usar `horas_por_dia` (mesma intenção).

- [ ] **Step 5: Atualizar o resumo da jornada no print + commit**

Adicionar helper em `banco-horas.js` (perto dos helpers) e usar no print de `PontoBancoHoras.jsx:471`:

```js
// Resumo curto da jornada para cabeçalho de relatório. Ex.: "Seg–Sex 8h · Sáb 4h".
export function resumoDiasJornada(jornada = JORNADA_DEFAULT) {
  const nomes = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
  const mapa = jornada.horas_por_dia || {};
  const partes = [];
  for (let d = 0; d <= 6; d++) {
    const h = Number(mapa[d]) || 0;
    if (h > 0) partes.push(`${nomes[d]} ${h}h`);
  }
  return partes.length ? partes.join(" · ") : "Sem dias úteis";
}
```

Em `PontoBancoHoras.jsx:471`, trocar `Jornada ${jornada.horas_dia}h/dia` por
`Jornada ${resumoDiasJornada(jornada)}` (importar `resumoDiasJornada` de `banco-horas.js`).

```bash
git add src/lib/banco-horas.js src/lib/banco-horas.test.js src/modules/PontoBancoHoras.jsx
git commit -m "feat(jornada): saldo usa carga horaria por dia (sabado meio periodo)"
```

---

### Task 5: UI — `ConfigJornadaModal` (grade por dia + janela de almoço)

**Files:**
- Modify: `src/modules/PontoBancoHoras.jsx:258-367`

- [ ] **Step 1: Substituir o componente `ConfigJornadaModal`**

Trocar todo o componente (258-367) por:

```jsx
function ConfigJornadaModal({ db, funcionarioId, funcionarioNome, atual, addToast, onClose, onSaved }) {
  const NOMES = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"];
  const inicialMapa = atual.horas_por_dia || { 0: 0, 1: 8, 2: 8, 3: 8, 4: 8, 5: 8, 6: 0 };
  const [horasPorDia, setHorasPorDia] = useState(() => ({ ...inicialMapa }));
  const [tolerancia, setTolerancia] = useState(atual.tolerancia_min ?? 10);
  const [temAlmoco, setTemAlmoco] = useState(!!(atual.almoco_inicio && atual.almoco_fim));
  const [almocoInicio, setAlmocoInicio] = useState(atual.almoco_inicio || "12:00");
  const [almocoFim, setAlmocoFim] = useState(atual.almoco_fim || "13:00");
  const [erro, setErro] = useState("");
  const [loading, setLoading] = useState(false);

  const setHoras = (d, val) => {
    const n = Math.max(0, Math.min(24, parseFloat(val) || 0));
    setHorasPorDia((prev) => ({ ...prev, [d]: n }));
  };
  const toggleDia = (d) => {
    setHorasPorDia((prev) => ({ ...prev, [d]: (Number(prev[d]) || 0) > 0 ? 0 : 8 }));
  };

  const handleSubmit = useCallback((e) => {
    e?.preventDefault();
    setErro("");
    const algumDia = Object.values(horasPorDia).some((h) => (Number(h) || 0) > 0);
    if (!algumDia) { setErro("Defina ao menos um dia com horas."); return; }
    if (temAlmoco && !(almocoFim > almocoInicio)) {
      setErro("Fim do almoço deve ser depois do início."); return;
    }
    setLoading(true);
    try {
      const mapa = {};
      for (let d = 0; d <= 6; d++) mapa[d] = Number(horasPorDia[d]) || 0;
      setJornada(db, funcionarioId, {
        horas_por_dia: mapa,
        almoco_inicio: temAlmoco ? almocoInicio : null,
        almoco_fim: temAlmoco ? almocoFim : null,
        tolerancia_min: parseInt(tolerancia, 10) || 0,
        ativo: true,
      });
      addToast?.({ type: "success", message: "Jornada atualizada." });
      onSaved?.();
    } catch (err) {
      setErro(err?.message || "Erro ao salvar.");
    } finally {
      setLoading(false);
    }
  }, [db, funcionarioId, horasPorDia, temAlmoco, almocoInicio, almocoFim, tolerancia, addToast, onSaved]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4"
      role="dialog" aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl max-h-[90vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="text-base font-bold text-white">Configurar jornada</h3>
            <p className="text-xs text-gray-400 mt-0.5">{funcionarioNome}</p>
          </div>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white">✕</button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <fieldset>
            <legend className="block text-xs font-semibold text-gray-300 mb-2">Carga horária por dia</legend>
            <div className="space-y-1.5">
              {NOMES.map((nome, d) => {
                const ativo = (Number(horasPorDia[d]) || 0) > 0;
                return (
                  <div key={d} className="flex items-center gap-3">
                    <button
                      type="button"
                      onClick={() => toggleDia(d)}
                      className={`w-24 px-2 py-1.5 rounded-lg text-xs font-semibold border text-left ${ativo ? "bg-blue-600 border-blue-500 text-white" : "bg-gray-800 border-gray-700 text-gray-400"}`}
                    >
                      {nome}
                    </button>
                    <input
                      type="number" step="0.5" min="0" max="24"
                      value={horasPorDia[d] ?? 0}
                      onChange={(e) => setHoras(d, e.target.value)}
                      disabled={!ativo}
                      className="w-20 px-2 py-1.5 rounded-lg bg-gray-800 border border-gray-700 text-white text-sm disabled:opacity-40"
                    />
                    <span className="text-xs text-gray-500">{ativo ? "horas" : "folga"}</span>
                  </div>
                );
              })}
            </div>
            <p className="text-[11px] text-gray-500 mt-1.5">Toque no dia pra ligar/desligar. Sábado meio período = 4h.</p>
          </fieldset>

          <fieldset className="border-t border-gray-800 pt-3">
            <div className="flex items-center justify-between mb-2">
              <legend className="text-xs font-semibold text-gray-300">Janela de almoço</legend>
              <label className="flex items-center gap-2 text-xs text-gray-300">
                <input type="checkbox" checked={temAlmoco} onChange={(e) => setTemAlmoco(e.target.checked)} />
                {temAlmoco ? "Com almoço" : "Sem almoço"}
              </label>
            </div>
            {temAlmoco && (
              <div className="grid grid-cols-2 gap-3">
                <Field id="alm-ini" label="Início" type="time" value={almocoInicio} onChange={setAlmocoInicio} />
                <Field id="alm-fim" label="Fim" type="time" value={almocoFim} onChange={setAlmocoFim} />
              </div>
            )}
            <p className="text-[11px] text-gray-500 mt-1.5">O almoço é descontado automático — não precisa bater. Quem sai antes do início não perde nada.</p>
          </fieldset>

          <div className="grid grid-cols-2 gap-3 border-t border-gray-800 pt-3">
            <Field id="jor-tol" label="Tolerância (min)" type="number" step="1" min="0" max="60" value={tolerancia} onChange={setTolerancia} />
          </div>

          {erro && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">{erro}</div>
          )}

          <div className="flex items-center justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-gray-300 hover:text-white" disabled={loading}>Cancelar</button>
            <button type="submit" disabled={loading} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">
              {loading ? "Salvando…" : "Salvar"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Conferir que o `atual` passado ao modal já vem migrado**

Verificar o call-site (≈ linha 66): `getJornada(db, funcSelecionado)` já retorna jornada migrada (Task 3), então `atual.horas_por_dia` e `atual.almoco_*` existem. Nenhuma mudança extra necessária. Se o modal recebe `JORNADA_DEFAULT` (funcionário sem config), os defaults do `useState` cobrem.

- [ ] **Step 3: Build pra garantir que compila**

Run: `npm run build`
Expected: build OK (sem erro de referência a `DIA_SEMANA`, `horaEntrada`, etc. removidos). Se `DIA_SEMANA` ficou sem uso e o projeto não tem linter, ignorar; se quebrar import, remover a referência órfã.

- [ ] **Step 4: Commit**

```bash
git add src/modules/PontoBancoHoras.jsx
git commit -m "feat(ponto): modal de jornada com carga por dia e janela de almoco"
```

---

### Task 6: Call-sites de `minutosTrabalhadosDia` em `PontoModule.jsx`

**Files:**
- Modify: `src/modules/PontoModule.jsx`

- [ ] **Step 1: Localizar usos de `minutosTrabalhadosDia` e `proximaAcao`**

Run: `git grep -n "minutosTrabalhadosDia\|proximaAcao" src/modules/PontoModule.jsx`
Expected: lista de linhas. Para cada `minutosTrabalhadosDia(regs)` que represente minutos do dia de um funcionário, passar a jornada: `minutosTrabalhadosDia(regs, getJornada(db, user.id))` (ou o id do funcionário do contexto). Importar `getJornada` de `../lib/banco-horas.js` se ainda não estiver importado.

- [ ] **Step 2: Aplicar a alteração em cada call-site**

Em cada ocorrência, trocar:

```jsx
minutosTrabalhadosDia(registrosDoDia)
```

por (usando o id do funcionário disponível no escopo — `user.id` no card "Meu ponto", ou o id do funcionário da linha no painel admin):

```jsx
minutosTrabalhadosDia(registrosDoDia, getJornada(db, <funcionarioId>))
```

Se não houver `db`/jornada no escopo daquele ponto, manter `minutosTrabalhadosDia(registrosDoDia)` (sem jornada → não desconta; aceitável para exibição agregada onde não há um único funcionário).

- [ ] **Step 3: Remover qualquer texto/label de "intervalo" no fluxo de batida**

Run: `git grep -n "intervalo" src/modules/PontoModule.jsx`
Expected: nenhuma referência de UI que instrua o funcionário a "bater intervalo". Remover labels desse tipo se existirem (o `proxima` já só retorna entrada/saida). `labelTipo` em `ponto.js` mantém os casos de intervalo (compat com histórico) — não remover.

- [ ] **Step 4: Rodar suite + build**

Run: `npm run test && npm run build`
Expected: PASS + build OK.

- [ ] **Step 5: Commit**

```bash
git add src/modules/PontoModule.jsx
git commit -m "feat(ponto): minutos do dia usam a jornada (desconto de almoco)"
```

---

## Self-Review

- **Spec coverage:** entrada/saída (Task 1) ✓; almoço por janela (Task 2) ✓; jornada por dia + migração (Task 3) ✓; sábado meio período via carga do dia (Task 4) ✓; UI (Task 5) ✓; call-sites (Task 6) ✓.
- **Placeholders:** nenhum TODO/TBD; código completo em cada step.
- **Type/contract consistency:** `minutosTrabalhadosDia(registrosDia, jornada)` usado consistentemente (Tasks 2,4,6); `migrarJornada`/`getJornada`/`resumoDiasJornada` exportados (Tasks 3,4) e importados onde usados; `horas_por_dia` é objeto `{0..6:horas}` em todos os pontos.
- **Risco TZ nos testes:** datahora SEM `Z` (hora local) e janela de almoço via `setHours` local → resultado determinístico independente do fuso do CI.

## Deploy

Front-end via Vercel ao mergear na `main`. Sem mudança de Supabase/edge functions. Jornadas existentes migram na leitura; admin re-salva pela UI nova para persistir o formato.
