// Edge Function: master-devices (verify_jwt = false — master não tem JWT)
// Autentica via master_users.session_token_hash (timing-safe), igual master-companies.
// Painel do superadmin para aprovar/rejeitar/revogar aparelhos de qualquer empresa.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
// Comparação constante-tempo pra não vazar timing no match do token hash.
function timingSafeEqual(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const action = String(body.action || "");
  const masterId = String(body.masterId || "");
  const sessionTokenHash = String(body.sessionTokenHash || "");
  if (!masterId || !sessionTokenHash) return json({ ok: false, error: "unauthenticated" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });

  // Auth do master via token hash.
  const { data: masterRow } = await admin
    .from("master_users").select("id, session_token_hash").eq("id", masterId).maybeSingle();
  if (!masterRow?.session_token_hash || !timingSafeEqual(String(masterRow.session_token_hash), sessionTokenHash)) {
    return json({ ok: false, error: "invalid_session" }, 401);
  }

  // ─── LIST ───
  if (action === "list") {
    const { data: devices, error } = await admin
      .from("member_devices")
      .select("id, company_id, member_user_id, status, platform, device_uuid, fingerprint, created_at, approved_at")
      .order("created_at", { ascending: false });
    if (error) { console.error("master-devices list:", error.message); return json({ ok: false, error: "internal" }, 500); }

    // Enriquecer com nome do membro/empresa (uma varredura simples; volumes pequenos).
    const memberIds = [...new Set((devices || []).map((d) => d.member_user_id))];
    const { data: members } = await admin
      .from("company_members").select("user_id, nome, role, is_super_admin").in("user_id", memberIds.length ? memberIds : ["_none_"]);
    const memberMap = new Map((members || []).map((m) => [m.user_id, m]));
    const { data: companies } = await admin.from("companies").select("id, nome");
    const companyMap = new Map((companies || []).map((c) => [String(c.id), c.nome]));

    const enriched = (devices || []).map((d) => ({
      ...d,
      company_nome: companyMap.get(String(d.company_id)) || d.company_id,
      member_nome: memberMap.get(d.member_user_id)?.nome || d.member_user_id,
      role: memberMap.get(d.member_user_id)?.role || null,
      is_super_admin: !!memberMap.get(d.member_user_id)?.is_super_admin,
    }));
    return json({ ok: true, devices: enriched });
  }

  const deviceId = String(body.deviceId || "");
  if (!deviceId) return json({ ok: false, error: "missing_device" }, 400);

  // ─── APPROVE ───
  if (action === "approve") {
    const { data: target } = await admin
      .from("member_devices").select("id, member_user_id, device_uuid").eq("id", deviceId).maybeSingle();
    if (!target) return json({ ok: false, error: "not_found" }, 404);
    // Garante 1:1: revoga qualquer outro aprovado do mesmo membro E qualquer
    // aprovado do mesmo device_uuid pertencente a outro membro.
    await admin.from("member_devices").update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("member_user_id", target.member_user_id).eq("status", "approved").neq("id", deviceId);
    await admin.from("member_devices").update({ status: "revoked", updated_at: new Date().toISOString() })
      .eq("device_uuid", target.device_uuid).eq("status", "approved").neq("id", deviceId);
    const { error } = await admin.from("member_devices")
      .update({ status: "approved", approved_by: masterId, approved_at: new Date().toISOString(), updated_at: new Date().toISOString() })
      .eq("id", deviceId);
    if (error) { console.error("master-devices approve:", error.message); return json({ ok: false, error: error.message }, 500); }
    return json({ ok: true });
  }

  // ─── REJECT ───
  if (action === "reject") {
    const { error } = await admin.from("member_devices")
      .update({ status: "rejected", updated_at: new Date().toISOString() }).eq("id", deviceId);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  // ─── REVOKE ───
  if (action === "revoke") {
    await admin.from("device_sessions").delete().eq("device_id", deviceId);
    const { error } = await admin.from("member_devices")
      .update({ status: "revoked", updated_at: new Date().toISOString() }).eq("id", deviceId);
    if (error) return json({ ok: false, error: error.message }, 500);
    return json({ ok: true });
  }

  return json({ ok: false, error: "unknown_action" }, 400);
});
