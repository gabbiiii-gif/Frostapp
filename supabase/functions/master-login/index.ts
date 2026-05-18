// Edge Function: master-login
// ─────────────────────────────────────────────────────────────────────────────
// Phase 2 do lockdown de master_users. Valida credenciais master 100% no
// servidor (service_role bypassa RLS). O hash PBKDF2 NUNCA sai do servidor —
// o cliente envia email+senha, recebe de volta o registro master SEM o hash
// e um session token novo (cujo hash fica persistido em session_token_hash).
//
// Algoritmo PBKDF2 replica exatamente hashPassword() do App.jsx:
//   SHA-256, 100000 iteracoes, salt 16 bytes, 256 bits de saida,
//   formato armazenado "pbkdf2:<saltB64>:<hashB64>".
//
// Deploy: supabase functions deploy master-login (verify_jwt = false — login
// e por definicao pre-autenticado; a propria funcao e a fronteira de auth).

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

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// Reproduz hashPassword(pwd, existingSalt) do App.jsx
async function pbkdf2Hash(password: string, saltB64: string): Promise<string> {
  const enc = new TextEncoder();
  const salt = b64ToBytes(saltB64);
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveBits"],
  );
  const derived = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt, iterations: 100000, hash: "SHA-256" },
    keyMaterial, 256,
  );
  const hashB64 = bytesToB64(new Uint8Array(derived));
  return `pbkdf2:${saltB64}:${hashB64}`;
}

// Reproduz sha256Hex(str) do App.jsx (usado pra derivar session_token_hash)
async function sha256Hex(str: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return bytesToHex(new Uint8Array(buf));
}

// Comparacao constante-tempo pra nao vazar timing
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  let email = "";
  let password = "";
  try {
    const body = await req.json();
    email = String(body?.email ?? "").trim().toLowerCase();
    password = String(body?.password ?? "");
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }
  if (!email || !password) return json({ ok: false, error: "missing_credentials" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Lookup pelo email (service_role bypassa RLS)
  const { data: rows, error: selErr } = await admin
    .from("master_users")
    .select("id, email, nome, password, role, created_at")
    .eq("email", email)
    .limit(1);

  if (selErr) {
    console.error("master-login select:", selErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }
  const master = rows?.[0];

  // Resposta generica pra nao revelar se email existe (anti-enumeration)
  const FAIL = () => json({ ok: false, error: "invalid_credentials" }, 401);
  if (!master || typeof master.password !== "string") return FAIL();

  // Apenas formato PBKDF2 e validado no servidor. Formatos legados (DJB2/base64)
  // caem no fallback local do cliente que ja faz re-hash automatico.
  const stored: string = master.password;
  if (!stored.startsWith("pbkdf2:")) {
    return json({ ok: false, error: "legacy_format_use_local" }, 409);
  }
  const parts = stored.split(":");
  if (parts.length !== 3) return FAIL();

  const recomputed = await pbkdf2Hash(password, parts[1]);
  if (!timingSafeEqual(recomputed, stored)) return FAIL();

  // Credencial OK — emite session token novo. Guarda apenas o HASH no banco;
  // o token bruto fica so com o cliente (mesma estrategia de startSession).
  const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
  const sessionToken = bytesToHex(tokenBytes);
  const sessionTokenHash = await sha256Hex(sessionToken);

  const { error: updErr } = await admin
    .from("master_users")
    .update({ session_token_hash: sessionTokenHash, updated_at: new Date().toISOString() })
    .eq("id", master.id);
  if (updErr) {
    console.error("master-login update:", updErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }

  return json({
    ok: true,
    sessionToken,
    master: {
      id: master.id,
      email: master.email,
      nome: master.nome,
      role: master.role || "master",
      sessionTokenHash,
      createdAt: master.created_at,
    },
  });
});
