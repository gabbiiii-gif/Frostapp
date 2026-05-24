// Edge Function: send-email
// ─────────────────────────────────────────────────────────────────────────────
// Helper compartilhado: envia email via Resend API. Não é exposto direto ao
// cliente — outras edge functions (com service_role) chamam essa função pra
// centralizar o envio (template, sender, retry, observabilidade num só lugar).
//
// Por que existe: evitar duplicar fetch pra api.resend.com em toda edge function
// que precisa mandar email (OTP, notificações de OS, etc.).
//
// Deploy:
//   supabase functions deploy send-email --no-verify-jwt
//   supabase secrets set RESEND_API_KEY=re_xxx
//
// Auth: verify_jwt = false. Esta função é chamada server-side por outras edge
// functions (que validam JWT do caller antes). Não há endpoint público
// permitido — checa cabeçalho x-internal-secret pra evitar abuso externo.
//
// Payload (POST JSON):
//   {
//     to: string | string[],
//     subject: string,
//     html: string,
//     text?: string,
//     from?: string  // opcional, default noreply@app.frosterp.com.br
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const DEFAULT_FROM = "FrostERP <noreply@app.frosterp.com.br>";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET");
  if (!RESEND_API_KEY) return json({ ok: false, error: "resend_not_configured" }, 500);

  // Anti-abuso: cabeçalho compartilhado entre edge functions internas.
  // Se INTERNAL_FUNCTION_SECRET estiver setado, exige match. Se não estiver,
  // aceita qualquer chamador (modo dev — recomendado configurar em prod).
  if (INTERNAL_SECRET) {
    const sent = req.headers.get("x-internal-secret") || "";
    if (sent !== INTERNAL_SECRET) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const to = body.to;
  const subject = String(body.subject || "").trim();
  const html = String(body.html || "").trim();
  const text = body.text ? String(body.text) : undefined;
  const from = body.from ? String(body.from) : DEFAULT_FROM;

  if (!to || !subject || !html) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const payload: Record<string, unknown> = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
  };
  if (text) payload.text = text;

  try {
    const resp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify(payload),
    });
    const respBody = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("send-email resend error:", resp.status, respBody);
      return json({ ok: false, error: respBody?.message || `resend_${resp.status}` }, 502);
    }
    return json({ ok: true, id: respBody?.id || null });
  } catch (err) {
    console.error("send-email exception:", (err as Error).message);
    return json({ ok: false, error: "network_error" }, 502);
  }
});
