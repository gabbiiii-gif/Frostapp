// Edge Function: device-verify (verify_jwt = true)
// Fase 1 (soft): compara device_uuid. Fase 2 (WebAuthn): valida a ASSINATURA da
// prova de posse contra a chave pública guardada. A device_session emitida é a
// base do RLS por aparelho (Fase 3).
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const SESSION_TTL_MIN = 720; // 12h

function b64urlToBytes(b64url: string): Uint8Array {
  const s = String(b64url).replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4;
  const b64 = s + (pad ? "=".repeat(4 - pad) : "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
function derToRawEcdsa(der: Uint8Array): Uint8Array {
  const o = 2;
  function readInt(pos: number): { val: Uint8Array; next: number } {
    const len = der[pos + 1];
    let start = pos + 2;
    const end = start + len;
    while (start < end - 1 && der[start] === 0x00) start++;
    const raw = der.slice(start, end);
    const out = new Uint8Array(32);
    out.set(raw.subarray(Math.max(0, raw.length - 32)), Math.max(0, 32 - raw.length));
    return { val: out, next: end };
  }
  const r = readInt(o);
  const s = readInt(r.next);
  const raw = new Uint8Array(64);
  raw.set(r.val, 0);
  raw.set(s.val, 32);
  return raw;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json({ ok: false, error: "server_misconfigured" }, 500);

  const authHeader = req.headers.get("Authorization") || "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } });
  const { data: userData, error: userErr } = await userClient.auth.getUser();
  if (userErr || !userData?.user) return json({ ok: false, error: "unauthenticated" }, 401);
  const userId = userData.user.id;

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }
  const deviceUuid = String(body.device_uuid || "").trim();
  const wa = (body.webauthn && typeof body.webauthn === "object") ? body.webauthn as Record<string, string> : null;

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: devices } = await admin
    .from("member_devices")
    .select("id, device_uuid, status, credential_id, public_key")
    .eq("member_user_id", userId);
  const list = devices || [];
  const approved = list.find((d) => d.status === "approved");

  async function issueSession(deviceId: string) {
    // Higiene: remove sessões expiradas do membro antes de emitir a nova.
    await admin.from("device_sessions").delete().eq("member_user_id", userId).lt("expires_at", new Date().toISOString());
    const expires = new Date(Date.now() + SESSION_TTL_MIN * 60_000).toISOString();
    await admin.from("device_sessions").insert({ member_user_id: userId, device_id: deviceId, expires_at: expires });
  }

  // ─── Fase 2: prova WebAuthn ────────────────────────────────────────────────
  if (wa && wa.signature) {
    if (!approved || !approved.public_key || approved.credential_id !== wa.credentialId) {
      return json({ ok: true, status: approved ? "denied" : "needs_enroll" });
    }
    try {
      const clientDataBytes = b64urlToBytes(wa.clientDataJSON);
      const clientData = JSON.parse(new TextDecoder().decode(clientDataBytes));
      if (clientData.type !== "webauthn.get") return json({ ok: true, status: "denied" });
      const origin = req.headers.get("Origin") || "";
      if (!origin || clientData.origin !== origin) return json({ ok: true, status: "denied" });
      const rpId = new URL(origin).hostname;
      const nonce = String(clientData.challenge || "");
      const { data: chal } = await admin
        .from("device_challenges")
        .select("id, expires_at, consumed_at")
        .eq("member_user_id", userId).eq("nonce", nonce).eq("purpose", "verify")
        .maybeSingle();
      if (!chal || chal.consumed_at || new Date(chal.expires_at).getTime() < Date.now()) {
        return json({ ok: true, status: "denied" });
      }
      const authData = b64urlToBytes(wa.authenticatorData);
      const rpIdHash = await sha256(new TextEncoder().encode(rpId));
      if (!bytesEqual(authData.slice(0, 32), rpIdHash)) return json({ ok: true, status: "denied" });
      const clientHash = await sha256(clientDataBytes);
      const signedData = new Uint8Array(authData.length + clientHash.length);
      signedData.set(authData, 0);
      signedData.set(clientHash, authData.length);
      const spki = b64urlToBytes(approved.public_key);
      const key = await crypto.subtle.importKey("spki", spki, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
      const sigRaw = derToRawEcdsa(b64urlToBytes(wa.signature));
      const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, sigRaw, signedData);
      if (!ok) return json({ ok: true, status: "denied" });
      await admin.from("device_challenges").update({ consumed_at: new Date().toISOString() }).eq("id", chal.id);
      await issueSession(approved.id);
      return json({ ok: true, status: "approved", mode: "webauthn" });
    } catch (e) {
      console.error("device-verify webauthn:", (e as Error).message);
      return json({ ok: true, status: "denied" });
    }
  }

  // ─── Fase 1: soft (device_uuid) ────────────────────────────────────────────
  if (!deviceUuid) return json({ ok: false, error: "invalid_device" }, 400);
  let status = "needs_enroll";
  let deviceId: string | null = null;
  if (approved) {
    if (approved.device_uuid === deviceUuid) { status = "approved"; deviceId = approved.id; }
    else { status = "denied"; deviceId = approved.id; }
  } else {
    const thisDev = list.find((d) => d.device_uuid === deviceUuid);
    if (!thisDev) status = "needs_enroll";
    else if (thisDev.status === "pending") { status = "pending"; deviceId = thisDev.id; }
    else { status = "denied"; deviceId = thisDev.id; }
  }
  // Estrito (Fase 3): se o aparelho aprovado tem credencial WebAuthn e o cadeado
  // está LIGADO, o caminho soft não vale — exige a prova WebAuthn (fecha o buraco
  // de copiar o device_uuid). Com o kill-switch OFF, soft continua valendo.
  if (status === "approved" && approved?.public_key) {
    const { data: enf } = await admin.from("device_enforcement").select("enabled").eq("id", 1).maybeSingle();
    if (enf?.enabled) { status = "denied"; deviceId = null; }
  }
  if (status === "approved" && deviceId) {
    await issueSession(deviceId);
  }
  return json({ ok: true, status, mode: "soft" });
});
