// Edge Function: admin-remove-user-mfa
// ─────────────────────────────────────────────────────────────────────────────
// Permite admin/gerente da empresa apagar TODOS os fatores MFA de um usuário
// da mesma company. Usado quando técnico perde acesso ao app autenticador.
// Cliente não pode chamar auth.admin.mfa.deleteFactor direto — precisa
// service_role.
//
// Deploy: supabase functions deploy admin-remove-user-mfa
//
// Auth: verify_jwt = true. Caller precisa estar logado.
//
// Payload (POST JSON):
//   { user_id: string }  // auth.users.id do alvo

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

  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !callerData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const callerId = callerData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const targetUserId = String(body.user_id || "").trim();
  if (!targetUserId) return json({ ok: false, error: "missing_user_id" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Carrega ambos members em uma query (caller + target). Confirma:
  // - caller é admin/gerente OU is_super_admin
  // - target é membro da mesma company do caller
  // - caller != target (não pode resetar próprio MFA por essa rota)
  if (callerId === targetUserId) {
    return json({ ok: false, error: "use_unenroll_for_self" }, 400);
  }

  const { data: callerMember, error: callerMemberErr } = await admin
    .from("company_members")
    .select("user_id, company_id, role, is_super_admin")
    .eq("user_id", callerId)
    .maybeSingle();
  if (callerMemberErr || !callerMember) {
    return json({ ok: false, error: "forbidden_no_member" }, 403);
  }
  if (!callerMember.is_super_admin && !["admin", "gerente"].includes(callerMember.role)) {
    return json({ ok: false, error: "forbidden_role" }, 403);
  }

  const { data: targetMember, error: targetMemberErr } = await admin
    .from("company_members")
    .select("user_id, company_id")
    .eq("user_id", targetUserId)
    .maybeSingle();
  if (targetMemberErr || !targetMember) {
    return json({ ok: false, error: "target_not_member" }, 404);
  }
  if (targetMember.company_id !== callerMember.company_id && !callerMember.is_super_admin) {
    return json({ ok: false, error: "forbidden_other_company" }, 403);
  }

  // Lista factors MFA do target e deleta todos
  const { data: factorsData, error: listErr } = await admin.auth.admin.mfa
    .listFactors({ userId: targetUserId });
  if (listErr) {
    console.error("admin-remove-user-mfa list:", listErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }

  const factors = factorsData?.factors || [];
  let removed = 0;
  for (const f of factors) {
    const { error: delErr } = await admin.auth.admin.mfa.deleteFactor({
      userId: targetUserId,
      id: f.id,
    });
    if (delErr) {
      console.error("admin-remove-user-mfa delete:", f.id, delErr.message);
      continue;
    }
    removed++;
  }

  return json({ ok: true, removed });
});
