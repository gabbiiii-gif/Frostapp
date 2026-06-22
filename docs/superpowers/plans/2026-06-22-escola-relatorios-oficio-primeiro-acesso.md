# Escola: relatórios no portal, ofício anexo e checklist de primeiro acesso — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar relatórios no portal externo da Vanda, anexo opcional de ofício(s) com preview na criação de solicitação, e um checklist de requisitos de senha ao vivo na tela de primeiro acesso.

**Architecture:** Reusar o lib puro de relatórios já existente (`escola-relatorio.js`) numa nova UI do portal; adicionar um helper de upload para um bucket Supabase novo (`escola-oficios`) espelhando `uploadFotoOS`; e um helper puro `passwordChecklist` que alimenta um componente visual na `ResetPasswordScreen`. A política de senha global (12 chars) **não muda** — o checklist apenas exibe as regras.

**Tech Stack:** React 19 (JSX), Vite 6, Tailwind 4, Supabase Storage, Vitest + happy-dom.

**Spec:** `docs/superpowers/specs/2026-06-22-escola-relatorios-oficio-primeiro-acesso-design.md`

---

## File Structure

| Arquivo | Responsabilidade |
| --- | --- |
| `src/utils.js` | `passwordChecklist(pwd)` — booleanos por requisito (puro) |
| `src/utils.test.js` | testes de `passwordChecklist` |
| `src/lib/escola.js` | `validarOficio(file)` + constantes (puro) |
| `src/lib/escola.test.js` | testes de `validarOficio` |
| `src/supabase.js` | `uploadEscolaOficio(file, demandaId)` — bucket `escola-oficios` |
| `src/modules/EscolaPortalVanda.jsx` | input+preview de ofícios; envio com upload; botão+modal de relatórios; exibição de anexos no card |
| `src/modules/EscolaModule.jsx` | seção "Ofícios anexados" no detalhe da demanda (painel interno) |
| `src/App.jsx` | `PasswordChecklist` na `ResetPasswordScreen` + gate do botão |

---

## Task 1: Helper `passwordChecklist` (puro + teste)

**Files:**
- Modify: `src/utils.js` (após `validatePasswordStrength`, ~linha 236)
- Test: `src/utils.test.js` (após bloco `validatePasswordStrength`, ~linha 374)

- [ ] **Step 1: Write the failing test**

Adicionar ao final de `src/utils.test.js` (e incluir `passwordChecklist` no import de `./utils.js` no topo do arquivo, junto dos outros — linha ~20):

```javascript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils.test.js`
Expected: FAIL — `passwordChecklist is not defined` / `is not a function`.

- [ ] **Step 3: Write minimal implementation**

Adicionar em `src/utils.js` logo após o fechamento de `validatePasswordStrength` (depois da linha 236):

```javascript
// ─── Checklist visual de requisitos de senha ────────────────────────────────
// APENAS exibição: a política real continua em validatePasswordStrength (12 chars).
// Retorna um booleano por requisito para a UI marcar cada item em verde ao vivo.
// Helper puro — testado em utils.test.js.
export function passwordChecklist(pwd) {
  const s = String(pwd || "");
  return {
    min12: s.length >= 12,
    upper: /[A-Z]/.test(s),
    lower: /[a-z]/.test(s),
    number: /\d/.test(s),
    symbol: /[^\w\s]|_/.test(s),
    noSpace: s.length > 0 && !/\s/.test(s),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils.test.js`
