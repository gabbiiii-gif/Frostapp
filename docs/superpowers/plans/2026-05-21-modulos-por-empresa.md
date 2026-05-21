# Módulos por Empresa — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir que o Master escolha, por empresa, quais módulos do ERP ficam disponíveis.

**Architecture:** O objeto `company` ganha um campo `allowedModules` (allowlist; `null` = todos ligados). Um helper puro `isModuleEnabledForCompany` decide a habilitação. O filtro de `navItems` no App passa a exigir permissão do usuário **E** habilitação na empresa. O `MasterApp` ganha checkboxes no formulário de empresa.

**Tech Stack:** React 19, Vite, Vitest. App single-file (`src/App.jsx`); helpers puros em `src/utils.js`.

**Spec:** `docs/superpowers/specs/2026-05-21-modulos-por-empresa-design.md`

**Nota git:** repo ativo em `Frostapp-main/` (remote `github.com/gabbiiii-gif/Frostapp`, branch `main`). Commits são reais.

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---------|------------------|------|
| `src/utils.js` | Helper puro `isModuleEnabledForCompany` | Modificar (+função) |
| `src/utils.test.js` | Testes do helper | Modificar (+casos) |
| `src/App.jsx` | Constante `TOGGLEABLE_MODULES`, filtro `navItems`, fallback `activeModule`, checkboxes no `MasterApp` | Modificar |

---

## Task 1: Helper `isModuleEnabledForCompany`

**Files:**
- Modify: `src/utils.js`
- Test: `src/utils.test.js`

- [ ] **Step 1: Escrever o teste falhando**

Em `src/utils.test.js`: adicionar `isModuleEnabledForCompany` ao bloco de import do topo (a lista `import { ... } from './utils.js'`). Depois adicionar ao fim do arquivo:

```javascript
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
```

- [ ] **Step 2: Rodar — deve falhar**

Run: `cd "Frostapp-main" && npx vitest run src/utils.test.js`
Expected: FAIL — `isModuleEnabledForCompany is not defined`.

- [ ] **Step 3: Implementar o helper**

Adicionar ao fim de `src/utils.js`:

```javascript
// Decide se um módulo está habilitado para a empresa.
// allowedModules: array da empresa (ou null/undefined = tudo ligado).
// "dashboard" e "config" são sempre habilitados (regra de negócio: o admin
// da empresa nunca pode perder a tela inicial nem o acesso a configurações).
export function isModuleEnabledForCompany(allowedModules, moduleId) {
  if (moduleId === "dashboard" || moduleId === "config") return true;
  if (allowedModules == null) return true;
  return Array.isArray(allowedModules) && allowedModules.includes(moduleId);
}
```

- [ ] **Step 4: Rodar — deve passar**

Run: `cd "Frostapp-main" && npx vitest run src/utils.test.js`
Expected: PASS — todos os casos de `isModuleEnabledForCompany`.

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/utils.test.js
git commit -m "feat: helper isModuleEnabledForCompany"
```

---

## Task 2: Enforcement no App (constante + filtro `navItems` + fallback)

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Importar o helper**

No topo de `src/App.jsx`, localizar o import de `./utils` (grep `from "./utils"`). Adicionar `isModuleEnabledForCompany` à lista de nomes importados.

- [ ] **Step 2: Adicionar a constante `TOGGLEABLE_MODULES`**

Localizar a constante `ALL_MODULES` em `src/App.jsx` (grep `const ALL_MODULES`). Logo após o `]` que fecha `ALL_MODULES`, adicionar:

```javascript
// Módulos que o Master pode ligar/desligar por empresa.
// dashboard e config são sempre ativos — não entram nesta lista.
const TOGGLEABLE_MODULES = [
  { id: "processos", label: "Ordens de Serviço" },
  { id: "agenda", label: "Agenda" },
  { id: "financeiro", label: "Financeiro" },
  { id: "cadastro", label: "Cadastros" },
  { id: "ia", label: "IA / Atendimento" },
  { id: "pos-venda", label: "Pós-Venda" },
  { id: "folha", label: "Folha de Pagamento" },
];
```

- [ ] **Step 3: Filtrar `navItems` pela empresa ativa**

Localizar o `useMemo` de `navItems` (grep `const navItems = useMemo`). O corpo atual termina com um `return items.filter((item) => { ... });` e o array de deps `[user]`.

Substituir o `return items.filter(...)` por:

```javascript
    if (!user) return [];
    // allowedModules da empresa ativa — null/ausente = tudo ligado.
    const company = user.companyId ? DB.get("erp:company:" + user.companyId) : null;
    const allowed = company?.allowedModules ?? null;
    // Usa hasPermission para respeitar permissões customizadas (sobrescrevem o role)
    return items.filter((item) => {
      const permOk =
        item.id === "dashboard"
          ? hasPermission(user, "dashboard")
          : item.id === "config"
            ? (user.role === "admin" || hasPermission(user, "config"))
            : (hasPermission(user, item.id) || hasPermission(user, item.module));
      return permOk && isModuleEnabledForCompany(allowed, item.id);
    });
