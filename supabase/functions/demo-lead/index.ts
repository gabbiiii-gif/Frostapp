// Edge Function: demo-lead (verify_jwt = false — chamada pública da landing/demo)
// Registra o lead da demo interativa e (best-effort) notifica a equipe por email
// via a edge send-email (Resend) já existente. Isolado dos dados locais da demo.
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
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const nome = String(body.nome || "").trim().slice(0, 120);
  const whatsapp = String(body.whatsapp || "").trim().slice(0, 40);
  const email = String(body.email || "").trim().slice(0, 160);
  const userAgent = String(body.user_agent || "").slice(0, 300);
  // Nome + (WhatsApp OU email) obrigatórios.
  if (!nome || (!whatsapp && !email)) return json({ ok: false, error: "missing_fields" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { error } = await admin.from("demo_leads").insert({ nome, whatsapp, email, user_agent: userAgent });
  if (error) { console.error("demo-lead insert:", error.message); return json({ ok: false, error: "internal" }, 500); }

  // Notifica a equipe (best-effort). Reusa a edge send-email (Resend).
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` },
      body: JSON.stringify({
        to: "suportefrosterp@gmail.com",
        subject: `Novo lead da demo: ${nome}`,
        html: `<h2>Novo lead na demo do FrostERP</h2>`
          + `<p><b>Nome:</b> ${nome}</p>`
          + `<p><b>WhatsApp:</b> ${whatsapp || "-"}</p>`
          + `<p><b>Email:</b> ${email || "-"}</p>`,
      }),
    });
  } catch (_) { /* best-effort — não bloqueia o lead */ }

  return json({ ok: true });
});
