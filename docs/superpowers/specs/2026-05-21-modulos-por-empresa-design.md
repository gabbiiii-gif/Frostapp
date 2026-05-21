# Spec — Módulos por empresa (controle no MasterApp)

- **Data:** 2026-05-21
- **Status:** aprovado (design), aguardando revisão do spec
- **Escopo:** O Master passa a escolher, por empresa, quais módulos do ERP ficam disponíveis. É um teto de acesso acima das permissões de usuário/role.

## Contexto

O FrostERP é multi-tenant: o `MasterApp` (`src/App.jsx#MasterApp`) cadastra e gerencia empresas (`erp:company:<id>` no `kv_store`). Cada empresa já tem campos como `nome`, `cnpj`, `maxUsuarios`, `ativo`.

Hoje o acesso a módulos é só por usuário: `navItems` (`src/App.jsx`, ~linha 13714) filtra os 9 módulos da sidebar por `hasPermission(user, módulo)`, que consulta `ROLE_PERMISSIONS[role]` ou `customPermissions` do usuário. Não há controle por empresa — toda empresa enxerga todos os módulos que o role do usuário permite.

Os 9 módulos (campo `id` em `navItems`): `dashboard`, `processos`, `agenda`, `financeiro`, `cadastro`, `ia`, `pos-venda`, `folha`, `config`.

Esta feature é a primeira de duas pedidas para o MasterApp. A segunda — botão "Ativar WhatsApp" (onboarding Evolution automático) — é independente e terá spec próprio.

## Decisões (confirmadas com o usuário)

| # | Decisão |
|---|---------|
| D1 | `dashboard` e `config` são **sempre ativos** — sem `config` o admin da empresa não gerencia usuários/ajustes. O Master controla os outros **7**: `processos`, `agenda`, `financeiro`, `cadastro`, `ia`, `pos-venda`, `folha`. |
| D2 | Armazenamento = **allowlist**: campo `allowedModules` (array) no objeto `company`. `null`/ausente → todos ligados (empresas existentes não quebram). |
| D3 | Só o **Master** edita `allowedModules`. O admin da empresa não pode reabilitar um módulo desligado pelo Master. |
| D4 | Desligar um módulo **esconde**, não apaga dados. Reabilitar volta a mostrar. |
| D5 | É um **teto**: módulo aparece só se a empresa permite **E** o usuário tem permissão. A empresa nunca expande o que o role/`customPermissions` do usuário concede. |

## Modelo de dados

Objeto `company` (`erp:company:<id>`) ganha:

```
allowedModules: string[] | null
```

- Valores possíveis no array: os 7 ids toggláveis (`processos`, `agenda`, `financeiro`, `cadastro`, `ia`, `pos-venda`, `folha`).
- `dashboard` e `config` **nunca** entram no array — são sempre ativos por regra (D1).
- `null` ou campo ausente → comporta-se como "todos os 7 ligados" (compatibilidade com empresas já cadastradas).

Constante nova em `src/App.jsx`, junto de `ALL_MODULES`:

```javascript
// Módulos que o Master pode ligar/desligar por empresa (dashboard e config são sempre ativos).
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

## Helper puro

Em `src/utils.js` (testável em `src/utils.test.js`):

```javascript
// Decide se um módulo está habilitado para a empresa.
// allowedModules: array da empresa (ou null/undefined = tudo ligado).
// "dashboard" e "config" são sempre habilitados.
export function isModuleEnabledForCompany(allowedModules, moduleId) {
  if (moduleId === "dashboard" || moduleId === "config") return true;
  if (allowedModules == null) return true;
  return Array.isArray(allowedModules) && allowedModules.includes(moduleId);
}
```

## UI no MasterApp

O formulário de empresa do `MasterApp` (`src/App.jsx#MasterApp`) é usado tanto para criar (`handleCreateCompany`) quanto para editar (`editingCompany`). Adicionar uma seção "Módulos liberados":