```

Manter o array de deps como `[user]`.

- [ ] **Step 4: Fallback do `activeModule` órfão**

Localizar o `useMemo` `activeModuleLabel` (grep `activeModuleLabel`) — fica logo após `navItems`. Após esse `useMemo`, adicionar:

```javascript
  // Se o módulo ativo foi desabilitado (pela empresa ou permissão), volta ao dashboard.
  useEffect(() => {
    if (navItems.length && !navItems.some((n) => n.id === activeModule)) {
      setActiveModule("dashboard");
    }
  }, [navItems, activeModule]);
```

Verificar que `useEffect`, `activeModule` e `setActiveModule` estão em escopo nesse ponto do componente `App` (devem estar — `activeModule` é o estado de navegação). Se `useEffect` não estiver importado, ele já é usado em todo o App — está importado.

- [ ] **Step 5: Verificar build**

Run: `cd "Frostapp-main" && npm run build`
Expected: build sem erro.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(acesso): navItems respeita allowedModules da empresa"
```

---

## Task 3: Checkboxes de módulos no formulário do `MasterApp`

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Localizar os pontos no `MasterApp`**

Por grep em `src/App.jsx` dentro de `function MasterApp`:
- O bloco de `useState` do formulário (`cNome`, `cCnpj`, `cMaxUsuarios`, etc.).
- `resetForm` — função que zera o formulário.
- `handleCreateCompany` — cria a empresa (monta o objeto `company`).
- O handler de edição de empresa (grep `editingCompany` e a função que salva a empresa editada — monta um objeto `updated` e faz `window.storage.setItem("erp:company:" + ...)`).
- O JSX do formulário de empresa (onde estão os inputs de nome/cnpj/telefone/maxUsuarios).

- [ ] **Step 2: Adicionar estado do formulário**

Junto dos outros `useState` do formulário, adicionar (`TOGGLEABLE_MODULES` é a constante da Task 2):

```javascript
  // Módulos liberados da empresa — inicia com todos os toggláveis marcados.
  const [cAllowedModules, setCAllowedModules] = useState(TOGGLEABLE_MODULES.map((m) => m.id));
```

- [ ] **Step 3: Resetar no `resetForm`**

Dentro de `resetForm`, adicionar à sequência de resets:

```javascript
    setCAllowedModules(TOGGLEABLE_MODULES.map((m) => m.id));
```

- [ ] **Step 4: Popular ao abrir edição**

Localizar onde a edição é iniciada (onde `setEditingCompany(company)` é chamado e os `setC...` são preenchidos com os dados da empresa). Adicionar:

```javascript
    setCAllowedModules(
      Array.isArray(company.allowedModules)
        ? company.allowedModules
        : TOGGLEABLE_MODULES.map((m) => m.id),
    );
```

- [ ] **Step 5: Gravar no objeto `company` (criar e editar)**

Em `handleCreateCompany`, no objeto `company` que é montado, adicionar a propriedade:

```javascript
        allowedModules: cAllowedModules,
```

No handler de edição, no objeto `updated` que é montado, adicionar igualmente:

