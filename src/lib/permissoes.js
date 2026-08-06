// Permissões de módulo por usuário.
//
// Extraído do App.jsx para ganhar teste: a regra decide o que cada pessoa vê no
// sistema, e um erro aqui some com módulo inteiro sem gerar erro nenhum.
//
// ─── Por que existe `permissionsKnownModules` ────────────────────────────────
// `customPermissions` é a lista de módulos liberados individualmente para o
// usuário (sobrescreve o papel). O problema: ela era ABSOLUTA. Um módulo criado
// DEPOIS do último save do admin nunca estava na lista, então nascia invisível
// para todo mundo que tivesse permissão customizada — e ninguém percebia, porque
// não há erro: o item simplesmente não aparece na sidebar.
//
// A correção guarda, junto da lista, quais módulos EXISTIAM quando o admin
// salvou (`permissionsKnownModules`). Com isso dá para distinguir:
//   • ausente da lista, presente no snapshot  → o admin tirou de propósito. Nega.
//   • ausente da lista, ausente do snapshot   → módulo novo. Cai no papel.
// Registro antigo (sem snapshot) mantém o comportamento estrito de antes — não
// afrouxa restrição existente sozinho; passa a valer no próximo save.

import { ROLE_PERMISSIONS } from "../constants.js";

// Permissão que vem só do papel (admin tem "all").
export function papelPermite(role, moduleId) {
  const perms = ROLE_PERMISSIONS[role] || [];
  return perms.includes("all") || perms.includes(moduleId);
}

export function hasPermission(user, moduleId) {
  if (!user || !user.role || !moduleId) return false;

  const custom = user.customPermissions;
  if (!Array.isArray(custom)) return papelPermite(user.role, moduleId);

  if (custom.includes("all") || custom.includes(moduleId)) return true;

  const conhecidos = user.permissionsKnownModules;
  // Módulo que ainda não existia no último save: decide pelo papel, em vez de
  // sumir em silêncio.
  if (Array.isArray(conhecidos) && !conhecidos.includes(moduleId)) {
    return papelPermite(user.role, moduleId);
  }

  return false;
}

// Monta o par (lista salva, snapshot dos módulos conhecidos) na hora de gravar o
// usuário. `modulosAtuais` são os ids de ALL_MODULES no momento do save.
export function montarPermissoesSalvas({ usarCustom, selecionados, modulosAtuais }) {
  if (!usarCustom) {
    return { customPermissions: null, permissionsKnownModules: null };
  }
  const atuais = Array.isArray(modulosAtuais) ? modulosAtuais : [];
  const marcados = Array.isArray(selecionados) ? selecionados : [];
  return {
    // Guarda só ids que existem hoje — evita arrastar módulo aposentado
    // (ex.: "escola") para sempre dentro do registro.
    customPermissions: marcados.filter((id) => atuais.includes(id)),
    permissionsKnownModules: [...atuais],
  };
}

// Módulos que existem hoje e que o usuário herdaria do papel por serem novos
// (não estavam no snapshot). Serve para a UI avisar o admin em vez de deixá-lo
// descobrir por acidente.
export function modulosNovosDesdeOSave(user, modulosAtuais) {
  if (!user || !Array.isArray(user.customPermissions)) return [];
  const conhecidos = user.permissionsKnownModules;
  if (!Array.isArray(conhecidos)) return [];
  return (modulosAtuais || []).filter((id) => !conhecidos.includes(id));
}