Expected: PASS (todos os `passwordChecklist` verdes).

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/utils.test.js
git commit -m "feat(escola): helper passwordChecklist para checklist de senha ao vivo"
```

---

## Task 2: `PasswordChecklist` na tela de primeiro acesso

**Files:**
- Modify: `src/App.jsx` — import (linha 19), `ResetPasswordScreen` (linhas 2575-2677)

- [ ] **Step 1: Adicionar `passwordChecklist` ao import de utils**

Em `src/App.jsx` linha 19, o import atual é:

```javascript
import { validateOSProposal, buildOSWhatsAppResumo, isModuleEnabledForCompany, calcDescontoOS, validatePasswordStrength } from "./utils.js";
```

Trocar por (adicionar `passwordChecklist`):

```javascript
import { validateOSProposal, buildOSWhatsAppResumo, isModuleEnabledForCompany, calcDescontoOS, validatePasswordStrength, passwordChecklist } from "./utils.js";
```

- [ ] **Step 2: Inserir o componente `PasswordChecklist` antes de `ResetPasswordScreen`**

Em `src/App.jsx`, imediatamente antes da linha `function ResetPasswordScreen(...)` (linha 2575), inserir:

```javascript
// Lista visual de requisitos de senha — cada item fica verde quando cumprido.
// Não bloqueia nada sozinho; a validação real continua em validatePasswordStrength.
function PasswordChecklist({ pwd }) {
  const c = passwordChecklist(pwd);
  const itens = [
    { ok: c.min12, label: "Mínimo 12 caracteres" },
    { ok: c.upper, label: "Uma letra maiúscula" },
    { ok: c.lower, label: "Uma letra minúscula" },
    { ok: c.number, label: "Um número" },
    { ok: c.symbol, label: "Um caractere especial (!@#$…)" },
    { ok: c.noSpace, label: "Sem espaços" },
  ];
  return (
    <ul className="mt-2 space-y-1" aria-label="Requisitos da senha">
      {itens.map((it) => (
        <li
          key={it.label}
          className={`flex items-center gap-2 text-[12px] transition-colors ${it.ok ? "text-green-400" : "text-gray-400"}`}
        >
          <span aria-hidden="true" className={`inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] ${it.ok ? "bg-green-500/20 text-green-400" : "bg-gray-700 text-gray-500"}`}>
            {it.ok ? "✓" : "•"}
          </span>
          {it.label}
        </li>
      ))}
    </ul>
  );
}
```

- [ ] **Step 3: Renderizar o checklist e travar o botão**

Em `ResetPasswordScreen`, logo abaixo do primeiro `<PasswordInput .../>` (o de "Nova senha", que termina na linha 2645 com `/>`), dentro do mesmo `<div>` que o envolve (após a linha 2645, antes do `</div>` da linha 2646), inserir:

```javascript
              <PasswordChecklist pwd={pwd} />
```

Em seguida, alterar o botão "Ativar conta" (linhas 2661-2671) para desabilitar enquanto a senha não cumpre a política ou não confere. Substituir:

```javascript
            <button
              onClick={handleSave}
              disabled={busy}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50"
            >
```

por:

```javascript
            <button
              onClick={handleSave}
              disabled={busy || !validatePasswordStrength(pwd).ok || pwd !== confirm}
              className="w-full bg-blue-600 text-white py-2.5 rounded-lg font-medium hover:bg-blue-700 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
