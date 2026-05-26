// Edge Function: admin-create-user
// ─────────────────────────────────────────────────────────────────────────────
// Cria (ou atualiza senha de) usuário da empresa: provisiona em auth.users +
// company_members usando service_role. O caller precisa estar autenticado e
// ter role admin/gerente na mesma company_id alvo.
//
// Por que existe: o cliente não pode chamar auth.admin.createUser, e usar
// supabase.auth.signUp invalidaria a sessão do admin atual. Essa function
// faz o provisionamento atômico do auth.users + company_members em um único
// lugar com permissão checada.
//
// Deploy:
//   supabase functions deploy admin-create-user
//   (verify_jwt = true por padrão — caller precisa enviar Authorization Bearer)
//
// Variáveis de ambiente esperadas (já presentes no Supabase Edge runtime):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY
//
// Payload (POST JSON):
//   {
//     mode: "create" | "update_password" | "invite",
//     legacy_user_id: string,        // id do erp:user no kv_store
//     email: string,
//     password: string,              // ignorado em mode=invite
//     nome: string,
//     role: "admin" | "gerente" | "tecnico" | "atendente",
//     company_id: string,            // empresa alvo
//     custom_permissions: string[] | null,
//     comissao_percentual: number | null,
//     avatar: string | null,
//     redirect_to: string | null     // só usado em mode=invite (URL pra qual o email aponta)
//   }

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // Valida JWT do caller (admin/gerente atual)
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !callerData?.user) {
    return json({ ok: false, error: "invalid_token" }, 401);
  }
  const callerId = callerData.user.id;

  // Body
  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const mode = String(body.mode || "create");
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  const nome = String(body.nome || "").trim();
  const role = String(body.role || "atendente");
  const companyId = String(body.company_id || "");
  const legacyUserId = String(body.legacy_user_id || "");
  const customPermissions = Array.isArray(body.custom_permissions)
    ? body.custom_permissions as string[]
    : null;
  const comissaoPercentual = body.comissao_percentual === null || body.comissao_percentual === undefined
    ? null
    : Number(body.comissao_percentual);
  const avatar = body.avatar ? String(body.avatar) : null;
  const redirectTo = body.redirect_to ? String(body.redirect_to) : null;

  if (!email || !companyId) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  // Convite não precisa de senha; create/update_password precisam.
  // Critérios alinhados com validatePasswordStrength do client (src/utils.js):
  // 12+ chars, maiúscula, minúscula, número, símbolo, sem espaço. Antes só
  // checava length>=8, permitindo admin bypassar validação da UI.
  if (mode !== "invite") {
    if (!password) return json({ ok: false, error: "missing_fields" }, 400);
    const reasons: string[] = [];
    if (password.length < 12) reasons.push("min_12_chars");
    if (!/[a-z]/.test(password)) reasons.push("missing_lowercase");
    if (!/[A-Z]/.test(password)) reasons.push("missing_uppercase");
    if (!/\d/.test(password)) reasons.push("missing_digit");
    if (!/[^\w\s]|_/.test(password)) reasons.push("missing_symbol");
    if (/\s/.test(password)) reasons.push("contains_whitespace");
    if (reasons.length > 0) {
      return json({ ok: false, error: "weak_password", reasons }, 400);
    }
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Verifica que caller é admin/gerente da company alvo
  const { data: callerMember, error: callerMemberErr } = await admin
    .from("company_members")
    .select("user_id, company_id, role, is_super_admin")
    .eq("user_id", callerId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (callerMemberErr) {
    console.error("admin-create-user caller member:", callerMemberErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }
  if (!callerMember) {
    return json({ ok: false, error: "forbidden_not_member" }, 403);
  }
  if (!callerMember.is_super_admin && !["admin", "gerente"].includes(callerMember.role)) {
    return json({ ok: false, error: "forbidden_role" }, 403);
  }

  if (mode === "update_password") {
    // Procura auth user pelo email paginando todas as páginas — paginação fixa
    // em 200 quebrava em empresas com 201+ users (target sumia além da página 1).
    const PER_PAGE = 200;
    let target: { id: string; email: string | null } | undefined;
    for (let page = 1; page <= 50 && !target; page++) {
      const { data: existingUser, error: lookupErr } = await admin.auth.admin
        .listUsers({ page, perPage: PER_PAGE });
      if (lookupErr) {
        console.error("admin-create-user listUsers:", lookupErr.message);
        return json({ ok: false, error: "internal" }, 500);
      }
      const users = existingUser?.users || [];
      target = users.find((u) => (u.email || "").toLowerCase() === email);
      if (users.length < PER_PAGE) break;
    }
    if (!target) {
      return json({ ok: false, error: "auth_user_not_found" }, 404);
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(target.id, { password });
    if (updErr) {
      console.error("admin-create-user updateUser:", updErr.message);
      return json({ ok: false, error: updErr.message }, 400);
    }
    return json({ ok: true, auth_user_id: target.id });
  }

  // mode === "create" | "invite"
  // 1. Cria user em auth.users.
  //    - create: senha definida pelo admin, email já confirmado.
  //    - invite: sem senha; Supabase manda email com link recovery pro técnico
  //      definir própria senha (mais seguro — admin nunca vê senha do convidado).
  let newAuthUserId: string;
  if (mode === "invite") {
    const inviteOpts: Record<string, unknown> = {
      data: { nome, role, legacy_user_id: legacyUserId },
    };
    if (redirectTo) inviteOpts.redirectTo = redirectTo;
    const { data: invited, error: inviteErr } = await admin.auth.admin
      .inviteUserByEmail(email, inviteOpts);
    if (inviteErr || !invited?.user) {
      console.error("admin-create-user inviteUser:", inviteErr?.message);
      return json({ ok: false, error: inviteErr?.message || "invite_failed" }, 400);
    }
    newAuthUserId = invited.user.id;
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { nome, role, legacy_user_id: legacyUserId },
    });
    if (createErr || !created?.user) {
      console.error("admin-create-user createUser:", createErr?.message);
      return json({ ok: false, error: createErr?.message || "create_failed" }, 400);
    }
    newAuthUserId = created.user.id;
  }

  // 2. Cria company_members vinculando ao tenant.
  //    Convidados ficam status='pendente' até aceitar (definir senha pelo email).
  //    Helper SQL update_member_active_on_signin (ou trigger client-side) promove
  //    pra 'ativo' no primeiro login bem-sucedido.
  const memberRow = {
    user_id: newAuthUserId,
    company_id: companyId,
    role,
    is_super_admin: false,
    legacy_user_id: legacyUserId || null,
    custom_permissions: customPermissions,
    status: mode === "invite" ? "pendente" : "ativo",
    nome,
    avatar,
    comissao_percentual: comissaoPercentual,
  };
  const { error: memberErr } = await admin
    .from("company_members")
    .upsert(memberRow, { onConflict: "user_id,company_id" });
  if (memberErr) {
    console.error("admin-create-user upsert member:", memberErr.message);
    // Rollback: remove auth user para evitar órfão
    await admin.auth.admin.deleteUser(newAuthUserId).catch(() => {});
    return json({ ok: false, error: memberErr.message }, 500);
  }

  return json({ ok: true, auth_user_id: newAuthUserId });
});
