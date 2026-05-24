// Edge Function: frost-conversation
// ─────────────────────────────────────────────────────────────────────────────
// Get-or-create ai_conversation por (company_id, customer_phone). Chamado pelo
// n8n workflow principal antes de qualquer write em ai_messages, pra garantir
// que conversation_id seja real (não mais o UUID zerado da Fase 3).
//
// Também atualiza last_message_at (debounce: ver Fase 4 item E) e incrementa
// unread_count quando role=customer.
//
// Deploy: supabase functions deploy frost-conversation --no-verify-jwt
//
// Auth: verify_jwt = false. n8n usa apikey + service_role pra autenticar via
// HTTP header (sem JWT). Em produção, considerar INTERNAL_FUNCTION_SECRET
// pra blindar contra abuso externo.
//
// Payload (POST JSON):
//   {
//     company_id: string,
//     customer_phone: string,           // só dígitos
//     customer_name?: string,
//     role?: "customer" | "agent",       // se customer, incrementa unread_count
//     bump_last_message?: boolean        // default true
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
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  if (INTERNAL_SECRET) {
    const sent = req.headers.get("x-internal-secret") || "";
    if (sent !== INTERNAL_SECRET) return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const companyId = String(body.company_id || "").trim();
  const phone = String(body.customer_phone || "").replace(/\D/g, "");
  const customerName = body.customer_name ? String(body.customer_name) : null;
  const role = body.role === "agent" ? "agent" : "customer";
  const bump = body.bump_last_message !== false;

  if (!companyId || !phone) return json({ ok: false, error: "missing_fields" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Get latest active conversation for this phone+company. Se não houver, cria.
  const { data: existing, error: selErr } = await admin
    .from("ai_conversations")
    .select("id, status, customer_name, unread_count, last_message_at")
    .eq("company_id", companyId)
    .eq("customer_phone", phone)
    .order("last_message_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (selErr) {
    console.error("frost-conversation select:", selErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }

  let conversationId: string;
  let created = false;
  const nowIso = new Date().toISOString();

  if (existing && existing.status !== "closed") {
    conversationId = existing.id;
    if (bump) {
      const updates: Record<string, unknown> = { last_message_at: nowIso };
      if (role === "customer") updates.unread_count = (existing.unread_count || 0) + 1;
      if (customerName && !existing.customer_name) updates.customer_name = customerName;
      const { error: updErr } = await admin
        .from("ai_conversations")
        .update(updates)
        .eq("id", conversationId);
      if (updErr) {
        console.error("frost-conversation update:", updErr.message);
      }
    }
  } else {
    const { data: ins, error: insErr } = await admin
      .from("ai_conversations")
      .insert({
        company_id: companyId,
        customer_phone: phone,
        customer_name: customerName,
        status: "active",
        last_message_at: nowIso,
        unread_count: role === "customer" ? 1 : 0,
      })
      .select("id")
      .single();
    if (insErr || !ins) {
      console.error("frost-conversation insert:", insErr?.message);
      return json({ ok: false, error: insErr?.message || "insert_failed" }, 500);
    }
    conversationId = ins.id;
    created = true;
  }

  return json({
    ok: true,
    conversation_id: conversationId,
    created,
    last_message_at: nowIso,
  });
});
