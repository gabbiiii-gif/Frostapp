// Edge Function: frost-propose-os
// ─────────────────────────────────────────────────────────────────────────────
// Tool exposta ao agent Claude: cria uma OS proposta em ai_os_proposals com
// status='pending_approval'. NÃO cria a OS direta no kv_store — admin precisa
// aprovar manualmente no painel do FrostERP pra evitar OS lixo do bot.
//
// Após salvar, notifica admin/gerente por email (reusa send-email) e retorna
// proposal_id pra Frost confirmar ao cliente.
//
// Deploy: supabase functions deploy frost-propose-os --no-verify-jwt
//
// Auth: verify_jwt = false. n8n autentica via INTERNAL_FUNCTION_SECRET (se
// configurado) ou aceita aberto.
//
// Payload (POST JSON):
//   {
//     company_id: string,
//     conversation_id: string,    // uuid
//     payload: {
//       nome: string,
//       telefone: string,
//       endereco?: string,
//       equipamento?: string,
//       marca?: string,
//       modelo?: string,
//       problema?: string,
//       valor_estimado?: number,
//       observacoes?: string,
//     }
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

// Escapa caracteres HTML perigosos pra prevenir XSS no mailbox do admin.
// Payload IA vem do WhatsApp do cliente (não confiável) — atacante poderia
// injetar <img src=x onerror=...> e executar script no email do gestor.
function escapeHtml(v: unknown): string {
  const s = v == null ? "" : String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function notifyAdmins(
  admin: ReturnType<typeof createClient>,
  supabaseUrl: string,
  serviceKey: string,
  anonKey: string,
  internalSecret: string,
  companyId: string,
  proposalPayload: Record<string, unknown>,
) {
  // Lista admin/gerente ativos
  const { data: gestores } = await admin
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .in("role", ["admin", "gerente"])
    .eq("status", "ativo");
  const ids = (gestores || []).map((g: { user_id: string }) => g.user_id);
  if (ids.length === 0) return;

  // Resolve emails
  const emails: string[] = [];
  for (const uid of ids) {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (!error && data?.user?.email) emails.push(data.user.email);
  }
  if (emails.length === 0) return;

  const { data: company } = await admin
    .from("companies")
    .select("nome")
    .eq("id", companyId)
    .maybeSingle();
  const empresaNome = escapeHtml(company?.nome || "FrostERP");

  // Todos os campos do payload são escapados — vêm do WhatsApp do cliente,
  // input não-confiável que poderia conter HTML/script malicioso.
  const nome = escapeHtml(proposalPayload.nome || "—");
  const telefone = escapeHtml(proposalPayload.telefone || "—");
  const endereco = escapeHtml(proposalPayload.endereco || "—");
  const equipamento = `${escapeHtml(proposalPayload.equipamento || "—")} ${escapeHtml(proposalPayload.marca || "")} ${escapeHtml(proposalPayload.modelo || "")}`.trim();
  const problema = escapeHtml(proposalPayload.problema || "—");
  const valorEstimado = proposalPayload.valor_estimado
    ? "R$ " + Number(proposalPayload.valor_estimado).toFixed(2)
    : "—";
  const observacoes = proposalPayload.observacoes ? escapeHtml(proposalPayload.observacoes) : "";

  const html = `
    <div style="font-family: -apple-system, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="color: #d97706;">🤖 Nova OS proposta pelo Frost (aguardando aprovação)</h2>
      <p>O agente IA recebeu uma solicitação de cliente em <strong>${empresaNome}</strong>. Antes de virar uma OS de verdade, você precisa aprovar.</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        <tr><td style="padding:6px 0; color:#6b7280;">Cliente</td><td><strong>${nome}</strong></td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Telefone</td><td>${telefone}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Endereço</td><td>${endereco}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Equipamento</td><td>${equipamento}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Problema</td><td>${problema}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Valor estimado</td><td>${valorEstimado}</td></tr>
        ${observacoes ? `<tr><td style="padding:6px 0; color:#6b7280;">Obs</td><td>${observacoes}</td></tr>` : ""}
      </table>
      <p style="color:#6b7280; font-size:13px;">Abra o FrostERP → Conversas IA pra aprovar/recusar.</p>
    </div>
  `;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: anonKey,
    Authorization: `Bearer ${serviceKey}`,
  };
  if (internalSecret) headers["x-internal-secret"] = internalSecret;

  try {
    await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        to: emails,
        subject: `[Frost] Nova proposta de OS — ${proposalPayload.nome || "cliente"}`,
        html,
        text: `Nova OS proposta pelo Frost em ${empresaNome}. Cliente ${proposalPayload.nome || "—"}, telefone ${proposalPayload.telefone || "—"}. Aprovar no FrostERP.`,
      }),
    });
  } catch (err) {
    console.error("frost-propose-os notify:", (err as Error).message);
  }
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
  const payload = (body.payload || {}) as Record<string, unknown>;

  if (!companyId || !conversationId) return json({ ok: false, error: "missing_fields" }, 400);
  if (!payload.nome || !payload.telefone) {
    return json({ ok: false, error: "missing_payload_fields", needed: ["nome", "telefone"] }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: ins, error: insErr } = await admin
    .from("ai_os_proposals")
    .insert({
      company_id: companyId,
      conversation_id: conversationId,
      payload,
      status: "pending_approval",
    })
    .select("id")
    .single();
  if (insErr || !ins) {
    console.error("frost-propose-os insert:", insErr?.message);
    return json({ ok: false, error: insErr?.message || "insert_failed" }, 500);
  }

  // Notifica admins (fire-and-forget; não bloqueia retorno)
  notifyAdmins(admin, SUPABASE_URL, SERVICE_KEY, ANON_KEY, INTERNAL_SECRET, companyId, payload)
    .catch((err) => console.error("frost-propose-os notify fail:", err?.message));

  return json({ ok: true, proposal_id: ins.id });
});
