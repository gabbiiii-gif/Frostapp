// Edge Function: pos-venda-dispatch
// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher do Pos-Venda. Agendado por Supabase pg_cron (ver
// docs/ai-agent/04-pos-venda-pg-cron.sql) ou trigger manual via
// api/pos-venda-cron.js. Envia as mensagens de pos-venda que estao na hora,
// via Evolution API (ai_agent_config + secret EVOLUTION_APIKEY).
//
// Auth: header x-dispatch-key. A chave esperada vem de:
//   1) env DISPATCH_KEY (se setada) — compat com trigger manual antigo;
//   2) senao, do Vault via RPC public.pos_venda_dispatch_key() (service_role).
// Assim o pg_cron e a funcao compartilham o segredo sem coordenar env.
//
// Env injetadas pelo runtime: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Env opcional do operador: DISPATCH_KEY, EVOLUTION_APIKEY.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-dispatch-key",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const MAX_BATCH = 50;
const MAX_TENTATIVAS = 3;

// Normaliza telefone BR para o formato que a Evolution/WhatsApp espera: digitos
// com DDI 55 na frente. Telefones cadastrados costumam vir locais — ex:
// "(93) 9172-1424" -> "9391721424" (10 digitos, sem DDI) -> Evolution responde
// number "exists:false". Prependendo "55" vira "559391721424" e resolve.
//   - ja tem DDI 55 (>=12 digitos): mantem;
//   - 10 (DDD+8) ou 11 (DDD+9+8) digitos: prepend 55;
//   - fora desses tamanhos: devolve so os digitos (nao da pra inferir DDD).
function normalizarTelefoneBR(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 12 && d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Auth: a funcao e a fronteira (chamada por cron) ──────────────────────
  // Chave esperada: env DISPATCH_KEY tem prioridade; senao, Vault via RPC.
  let expected: string | null = Deno.env.get("DISPATCH_KEY") ?? null;
  if (!expected) {
    const { data: k, error: kErr } = await supabase.rpc("pos_venda_dispatch_key");
    if (kErr) return json({ error: "key_lookup_failed", detail: kErr.message }, 500);
    expected = typeof k === "string" && k.length > 0 ? k : null;
  }
  if (!expected || req.headers.get("x-dispatch-key") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  // ── Config global do pos-venda ───────────────────────────────────────────
  const { data: config, error: cfgErr } = await supabase
    .from("pos_venda_config")
    .select("modo_disparo, ativo")
    .is("cliente_id", null)
    .maybeSingle();
  if (cfgErr) return json({ error: "config_query_failed", detail: cfgErr.message }, 500);
  if (!config || config.ativo === false) {
    return json({ skipped: "agente_inativo", sent: 0 });
  }

  // ── Evolution (reusa ai_agent_config + secret) ───────────────────────────
  const { data: evo } = await supabase
    .from("ai_agent_config")
    .select("evolution_url, evolution_instance, enabled, metadata")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  // apikey: prioriza ai_agent_config.metadata.evolution_apikey (padrao do projeto,
  // mesma fonte usada por whatsapp-webhook e frost-notify-approval). Fallback pro
  // env EVOLUTION_APIKEY por compatibilidade com setups antigos.
  const apikey = String((evo?.metadata as Record<string, unknown> | null)?.evolution_apikey || "")
    || Deno.env.get("EVOLUTION_APIKEY") || "";
  if (!evo?.evolution_url || !evo?.evolution_instance || !apikey) {
    return json({ skipped: "evolution_nao_configurada", sent: 0 });
  }
  const base = evo.evolution_url.replace(/\/+$/, "");
  const endpoint = `${base}/message/sendText/${evo.evolution_instance}`;

  // ── Mensagens elegiveis ──────────────────────────────────────────────────
  const statuses = config.modo_disparo === "auto"
    ? ["aprovada", "pendente"]
    : ["aprovada"];

  const { data: msgs, error: qErr } = await supabase
    .from("pos_venda_mensagens")
    .select("id, telefone, conteudo, tentativas, status")
    .in("status", statuses)
    .lte("agendada_para", new Date().toISOString())
    .not("telefone", "is", null)
    .neq("telefone", "")
    .order("agendada_para", { ascending: true })
    .limit(MAX_BATCH);
  if (qErr) return json({ error: "fila_query_failed", detail: qErr.message }, 500);
  if (!msgs || msgs.length === 0) return json({ sent: 0, failed: 0, nada: true });

  let sent = 0;
  let failed = 0;

  for (const m of msgs) {
    const numero = normalizarTelefoneBR(m.telefone);
    if (!numero) {
      await supabase.from("pos_venda_mensagens")
        .update({ status: "erro", erro_envio: "telefone invalido" })
        .eq("id", m.id);
      failed++;
      continue;
    }
    try {
      const resp = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey },
        body: JSON.stringify({ number: numero, text: m.conteudo }),
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Evolution ${resp.status}: ${txt.slice(0, 200)}`);
      }
      await supabase.from("pos_venda_mensagens")
        .update({
          status: "enviada",
          enviada_em: new Date().toISOString(),
          canal: "whatsapp",
          erro_envio: null,
        })
        .eq("id", m.id);
      sent++;
    } catch (e) {
      const tentativas = (m.tentativas || 0) + 1;
      await supabase.from("pos_venda_mensagens")
        .update({
          tentativas,
          erro_envio: String((e as Error).message || e).slice(0, 500),
          status: tentativas >= MAX_TENTATIVAS ? "erro" : m.status,
        })
        .eq("id", m.id);
      failed++;
    }
  }

  return json({ sent, failed, processados: msgs.length });
});
