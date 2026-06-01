// Edge Function: whatsapp-webhook
// ─────────────────────────────────────────────────────────────────────────────
// Recebe o webhook MESSAGES_UPSERT da Evolution API, persiste a conversa e roda
// o agente de IA (Claude Sonnet 4.6). Substitui o orquestrador n8n.
//
// Auth: query param ?token= comparado ao secret WEBHOOK_TOKEN.
// Resposta: 200 imediato; processamento da IA em background (waitUntil).
// Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (runtime), ANTHROPIC_API_KEY,
//      WEBHOOK_TOKEN (secrets). A apikey da Evolution vem de
//      ai_agent_config.metadata.evolution_apikey (por empresa).

import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Sonnet 4.6: raciocínio bem melhor que o Haiku pra conduzir o atendimento,
// seguir o fluxo (nome primeiro, reconhecer cliente, regras de desconto) e
// interpretar imagens. Custo/latência maiores, aceitos pra qualidade do bot.
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERS = 5;
const HISTORY_LIMIT = 20;

// ─── Tools expostas ao agente ────────────────────────────────────────────────
const TOOLS = [
  {
    name: "propose_os",
    description:
      "Registra uma PROPOSTA de Ordem de Serviço para aprovação humana. Use quando tiver os dados obrigatórios (nome, endereço, tipo de equipamento, problema). Marca, modelo e telefone são opcionais. Não cria a OS — apenas registra a solicitação para um atendente analisar.",
    input_schema: {
      type: "object",
      properties: {
        customer_name: { type: "string", description: "Nome completo do cliente" },
        address: { type: "string", description: "Endereço completo" },
        equipment_type: { type: "string", description: "Tipo de equipamento" },
        equipment_brand: { type: "string", description: "Marca (opcional, se o cliente souber)" },
        equipment_model: { type: "string", description: "Modelo (opcional, se o cliente souber)" },
        problem: { type: "string", description: "Descrição do problema" },
        phone: { type: "string", description: "Telefone de contato (opcional; usa o número do WhatsApp se omitido)" },
        discount_note: { type: "string", description: "Observação de desconto a aplicar, quando o cliente tem direito (ex: '15% à vista — aniversariante' ou '15% à vista — primeiro serviço'). Deixe vazio se não houver desconto." },
      },
      // Só o essencial é obrigatório. Marca/modelo e telefone são opcionais —
      // o cliente nem sempre sabe a marca/modelo, e o telefone vem do WhatsApp.
      required: ["customer_name", "address", "equipment_type", "problem"],
    },
  },
  {
    name: "get_customer",
    description:
      "Verifica se o número de WhatsApp já é um CLIENTE CADASTRADO. Use no INÍCIO da conversa (o telefone é automático, não peça). Retorna {found, nome, primeiro_nome, data_nascimento, aniversario_mes_atual, ja_cliente}. Se found=false é cliente NOVO (oferecer desconto de primeiro serviço). Se aniversario_mes_atual=true, o cliente faz aniversário neste mês (desconto de aniversariante).",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string", description: "Telefone do cliente (opcional; usa o número do WhatsApp se omitido)" } },
      required: [],
    },
  },
  {
    name: "get_recent_os",
    description: "Consulta as Ordens de Serviço recentes do cliente pelo telefone.",
    input_schema: {
      type: "object",
      properties: { phone: { type: "string", description: "Telefone do cliente" } },
      required: ["phone"],
    },
  },
  {
    name: "handoff_to_human",
    description: "Transfere o atendimento para um humano. Use em casos técnicos demais, fora de escopo ou cliente insatisfeito.",
    input_schema: {
      type: "object",
      properties: { reason: { type: "string", description: "Motivo do escalonamento" } },
      required: ["reason"],
    },
  },
];

function ok() {
  return new Response("ok", { status: 200 });
}

Deno.serve(async (req) => {
  // ── 1. Auth por token na query ─────────────────────────────────────────────
  const url = new URL(req.url);
  if (url.searchParams.get("token") !== Deno.env.get("WEBHOOK_TOKEN")) {
    return new Response("unauthorized", { status: 401 });
  }
  if (req.method !== "POST") return ok();

  // ── 2. Parse + filtro de evento ────────────────────────────────────────────
  let body: any;
  try { body = await req.json(); } catch { return ok(); }
  if (body?.event !== "messages.upsert") return ok();

  const data = body?.data;
  const key = data?.key;
  if (!key || key.fromMe === true) return ok();
  const remoteJid: string = key.remoteJid || "";
  if (remoteJid.endsWith("@g.us")) return ok(); // grupo

  const msg = data?.message || {};
  const text: string =
    msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || "";
  const hasImage = !!msg.imageMessage;
  if (!text && !hasImage) return ok(); // áudio/outros — fase 2

  // ── 3. Responde 200 já; processa em background ─────────────────────────────
  const job = handleMessage({
    instance: body?.instance || "",
    phone: remoteJid.replace(/@.*$/, ""),
    pushName: data?.pushName || "",
    text,
    hasImage,
    messageId: key.id || "",
  });
  // @ts-ignore EdgeRuntime existe no runtime Supabase
  EdgeRuntime.waitUntil(job.catch((e) => console.error("[whatsapp-webhook] bg erro:", e)));
  return ok();
});

