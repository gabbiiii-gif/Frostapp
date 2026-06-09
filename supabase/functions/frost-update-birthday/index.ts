// Edge Function: frost-update-birthday
// ─────────────────────────────────────────────────────────────────────────────
// Tool exposta ao agent Claude: atualiza data_nascimento do cliente no kv_store
// (chave erp:client:<id> escopada por cmp_<companyId>:). Localiza por telefone
// normalizado (só dígitos), faz upsert do valor.
//
// Se cliente não existe ainda, NÃO cria — retorna client_not_found pra Frost
// pedir os outros dados antes (uso recomendado: chamar após cliente já existir,
// p.ex. após propose_os ter sido aprovada).
//
// Deploy: supabase functions deploy frost-update-birthday --no-verify-jwt
//
// Payload (POST JSON):
//   {
//     company_id: string,
//     customer_phone: string,
//     data_nascimento: string  // formato YYYY-MM-DD
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

  // FAIL-CLOSED: exige x-internal-secret SEMPRE (fecha contra chamadas anonimas).
  {
    const sent = req.headers.get("x-internal-secret") || "";
    if (!INTERNAL_SECRET || sent !== INTERNAL_SECRET) return json({ ok: false, error: "forbidden" }, 403);
  }

  let body: Record<string, unknown> = {};
  try { body = await req.json(); } catch { return json({ ok: false, error: "bad_request" }, 400); }

  const companyId = String(body.company_id || "").trim();
  const phoneDigits = String(body.customer_phone || "").replace(/\D/g, "");
  const dataNascimento = String(body.data_nascimento || "").trim();
  if (!companyId || !phoneDigits || !dataNascimento) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  // Validação simples YYYY-MM-DD
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dataNascimento)) {
    return json({ ok: false, error: "invalid_date_format", needed: "YYYY-MM-DD" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Lista clients da company. Filtra em memória por telefone normalizado.
  // (kv_store não tem index em campos JSON; volume típico de clientes/empresa é baixo.)
  const prefix = `cmp_${companyId}:erp:client:`;
  const { data: rows, error: selErr } = await admin
    .from("kv_store")
    .select("key, value")
    .like("key", `${prefix}%`)
    .limit(2000);
  if (selErr) {
    console.error("frost-update-birthday select:", selErr.message);
    return json({ ok: false, error: "internal" }, 500);
  }

  type Row = { key: string; value: Record<string, unknown> | null };
  const match = ((rows || []) as Row[]).find((r) => {
    const v = r.value || {};
    const candidates = [v.telefone, v.celular, v.whatsapp, v.fone];
    return candidates.some((c) => typeof c === "string" && c.replace(/\D/g, "") === phoneDigits);
  });

  if (!match) {
    return json({ ok: false, error: "client_not_found" }, 404);
  }

  // Guard contra match.value null/não-objeto. Spreading null gera objeto só com
  // data_nascimento, sobrescrevendo o record do cliente inteiro no kv_store.
  // Defensivo mesmo o filtro acima ter eliminado nulls — proteção dupla.
  // Retorna 200 com ok:false (em vez de 422) pra não halt workflow n8n que
  // não tem "Continue On Fail" configurado — o agente Claude recebe o tool_result
  // com erro estruturado e responde graciosamente ao cliente.
  if (!match.value || typeof match.value !== "object" || Array.isArray(match.value)) {
    return json({ ok: false, error: "client_record_invalid" }, 200);
  }

  const updated = { ...match.value, data_nascimento: dataNascimento };
  const { error: updErr } = await admin
    .from("kv_store")
    .update({ value: updated, updated_at: new Date().toISOString() })
    .eq("key", match.key);
  if (updErr) {
    console.error("frost-update-birthday update:", updErr.message);
    return json({ ok: false, error: updErr.message }, 500);
  }

  return json({ ok: true, client_key: match.key, data_nascimento: dataNascimento });
});
