// Edge Function: first-login-otp-verify
// ─────────────────────────────────────────────────────────────────────────────
// Valida código OTP de 6 dígitos enviado por first-login-otp-send. Sucesso:
// marca company_members.first_login_otp_done=true. Após 5 tentativas erradas,
// invalida o OTP e exige reenvio.
//
// Deploy: supabase functions deploy first-login-otp-verify
//
// Auth: verify_jwt = true.
//
// Payload (POST JSON):
//   { code: "123456" }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MAX_ATTEMPTS = 5;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
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
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const code = String(body.code || "").trim();
  if (!/^\d{6}$/.test(code)) return json({ ok: false, error: "invalid_format" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Busca OTP ativo (não consumido, não expirado) mais recente
  const nowIso = new Date().toISOString();
  const { data: otps, error: otpErr } = await admin
    .from("email_otps")
    .select("id, code_hash, attempts, expires_at, company_id")
    .eq("user_id", userId)
    .eq("purpose", "first_login")
    .is("consumed_at", null)
    .gt("expires_at", nowIso)
    .order("created_at", { ascending: false })
    .limit(1);
  if (otpErr) {
    console.error("first-login-otp-verify select:", otpErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }
  if (!otps || otps.length === 0) {
    return json({ ok: false, error: "no_active_otp" }, 400);
  }
  const otp = otps[0];

  // Incrementa attempts antes de comparar (evita atacante interromper request
  // pra zerar contador)
  const newAttempts = (otp.attempts || 0) + 1;
  const isMatch = (await sha256Hex(code)) === otp.code_hash;

  if (!isMatch) {
    if (newAttempts >= MAX_ATTEMPTS) {
      // Esgota OTP — força reenvio
      await admin
        .from("email_otps")
        .update({ attempts: newAttempts, consumed_at: nowIso })
        .eq("id", otp.id);
      return json({ ok: false, error: "max_attempts", locked: true }, 429);
    }
    await admin
      .from("email_otps")
      .update({ attempts: newAttempts })
      .eq("id", otp.id);
    return json({
      ok: false,
      error: "invalid_code",
      attempts_left: MAX_ATTEMPTS - newAttempts,
    }, 400);
  }

  // Sucesso: consome OTP + promove member
  await admin
    .from("email_otps")
    .update({ attempts: newAttempts, consumed_at: nowIso })
    .eq("id", otp.id);
  const { error: memberUpdErr } = await admin
    .from("company_members")
    .update({ first_login_otp_done: true })
    .eq("user_id", userId)
    .eq("company_id", otp.company_id);
  if (memberUpdErr) {
    console.error("first-login-otp-verify member update:", memberUpdErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }

  return json({ ok: true });
});
