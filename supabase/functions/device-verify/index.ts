// Edge Function: device-verify (verify_jwt = true)
// Aplica no servidor as MESMAS regras de src/lib/device-policy.js e, quando o
// aparelho está aprovado, emite uma device_session curta (base do RLS na Fase 3).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const SESSION_TTL_MIN = 15;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const deviceUuid = String(body.device_uuid || "").trim();
  if (!deviceUuid) return json({ ok: false, error: "invalid_device" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: devices } = await admin
    .from("member_devices")
    .select("id, device_uuid, status")
    .eq("member_user_id", userId);

  // Regras espelhadas de src/lib/device-policy.js
  const list = devices || [];
  const approved = list.find((d) => d.status === "approved");
  let status = "needs_enroll";
  let deviceId: string | null = null;
  if (approved) {
    if (approved.device_uuid === deviceUuid) { status = "approved"; deviceId = approved.id; }
    else { status = "denied"; deviceId = approved.id; }
  } else {
    const thisDev = list.find((d) => d.device_uuid === deviceUuid);
    if (!thisDev) status = "needs_enroll";
    else if (thisDev.status === "pending") { status = "pending"; deviceId = thisDev.id; }
    else { status = "denied"; deviceId = thisDev.id; }
  }

  if (status === "approved" && deviceId) {
    const expires = new Date(Date.now() + SESSION_TTL_MIN * 60_000).toISOString();
    await admin.from("device_sessions").insert({ member_user_id: userId, device_id: deviceId, expires_at: expires });
  }

  return json({ ok: true, status });
});
