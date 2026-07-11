// Edge Function: evolution-manage
// ─────────────────────────────────────────────────────────────────────────────
// Gestão de instâncias Evolution (WhatsApp) por empresa, sem NUNCA expor a
// Global API Key ao navegador. O app chama esta função; ela usa a global key
// (secret) para create/delete e devolve QR/status pro cliente.
//
// AÇÕES:
//   create  (SÓ master)  → cria a instância da empresa, aponta o webhook pra
//                          whatsapp-webhook, salva evolution_instance/url/apikey
//                          em ai_agent_config e devolve o QR pra parear.
//   connect (master|admin)→ gera um QR novo pra (re)conectar quando cair.
//   status  (master|admin)→ estado da conexão (open|connecting|close).
//   logout  (master|admin)→ desconecta o número (mantém a instância).
//   delete  (SÓ master)  → logout + apaga a instância + limpa ai_agent_config.
//
// AUTENTICAÇÃO (dois tipos de caller):
//   • Admin da empresa: Authorization: Bearer <jwt supabase>. Valida via
//     company_members (admin/gerente) e SÓ age na própria empresa (company_id
//     do body é ignorado — usa o da associação).
//   • Master: body { masterId, sessionTokenHash } comparado a master_users.
//     Pode agir em qualquer empresa (company_id vem do body). create/delete
//     exigem master.
//
// SECRETS necessários (defina no painel Supabase → Edge Functions → Secrets):
//   EVOLUTION_API_URL   ex.: https://evolution.frosterp.com.br
//   EVOLUTION_GLOBAL_KEY  a AUTHENTICATION_API_KEY do servidor Evolution
//   WEBHOOK_TOKEN       (já existe — usado pra montar a URL do webhook)
//
// Deploy: verify_jwt=false (o master não tem JWT; a própria função valida).

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

