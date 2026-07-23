// Edge Function: device-challenge (verify_jwt = true)
// Emite um nonce (desafio) anti-replay para enroll/verify de aparelho via WebAuthn.
// O nonce é guardado em device_challenges (uso único, expira em 5 min).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
// base64url de bytes aleatórios (formato do challenge WebAuthn).
function randomChallenge(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let str = "";
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

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
  const purpose = body.purpose === "enroll" ? "enroll" : "verify";

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const nonce = randomChallenge();
  const expires = new Date(Date.now() + 5 * 60_000).toISOString();
  const { error } = await admin.from("device_challenges").insert({
    member_user_id: userId, nonce, purpose, expires_at: expires,
  });
  if (error) { console.error("device-challenge insert:", error.message); return json({ ok: false, error: "internal" }, 500); }

  // Para verify: informa o credentialId (público) do aparelho aprovado, para o
  // cliente montar o allowCredentials do WebAuthn.
  let webauthnCredentialId: string | null = null;
  if (purpose === "verify") {
    const { data: dev } = await admin.from("member_devices")
      .select("credential_id").eq("member_user_id", userId).eq("status", "approved").maybeSingle();
    webauthnCredentialId = (dev?.credential_id as string) || null;
  }

  return json({ ok: true, challenge: nonce, purpose, webauthn_credential_id: webauthnCredentialId });
});