```

- [ ] **Step 4: Verificar build (sem teste unitário de UI neste projeto)**

Run: `npm run build`
Expected: build conclui sem erro de sintaxe/JSX.

- [ ] **Step 5: Commit**

```bash
git add src/App.jsx
git commit -m "feat(escola): checklist de requisitos de senha ao vivo no primeiro acesso"
```

---

## Task 3: Helper `validarOficio` (puro + teste)

**Files:**
- Modify: `src/lib/escola.js` (topo, após os exports de URGENCIA, ~linha 19)
- Test: `src/lib/escola.test.js` (novo bloco no final)

- [ ] **Step 1: Write the failing test**

Adicionar ao final de `src/lib/escola.test.js` (e importar `validarOficio`, `OFICIO_MAX_BYTES` no topo do arquivo, junto dos outros imports de `./escola.js`):

```javascript
describe("validarOficio", () => {
  it("aceita PDF dentro do limite", () => {
    const r = validarOficio({ name: "oficio.pdf", type: "application/pdf", size: 1024 });
    expect(r.ok).toBe(true);
  });

  it("aceita imagem dentro do limite", () => {
    const r = validarOficio({ name: "foto.jpg", type: "image/jpeg", size: 2048 });
    expect(r.ok).toBe(true);
  });

  it("rejeita tipo não permitido", () => {
    const r = validarOficio({ name: "a.docx", type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", size: 10 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/PDF ou imagem/i);
  });

  it("rejeita arquivo acima do limite", () => {
    const r = validarOficio({ name: "grande.pdf", type: "application/pdf", size: OFICIO_MAX_BYTES + 1 });
    expect(r.ok).toBe(false);
    expect(r.motivo).toMatch(/10 MB/i);
  });

  it("rejeita arquivo nulo", () => {
    expect(validarOficio(null).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/lib/escola.test.js`
Expected: FAIL — `validarOficio is not defined`.

- [ ] **Step 3: Write minimal implementation**

Adicionar em `src/lib/escola.js` logo após a constante `URGENCIA_OPCOES` (linha 19):

```javascript
// ─── Anexo de ofício (validação client-side, pura) ───────────────────────────
// Limite de 10 MB por arquivo; só PDF ou imagem. Retorna { ok, motivo? }.
export const OFICIO_MAX_BYTES = 10 * 1024 * 1024;

export function validarOficio(file) {
  if (!file) return { ok: false, motivo: "Arquivo inválido" };
  const tipo = file.type || "";
  const tipoOk = tipo === "application/pdf" || tipo.startsWith("image/");
  if (!tipoOk) return { ok: false, motivo: "Apenas PDF ou imagem" };
  if (file.size > OFICIO_MAX_BYTES) return { ok: false, motivo: "Máximo 10 MB por arquivo" };
  return { ok: true };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/lib/escola.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/escola.js src/lib/escola.test.js
git commit -m "feat(escola): helper validarOficio (PDF/imagem, max 10MB)"
```

---

## Task 4: `uploadEscolaOficio` no Supabase Storage

**Files:**
- Modify: `src/supabase.js` (após `deleteAssinaturaOS`, ~linha 1226)

- [ ] **Step 1: Adicionar o helper de upload**

Em `src/supabase.js`, logo após o fim de `deleteAssinaturaOS` (linha 1226), inserir. Reaproveita `SIGNED_URL_TTL` e `getCompanyId` já definidos no arquivo:

```javascript
// ─── Storage: upload de ofícios do módulo Escola ─────────────────────────────
// Bucket PRIVADO 'escola-oficios' (criar manualmente no Dashboard, RLS por pasta:
// foldername[1] = company_id, igual a os-fotos/os-assinaturas).
// Path: {companyId}/{demandaId}/{ts}_{rand}.{ext}. Retorna signed URL ou null.
// Anexo é opcional no portal — se retornar null (offline/erro), a demanda já existe.
export async function uploadEscolaOficio(file, demandaId) {
  if (!supabase) return null;
  const companyId = getCompanyId();
  if (!companyId) { console.warn('uploadEscolaOficio: sem company_id.'); return null; }
  try {
    const ext = (file.name || 'oficio').split('.').pop();
    const ts = Date.now();
    const path = `${companyId}/${demandaId}/${ts}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const { error: upErr } = await supabase.storage
      .from('escola-oficios')
      .upload(path, file, { cacheControl: '3600', upsert: false, contentType: file.type });
    if (upErr) { console.warn('Upload ofício erro:', upErr.message); return null; }
    const { data, error: signErr } = await supabase.storage.from('escola-oficios').createSignedUrl(path, SIGNED_URL_TTL);
    if (signErr) { console.warn('Signed URL ofício erro:', signErr.message); return null; }
    return data?.signedUrl || null;
  } catch (err) {
    console.warn('Upload ofício falhou:', err.message);
    return null;
  }
}
```

- [ ] **Step 2: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add src/supabase.js
git commit -m "feat(escola): uploadEscolaOficio (bucket privado escola-oficios)"
```

---

## Task 5: Anexo de ofício(s) com preview no portal da Vanda

**Files:**
- Modify: `src/modules/EscolaPortalVanda.jsx` — imports (14-24), estado/handlers (54-106), modal (225-313)

- [ ] **Step 1: Atualizar imports**

Em `src/modules/EscolaPortalVanda.jsx`, trocar o import do lib (linhas 15-20) para incluir `validarOficio`:

```javascript
import {
  criarDemanda,
  listarDemandasUsuario,
  URGENCIA,
  URGENCIA_OPCOES,
  validarOficio,
} from "../lib/escola.js";
```

E ampliar o import do supabase (linha 24) para incluir o upload:

```javascript
import { notifyEscolaEvent, uploadEscolaOficio } from "../supabase.js";
```

- [ ] **Step 2: Adicionar estado dos ofícios + cleanup**

Em `EscolaPortalVanda`, junto dos estados do modal (após `const [erroForm, setErroForm] = useState("");`, linha 59), inserir:

```javascript
  // Ofícios anexados (opcional, múltiplos). Cada item: { file, previewUrl|null, key }.
  const [oficios, setOficios] = useState([]);

  // Revoga object URLs de imagem ao desmontar (evita memory leak).
  useEffect(() => {
    return () => { oficios.forEach((o) => o.previewUrl && URL.revokeObjectURL(o.previewUrl)); };
  }, [oficios]);

  const handleSelecionarOficios = useCallback((e) => {
    const novos = [];
    for (const file of Array.from(e.target.files || [])) {
      const v = validarOficio(file);
      if (!v.ok) { setErroForm(`"${file.name}": ${v.motivo}`); continue; }
      novos.push({
        file,
        previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : null,
        key: `${file.name}_${file.size}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      });
    }
    if (novos.length) setOficios((prev) => [...prev, ...novos]);
    e.target.value = ""; // permite re-selecionar o mesmo arquivo
  }, []);

  const handleRemoverOficio = useCallback((key) => {
    setOficios((prev) => {
      const alvo = prev.find((o) => o.key === key);
      if (alvo?.previewUrl) URL.revokeObjectURL(alvo.previewUrl);
      return prev.filter((o) => o.key !== key);
    });
  }, []);
```

- [ ] **Step 3: Limpar ofícios no `resetForm`**

Alterar `resetForm` (linhas 61-66) para também limpar os ofícios:

```javascript
  const resetForm = useCallback(() => {
    setFormEscola("");
    setFormDescricao("");
    setFormUrgencia("medio");
    setErroForm("");
    setOficios((prev) => {
      prev.forEach((o) => o.previewUrl && URL.revokeObjectURL(o.previewUrl));
      return [];
    });
  }, []);
```

- [ ] **Step 4: Subir os ofícios após criar a demanda**

Em `handleEnviar` (linhas 73-106), logo após o bloco `addToast?.({ type: "success", ... })` (linha 90) e **antes** de `if (user.companyId)` (linha 93), inserir o upload:

```javascript
      // Upload dos ofícios (opcional). A demanda já está gravada no kv_store;
      // anexos que falharem (offline/erro) apenas não entram — não travam o fluxo.
      if (oficios.length) {
        const subidos = [];
        for (const o of oficios) {
          const url = await uploadEscolaOficio(o.file, nova.id);
          if (url) subidos.push({ url, nome: o.file.name, tipo: o.file.type, tamanho: o.file.size });
        }
        if (subidos.length) {
          const atual = db.get(nova.id) || nova;
          db.set(nova.id, { ...atual, oficios: subidos, updated_at: new Date().toISOString() });
        }
        if (subidos.length < oficios.length) {
          addToast?.({ type: "info", message: "Alguns anexos não puderam ser enviados." });
        }
      }
```

Atualizar também o array de dependências do `useCallback` de `handleEnviar` (linha 106) para incluir `oficios`:

```javascript
  }, [db, user, formEscola, formDescricao, formUrgencia, oficios, addToast, resetForm]);
```

- [ ] **Step 5: Adicionar o campo de upload + previews no modal**

Em `src/modules/EscolaPortalVanda.jsx`, dentro do `<form>`, logo após o `<fieldset>` de urgência (fecha na linha 284) e antes do `<div className="text-[11px] text-gray-500">` (linha 286), inserir:

```javascript
              <div>
                <label htmlFor="dem-oficios" className="block text-xs font-semibold text-gray-300 mb-1.5">
                  Ofício (PDF ou imagem) — opcional
                </label>
                <input
                  id="dem-oficios"
                  type="file"
                  accept="application/pdf,image/*"
                  multiple
                  onChange={handleSelecionarOficios}
                  className="block w-full text-sm text-gray-300 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border-0 file:bg-blue-600 file:text-white file:text-xs file:font-semibold hover:file:bg-blue-500 cursor-pointer"
                />
                {oficios.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 sm:grid-cols-3 gap-2">
                    {oficios.map((o) => (
                      <li key={o.key} className="relative rounded-lg border border-gray-700 bg-gray-800/60 p-2 flex flex-col gap-1">
                        <button
                          type="button"
                          onClick={() => handleRemoverOficio(o.key)}
                          aria-label={`Remover ${o.file.name}`}
                          className="absolute -top-2 -right-2 w-5 h-5 rounded-full bg-red-600 hover:bg-red-500 text-white text-xs leading-none flex items-center justify-center shadow"
                        >✕</button>
                        {o.previewUrl ? (
                          <img src={o.previewUrl} alt={o.file.name} className="w-full h-20 object-cover rounded" />
                        ) : (
                          <div className="w-full h-20 rounded bg-gray-900/70 flex items-center justify-center text-2xl" aria-hidden="true">📄</div>
                        )}
                        <span className="text-[10px] text-gray-300 truncate" title={o.file.name}>{o.file.name}</span>
                        <span className="text-[10px] text-gray-500">{(o.file.size / 1024).toFixed(0)} KB</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add src/modules/EscolaPortalVanda.jsx
git commit -m "feat(escola): anexo de oficios com preview na criacao de solicitacao"
```

---

## Task 6: Exibir ofícios no card (portal) e no detalhe interno

**Files:**
- Modify: `src/modules/EscolaPortalVanda.jsx` — card da lista (linhas 193-197)
- Modify: `src/modules/EscolaModule.jsx` — detalhe da demanda (após bloco "Descrição", ~linha 362)

- [ ] **Step 1: Mostrar anexos no card do portal**

Em `src/modules/EscolaPortalVanda.jsx`, dentro do `<li>` de cada demanda, no rodapé de metadados (o `<div className="mt-3 flex items-center gap-4 ...">`, linhas 193-197), adicionar após o `<span>` de "Solicitado em" (antes do fechamento `</div>` da linha 197):

```javascript
                    {Array.isArray(d.oficios) && d.oficios.length > 0 && (
                      <span className="inline-flex items-center gap-1">
                        📎 {d.oficios.length} anexo{d.oficios.length > 1 ? "s" : ""}
                        {d.oficios.map((of, i) => (
                          <a
                            key={i}
                            href={of.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline text-blue-300 hover:text-blue-200"
                          >
                            {i + 1}
                          </a>
                        ))}
                      </span>
                    )}
```

- [ ] **Step 2: Mostrar anexos no detalhe do painel interno**

Em `src/modules/EscolaModule.jsx`, no modal de detalhe, logo após o bloco de "Descrição" (o `<div>` que fecha na linha 362) e antes do bloco `observacao_conclusao` (linha 364), inserir:

```javascript
              {Array.isArray(demandaDetalhe.oficios) && demandaDetalhe.oficios.length > 0 && (
                <div>
                  <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-1">Ofícios anexados</h4>
                  <ul className="space-y-1.5">
                    {demandaDetalhe.oficios.map((of, i) => (
                      <li key={i}>
                        <a
                          href={of.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300"
                        >
                          <span aria-hidden="true">{(of.tipo || "").startsWith("image/") ? "🖼️" : "📄"}</span>
                          <span className="truncate max-w-[320px]">{of.nome || `Anexo ${i + 1}`}</span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
```

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 4: Commit**

```bash
git add src/modules/EscolaPortalVanda.jsx src/modules/EscolaModule.jsx
git commit -m "feat(escola): exibe oficios anexados no card do portal e no detalhe interno"
```

---

## Task 7: Relatórios no portal da Vanda

**Files:**
- Modify: `src/modules/EscolaPortalVanda.jsx` — imports, header (130-146), novo estado + modal

- [ ] **Step 1: Importar o lib de relatório e `useCallback`**

Em `src/modules/EscolaPortalVanda.jsx`, adicionar import do lib de relatório (após o import de `escola.js`, linha 20):

```javascript
import {
  montarRelatorio,
  gerarHtmlRelatorio,
  gerarCsvRelatorio,
  periodoSemana,
  periodoMesCorrente,
} from "../lib/escola-relatorio.js";
```

(`useState`, `useMemo`, `useCallback`, `useEffect` já estão importados na linha 14.)

- [ ] **Step 2: Estado de abertura do modal**

Junto dos estados do componente (após `const [refreshTick, setRefreshTick] = useState(0);`, linha 40), inserir:

```javascript
  const [showRelatorio, setShowRelatorio] = useState(false);
```

- [ ] **Step 3: Botão "Relatórios" no header**

Em `src/modules/EscolaPortalVanda.jsx`, na seção CTA "Nova solicitação" (linhas 132-146), trocar o `<button>` único por um par de botões. Substituir o bloco do botão (linhas 139-145):

```javascript
          <button
            type="button"
            onClick={handleAbrirForm}
            className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-900/40 transition"
          >
            + Nova Solicitação
          </button>
```

por:

```javascript
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setShowRelatorio(true)}
              className="px-4 py-2.5 rounded-xl border border-gray-600 hover:border-gray-400 text-gray-200 hover:text-white font-semibold transition"
            >
              📊 Relatórios
            </button>
            <button
              type="button"
              onClick={handleAbrirForm}
              className="px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold shadow-lg shadow-blue-900/40 transition"
            >
              + Nova Solicitação
            </button>
          </div>
```

- [ ] **Step 4: Renderizar o modal de relatório**

Em `src/modules/EscolaPortalVanda.jsx`, logo antes do fechamento final do componente (antes da última linha `    </div>\n  );\n}` — o `</div>` que fecha o container raiz, linha 317), inserir a renderização condicional:

```javascript
      {showRelatorio && (
        <RelatorioPortalModal
          demandas={demandas}
          empresaNome={user?.companyName || "FrostERP"}
          onClose={() => setShowRelatorio(false)}
          addToast={addToast}
        />
      )}
```

- [ ] **Step 5: Implementar `RelatorioPortalModal` (tema escuro do portal)**

No final do arquivo `src/modules/EscolaPortalVanda.jsx`, após o fechamento do componente `EscolaPortalVanda` (depois da linha 319), adicionar:

```javascript
// ─── Modal de Relatórios do portal (reusa o lib escola-relatorio.js) ─────────
// Mesma lógica do painel interno, mas no tema escuro do portal. Opera só sobre
// as demandas da própria Vanda (já filtradas por solicitante no componente pai).
function RelatorioPortalModal({ demandas, empresaNome, onClose, addToast }) {
  const semana = periodoSemana();
  const [preset, setPreset] = useState("mes");
  const [ini, setIni] = useState(periodoMesCorrente().ini);
  const [fim, setFim] = useState(periodoMesCorrente().fim);
  const [escolaFiltro, setEscolaFiltro] = useState("");

  const handlePreset = useCallback((p) => {
    setPreset(p);
    if (p === "semana") { setIni(semana.ini); setFim(semana.fim); }
    if (p === "mes") { const m = periodoMesCorrente(); setIni(m.ini); setFim(m.fim); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const relatorio = useMemo(
    () => montarRelatorio(demandas, ini, fim, escolaFiltro),
    [demandas, ini, fim, escolaFiltro]
  );

  const handlePDF = useCallback(() => {
    try {
      const html = gerarHtmlRelatorio(relatorio, empresaNome);
      const w = window.open("", "_blank", "width=900,height=900");
      if (!w) { addToast?.({ type: "error", message: "Pop-up bloqueado. Permita pop-ups e tente de novo." }); return; }
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao gerar PDF." });
    }
  }, [relatorio, empresaNome, addToast]);

  const handleCSV = useCallback(() => {
    try {
      const csv = gerarCsvRelatorio(relatorio);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `escola_${ini}_a_${fim}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      addToast?.({ type: "success", message: "CSV exportado." });
    } catch (err) {
      addToast?.({ type: "error", message: err?.message || "Erro ao exportar CSV." });
    }
  }, [relatorio, ini, fim, addToast]);

  const { metricas } = relatorio;
  const taxa = (metricas.taxa_conclusao * 100).toFixed(1);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dlg-rel-titulo"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full sm:max-w-xl bg-gray-900 border border-gray-700 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between sticky top-0 bg-gray-900">
          <h3 id="dlg-rel-titulo" className="text-base font-bold text-white">Relatórios — Minhas solicitações</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex gap-1 rounded-lg border border-gray-700 bg-gray-800/40 p-1">
            {[
              { id: "semana", label: "Semana" },
              { id: "mes", label: "Mês corrente" },
              { id: "custom", label: "Personalizado" },
            ].map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handlePreset(p.id)}
                className={`flex-1 px-3 py-1.5 text-xs font-semibold rounded ${preset === p.id ? "bg-gray-700 text-white" : "text-gray-400 hover:text-white"}`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="prel-ini" className="block text-xs font-semibold text-gray-300 mb-1">Início</label>
              <input
                id="prel-ini"
                type="date"
                value={ini}
                onChange={(e) => { setIni(e.target.value); setPreset("custom"); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
            <div>
              <label htmlFor="prel-fim" className="block text-xs font-semibold text-gray-300 mb-1">Fim</label>
              <input
                id="prel-fim"
                type="date"
                value={fim}
                onChange={(e) => { setFim(e.target.value); setPreset("custom"); }}
                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              />
            </div>
          </div>

          <div>
            <label htmlFor="prel-escola" className="block text-xs font-semibold text-gray-300 mb-1">Filtrar escola (opcional)</label>
            <input
              id="prel-escola"
              type="search"
              value={escolaFiltro}
              onChange={(e) => setEscolaFiltro(e.target.value)}
              className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-white"
              placeholder="Ex: Vila Nova"
            />
          </div>

          <div className="rounded-2xl border border-gray-700 bg-gray-800/40 p-4">
            <h4 className="text-xs font-semibold text-gray-300 mb-3">Preview do período</h4>
            <div className="grid grid-cols-4 gap-2 text-center">
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Total</div><div className="text-lg font-bold text-white">{metricas.total}</div></div>
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Concluídas</div><div className="text-lg font-bold text-white">{metricas.concluidas}</div></div>
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Em exec.</div><div className="text-lg font-bold text-white">{metricas.em_execucao}</div></div>
              <div className="rounded-lg bg-gray-900/60 p-2"><div className="text-[10px] uppercase tracking-wide text-gray-400">Aguard.</div><div className="text-lg font-bold text-white">{metricas.aguardando}</div></div>
            </div>
            <div className="mt-3 text-[11px] text-gray-400">
              Taxa de conclusão: <strong className="text-white">{taxa}%</strong>
            </div>
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-800">
            <button
              type="button"
              onClick={handleCSV}
              className="px-4 py-2 rounded-lg border border-gray-600 hover:border-gray-400 text-gray-300 hover:text-white text-sm"
            >
              ⬇ CSV
            </button>
            <button
              type="button"
              onClick={handlePDF}
              className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm font-semibold"
            >
              ⬇ PDF
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 6: Verificar build**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 7: Commit**

```bash
git add src/modules/EscolaPortalVanda.jsx
git commit -m "feat(escola): relatorios (PDF/CSV, semana/mes/custom) no portal da Vanda"
```

---

## Task 8: Verificação final + documentação do bucket

**Files:**
- Modify: `CLAUDE.md` (seção de buckets / setup manual — adicionar nota do `escola-oficios`)

- [ ] **Step 1: Rodar a suíte de testes completa**

Run: `npm test`
Expected: PASS — incluindo `passwordChecklist` (utils.test.js) e `validarOficio` (escola.test.js).

- [ ] **Step 2: Build de produção**

Run: `npm run build`
Expected: build OK, sem erros.

- [ ] **Step 3: Documentar o bucket novo**

Em `CLAUDE.md`, na Regra 4 (onde menciona buckets `os-fotos`/`os-assinaturas`) ou numa nota de setup do módulo Escola, acrescentar:

```markdown
- Bucket Supabase Storage **`escola-oficios`** (privado) — criar manualmente no Dashboard,
  com RLS de pasta escopada por `company_id` (`foldername[1] = company_id`, igual a `os-fotos`).
  Guarda os ofícios anexados pela Vanda ao abrir solicitação. Anexo é opcional.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs(escola): registra bucket escola-oficios no setup"
```

- [ ] **Step 5: Push da branch**

```bash
git push -u origin feat/escola-novas-features
```

---

## Notas de execução

- **Setup manual obrigatório antes do teste E2E:** criar o bucket privado `escola-oficios` no Supabase Dashboard com RLS de pasta. Sem ele, o upload retorna `null` (a demanda é criada, mas sem anexo).
- O projeto só tem testes unitários para helpers puros — as Tasks de UI são verificadas via `npm run build`. Verificação visual (relatório, preview de anexo, checklist de senha) é manual no `npm run dev`.
- Política de senha global **inalterada** (12 chars) — o checklist é só exibição.
