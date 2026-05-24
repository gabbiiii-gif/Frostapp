// Edge Function: notify-os-created
// ─────────────────────────────────────────────────────────────────────────────
// Dispara email pra admin/gerente da empresa + técnico atribuído quando uma
// nova OS é criada. Lê emails via auth.admin.getUserById (service_role).
// Usa edge function send-email (Resend).
//
// Caller: cliente front-end logado. Verifica que caller pertence à companyId
// alvo antes de fazer o resto.
//
// Deploy: supabase functions deploy notify-os-created
//
// Auth: verify_jwt = true.
//
// Payload (POST JSON):
//   {
//     companyId: string,
//     osData: {
//       id: string,
//       numero?: number,
//       clienteNome?: string,
//       equipamentoTipo?: string,
//       descricao?: string,
//       valor?: number,
//       tecnicoId?: string,        // legacy id em erp:user (mapeia em company_members.legacy_user_id)
//       tecnicoNome?: string,
//       dataAgendada?: string,
//       horaAgendada?: string,
//     }
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

function fmtCurrency(v: unknown): string {
  const n = Number(v);
  if (!isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function fmtDate(s: unknown): string {
  if (!s) return "—";
  const str = String(s);
  // Aceita YYYY-MM-DD ou ISO. Devolve DD/MM/YYYY pt-BR.
  const d = new Date(str.length === 10 ? str + "T00:00:00" : str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString("pt-BR");
}

function osEmailHtml(empresa: string, os: Record<string, unknown>): string {
  const numero = os.numero ? `#${os.numero}` : (os.id ? `#${String(os.id).slice(0, 8)}` : "");
  const cliente = os.clienteNome || "—";
  const equipamento = os.equipamentoTipo || "—";
  const descricao = os.descricao || "—";
  const valor = fmtCurrency(os.valor);
  const tecnico = os.tecnicoNome || "—";
  const dataAg = fmtDate(os.dataAgendada);
  const horaAg = os.horaAgendada ? ` às ${String(os.horaAgendada)}` : "";
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;">
      <h2 style="color: #1e40af; margin-bottom: 8px;">Nova ordem de serviço ${numero}</h2>
      <p style="color:#374151;">Foi criada uma nova OS na <strong>${empresa}</strong>:</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        <tr><td style="padding:6px 0; color:#6b7280;">Cliente</td><td style="padding:6px 0;"><strong>${cliente}</strong></td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Equipamento</td><td style="padding:6px 0;">${equipamento}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Descrição</td><td style="padding:6px 0;">${descricao}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Valor estimado</td><td style="padding:6px 0;">${valor}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Técnico atribuído</td><td style="padding:6px 0;">${tecnico}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Agendada para</td><td style="padding:6px 0;">${dataAg}${horaAg}</td></tr>
      </table>
      <p style="color:#6b7280; font-size:13px;">Abra o FrostERP pra ver detalhes e acompanhar.</p>
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
  const { data: callerData, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !callerData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const callerId = callerData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const companyId = String(body.companyId || "").trim();
  const osData = (body.osData || {}) as Record<string, unknown>;
  if (!companyId || !osData) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Caller precisa pertencer à company alvo
  const { data: callerMember, error: callerMemberErr } = await admin
    .from("company_members")
    .select("user_id, company_id, role, is_super_admin")
    .eq("user_id", callerId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (callerMemberErr || !callerMember) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // Verifica toggle da empresa
  const { data: company, error: companyErr } = await admin
    .from("companies")
    .select("id, nome, notify_os_email")
    .eq("id", companyId)
    .maybeSingle();
  if (companyErr || !company) return json({ ok: false, error: "no_company" }, 404);
  if (!company.notify_os_email) return json({ ok: true, skipped: "disabled" });

  // Lista destinatários:
  //  1. Todos admin/gerente ativos da empresa
  //  2. Técnico atribuído (se houver tecnicoId mapeável)
  const recipientUserIds = new Set<string>();

  const { data: gestores } = await admin
    .from("company_members")
    .select("user_id, role")
    .eq("company_id", companyId)
    .in("role", ["admin", "gerente"])
    .eq("status", "ativo");
  (gestores || []).forEach((m) => recipientUserIds.add(m.user_id));

  const tecnicoLegacyId = osData.tecnicoId ? String(osData.tecnicoId) : "";
  if (tecnicoLegacyId) {
    const { data: tec } = await admin
      .from("company_members")
      .select("user_id")
      .eq("company_id", companyId)
      .eq("legacy_user_id", tecnicoLegacyId)
      .maybeSingle();
    if (tec?.user_id) recipientUserIds.add(tec.user_id);
  }

  if (recipientUserIds.size === 0) {
    return json({ ok: true, skipped: "no_recipients" });
  }

  // Resolve emails via auth.admin.getUserById (1 por user — small N)
  const emails: string[] = [];
  for (const uid of recipientUserIds) {
    const { data, error } = await admin.auth.admin.getUserById(uid);
    if (error || !data?.user?.email) continue;
    emails.push(data.user.email);
  }
  if (emails.length === 0) {
    return json({ ok: true, skipped: "no_emails" });
  }

  const empresaNome = String(company.nome || "FrostERP");
  const numero = osData.numero ? `#${osData.numero}` : "";
  const subject = `Nova OS ${numero} - ${osData.clienteNome || "cliente"} (${empresaNome})`.trim();
  const html = osEmailHtml(empresaNome, osData);

  // Texto plano básico (fallback pra clientes sem HTML)
  const text = `Nova OS ${numero} em ${empresaNome}. Cliente: ${osData.clienteNome || "—"}. Técnico: ${osData.tecnicoNome || "—"}. Valor: ${fmtCurrency(osData.valor)}.`;

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
        to: emails,
        subject,
        html,
        text,
      }),
    });
    const respBody = await resp.json().catch(() => ({}));
    if (!resp.ok || !respBody.ok) {
      console.error("notify-os-created send-email failed:", respBody);
      return json({ ok: false, error: respBody?.error || "email_failed" }, 502);
    }
  } catch (err) {
    console.error("notify-os-created exception:", (err as Error).message);
    return json({ ok: false, error: "network_error" }, 502);
  }

  return json({ ok: true, sent_to: emails.length });
});