```javascript
        allowedModules: cAllowedModules,
```

- [ ] **Step 6: Adicionar a UI dos checkboxes no formulário**

No JSX do formulário de empresa, após o campo de `maxUsuarios` (ou outro campo próximo do fim do formulário), adicionar:

```jsx
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-1.5">Módulos liberados</label>
              <div className="grid grid-cols-2 gap-2">
                {/* dashboard e config: sempre ativos */}
                {[{ id: "dashboard", label: "Dashboard" }, { id: "config", label: "Configurações" }].map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-gray-500">
                    <input type="checkbox" checked disabled className="rounded" />
                    {m.label} <span className="text-xs">(sempre ativo)</span>
                  </label>
                ))}
                {TOGGLEABLE_MODULES.map((m) => (
                  <label key={m.id} className="flex items-center gap-2 text-sm text-gray-300">
                    <input
                      type="checkbox"
                      className="rounded"
                      checked={cAllowedModules.includes(m.id)}
                      onChange={(e) => {
                        setCAllowedModules((prev) =>
                          e.target.checked
                            ? [...prev, m.id]
                            : prev.filter((x) => x !== m.id),
                        );
                      }}
                    />
                    {m.label}
                  </label>
                ))}
              </div>
              {!cAllowedModules.includes("processos") && (
                <p className="text-xs text-amber-400 mt-1.5">
                  Desligar Ordens de Serviço afeta o app do técnico desta empresa.
                </p>
              )}
            </div>
```

Ajustar as classes CSS para o padrão visual usado pelos outros campos do formulário (verificar no Step 1 — os inputs usam `bg-gray-700 border border-gray-600 ...`; os `<label>` usam `text-gray-300`).

- [ ] **Step 7: Verificar build**

Run: `cd "Frostapp-main" && npm run build`
Expected: build sem erro.

- [ ] **Step 8: Commit**

```bash
git add src/App.jsx
git commit -m "feat(master): checkboxes de módulos liberados no formulário de empresa"
```

---

## Task 4: Validação manual + deploy

**Files:** nenhum.

- [ ] **Step 1: Rodar a suíte de testes**

Run: `cd "Frostapp-main" && npm run test`
Expected: todos os testes passam (incluindo os novos de `isModuleEnabledForCompany`).

- [ ] **Step 2: Validação manual**

Run: `cd "Frostapp-main" && npm run dev`
- Logar como Master → editar uma empresa → desmarcar "Financeiro" → salvar.
- Logar como admin dessa empresa → confirmar que "Financeiro" não aparece na sidebar.
- Confirmar que `Dashboard` e `Configurações` continuam visíveis.
- Logar em outra empresa (ou empresa sem `allowedModules`) → confirmar que todos os módulos aparecem.
- Reabilitar "Financeiro" no Master → confirmar que volta a aparecer.

- [ ] **Step 3: Push**

```bash
cd "Frostapp-main" && git push origin main
```
A Vercel faz o deploy automático (CLAUDE.md Regra 1).

- [ ] **Step 4: Ingest no wiki**

Atualizar `docs/wiki/`:
- `concepts/role-permissions.md` — registrar a camada de teto por empresa (`allowedModules`).
- `modules/master-tier.md` (ou a página equivalente do MasterApp) — campo `allowedModules` e os checkboxes.
- Atualizar `docs/wiki/index.md` se necessário e append em `docs/wiki/log.md` (entrada `ingest`).

- [ ] **Step 5: Commit do wiki e push**

```bash
git add docs/wiki/
git commit -m "docs(wiki): ingest módulos por empresa"
git push origin main
```

---

## Notas de execução

- Tasks 1 → 2 → 3 em ordem (Task 2 depende da constante; Task 3 usa `TOGGLEABLE_MODULES` da Task 2).
- Compatibilidade: empresas sem `allowedModules` → `null` → todos os módulos ligados. Nenhuma migração de dados necessária.
- App do Técnico (`TecnicoMobileApp`) não é alterado — o aviso ao desligar OS (Task 3 Step 6) é a salvaguarda.
