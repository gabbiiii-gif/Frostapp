// Edge Function: first-login-otp-send
// ─────────────────────────────────────────────────────────────────────────────
// Gera código OTP de 6 dígitos e envia por email no primeiro login do usuário.
// Só dispara se a empresa do caller tiver require_first_login_otp=true E o
// próprio member ainda não tiver first_login_otp_done=true.
//
// Deploy: supabase functions deploy first-login-otp-send
//
// Auth: verify_jwt = true. O caller já passou pela autenticação por senha em
// signInWithPassword. Esta função roda no passo intermediário antes de liberar
// acesso ao dashboard.
//
// Payload: vazio. Tudo é deduzido do JWT.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const COOLDOWN_SECONDS = 60;
const VALID_MINUTES = 10;

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

function generateOTP(): string {
  // 6 dígitos via getRandomValues (range 100000-999999 sem viés
  // significativo — 9e5 dentro de 16-bit range é OK pra esse uso).
  const arr = new Uint32Array(1);
  crypto.getRandomValues(arr);
  return String(100000 + (arr[0] % 900000));
}

function otpEmailHtml(code: string, nome: string): string {
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 480px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="color: #1e40af; margin-bottom: 8px;">Código de verificação</h2>
      <p>Olá${nome ? `, <strong>${nome}</strong>` : ""}!</p>
      <p>Use o código abaixo pra concluir seu primeiro login no FrostERP:</p>
      <div style="background:#eff6ff; border:1px solid #bfdbfe; border-radius:12px; padding:24px; text-align:center; font-size:32px; font-weight:bold; letter-spacing:8px; color:#1e3a8a; margin:24px 0;">
        ${code}
      </div>
      <p style="color:#6b7280; font-size:14px;">
        O código é válido por <strong>${VALID_MINUTES} minutos</strong>.
        Se você não tentou fazer login, ignore este email e troque sua senha
        imediatamente.
      </p>
    </div>
  `;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
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
  const email = userData.user.email || "";
  const nome = (userData.user.user_metadata?.nome as string) || "";

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Carrega member + company para checar se OTP é exigido
  const { data: member, error: memberErr } = await admin
    .from("company_members")
    .select("user_id, company_id, first_login_otp_done")
    .eq("user_id", userId)
    .maybeSingle();
  if (memberErr || !member) {
    return json({ ok: false, error: "no_member" }, 404);
  }
  if (member.first_login_otp_done) {
    return json({ ok: false, error: "already_verified" }, 400);
  }
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .select("id, require_first_login_otp")
    .eq("id", member.company_id)
    .maybeSingle();
  if (companyErr || !company) {
    return json({ ok: false, error: "no_company" }, 404);
  }
  if (!company.require_first_login_otp) {
    return json({ ok: false, error: "otp_not_required" }, 400);
  }

  // Cooldown: bloqueia se já enviou OTP nos últimos COOLDOWN_SECONDS
  const cooldownCutoff = new Date(Date.now() - COOLDOWN_SECONDS * 1000).toISOString();
  const { data: recent } = await admin
    .from("email_otps")
    .select("created_at")
    .eq("user_id", userId)
    .eq("purpose", "first_login")
    .gte("created_at", cooldownCutoff)
    .order("created_at", { ascending: false })
    .limit(1);
  if (recent && recent.length > 0) {
    const elapsed = (Date.now() - new Date(recent[0].created_at).getTime()) / 1000;
    return json({
      ok: false,
      error: "cooldown",
      retry_in: Math.max(1, Math.ceil(COOLDOWN_SECONDS - elapsed)),
    }, 429);
  }

  // Invalida OTPs ativos anteriores (idempotência: só 1 OTP válido por vez)
  await admin
    .from("email_otps")
    .update({ consumed_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("purpose", "first_login")
    .is("consumed_at", null);

  // Gera código + hash + persiste
  const code = generateOTP();
  const codeHash = await sha256Hex(code);
  const expiresAt = new Date(Date.now() + VALID_MINUTES * 60 * 1000).toISOString();

  const { error: insertErr } = await admin.from("email_otps").insert({
    user_id: userId,
    company_id: member.company_id,
    code_hash: codeHash,
    purpose: "first_login",
    expires_at: expiresAt,
  });
  if (insertErr) {
    console.error("first-login-otp-send insert:", insertErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }

  // Envia email via helper send-email (server-to-server)
  const emailHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    Authorization: `Bearer ${SERVICE_KEY}`,
  };
  if (INTERNAL_SECRET) emailHeaders["x-internal-secret"] = INTERNAL_SECRET;

  try {
    const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: emailHeaders,
      body: JSON.stringify({
        to: email,
        subject: "Seu código de verificação - FrostERP",
        html: otpEmailHtml(code, nome),
        text: `Seu código de verificação FrostERP é: ${code} (válido por ${VALID_MINUTES} minutos)`,
      }),
    });
    const respBody = await resp.json().catch(() => ({}));
    if (!resp.ok || !respBody.ok) {
      console.error("first-login-otp-send email failed:", respBody);
      return json({ ok: false, error: respBody?.error || "email_failed" }, 502);
    }
  } catch (err) {
    console.error("first-login-otp-send email exception:", (err as Error).message);
    return json({ ok: false, error: "email_failed" }, 502);
  }

  return json({ ok: true, expires_at: expiresAt });
});
