// Edge Function: frost-notify-approval
// ─────────────────────────────────────────────────────────────────────────────
// Quando um atendente APROVA uma proposta de OS da IA no FrostERP, dispara uma
// mensagem de WhatsApp pro cliente avisando que a solicitação foi verificada por
// um humano e que o contato humanizado vem em seguida.
//
// Chamada pelo frontend (IAAtendimentoModule.approveProposal) via
// supabase.functions.invoke — o JWT do admin/gerente vai no Authorization.
//
// Auth: verify_jwt = true. Além disso, confere que o caller é admin/gerente
// ATIVO da company_id alvo (mesma checagem do notify-os-created).
//
// Deploy: supabase functions deploy frost-notify-approval
//
// Payload (POST JSON):
//   {
//     company_id: string,
//     conversation_id?: string,   // se houver, grava a msg em ai_messages e usa
//                                  // o telefone exato da conversa pro Evolution
//     customer_phone?: string,    // fallback (dígitos) se não houver conversa
//     customer_name?: string,     // pra saudar pelo primeiro nome
//     os_numero?: number
//   }

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
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  // ── Valida JWT do caller ───────────────────────────────────────────────────
  const authHeader = req.headers.get("Authorization") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthorized" }, 401);

  const authClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: userErr } = await authClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthorized" }, 401);
  const callerId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const companyId = String(body.company_id || "").trim();
  const conversationId = body.conversation_id ? String(body.conversation_id) : "";
  const customerName = String(body.customer_name || "").trim();
  const osNumero = body.os_numero != null ? String(body.os_numero) : "";
  if (!companyId) return json({ ok: false, error: "missing_fields" }, 400);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ── Confere que o caller é admin/gerente ativo da empresa ──────────────────
  const { data: member } = await admin
    .from("company_members")
    .select("role, status")
    .eq("company_id", companyId)
    .eq("user_id", callerId)
    .eq("status", "ativo")
    .maybeSingle();
  if (!member || !["admin", "gerente"].includes(String(member.role))) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // ── Config do agente (URL + instância + apikey Evolution por empresa) ──────
  const { data: cfg } = await admin
    .from("ai_agent_config")
    .select("evolution_url, evolution_instance, metadata")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!cfg) return json({ ok: false, error: "agent_not_configured" }, 200);

  const evoBase = String(cfg.evolution_url || "").replace(/\/+$/, "");
  const instance = String(cfg.evolution_instance || "");
  const apikey = String((cfg.metadata as Record<string, unknown> | null)?.evolution_apikey || "");
  if (!evoBase || !instance || !apikey) return json({ ok: false, error: "evolution_not_configured" }, 200);

  // ── Resolve o telefone: prioriza o da conversa (formato exato do WhatsApp) ─
  let phone = String(body.customer_phone || "").replace(/\D/g, "");
  if (conversationId) {
    const { data: conv } = await admin
      .from("ai_conversations")
      .select("customer_phone")
      .eq("id", conversationId)
      .maybeSingle();
    if (conv?.customer_phone) phone = String(conv.customer_phone).replace(/\D/g, "");
  }
  if (!phone) return json({ ok: false, error: "no_phone" }, 200);

  // ── Monta a mensagem (saudação pelo primeiro nome) ─────────────────────────
  const primeiroNome = customerName.split(/\s+/)[0] || "";
  const saudacao = primeiroNome ? `Olá ${primeiroNome}!` : "Olá!";
  const refOS = osNumero ? ` (OS #${osNumero})` : "";
  const texto =
    `${saudacao} ✅ Sua solicitação${refOS} foi *verificada por um de nossos atendentes* e já está confirmada no nosso sistema.\n\n` +
    `👨‍🔧 Em instantes uma pessoa da nossa equipe vai entrar em contato com você pra combinar os detalhes do atendimento.\n\n` +
    `Qualquer dúvida, é só responder por aqui. 😊`;

  // ── Envia via Evolution ────────────────────────────────────────────────────
  try {
    const r = await fetch(`${evoBase}/message/sendText/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ number: phone, text: texto }),
    });
    if (!r.ok) {
      console.error("frost-notify-approval evolution:", r.status, (await r.text()).slice(0, 200));
      return json({ ok: false, error: "send_failed" }, 200);
    }
  } catch (err) {
    console.error("frost-notify-approval send:", (err as Error).message);
    return json({ ok: false, error: "send_error" }, 200);
  }

  // ── Registra a mensagem na timeline da conversa (role=agent) ───────────────
  if (conversationId) {
    await admin.from("ai_messages").insert({
      conversation_id: conversationId,
      company_id: companyId,
      role: "agent",
      content: texto,
    });
  }

  return json({ ok: true });
});