interface Job {
  instance: string;
  phone: string;
  pushName: string;
  text: string;
  hasImage: boolean;
  messageId: string;
}

async function handleMessage(j: Job) {
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // ── Dedupe: Evolution dispara MESSAGES_UPSERT várias vezes por msg (status
  // updates PENDING/SENT/DELIVERY_ACK). Insere messageId em tabela UNIQUE;
  // se já existe (23505), retorna sem processar de novo.
  if (j.messageId) {
    const { error: dedupeErr } = await supabase
      .from("whatsapp_processed_messages")
      .insert({ message_id: j.messageId });
    if (dedupeErr && (dedupeErr as { code?: string }).code === "23505") return;
    if (dedupeErr) console.error("[whatsapp-webhook] dedupe:", dedupeErr.message);
  }

  // ── Resolve empresa pela instância ───────────────────────────────────────
  const { data: cfg } = await supabase
    .from("ai_agent_config")
    .select("company_id, system_prompt, business_hours, out_of_hours_message, evolution_url, evolution_instance, enabled, metadata")
    .eq("evolution_instance", j.instance)
    .eq("enabled", true)
    .maybeSingle();
  if (!cfg) { console.log("[whatsapp-webhook] instância não registrada:", j.instance); return; }

  const apikey: string = cfg.metadata?.evolution_apikey || "";
  const evoBase: string = String(cfg.evolution_url || "").replace(/\/+$/, "");

  // ── Upsert conversa ──────────────────────────────────────────────────────
  const convRow: Record<string, unknown> = {
    company_id: cfg.company_id,
    customer_phone: j.phone,
  };
  if (j.pushName) convRow.customer_name = j.pushName;
  const { data: conv, error: convErr } = await supabase
    .from("ai_conversations")
    .upsert(convRow, { onConflict: "company_id,customer_phone" })
    .select("id, status")
    .single();
  if (convErr || !conv) { console.error("[whatsapp-webhook] upsert conversa:", convErr); return; }

  // ── Imagem: baixa da Evolution → Storage ─────────────────────────────────
  let mediaUrl: string | null = null;
  let imageBase64: string | null = null;
  if (j.hasImage && apikey && evoBase) {
    try {
      const r = await fetch(`${evoBase}/chat/getBase64FromMediaMessage/${j.instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey },
        body: JSON.stringify({ message: { key: { id: j.messageId } }, convertToMp4: false }),
      });
      if (r.ok) {
        const jr = await r.json();
        imageBase64 = jr?.base64 || null;
        if (imageBase64) {
          const path = `${cfg.company_id}/${conv.id}/${crypto.randomUUID()}.jpg`;
          const bin = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
          const up = await supabase.storage.from("ai-media").upload(path, bin, {
            contentType: "image/jpeg", upsert: false,
          });
          if (!up.error) {
            mediaUrl = supabase.storage.from("ai-media").getPublicUrl(path).data.publicUrl;
          }
        }
      }
    } catch (e) { console.error("[whatsapp-webhook] imagem:", e); }
  }

  // ── Grava mensagem do cliente ────────────────────────────────────────────
  await supabase.from("ai_messages").insert({
    conversation_id: conv.id,
    company_id: cfg.company_id,
    role: "customer",
    content: j.text || "[imagem enviada pelo cliente]",
    media_url: mediaUrl,
  });

  // ── Gate 1: conversa não-'active' (humano assumiu) ───────────────────────
  if (conv.status !== "active") return;

  // ── Gate 2: fora do horário comercial ────────────────────────────────────
  if (!dentroDoHorario(cfg.business_hours)) {
    const fora = cfg.out_of_hours_message || "Recebemos sua mensagem fora do horário de atendimento. Retornaremos no próximo dia útil.";
    await enviarTexto(evoBase, j.instance, apikey, j.phone, fora);
    await supabase.from("ai_messages").insert({
      conversation_id: conv.id, company_id: cfg.company_id, role: "agent", content: fora,
    });
    return;
  }

  // ── Histórico → mensagens do Claude ──────────────────────────────────────
  const { data: hist } = await supabase
    .from("ai_messages")
    .select("role, content, media_url")
    .eq("conversation_id", conv.id)
    .order("created_at", { ascending: false })
    .limit(HISTORY_LIMIT);
  const ordered = (hist || []).reverse();

  const messages: any[] = ordered.map((m, idx) => {
    const isLast = idx === ordered.length - 1;
    const role = m.role === "customer" ? "user" : "assistant";
    if (isLast && imageBase64 && role === "user") {
      return {
        role,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: imageBase64 } },
          { type: "text", text: m.content || "Analise a imagem enviada." },
        ],
      };
    }
    return { role, content: m.content };
  });

  // ── Loop do agente Claude ────────────────────────────────────────────────
  // Injeta a data de hoje no prompt: a IA não tem relógio e errava o mês do
  // aniversário (dava desconto fora do mês). Agora tem a referência explícita.
  const systemPrompt = `${cfg.system_prompt}\n\n== CONTEXTO ATUAL ==\n${contextoData()}`;
  let resposta = "";
  let handoff = false;
  try {
    for (let iter = 0; iter < MAX_TOOL_ITERS; iter++) {
      const ai = await chamarClaude(systemPrompt, messages);
      const toolUses = (ai.content || []).filter((c: any) => c.type === "tool_use");
      const textos = (ai.content || []).filter((c: any) => c.type === "text").map((c: any) => c.text);
      if (textos.length) resposta = textos.join("\n").trim();

      if (ai.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: ai.content });
      const results: any[] = [];
      for (const tu of toolUses) {
        const out = await executarTool(supabase, cfg, conv.id, j.phone, tu.name, tu.input, mediaUrl);
        if (tu.name === "handoff_to_human") handoff = true;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("[whatsapp-webhook] claude:", e);
    return; // msg do cliente já gravada; admin responde manual
  }

  if (!resposta) return;

  // ── Grava resposta + envia ───────────────────────────────────────────────
  await supabase.from("ai_messages").insert({
    conversation_id: conv.id, company_id: cfg.company_id, role: "agent", content: resposta,
  });
  await enviarTexto(evoBase, j.instance, apikey, j.phone, resposta);

  if (handoff) {
    await supabase.from("ai_conversations").update({ status: "pending_human" }).eq("id", conv.id);
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Data/hora de hoje no fuso de Brasília (UTC-3) — injetada no system prompt pra
// a IA ter referência ao decidir desconto de aniversário (mês corrente).
function brasiliaNow(): Date {
  return new Date(Date.now() - 3 * 3600 * 1000);
}
function contextoData(): string {
  const br = brasiliaNow();
  const meses = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
  const d = String(br.getUTCDate()).padStart(2, "0");
  const m = br.getUTCMonth(); // 0-11
  const y = br.getUTCFullYear();
  return `Data de hoje: ${d}/${String(m + 1).padStart(2, "0")}/${y}. Mês atual: ${meses[m]} (${m + 1}). Use isso para decidir o desconto de aniversário — só vale se o aniversário do cliente cair NESTE mês.`;
}

// Só dígitos
function normDigits(s: unknown): string {
  return String(s ?? "").replace(/\D/g, "");
}

// Remove DDI 55 quando presente (números BR de WhatsApp vêm como 55DDXXXXXXXXX)
function stripDDI(d: string): string {
  return d.length > 11 && d.startsWith("55") ? d.slice(2) : d;
}

// Compara dois telefones tolerando DDI/máscara. Igualdade total ou sufixo de 8
// dígitos (número do assinante) — cobre cadastros legados sem DDD/DDI.
function phonesMatch(a: unknown, b: unknown): boolean {
  const x = stripDDI(normDigits(a));
  const y = stripDDI(normDigits(b));
  if (!x || !y) return false;
  if (x === y) return true;
  return x.length >= 8 && y.length >= 8 && x.slice(-8) === y.slice(-8);
}

// O telefone aparece dentro de um texto livre (ex: observações da OS)?
function phoneInText(text: unknown, tel: unknown): boolean {
  const hay = normDigits(text);
  const needle = stripDDI(normDigits(tel));
  return needle.length >= 8 && hay.includes(needle.slice(-8));
}

// O aniversário (YYYY-MM-DD) cai no mês corrente de Brasília?
function aniversarioMesAtual(dataNasc: string): boolean {
  const m = parseInt(String(dataNasc).slice(5, 7), 10);
  return m >= 1 && m <= 12 && m === brasiliaNow().getUTCMonth() + 1;
}

// Lista registros do kv_store por sufixo de chave, tolerando os dois formatos:
// escopado (`<company_id>:erp:...`) e legado sem prefixo (`erp:...`). Os dados
// atuais são legados (bare); o fallback garante que funcione em ambos.
async function kvList(
  supabase: SupabaseClient, companyId: string, suffix: string,
): Promise<Array<{ key: string; value: unknown }>> {
  const scoped = await supabase
    .from("kv_store").select("key, value").like("key", `${companyId}:${suffix}%`).limit(2000);
  if (scoped.data && scoped.data.length) return scoped.data as Array<{ key: string; value: unknown }>;
  const bare = await supabase
    .from("kv_store").select("key, value").like("key", `${suffix}%`).limit(2000);
  return (bare.data || []) as Array<{ key: string; value: unknown }>;
}

function dentroDoHorario(bh: any): boolean {
  if (!bh) return true;
  const now = new Date();
  // Horário de Brasília (UTC-3)
  const br = new Date(now.getTime() - 3 * 3600 * 1000);
  const dow = br.getUTCDay(); // 0=domingo
  const weekdays: number[] = Array.isArray(bh.weekdays) ? bh.weekdays : [1, 2, 3, 4, 5, 6];
  if (!weekdays.includes(dow)) return false;
  const hm = br.getUTCHours() * 60 + br.getUTCMinutes();
  const [sh, sm] = String(bh.start || "08:00").split(":").map(Number);
  const [eh, em] = String(bh.end || "18:00").split(":").map(Number);
  return hm >= sh * 60 + sm && hm <= eh * 60 + em;
}

async function chamarClaude(systemPrompt: string, messages: any[]): Promise<any> {
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOLS,
      messages,
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return await r.json();
}

async function executarTool(
  supabase: SupabaseClient, cfg: any, conversationId: string, phone: string,
  name: string, input: any, mediaUrl: string | null,
): Promise<string> {
  if (name === "propose_os") {
    const payload = {
      customer_name: String(input.customer_name || "").trim(),
      address: String(input.address || "").trim(),
      equipment_type: String(input.equipment_type || "").trim(),
      equipment_brand: String(input.equipment_brand || "").trim(),
      equipment_model: String(input.equipment_model || "").trim(),
      problem: String(input.problem || "").trim(),
      phone: String(input.phone || phone).replace(/\D/g, ""),
      media_urls: mediaUrl ? [mediaUrl] : [],
      // Observação de desconto sinalizada pela IA (vira nota na OS pro técnico).
      discount_note: String(input.discount_note || "").trim(),
    };
    const { error } = await supabase.from("ai_os_proposals").insert({
      company_id: cfg.company_id, conversation_id: conversationId, payload,
    });
    if (error) return "Erro ao registrar a proposta. Tente novamente.";
    return "Proposta registrada com sucesso. Um atendente vai analisar.";
  }

  if (name === "get_customer") {
    const tel = String(input.phone || phone);
    const rows = await kvList(supabase, cfg.company_id, "erp:client:");
    const cli = rows
      .map((r) => r.value as Record<string, unknown> | null)
      .find((v) => v && [v.telefone, v.celular, v.whatsapp, v.fone].some((c) => phonesMatch(c, tel)));
    if (!cli) return JSON.stringify({ found: false, ja_cliente: false });
    const nome = String(cli.nome || cli.razaoSocial || "").trim();
    const dn = (cli.data_nascimento || cli.dataNascimento || null) as string | null;
    return JSON.stringify({
      found: true,
      ja_cliente: true,
      nome,
      primeiro_nome: nome.split(/\s+/)[0] || "",
      data_nascimento: dn,
      aniversario_mes_atual: dn ? aniversarioMesAtual(dn) : false,
    });
  }

  if (name === "get_recent_os") {
    const tel = String(input.phone || phone);
    const rows = await kvList(supabase, cfg.company_id, "erp:os:");
    const matched = rows
      .map((r) => r.value as Record<string, unknown>)
      .filter((os) => os && (phonesMatch(os.telefone, tel) || phoneInText(os.observacoes, tel)))
      .slice(0, 5)
      .map((os) => ({ numero: os.numero, status: os.status, descricao: os.descricao }));
    return matched.length ? JSON.stringify(matched) : "Nenhuma OS encontrada para este telefone.";
  }

  if (name === "handoff_to_human") {
    await supabase.from("ai_conversations")
      .update({ ai_handoff_reason: String(input.reason || "").slice(0, 500) })
      .eq("id", conversationId);
    return "Atendimento encaminhado para um atendente humano.";
  }

  return "Ferramenta desconhecida.";
}

async function enviarTexto(
  evoBase: string, instance: string, apikey: string, phone: string, text: string,
) {
  if (!evoBase || !apikey) return;
  try {
    await fetch(`${evoBase}/message/sendText/${instance}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey },
      body: JSON.stringify({ number: phone, text }),
    });
  } catch (e) { console.error("[whatsapp-webhook] enviarTexto:", e); }
}
