---
title: Role Permissions (gating de módulos + customPermissions override)
type: concept
updated: 2026-05-10
sources: []
related:
  - ./db-layer.md
  - ../modules/tecnico-mobile.md
  - ../modules/settings.md
  - ../modules/process.md
code_refs:
  - src/App.jsx:140-145
  - src/App.jsx#hasPermission
  - src/App.jsx#ALL_MODULES
  - src/App.jsx:1030
  - src/App.jsx:1040
---

# Role Permissions

Gating de módulos baseado em role + override por `customPermissions`. Sempre via `hasPermission(user, module)` — **nunca** comparar role direto.

## Roles

| Role | Permissões padrão (`ROLE_PERMISSIONS`) |
|---|---|
| `admin` | `["all"]` (tudo) |
| `gerente` | `dashboard, clientes, funcionarios, financeiro, os, agenda, config` |
| `tecnico` | `dashboard, os, agenda` ← na prática **não vê o ERP** (shell dedicado, ver [tecnico-mobile](../modules/tecnico-mobile.md)) |
| `atendente` | `dashboard, clientes, os, agenda` |

> Observação: `gerente` tem `config` na lista padrão, mas o gate em `navItems` (App.jsx:11681-11684) restringe **Configurações apenas para `admin`** OU quem tem `config` em `customPermissions`. Em outras palavras: o `config` de `gerente` em `ROLE_PERMISSIONS` é overridden pelo gate específico do sidebar. Se quiser dar Settings pra gerente sem ele virar admin, use `customPermissions`.

## `ALL_MODULES` (App.jsx:1030)

Lista canônica dos módulos disponíveis pra UI:
```
dashboard, processos, agenda, cadastro, config
```

Note: `processos` (sidebar id) ≠ `os` (permission key). E `cadastro` (sidebar) usa permission key `clientes`. Mapping no `navItems` (App.jsx:11669):
```
{ id: "dashboard",  module: "dashboard"  }
{ id: "processos",  module: "os"         }
{ id: "agenda",     module: "agenda"     }
{ id: "financeiro", module: "financeiro" }
{ id: "cadastro",   module: "clientes"   }
{ id: "config",     module: "config"     }
```

`hasPermission(user, item.id) || hasPermission(user, item.module)` cobre ambas as chaves — defesa contra dados velhos que usam `id` em vez de `module`.

## `hasPermission(user, module)` (App.jsx:1040)

```js
if (!user || !user.role) return false;
if (Array.isArray(user.customPermissions)) {
  return user.customPermissions.includes("all") ||
         user.customPermissions.includes(module);
}
const perms = ROLE_PERMISSIONS[user.role] || [];
return perms.includes("all") || perms.includes(module);
```

### Comportamento crítico

- **`customPermissions` é override total do role.** Se array existe (mesmo vazio `[]`) → role é ignorado. Permite admin **restringir** um usuário individual (ex: gerente sem acesso a financeiro).
- Array vazio = bloqueia tudo. Não definir `customPermissions` = usa role.
- `"all"` é wildcard em ambos os caminhos.

## Onde é aplicado

| Lugar | Como |
|---|---|
| Sidebar `navItems` (App.jsx:11679) | Filtra itens via `hasPermission` |
| Settings gate (App.jsx:11681) | `user.role === "admin" \|\| hasPermission(user, "config")` |
| Render do `Dashboard` (12201) | Verifica activeModule (módulo já passou pelo filtro) |
| Tecnico shell | Decisão **antes** do gating: `role === "tecnico"` → renderiza `TecnicoMobileApp` direto (não passa pelo navItems do ERP) |

## Master tier ≠ ROLE_PERMISSIONS

`MasterApp` e `MasterLoginScreen` operam em namespace separado (`master:user:*`, `is_super_admin` em `company_members`). **Não compartilham** `ROLE_PERMISSIONS`. Master é orthogonal: pode existir sem ser membro de nenhuma company, e gerencia tenants.

## customPermissions vem do quê?

- `UserManagement` (App.jsx:9446 — sub-painel de Settings) atribui no cadastro/edição de usuário
- Persiste em `erp:user:<id>.customPermissions` (array de strings ou undefined)
- `company_members.custom_permissions` (Supabase) é a versão remota — sincronizada via `_afterAuth`

## Padrões / armadilhas

- **Nunca `if (user.role === "admin")`** direto em código novo. Use `hasPermission(user, "config")`. Exceção: o gate de Settings já faz comparação direta — não inventou regra nova, replicou padrão existente.
- **`tecnico` no `ROLE_PERMISSIONS` lista módulos do ERP** (dashboard, os, agenda) por **legado** — na prática o role nunca chega no shell que usa esses gates. Não remover ainda (defense in depth caso shell mude).
- **`customPermissions: []` ≠ ausência**. `Array.isArray([])` é true → bloqueia tudo. Bug fácil: setar `[]` por engano em vez de `undefined`/delete.
- Permission key strings são case-sensitive: `"OS"` ≠ `"os"`. Sempre lowercase.

## Lacunas

- [a expandir] Mapeamento exato de `clientes` permission → o que o usuário vê dentro de Cadastro (todas as tabs ou só clientes?)
- [a expandir] Sub-permissions (ex: ler vs escrever) não existem hoje — feature potencial
