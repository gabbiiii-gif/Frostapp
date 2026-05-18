// Edge Function: pos-venda-dispatch
// ─────────────────────────────────────────────────────────────────────────────
// Dispatcher do Pos-Venda. Roda em cron (Vercel Cron -> /api/pos-venda-cron ->
// esta funcao). Envia as mensagens de pos-venda que estao na hora, via
// Evolution API (mesma infra do modulo IA: ai_agent_config.evolution_url /
// evolution_instance + secret EVOLUTION_APIKEY).
//
// Regras:
//  - So envia se pos_venda_config (global, cliente_id IS NULL) existir e ativo=true.
//  - Status elegiveis: 'aprovada' sempre; 'pendente' apenas se modo_disparo='auto'.
//  - agendada_para <= agora.
//  - Sem Evolution configurada (url/instance/apikey) -> no-op gracioso (nao quebra,
//    a fila so acumula ate a infra existir).
//  - Sucesso: status='enviada', enviada_em=now, canal='whatsapp'.
//  - Falha: tentativas+1, erro_envio set; >=3 tentativas -> status='erro'.
//
// Auth: header x-dispatch-key === env DISPATCH_KEY (a funcao e a fronteira;
// verify_jwt=false porque o caller e um cron, nao um usuario).
//
// Env injetadas pelo runtime Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// Env que o operador define: DISPATCH_KEY, EVOLUTION_APIKEY.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  // ── Auth: a funcao e a fronteira (chamada por cron) ──────────────────────
  const expected = Deno.env.get("DISPATCH_KEY");
  if (!expected || req.headers.get("x-dispatch-key") !== expected) {
    return json({ error: "unauthorized" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

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
    .select("evolution_url, evolution_instance, enabled")
    .eq("enabled", true)
    .limit(1)
    .maybeSingle();
  const apikey = Deno.env.get("EVOLUTION_APIKEY") || "";
  if (!evo?.evolution_url || !evo?.evolution_instance || !apikey) {
    // No-op gracioso: infra ainda nao existe. Fila fica intacta.
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
    const numero = String(m.telefone || "").replace(/\D/g, "");
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
