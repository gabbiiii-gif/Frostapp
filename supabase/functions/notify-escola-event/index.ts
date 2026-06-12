// Edge Function: notify-escola-event
// ─────────────────────────────────────────────────────────────────────────────
// Notifica eventos do módulo Escola (Vanda) por email — reusa send-email
// (Resend) já existente. Roteia destinatários conforme o evento:
//
//   criada     → admin/gerente/tecnicos da empresa  + confirmação à Vanda
//   assumida   → apenas Vanda (opcional, depende de config futura)
//   concluida  → Vanda
//   cancelada  → Vanda
//   reaberta   → admin/gerente da empresa
//
// Auth: verify_jwt = true. Caller precisa pertencer à companyId alvo (regra
// idêntica ao notify-os-created).
//
// Deploy:
//   supabase functions deploy notify-escola-event
//
// Payload (POST JSON):
//   {
//     companyId: string,
//     evento: "criada" | "assumida" | "concluida" | "cancelada" | "reaberta",
//     demanda: {
//       id, escola_nome, descricao, urgencia, status,
//       data_solicitacao, concluido_em?, assumido_em?,
//       solicitante_id, solicitante_nome?,
//       responsavel_id?, responsavel_nome?,
//       observacao_conclusao?, motivo_cancelamento?
//     }
//   }
//
// Retorno:
//   { ok: true, sent_to: number, recipients: string[] }

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

// ─── Formatadores PT-BR ──────────────────────────────────────────────────────
function fmtDateTime(s: unknown): string {
  if (!s) return "—";
  const str = String(s);
  const d = new Date(str.length === 10 ? str + "T00:00:00" : str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function fmtDate(s: unknown): string {
  if (!s) return "—";
  const str = String(s);
  const d = new Date(str.length === 10 ? str + "T00:00:00" : str);
  if (isNaN(d.getTime())) return str;
  return d.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}
function fmtTime(s: unknown): string {
  if (!s) return "—";
  const d = new Date(String(s));
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleTimeString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
}

const URGENCIA_LABEL: Record<string, string> = {
  baixo: "Baixo", medio: "Médio", alto: "Alto", urgente: "Urgente",
};

// ─── Templates HTML ──────────────────────────────────────────────────────────
function tplBaseStyles() {
  return "font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; color: #111;";
}

// Para a equipe interna ao criar demanda nova
function htmlCriadaInterna(empresa: string, d: Record<string, unknown>): string {
  const urg = URGENCIA_LABEL[String(d.urgencia)] || String(d.urgencia);
  return `
    <div style="${tplBaseStyles()}">
      <h2 style="color:#1e40af; margin-bottom:8px;">Nova demanda escolar — ${escapeHtml(String(d.escola_nome))}</h2>
      <p style="color:#374151;">A cliente <strong>${escapeHtml(String(d.solicitante_nome || "Vanda"))}</strong> enviou uma nova solicitação na <strong>${escapeHtml(empresa)}</strong>:</p>
      <table style="width:100%; border-collapse:collapse; margin:16px 0; font-size:14px;">
        <tr><td style="padding:6px 0; color:#6b7280;">Escola</td><td style="padding:6px 0;"><strong>${escapeHtml(String(d.escola_nome))}</strong></td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Urgência</td><td style="padding:6px 0;"><strong>${urg}</strong></td></tr>
        <tr><td style="padding:6px 0; color:#6b7280;">Data da solicitação</td><td style="padding:6px 0;">${fmtDateTime(d.data_solicitacao)}</td></tr>
        <tr><td style="padding:6px 0; color:#6b7280; vertical-align:top;">Descrição</td><td style="padding:6px 0; white-space:pre-line;">${escapeHtml(String(d.descricao || "—"))}</td></tr>
      </table>
      <p style="color:#6b7280; font-size:13px;">Abra o FrostERP → módulo <strong>Escola</strong> para assumir e atender.</p>
    </div>
  `;
}

// Confirmação para a Vanda ao enviar
function htmlCriadaVanda(d: Record<string, unknown>): string {
  return `
    <div style="${tplBaseStyles()}">
      <h2 style="color:#1e40af; margin-bottom:8px;">Solicitação recebida</h2>
      <p style="color:#374151;">Sua solicitação para <strong>${escapeHtml(String(d.escola_nome))}</strong> foi recebida com sucesso.</p>
      <p style="color:#374151;">Acompanhe o status pelo Portal Escolas. Em breve nossa equipe atenderá.</p>
      <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;" />
      <p style="color:#6b7280; font-size:13px;">Resumo:</p>
      <ul style="color:#374151; font-size:14px;">
        <li>Escola: <strong>${escapeHtml(String(d.escola_nome))}</strong></li>
        <li>Urgência: ${URGENCIA_LABEL[String(d.urgencia)] || String(d.urgencia)}</li>
        <li>Solicitado em: ${fmtDateTime(d.data_solicitacao)}</li>
      </ul>
    </div>
  `;
}

// Conclusão para a Vanda
function htmlConcluidaVanda(d: Record<string, unknown>): string {
  const data = fmtDate(d.concluido_em);
  const hora = fmtTime(d.concluido_em);
  return `
    <div style="${tplBaseStyles()}">
      <h2 style="color:#15803d; margin-bottom:8px;">Serviço concluído</h2>
      <p style="color:#374151;">O serviço solicitado para <strong>${escapeHtml(String(d.escola_nome))}</strong> foi concluído em <strong>${data}</strong> às <strong>${hora}</strong>.</p>
      ${d.observacao_conclusao ? `
        <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;" />
        <p style="color:#6b7280; font-size:13px;">Observação da equipe:</p>
        <p style="color:#374151; white-space:pre-line;">${escapeHtml(String(d.observacao_conclusao))}</p>
      ` : ""}
      <p style="color:#6b7280; font-size:13px; margin-top:24px;">Você pode consultar o histórico completo no Portal Escolas.</p>
    </div>
  `;
}

// Cancelamento para a Vanda
function htmlCanceladaVanda(d: Record<string, unknown>): string {
  return `
    <div style="${tplBaseStyles()}">
      <h2 style="color:#b91c1c; margin-bottom:8px;">Solicitação cancelada</h2>
      <p style="color:#374151;">A solicitação enviada para <strong>${escapeHtml(String(d.escola_nome))}</strong> foi cancelada.</p>
      ${d.motivo_cancelamento ? `
        <hr style="border:none; border-top:1px solid #e5e7eb; margin:16px 0;" />
        <p style="color:#6b7280; font-size:13px;">Motivo:</p>
        <p style="color:#374151; white-space:pre-line;">${escapeHtml(String(d.motivo_cancelamento))}</p>
      ` : ""}
    </div>
  `;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] || c)
  );
}

