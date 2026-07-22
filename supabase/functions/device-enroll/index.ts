// Edge Function: device-enroll (verify_jwt = true)
// Registra o aparelho atual do membro autenticado como 'pending' (se ainda não
// existir). Idempotente por (member_user_id, device_uuid). Não aprova nada — a
// aprovação é exclusiva do superadmin (edge master-devices).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  // Identifica o caller pelo JWT.
  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const deviceUuid = String(body.device_uuid || "").trim();
  const platform = String(body.platform || "").trim();
  const fingerprint = (body.fingerprint && typeof body.fingerprint === "object") ? body.fingerprint : {};
  if (!deviceUuid || !["android", "web", "ios"].includes(platform)) {
    return json({ ok: false, error: "invalid_device" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Descobre a company_id do membro.
  const { data: member } = await admin
    .from("company_members").select("company_id").eq("user_id", userId).maybeSingle();
  if (!member?.company_id) return json({ ok: false, error: "no_membership" }, 403);

  // Já existe linha para (membro, device)? Preserva status; senão cria pending.
  const { data: existing } = await admin
    .from("member_devices")
    .select("id, status")
    .eq("member_user_id", userId).eq("device_uuid", deviceUuid).maybeSingle();

  if (existing) {
    // Atualiza fingerprint/plataforma para exibição; não altera status.
    await admin.from("member_devices")
      .update({ platform, fingerprint, updated_at: new Date().toISOString() })
      .eq("id", existing.id);
    return json({ ok: true, status: existing.status, device_id: existing.id });
  }

  const { data: inserted, error: insErr } = await admin.from("member_devices").insert({
    company_id: member.company_id,
    member_user_id: userId,
    status: "pending",
    platform,
    device_uuid: deviceUuid,
    fingerprint,
  }).select("id").single();
  if (insErr) { console.error("device-enroll insert:", insErr.message); return json({ ok: false, error: "internal" }, 500); }

  return json({ ok: true, status: "pending", device_id: inserted.id });
});