function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Nome de instância seguro (sem espaços/acentos) derivado do company_id.
function instanceNameFor(companyId: string): string {
  const clean = String(companyId).replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `frost-${clean}`;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  const EVO_URL = (Deno.env.get("EVOLUTION_API_URL") || "").replace(/\/+$/, "");
  const EVO_KEY = Deno.env.get("EVOLUTION_GLOBAL_KEY") || "";
  const WEBHOOK_TOKEN = Deno.env.get("WEBHOOK_TOKEN") || "";
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }
  if (!EVO_URL || !EVO_KEY) {
    return json({ ok: false, error: "evolution_secrets_missing" }, 500);
  }

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  const action = String(body.action || "");

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── Resolve o caller (admin JWT ou master token) ──────────────────────────
  let isMaster = false;
  let companyId = "";
  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();

  // Distingue JWT de usuário do anon key (o gateway pode injetar o anon como
  // Bearer). Só tratamos como admin se o token resolver um usuário real.
  let adminUserId = "";
  if (bearer && bearer !== ANON_KEY) {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data: u } = await userClient.auth.getUser();
    if (u?.user) adminUserId = u.user.id;
  }

  if (adminUserId) {
    // Caller é um usuário logado: precisa ser admin/gerente de UMA empresa.
    const { data: member } = await admin
      .from("company_members")
      .select("company_id, role, is_super_admin, status")
      .eq("user_id", adminUserId)
      .maybeSingle();
    if (!member || (member.status && member.status !== "ativo")) {
      return json({ ok: false, error: "forbidden" }, 403);
    }
    if (!member.is_super_admin && !["admin", "gerente"].includes(String(member.role))) {
      return json({ ok: false, error: "forbidden_role" }, 403);
    }
    companyId = String(member.company_id);
  } else {
    // Caller master: valida token de sessão.
    const masterId = String(body.masterId || "");
    const sessionTokenHash = String(body.sessionTokenHash || "");
    if (!masterId || !sessionTokenHash) return json({ ok: false, error: "unauthenticated" }, 401);
    const { data: masterRow } = await admin
      .from("master_users")
      .select("id, session_token_hash")
      .eq("id", masterId)
      .maybeSingle();
    if (
      !masterRow || !masterRow.session_token_hash ||
      !timingSafeEqual(String(masterRow.session_token_hash), sessionTokenHash)
    ) {
      return json({ ok: false, error: "invalid_session" }, 401);
    }
    isMaster = true;
    companyId = String(body.company_id || "");
    if (!companyId) return json({ ok: false, error: "missing_company" }, 400);
  }

  // create/delete são exclusivos do master.
  if ((action === "create" || action === "delete") && !isMaster) {
    return json({ ok: false, error: "forbidden_master_only" }, 403);
  }

  // Helper de chamada à Evolution com a global key.
  async function evo(method: string, path: string, payload?: unknown) {
    const r = await fetch(`${EVO_URL}${path}`, {
      method,
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: payload !== undefined ? JSON.stringify(payload) : undefined,
    });
    let data: unknown;
    try { data = await r.json(); } catch { data = await r.text(); }
    return { status: r.status, data };
  }

  // Lê a config atual da empresa (nome da instância).
  async function loadCfg() {
    const { data } = await admin
      .from("ai_agent_config")
      .select("company_id, evolution_instance, evolution_url, enabled, metadata")
      .eq("company_id", companyId)
      .maybeSingle();
    return data;
  }

  // ─── CREATE ────────────────────────────────────────────────────────────────
  if (action === "create") {
    const instanceName = String(body.instanceName || instanceNameFor(companyId)).trim();
    const webhookUrl = `${SUPABASE_URL}/functions/v1/whatsapp-webhook?token=${encodeURIComponent(WEBHOOK_TOKEN)}`;

    // Cria a instância (Baileys) já pedindo o QR.
    const createRes = await evo("POST", "/instance/create", {
      instanceName,
      integration: "WHATSAPP-BAILEYS",
      qrcode: true,
    });
    if (createRes.status >= 400) {
      const d = createRes.data as { response?: { message?: unknown }; message?: unknown };
      const msg = JSON.stringify(d?.response?.message || d?.message || createRes.data).slice(0, 300);
      // 403/409 costumam ser "instância já existe" — trate como recuperável.
      if (/already in use|already exists|exists/i.test(msg)) {
        return json({ ok: false, error: "instance_exists", detail: msg }, 409);
      }
      return json({ ok: false, error: "create_failed", detail: msg }, 400);
    }
    const cr = createRes.data as Record<string, any>;
    // A apikey da instância vem em `hash` (string) ou `hash.apikey` conforme versão.
    const instanceApiKey = typeof cr.hash === "string" ? cr.hash : (cr.hash?.apikey || EVO_KEY);
    const qrBase64 = cr.qrcode?.base64 || cr.qrcode?.code || null;
    const pairingCode = cr.qrcode?.pairingCode || null;

    // Aponta o webhook pra whatsapp-webhook (eventos de mensagem).
    // Tenta o formato v2 (objeto webhook) e, se falhar, o legado (campos soltos).
    let webhookOk = false;
    const w1 = await evo("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
      webhook: { enabled: true, url: webhookUrl, byEvents: false, base64: true, events: ["MESSAGES_UPSERT"] },
    });
    webhookOk = w1.status < 400;
    if (!webhookOk) {
      const w2 = await evo("POST", `/webhook/set/${encodeURIComponent(instanceName)}`, {
        enabled: true, url: webhookUrl, webhook_by_events: false, events: ["MESSAGES_UPSERT"],
      });
      webhookOk = w2.status < 400;
    }

    // Persiste na config da empresa (fonte que o whatsapp-webhook consulta).
    const { error: upErr } = await admin.from("ai_agent_config").upsert({
      company_id: companyId,
      evolution_instance: instanceName,
      evolution_url: EVO_URL,
      enabled: true,
      metadata: { evolution_apikey: instanceApiKey },
    }, { onConflict: "company_id" });
    if (upErr) {
      console.error("evolution-manage save cfg:", upErr.message);
      return json({ ok: false, error: "save_failed", detail: upErr.message }, 500);
    }

    return json({ ok: true, instance: instanceName, qr: qrBase64, pairingCode, webhookOk });
  }

  // ─── CONNECT (novo QR pra reconectar) ──────────────────────────────────────
  if (action === "connect") {
    const cfg = await loadCfg();
    const instanceName = cfg?.evolution_instance;
    if (!instanceName) return json({ ok: false, error: "no_instance" }, 404);
    const res = await evo("GET", `/instance/connect/${encodeURIComponent(instanceName)}`);
    if (res.status >= 400) return json({ ok: false, error: "connect_failed", detail: JSON.stringify(res.data).slice(0, 300) }, 400);
    const d = res.data as Record<string, any>;
    return json({
      ok: true,
      instance: instanceName,
      qr: d.base64 || d.qrcode?.base64 || null,
      code: d.code || null,
      pairingCode: d.pairingCode || d.qrcode?.pairingCode || null,
    });
  }

  // ─── STATUS ────────────────────────────────────────────────────────────────
  if (action === "status") {
    const cfg = await loadCfg();
    const instanceName = cfg?.evolution_instance;
    if (!instanceName) return json({ ok: true, instance: null, state: "none" });
    const res = await evo("GET", `/instance/connectionState/${encodeURIComponent(instanceName)}`);
    if (res.status >= 400) return json({ ok: true, instance: instanceName, state: "unknown" });
    const d = res.data as Record<string, any>;
    const state = d.instance?.state || d.state || "unknown";
    return json({ ok: true, instance: instanceName, state });
  }

  // ─── LOGOUT ────────────────────────────────────────────────────────────────
  if (action === "logout") {
    const cfg = await loadCfg();
    const instanceName = cfg?.evolution_instance;
    if (!instanceName) return json({ ok: false, error: "no_instance" }, 404);
    const res = await evo("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
    return json({ ok: res.status < 400, detail: res.status >= 400 ? JSON.stringify(res.data).slice(0, 200) : undefined });
  }

  // ─── DELETE ────────────────────────────────────────────────────────────────
  if (action === "delete") {
    const cfg = await loadCfg();
    const instanceName = cfg?.evolution_instance;
    if (instanceName) {
      await evo("DELETE", `/instance/logout/${encodeURIComponent(instanceName)}`);
      await new Promise((r) => setTimeout(r, 800));
      await evo("DELETE", `/instance/delete/${encodeURIComponent(instanceName)}`);
    }
    // Desliga o agente e limpa a instância da config.
    await admin.from("ai_agent_config").update({
      evolution_instance: "", enabled: false, metadata: {},
    }).eq("company_id", companyId);
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