- 7 checkboxes, um por `TOGGLEABLE_MODULES`.
- `dashboard` e `config` exibidos como itens fixos marcados e desabilitados, com legenda "sempre ativo".
- **Criar empresa:** todos os 7 marcados por padrão; `company.allowedModules` salvo como a lista marcada (será os 7 ids).
- **Editar empresa:** estado inicial dos checkboxes reflete `company.allowedModules` (se `null` → todos marcados).
- Ao desmarcar `processos`, mostrar aviso inline: "Desligar Ordens de Serviço afeta o app do técnico desta empresa."
- Salvar grava `allowedModules` no objeto `company` pelo mesmo caminho dos demais campos (`window.storage.setItem` + `syncToSupabase`, como em `handleCreateCompany`).

Estado do formulário: novo `useState` `cAllowedModules` (array de ids), populado em `resetForm`/abertura de edição.

## Enforcement (App principal)

O App principal precisa do registro da empresa ativa para filtrar a sidebar.

1. **Carregar a empresa ativa:** no componente `App`, ler `erp:company:<getActiveCompanyId()>` e manter `allowedModules` em estado/memo. (O App já lida com o registro da empresa no fluxo de login — reusar esse acesso; ver `App.jsx` ~linha 2283/2360.)

2. **Filtro de `navItems`** (`src/App.jsx` ~linha 13714) passa a exigir, além de `hasPermission`:

```javascript
return items.filter((item) => {
  const permOk =
    item.id === "dashboard" ? hasPermission(user, "dashboard")
    : item.id === "config" ? (user.role === "admin" || hasPermission(user, "config"))
    : (hasPermission(user, item.id) || hasPermission(user, item.module));
  return permOk && isModuleEnabledForCompany(companyAllowedModules, item.id);
});
```

3. **Fallback de `activeModule`:** se o `activeModule` atual não estiver mais presente em `navItems` (módulo foi desligado), redefinir `activeModule` para `dashboard`. Implementar via `useEffect` que observa `navItems`: se `!navItems.some(n => n.id === activeModule)` → `setActiveModule("dashboard")`.

## Erros / edge cases

- Empresa sem `allowedModules` (`null`/ausente) → todos os 7 ligados (D2).
- Master desliga módulo com usuário logado → na próxima recomputação de `navItems` o item some; o `useEffect` de fallback corrige o `activeModule` órfão.
- **App do Técnico** (`TecnicoMobileApp`): é um shell dedicado de OS, sem sidebar — não usa `navItems`. Se a empresa desligar `processos`, o técnico fica sem conteúdo. Tratado como **aviso ao Master** na UI (não bloqueio rígido). `TecnicoMobileApp` não recebe mudança de comportamento neste spec.
- `config` sempre ativo garante que o admin da empresa nunca perde acesso a Configurações.

## Testes

- `isModuleEnabledForCompany` → `src/utils.js` + casos em `src/utils.test.js` (Vitest):
  - `allowedModules == null` → `true` para qualquer módulo.
  - `dashboard`/`config` → sempre `true`, mesmo com array vazio.
  - array com subconjunto → `true` só para os listados.
- Validação manual: Master desliga "Financeiro" de uma empresa → admin dessa empresa não vê Financeiro na sidebar; admin de outra empresa continua vendo. Reabilitar volta a mostrar.

## Fora de escopo

- Botão "Ativar WhatsApp" no MasterApp (feature A — spec próprio).
- Controle de submódulos/abas dentro de um módulo (ex.: abas do Settings) — granularidade é por módulo de sidebar.
- Limites de uso por módulo (ex.: nº de OS) — só liga/desliga.
- Refactor do monólito `App.jsx`.

## Riscos / notas

- O App precisa carregar o registro da empresa ativa de forma confiável antes de montar a sidebar; se o registro não carregar, o fallback seguro é `allowedModules = null` (tudo ligado) para nunca travar a empresa por erro de carga.
- Ingest no wiki (`docs/wiki/`) após a implementação — CLAUDE.md Regra 5.
