// Edge Function: frost-handoff
// ─────────────────────────────────────────────────────────────────────────────
// Tool exposta ao agent Claude: marca conversa como 'handoff' (atendimento
// humano) e notifica admin/gerente por email. Frost para de responder até
// admin reabrir manualmente.
//
// Deploy: supabase functions deploy frost-handoff --no-verify-jwt
//
// Payload (POST JSON):
//   {
//     company_id: string,
//     conversation_id: string,
//     reason: string,             // motivo do handoff (livre)
//     customer_phone?: string     // pra contexto no email
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-internal-secret",
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
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  // FAIL-CLOSED: exige x-internal-secret SEMPRE (fecha contra chamadas anonimas).
  {
    const sent = req.headers.get("x-internal-secret") || "";
    if (!INTERNAL_SECRET || sent !== INTERNAL_SECRET) return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const companyId = String(body.company_id || "").trim();
  const conversationId = String(body.conversation_id || "").trim();
  const reason = String(body.reason || "Solicitação genérica de transferência").trim();
  const customerPhone = body.customer_phone ? String(body.customer_phone) : "";

  if (!companyId || !conversationId) return json({ ok: false, error: "missing_fields" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Marca conversa como handoff
  const { data: conv, error: updErr } = await admin
    .from("ai_conversations")
    .update({ status: "handoff", ai_handoff_reason: reason })
    .eq("id", conversationId)
    .eq("company_id", companyId)
    .select("customer_name, customer_phone")
    .maybeSingle();
  if (updErr) {
    console.error("frost-handoff update:", updErr.message);
    return json({ ok: false, error: updErr.message }, 500);
  }

  // Notifica admin/gerente (fire-and-forget)
  (async () => {
    const { data: gestores } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .in("role", ["admin", "gerente"])
      .eq("status", "ativo");
    const ids = (gestores || []).map((g: { user_id: string }) => g.user_id);
    if (ids.length === 0) return;
    const emails: string[] = [];
    for (const uid of ids) {
      const { data, error } = await admin.auth.admin.getUserById(uid);
      if (!error && data?.user?.email) emails.push(data.user.email);
    }
    if (emails.length === 0) return;

    const phone = customerPhone || conv?.customer_phone || "—";
    const nome = conv?.customer_name || "Cliente";
    const html = `
      <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
        <h2 style="color: #dc2626;">🙋 Cliente pedindo atendimento humano</h2>
        <p>O Frost transferiu uma conversa pra você.</p>
        <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
          <tr><td style="padding:6px 0; color:#6b7280;">Cliente</td><td><strong>${nome}</strong></td></tr>
          <tr><td style="padding:6px 0; color:#6b7280;">Telefone</td><td>${phone}</td></tr>
          <tr><td style="padding:6px 0; color:#6b7280;">Motivo</td><td>${reason}</td></tr>
        </table>
        <p style="color:#6b7280; font-size:13px;">Abra o FrostERP → Conversas IA pra responder.</p>
      </div>
    `;

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
      // ANON_KEY no Authorization: o gateway rejeita (401) o token service_role
      // na chamada entre Edge Functions. Auth real é o x-internal-secret abaixo.
      Authorization: `Bearer ${ANON_KEY}`,
    };
    if (INTERNAL_SECRET) headers["x-internal-secret"] = INTERNAL_SECRET;

    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          to: emails,
          subject: `[Frost] Cliente pedindo humano — ${nome}`,
          html,
          text: `Frost transferiu conversa pra humano. Cliente: ${nome}, telefone ${phone}. Motivo: ${reason}.`,
        }),
      });
    } catch (err) {
      console.error("frost-handoff notify:", (err as Error).message);
    }
  })().catch((err) => console.error("frost-handoff notify outer:", err?.message));

  return json({ ok: true });
});