// ─── Handler principal ──────────────────────────────────────────────────────
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

  // Verifica caller — precisa ser membro da company alvo
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
  const evento = String(body.evento || "").trim();
  const demanda = (body.demanda || {}) as Record<string, unknown>;
  if (!companyId || !evento || !demanda?.id) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  if (!["criada", "assumida", "concluida", "cancelada", "reaberta"].includes(evento)) {
    return json({ ok: false, error: "invalid_event" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Caller precisa pertencer à company OU ser a própria Vanda (solicitante)
  const { data: callerMember } = await admin
    .from("company_members")
    .select("user_id, role")
    .eq("user_id", callerId)
    .eq("company_id", companyId)
    .maybeSingle();
  if (!callerMember) {
    return json({ ok: false, error: "forbidden" }, 403);
  }

  // Empresa
  const { data: company } = await admin
    .from("companies")
    .select("id, nome")
    .eq("id", companyId)
    .maybeSingle();
  if (!company) return json({ ok: false, error: "no_company" }, 404);
  const empresaNome = String(company.nome || "FrostERP");

  // ─── Resolve destinatários por evento ─────────────────────────────────────
  type Mail = { email: string; subject: string; html: string; text: string };
  const mails: Mail[] = [];
  const escola = String(demanda.escola_nome || "—");

  // Email da Vanda (solicitante) — usado em vários eventos
  let vandaEmail = "";
  if (demanda.solicitante_id) {
    const { data } = await admin.auth.admin.getUserById(String(demanda.solicitante_id));
    if (data?.user?.email) vandaEmail = data.user.email;
  }

  // Emails da equipe interna (admin/gerente/tecnico ativos)
  async function listarEquipeInterna(): Promise<string[]> {
    const { data: membros } = await admin
      .from("company_members")
      .select("user_id, role")
      .eq("company_id", companyId)
      .in("role", ["admin", "gerente", "tecnico"])
      .eq("status", "ativo");
    const ids = (membros || []).map((m) => m.user_id);
    const emails: string[] = [];
    for (const uid of ids) {
      const { data } = await admin.auth.admin.getUserById(uid);
      if (data?.user?.email) emails.push(data.user.email);
    }
    return emails;
  }

  if (evento === "criada") {
    const equipe = await listarEquipeInterna();
    for (const e of equipe) {
      mails.push({
        email: e,
        subject: `Nova demanda escolar — ${escola}`,
        html: htmlCriadaInterna(empresaNome, demanda),
        text: `Nova demanda da Vanda em ${empresaNome}: ${escola}. Urgência ${URGENCIA_LABEL[String(demanda.urgencia)] || demanda.urgencia}. Abra o FrostERP → Escola.`,
      });
    }
    if (vandaEmail) {
      mails.push({
        email: vandaEmail,
        subject: `Solicitação recebida — ${escola}`,
        html: htmlCriadaVanda(demanda),
        text: `Sua solicitação para ${escola} foi recebida com sucesso. Acompanhe pelo Portal Escolas.`,
      });
    }
  } else if (evento === "concluida") {
    if (vandaEmail) {
      mails.push({
        email: vandaEmail,
        subject: `Serviço concluído — ${escola}`,
        html: htmlConcluidaVanda(demanda),
        text: `Serviço concluído em ${escola} no dia ${fmtDate(demanda.concluido_em)} às ${fmtTime(demanda.concluido_em)}.`,
      });
    }
  } else if (evento === "cancelada") {
    if (vandaEmail) {
      mails.push({
        email: vandaEmail,
        subject: `Solicitação cancelada — ${escola}`,
        html: htmlCanceladaVanda(demanda),
        text: `Solicitação para ${escola} foi cancelada. ${demanda.motivo_cancelamento ? "Motivo: " + demanda.motivo_cancelamento : ""}`,
      });
    }
  } else if (evento === "reaberta") {
    const equipe = await listarEquipeInterna();
    for (const e of equipe) {
      mails.push({
        email: e,
        subject: `Demanda escolar reaberta — ${escola}`,
        html: htmlCriadaInterna(empresaNome, demanda),
        text: `Demanda ${escola} foi reaberta. Abra o FrostERP → Escola.`,
      });
    }
  }
  // evento "assumida" intencionalmente sem email (config futura)

  if (mails.length === 0) {
    return json({ ok: true, skipped: "no_recipients", evento });
  }

  // ─── Dispara via send-email ──────────────────────────────────────────────
  const emailHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: ANON_KEY,
    // ANON_KEY no Authorization: o gateway rejeita (401) o token service_role
    // na chamada entre Edge Functions. Auth real é o x-internal-secret abaixo.
    Authorization: `Bearer ${ANON_KEY}`,
  };
  if (INTERNAL_SECRET) emailHeaders["x-internal-secret"] = INTERNAL_SECRET;

  let sent = 0;
  const errors: string[] = [];
  for (const m of mails) {
    try {
      const resp = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: emailHeaders,
        body: JSON.stringify({ to: m.email, subject: m.subject, html: m.html, text: m.text }),
      });
      const respBody = await resp.json().catch(() => ({}));
      if (!resp.ok || !respBody.ok) {
        errors.push(`${m.email}: ${respBody?.error || resp.status}`);
      } else {
        sent++;
      }
    } catch (err) {
      errors.push(`${m.email}: ${(err as Error).message}`);
    }
  }

  return json({
    ok: true,
    sent_to: sent,
    total_recipients: mails.length,
    errors: errors.length ? errors : undefined,
    evento,
  });
});
