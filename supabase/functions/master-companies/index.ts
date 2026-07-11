// Edge Function: master-companies
// ─────────────────────────────────────────────────────────────────────────────
// Persistência server-side das empresas gerenciadas pelo Master.
//
// PROBLEMA QUE RESOLVE: até então, o MasterApp (App.jsx) criava empresas e o
// admin inicial apenas no window.storage local — `syncToSupabase` é no-op para o
// master (ele não tem company_id ativo) e o admin nunca era provisionado em
// auth.users. Consequência: a empresa/admin viviam só no navegador do master.
// Em outro dispositivo (ou após limpar cache) o login retornava "Usuário não
// encontrado" e a empresa sumia da lista. Esta função grava tudo de forma
// atômica no banco (companies + auth.users + company_members + kv_store).
//
// AUTENTICAÇÃO: o master não possui sessão Supabase Auth (JWT). Ele autentica
// via `master_users.session_token_hash`, emitido pela edge `master-login`. O
// cliente reenvia { masterId, sessionTokenHash } e comparamos (timing-safe)
// contra o hash persistido. Mesmo padrão da antiga RPC master_list_authenticated.
//
// Deploy: supabase functions deploy master-companies (verify_jwt = false — o
// master não tem JWT; a própria função é a fronteira de auth via token hash).
//
// Payload (POST JSON):
//   { action: "list" | "create" | "update" | "delete",
//     masterId: string, sessionTokenHash: string,
//     company?: {...}, admin?: { nome, email, senha } }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Comparação constante-tempo pra não vazar timing no match do token hash.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Valida força da senha do admin — mesmos critérios de admin-create-user /
// validatePasswordStrength (src/utils.js): 12+, maiúscula, minúscula, número,
// símbolo, sem espaço.
function passwordReasons(password: string): string[] {
  const reasons: string[] = [];
  if (password.length < 12) reasons.push("min_12_chars");
  if (!/[a-z]/.test(password)) reasons.push("missing_lowercase");
  if (!/[A-Z]/.test(password)) reasons.push("missing_uppercase");
  if (!/\d/.test(password)) reasons.push("missing_digit");
  if (!/[^\w\s]|_/.test(password)) reasons.push("missing_symbol");
  if (/\s/.test(password)) reasons.push("contains_whitespace");
  return reasons;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const action = String(body.action || "");
  const masterId = String(body.masterId || "");
  const sessionTokenHash = String(body.sessionTokenHash || "");
  if (!masterId || !sessionTokenHash) {
    return json({ ok: false, error: "unauthenticated" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── Autenticação do master via session_token_hash ─────────────────────────
  const { data: masterRow, error: masterErr } = await admin
    .from("master_users")
    .select("id, session_token_hash")
    .eq("id", masterId)
    .maybeSingle();
  if (masterErr) {
    console.error("master-companies master lookup:", masterErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }
  if (
    !masterRow ||
    !masterRow.session_token_hash ||
    !timingSafeEqual(String(masterRow.session_token_hash), sessionTokenHash)
  ) {
    return json({ ok: false, error: "invalid_session" }, 401);
  }

  // ─── LIST ──────────────────────────────────────────────────────────────────
  // Devolve os objetos ricos guardados em kv_store (erp:company:*) — é o que o
  // MasterApp renderiza (nome, cnpj, allowedModules, maxUsuarios, ativo, ...).
  if (action === "list") {
    const { data: rows, error } = await admin
      .from("kv_store")
      .select("value")
      .like("key", "erp:company:%");
    if (error) {
      console.error("master-companies list:", error.message);
      return json({ ok: false, error: "internal" }, 500);
    }
    const companies = (rows || []).map((r) => r.value).filter(Boolean);
    return json({ ok: true, companies });
  }

  // ─── CREATE ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const company = (body.company || {}) as Record<string, unknown>;
    const adminInfo = (body.admin || {}) as Record<string, unknown>;
    const companyId = String(company.id || "").trim();
    const companyNome = String(company.nome || "").trim();
    const adminNome = String(adminInfo.nome || "").trim();
    const adminEmail = String(adminInfo.email || "").trim().toLowerCase();
    const adminSenha = String(adminInfo.senha || "");
    const legacyUserId = String(adminInfo.legacyUserId || "").trim();
    const redirectTo = adminInfo.redirectTo ? String(adminInfo.redirectTo) : null;
    // Sem senha => convite por e-mail: o admin recebe link do Supabase e define
    // a própria senha (mais seguro; o master nunca vê/digita a senha).
    const inviteMode = !adminSenha;

    if (!companyId || !companyNome) return json({ ok: false, error: "missing_company" }, 400);
    if (!adminNome || !adminEmail) return json({ ok: false, error: "missing_admin" }, 400);
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(adminEmail)) return json({ ok: false, error: "invalid_email" }, 400);
    if (!inviteMode) {
      const reasons = passwordReasons(adminSenha);
      if (reasons.length > 0) return json({ ok: false, error: "weak_password", reasons }, 400);
    }

    // 1. companies (upsert idempotente por id)
    const { error: compErr } = await admin.from("companies").upsert({
      id: companyId,
      nome: companyNome,
      cnpj: company.cnpj ? String(company.cnpj) : null,
      telefone: company.telefone ? String(company.telefone) : null,
      email: company.email ? String(company.email) : null,
      logo_url: company.logoUrl ? String(company.logoUrl) : null,
      ativo: company.ativo === false ? false : true,
      metadata: {
        allowedModules: Array.isArray(company.allowedModules) ? company.allowedModules : null,
        maxUsuarios: typeof company.maxUsuarios === "number" ? company.maxUsuarios : 0,
        criadoPor: masterId,
      },
    }, { onConflict: "id" });
    if (compErr) {
      console.error("master-companies create company:", compErr.message);
      return json({ ok: false, error: compErr.message }, 500);
    }

    // 2. auth.users — admin inicial. Se já existir, retorna erro semântico.
    let authUserId = "";
    if (inviteMode) {
      // Convite: Supabase envia e-mail com link recovery; admin define a senha.
      const inviteOpts: Record<string, unknown> = {
        data: { nome: adminNome, role: "admin", legacy_user_id: legacyUserId },
      };
      if (redirectTo) inviteOpts.redirectTo = redirectTo;
      const { data: invited, error: inviteErr } = await admin.auth.admin
        .inviteUserByEmail(adminEmail, inviteOpts);
      if (inviteErr || !invited?.user) {
        const msg = inviteErr?.message || "invite_failed";
        if (/already been registered|already exists|duplicate/i.test(msg)) {
          return json({ ok: false, error: "email_exists" }, 409);
        }
        console.error("master-companies inviteUser:", msg);
        return json({ ok: false, error: msg }, 400);
      }
      authUserId = invited.user.id;
    } else {
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email: adminEmail,
        password: adminSenha,
        email_confirm: true,
        user_metadata: { nome: adminNome, role: "admin", legacy_user_id: legacyUserId },
      });
      if (createErr || !created?.user) {
        const msg = createErr?.message || "create_failed";
        // Email duplicado é o caso comum — devolve código tratável pela UI.
        if (/already been registered|already exists|duplicate/i.test(msg)) {
          return json({ ok: false, error: "email_exists" }, 409);
        }
        console.error("master-companies createUser:", msg);
        return json({ ok: false, error: msg }, 400);
      }
      authUserId = created.user.id;
    }

    // 3. company_members — vincula admin ao tenant como super admin.
    //    Convite entra 'pendente' (promovido a 'ativo' no 1º login via
    //    promote_self_member_to_ativo); senha direta já entra 'ativo'.
    const memberStatus = inviteMode ? "pendente" : "ativo";
    const { error: memberErr } = await admin.from("company_members").upsert({
      user_id: authUserId,
      company_id: companyId,
      role: "admin",
      is_super_admin: true,
      legacy_user_id: legacyUserId || null,
      custom_permissions: null,
      status: memberStatus,
      nome: adminNome,
      avatar: adminNome.slice(0, 2).toUpperCase(),
    }, { onConflict: "user_id,company_id" });
    if (memberErr) {
      console.error("master-companies upsert member:", memberErr.message);
      // Rollback do auth user pra não deixar órfão.
      await admin.auth.admin.deleteUser(authUserId).catch(() => {});
      return json({ ok: false, error: memberErr.message }, 500);
    }

    // 4. kv_store — fonte de verdade do app. erp:company:* (objeto rico) +
    //    erp:user:* (sem segredos — password fica só no auth.users).
    const companyValue = { ...company, id: companyId, nome: companyNome, ativo: company.ativo === false ? false : true };
    const userValue = {
      id: legacyUserId || authUserId,
      email: adminEmail,
      nome: adminNome,
      role: "admin",
      avatar: adminNome.slice(0, 2).toUpperCase(),
      status: memberStatus,
      isSuperAdmin: true,
      companyId,
      authUserId,
      createdAt: new Date().toISOString(),
      ...(inviteMode ? { invitedAt: new Date().toISOString() } : {}),
    };
    const nowIso = new Date().toISOString();
    const { error: kvErr } = await admin.from("kv_store").upsert([
      { key: `erp:company:${companyId}`, value: companyValue, company_id: companyId, updated_at: nowIso },
      { key: `erp:user:${userValue.id}`, value: userValue, company_id: companyId, updated_at: nowIso },
    ], { onConflict: "key" });
    if (kvErr) {
      console.error("master-companies kv upsert:", kvErr.message);
      // Não faz rollback do auth/member — o login já funciona; kv é hidratável.
      return json({ ok: true, auth_user_id: authUserId, invited: inviteMode, warning: "kv_partial" });
    }

    return json({ ok: true, auth_user_id: authUserId, invited: inviteMode });
  }

  // ─── UPDATE ────────────────────────────────────────────────────────────────
  // Edição de dados da empresa e/ou bloqueio (ativo). Não mexe no admin.
  if (action === "update") {
    const company = (body.company || {}) as Record<string, unknown>;
    const companyId = String(company.id || "").trim();
    if (!companyId) return json({ ok: false, error: "missing_company" }, 400);

    const patch: Record<string, unknown> = { atualizado_em: new Date().toISOString() };
    if (company.nome !== undefined) patch.nome = String(company.nome);
    if (company.cnpj !== undefined) patch.cnpj = company.cnpj ? String(company.cnpj) : null;
    if (company.telefone !== undefined) patch.telefone = company.telefone ? String(company.telefone) : null;
    if (company.email !== undefined) patch.email = company.email ? String(company.email) : null;
    if (company.logoUrl !== undefined) patch.logo_url = company.logoUrl ? String(company.logoUrl) : null;
    if (company.ativo !== undefined) patch.ativo = !!company.ativo;
    if (company.allowedModules !== undefined || company.maxUsuarios !== undefined) {
      patch.metadata = {
        allowedModules: Array.isArray(company.allowedModules) ? company.allowedModules : null,
        maxUsuarios: typeof company.maxUsuarios === "number" ? company.maxUsuarios : 0,
      };
    }
    const { error: compErr } = await admin.from("companies").update(patch).eq("id", companyId);
    if (compErr) {
      console.error("master-companies update company:", compErr.message);
      return json({ ok: false, error: compErr.message }, 500);
    }
    // kv_store: objeto rico completo (o cliente manda o objeto final).
    const { error: kvErr } = await admin.from("kv_store").upsert(
      { key: `erp:company:${companyId}`, value: company, company_id: companyId, updated_at: new Date().toISOString() },
      { onConflict: "key" },
    );
    if (kvErr) console.error("master-companies update kv:", kvErr.message);
    return json({ ok: true });
  }

  // ─── DELETE ────────────────────────────────────────────────────────────────
  // Exclusão em cascata: kv_store (todas as chaves da empresa) + company_members
  // + auth.users dos membros + companies.
  if (action === "delete") {
    const company = (body.company || {}) as Record<string, unknown>;
    const companyId = String(company.id || "").trim();
    if (!companyId) return json({ ok: false, error: "missing_company" }, 400);

    // Remove auth.users dos membros antes de apagar company_members (FK).
    const { data: members } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId);
    for (const m of members || []) {
      if (m?.user_id) await admin.auth.admin.deleteUser(String(m.user_id)).catch(() => {});
    }
    await admin.from("company_members").delete().eq("company_id", companyId);
    // kv_store por company_id (FK aponta pra companies — apagar antes da company).
    await admin.from("kv_store").delete().eq("company_id", companyId);
    const { error: compErr } = await admin.from("companies").delete().eq("id", companyId);
    if (compErr) {
      console.error("master-companies delete company:", compErr.message);
      return json({ ok: false, error: compErr.message }, 500);
    }
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
