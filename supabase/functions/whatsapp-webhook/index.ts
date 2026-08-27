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
import { podeAutoReligar } from "./auto-resume.ts";
import { janelaDebounceMs, souAUltimaMensagem } from "./debounce.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
// Auto-religamento: se a IA foi pausada para um humano mas ninguém do time
// respondeu nesse tempo, a IA reassume a conversa quando o cliente voltar a
// escrever. Evita conversas mortas em 'pending_human' pra sempre. Configurável
// via env AUTO_RESUME_HOURS (padrão 6h).
const AUTO_RESUME_MS =
  (Number(Deno.env.get("AUTO_RESUME_HOURS")) || 6) * 3600 * 1000;
// Sonnet 4.6: raciocínio bem melhor que o Haiku pra conduzir o atendimento,
// seguir o fluxo (nome primeiro, reconhecer cliente, regras de desconto) e
// interpretar imagens. Custo/latência maiores, aceitos pra qualidade do bot.
const MODEL = "claude-sonnet-4-6";
const MAX_TOOL_ITERS = 5;
const HISTORY_LIMIT = 20;
// Debounce: cada mensagem do cliente dispara uma execução própria desta
// function. Quando o cliente escreve em rajada ("oi" / "meu ar não gela" /
// "pode vir hoje?"), esperar alguns segundos e deixar só a execução da ÚLTIMA
// mensagem seguir evita chamar o Claude 3x, responder fora de ordem e mandar 3
// avisos iguais de fora-de-horário. Configurável via DEBOUNCE_SECONDS (0
// desliga e volta ao comportamento de responder na hora).
const DEBOUNCE_MS = janelaDebounceMs(Deno.env.get("DEBOUNCE_SECONDS"));

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
  if (!key) return ok();
  // fromMe = mensagem SAINDO do número do negócio. Antes era ignorada; agora é
  // usada pro handoff humano: se o operador responde manual pelo WhatsApp, a IA
  // pausa naquele cliente (ver handleOperatorMessage).
  const fromMe = key.fromMe === true;
  const remoteJid: string = key.remoteJid || "";
  if (remoteJid.endsWith("@g.us")) return ok(); // grupo

  const msg = data?.message || {};
  const text: string =
    msg.conversation || msg.extendedTextMessage?.text || msg.imageMessage?.caption || "";
  const hasImage = !!msg.imageMessage;
  // Nota de voz do WhatsApp: audioMessage (ou pttMessage em algumas versões).
  const hasAudio = !!(msg.audioMessage || msg.pttMessage);
  if (!text && !hasImage && !hasAudio) return ok(); // outros tipos — fase futura

  // ── 3. Responde 200 já; processa em background ─────────────────────────────
  const job = handleMessage({
    instance: body?.instance || "",
    phone: remoteJid.replace(/@.*$/, ""),
    pushName: data?.pushName || "",
    text,
    hasImage,
    hasAudio,
    fromMe,
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
  hasAudio: boolean;
  fromMe: boolean;
  messageId: string;
}

// Comando que o operador manda no chat pra DEVOLVER o atendimento à IA.
// Qualquer outra mensagem do operador (fromMe) faz a IA pausar naquele cliente.
const REENABLE_COMMAND = "#ia";

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
    // Bump explícito da última mensagem. `last_message_at` tem DEFAULT now(),
    // mas default só vale no INSERT — no UPDATE do upsert a coluna ficava
    // congelada na criação da conversa. Efeito: o Inbox do app (ordenado por
    // last_message_at desc) nunca reordenava e conversa ativa afundava na lista.
    last_message_at: new Date().toISOString(),
  };
  // Só usa pushName pra nomear o cliente em mensagens DELE (não nas do operador).
  if (j.pushName && !j.fromMe) convRow.customer_name = j.pushName;
  const { data: conv, error: convErr } = await supabase
    .from("ai_conversations")
    .upsert(convRow, { onConflict: "company_id,customer_phone" })
    .select("id, status, unread_count")
    .single();
  if (convErr || !conv) { console.error("[whatsapp-webhook] upsert conversa:", convErr); return; }

  // ── Mensagem SAINDO do número do negócio (fromMe) ────────────────────────
  // Pode ser: (a) eco da própria IA/sistema → ignora; (b) comando #ia do
  // operador → religa a IA; (c) operador respondendo manual → pausa a IA.
  if (j.fromMe) {
    await handleOperatorMessage(supabase, cfg.company_id, conv.id, j.text);
    return;
  }

  // ── Áudio (nota de voz): baixa da Evolution → transcreve (Groq Whisper) ───
  // O texto transcrito passa a ser a mensagem do cliente e segue o fluxo normal
  // do agente. Se não der pra entender, pede pra escrever.
  let effectiveText = j.text;
  if (j.hasAudio && apikey && evoBase) {
    try {
      const r = await fetch(`${evoBase}/chat/getBase64FromMediaMessage/${j.instance}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey },
        body: JSON.stringify({ message: { key: { id: j.messageId } }, convertToMp4: false }),
      });
      if (r.ok) {
        const jr = await r.json();
        const b64: string | null = jr?.base64 || null;
        if (b64) {
          const transcricao = await transcreverAudio(b64, jr?.mimetype);
          if (transcricao) effectiveText = transcricao;
        }
      }
    } catch (e) { console.error("[whatsapp-webhook] audio:", e); }
    if (!effectiveText) {
      const fb = "Desculpe, não consegui entender o áudio. Pode escrever a sua mensagem, por favor? 🙏";
      await enviarTexto(evoBase, j.instance, apikey, j.phone, fb);
      await supabase.from("ai_messages").insert({
        conversation_id: conv.id, company_id: cfg.company_id, role: "customer", content: "[áudio não reconhecido]",
      });
      await bumpUnread(supabase, conv.id, conv.unread_count);
      await supabase.from("ai_messages").insert({
        conversation_id: conv.id, company_id: cfg.company_id, role: "agent", content: fb,
      });
      return;
    }
  }

  // ── Resposta de pós-venda? ───────────────────────────────────────────────
  // Antes de acionar o agente conversacional de OS, verifica se este inbound é
  // a resposta do cliente a uma mensagem de pós-venda enviada (NPS, lembrete,
  // reagendamento) ainda sem resposta. Se for, classifica a intenção via Haiku,
  // grava em pos_venda_mensagens, manda um ack curto e escala humano (Inbox +
  // email) quando necessário — e NÃO cai no fluxo do agente. Só texto: respostas
  // de pós-venda são textuais (nota, "sim", "quero reagendar").
  if (effectiveText && await handlePosVendaReply(supabase, cfg, { ...j, text: effectiveText })) {
    return;
  }

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
  // O id volta no insert: é ele que o debounce compara depois da espera pra
  // saber se esta execução ainda é a dona da resposta (ver souAUltimaMensagem).
  const { data: msgCliente } = await supabase.from("ai_messages").insert({
    conversation_id: conv.id,
    company_id: cfg.company_id,
    role: "customer",
    content: j.hasAudio ? `🎤 ${effectiveText}` : (effectiveText || "[imagem enviada pelo cliente]"),
    media_url: mediaUrl,
  }).select("id").single();
  const minhaMsgId: string | null = (msgCliente as { id?: string } | null)?.id ?? null;
  await bumpUnread(supabase, conv.id, conv.unread_count);

  // ── Gate 1: conversa não-'active' (humano assumiu) ───────────────────────
  // A IA fica muda em conversas pausadas. Mas se o time não respondeu há
  // AUTO_RESUME_MS, a IA REASSUME quando o cliente volta a escrever — senão a
  // conversa morre em 'pending_human' pra sempre (causa raiz do "IA parou").
  if (conv.status !== "active") {
    const lastAgentAtMs = await ultimaMsgAgenteMs(supabase, conv.id);
    if (!podeAutoReligar(conv.status, lastAgentAtMs, Date.now(), AUTO_RESUME_MS)) return;
    await supabase.from("ai_conversations")
      .update({ status: "active", ai_handoff_reason: null })
      .eq("id", conv.id);
    // segue o fluxo normal abaixo: a IA responde com a conversa já reativada.
  }

  // ── Debounce: espera a rajada do cliente terminar ────────────────────────
  // Fica DEPOIS do Gate 1 (conversa pausada sai na hora, sem gastar espera) e
  // ANTES do Gate 2, pra que 3 mensagens seguidas fora do horário gerem UM
  // aviso, não três. Passada a janela, releio a última mensagem do cliente: se
  // não for mais a minha, chegou mensagem nova e a execução DELA é que
  // responde — esta morre aqui. O histórico montado logo abaixo já inclui
  // todas as mensagens da rajada, então nada se perde.
  if (DEBOUNCE_MS > 0) {
    await new Promise((r) => setTimeout(r, DEBOUNCE_MS));
    const { data: ultima } = await supabase
      .from("ai_messages")
      .select("id")
      .eq("conversation_id", conv.id)
      .eq("role", "customer")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!souAUltimaMensagem(minhaMsgId, (ultima as { id?: string } | null)?.id)) {
      console.log("[whatsapp-webhook] debounce: mensagem superada, execução encerrada");
      return;
    }
  }

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

  // ── Imagens ainda não respondidas ────────────────────────────────────────
  // Antes só a foto da mensagem ATUAL era mandada ao modelo. Com o debounce
  // isso quebraria o caso mais comum de foto: o cliente manda a imagem e
  // escreve logo em seguida — a execução da imagem morre no debounce e a que
  // sobrevive (a do texto) só teria "[imagem enviada pelo cliente]" escrito.
  // Então anexo as fotos de toda a rajada: as mensagens do cliente posteriores
  // à última resposta do agente. Teto de MAX_IMAGENS pra não explodir o custo.
  const MAX_IMAGENS = 3;
  const idxUltimoAgente = ordered.map((m) => m.role).lastIndexOf("agent");
  const imagensPorIdx = new Map<number, string>();
  for (let i = ordered.length - 1; i > idxUltimoAgente && imagensPorIdx.size < MAX_IMAGENS; i--) {
    const m = ordered[i];
    if (m.role !== "customer" || !m.media_url) continue;
    // A imagem da mensagem atual já está em memória; as anteriores vêm do bucket.
    const b64 = (i === ordered.length - 1 && imageBase64)
      ? imageBase64
      : await baixarImagemBase64(supabase, String(m.media_url));
    if (b64) imagensPorIdx.set(i, b64);
  }

  const messages: any[] = ordered.map((m, idx) => {
    const role = m.role === "customer" ? "user" : "assistant";
    const b64 = imagensPorIdx.get(idx);
    if (b64 && role === "user") {
      return {
        role,
        content: [
          { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
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
  // Efeitos colaterais das tools que NÃO podem atrasar a resposta ao cliente
  // (email pra admin/gerente). Rodam depois que a mensagem já saiu. Não são
  // fire-and-forget soltos: promessa órfã dentro de um background task corre
  // risco de ser cortada quando o waitUntil resolve.
  const tarefasPosResposta: Array<() => Promise<void>> = [];
  // Só pra decidir a mensagem de fallback abaixo — o status da conversa quem
  // grava é a própria tool, na hora.
  let houveHandoff = false;
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
        const out = await executarTool(
          supabase, cfg, conv.id, j.phone, tu.name, tu.input, mediaUrl, tarefasPosResposta,
        );
        if (tu.name === "handoff_to_human") houveHandoff = true;
        results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
      }
      messages.push({ role: "user", content: results });
    }
  } catch (e) {
    console.error("[whatsapp-webhook] claude:", e);
    return; // msg do cliente já gravada; admin responde manual
  }

  // ── Grava resposta + envia ───────────────────────────────────────────────
  // Sem texto (o modelo só chamou tool e parou, ou estourou MAX_TOOL_ITERS) não
  // há o que mandar, mas as tarefas pendentes abaixo ainda precisam rodar — por
  // isso o `return` que existia aqui saiu. Era ele que engolia o efeito do
  // handoff quando o modelo transferia o atendimento sem escrever nada junto.
  // No handoff a IA fica muda a partir daqui, então o silêncio não seria
  // corrigido pela próxima mensagem: manda um aviso curto pro cliente saber que
  // um humano assume.
  if (!resposta && houveHandoff) {
    resposta = "Vou transferir seu atendimento para um de nossos atendentes. Em breve alguém fala com você por aqui. 🙏";
  }
  if (resposta) {
    await supabase.from("ai_messages").insert({
      conversation_id: conv.id, company_id: cfg.company_id, role: "agent", content: resposta,
    });
    await enviarTexto(evoBase, j.instance, apikey, j.phone, resposta);
  }

  // ── Notificações das tools (email pra admin/gerente) ─────────────────────
  for (const tarefa of tarefasPosResposta) {
    await tarefa().catch((e) => console.error("[whatsapp-webhook] tarefa pós-resposta:", e));
  }
}

// Baixa uma imagem do bucket ai-media e devolve base64 pro modelo.
// media_url é a URL pública legada, mas o bucket virou privado (migração
// 20260712000000_ai_media_private) — daí o download por path com service_role
// em vez de um fetch na URL, que hoje voltaria 400.
async function baixarImagemBase64(supabase: SupabaseClient, mediaUrl: string): Promise<string | null> {
  try {
    const marcador = "/ai-media/";
    const i = mediaUrl.indexOf(marcador);
    if (i < 0) return null;
    const path = decodeURIComponent(mediaUrl.slice(i + marcador.length).split("?")[0]);
    const { data, error } = await supabase.storage.from("ai-media").download(path);
    if (error || !data) { console.error("[whatsapp-webhook] download imagem:", error?.message); return null; }
    const buf = new Uint8Array(await data.arrayBuffer());
    // btoa em blocos: String.fromCharCode(...buf) estoura a pilha em fotos grandes.
    let bin = "";
    const BLOCO = 0x8000;
    for (let k = 0; k < buf.length; k += BLOCO) bin += String.fromCharCode(...buf.subarray(k, k + BLOCO));
    return btoa(bin);
  } catch (e) {
    console.error("[whatsapp-webhook] baixarImagemBase64:", e);
    return null;
  }
}

// Incrementa o contador de não lidas da conversa. O app zera ao abrir o chat
// (loadMessages). Sem isso o badge do Inbox nunca subia com mensagem nova.
async function bumpUnread(supabase: SupabaseClient, convId: string, atual: unknown) {
  const n = typeof atual === "number" ? atual : 0;
  const { error } = await supabase
    .from("ai_conversations")
    .update({ unread_count: n + 1 })
    .eq("id", convId);
  if (error) console.error("[whatsapp-webhook] unread_count:", error.message);
}

// Timestamp (ms) da última mensagem SAINDO do número (role=agent) — seja da
// IA ou de um operador humano. É o proxy de "quando o time falou por último"
// usado pelo auto-religamento. Retorna null se não há nenhuma.
async function ultimaMsgAgenteMs(
  supabase: SupabaseClient, conversationId: string,
): Promise<number | null> {
  const { data } = await supabase
    .from("ai_messages")
    .select("created_at")
    .eq("conversation_id", conversationId)
    .eq("role", "agent")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const ts = (data as { created_at?: string } | null)?.created_at;
  return ts ? new Date(ts).getTime() : null;
}

// Trata mensagem que SAIU do número do negócio (fromMe). Decide entre eco,
// comando de religar a IA, ou handoff humano (operador assumiu a conversa).
async function handleOperatorMessage(
  supabase: SupabaseClient, companyId: string, conversationId: string, text: string,
) {
  const limpo = (text || "").trim();

  // Comando explícito pra devolver o atendimento à IA.
  if (limpo.toLowerCase() === REENABLE_COMMAND) {
    await supabase.from("ai_conversations")
      .update({ status: "active", ai_handoff_reason: null })
      .eq("id", conversationId);
    return;
  }

  // Eco da própria IA/sistema: a mensagem já foi gravada como role=agent ANTES
  // de ser enviada (e a msg de aprovação também). Se o texto bate com uma das
  // últimas respostas do agente, é eco — não é o operador. Não pausa.
  const { data: recentAgent } = await supabase
    .from("ai_messages")
    .select("content")
    .eq("conversation_id", conversationId)
    .eq("role", "agent")
    .order("created_at", { ascending: false })
    .limit(5);
  if ((recentAgent || []).some((m: { content: string | null }) => (m.content || "").trim() === limpo)) {
    return; // eco, ignora
  }

  // Operador respondeu manualmente → pausa a IA naquele cliente e registra a
  // fala do humano na timeline da conversa (pro app mostrar).
  await supabase.from("ai_conversations")
    .update({ status: "pending_human" })
    .eq("id", conversationId);
  if (limpo) {
    await supabase.from("ai_messages").insert({
      conversation_id: conversationId, company_id: companyId, role: "agent", content: limpo,
    });
  }
}

// ─── Pós-venda: captura + classificação de respostas ────────────────────────

// Modelo barato/rápido pra classificar respostas curtas de pós-venda. Não
// precisa do raciocínio do Sonnet — é só mapear texto → intenção + nota NPS.
const POSVENDA_MODEL = "claude-haiku-4-5";
const POSVENDA_JANELA_DIAS = 7; // resposta só conta se a msg foi enviada nos últimos N dias
const INTENCOES = ["confirma", "reagenda", "duvida", "cancela", "parar", "outro"];

const CLASSIFY_TOOL = {
  name: "registrar_classificacao",
  description: "Registra a classificação da resposta do cliente. Sempre chame esta tool.",
  input_schema: {
    type: "object",
    properties: {
      intencao: {
        type: "string",
        enum: INTENCOES,
        description:
          "Intenção principal da resposta. confirma=concorda/positivo/ok; reagenda=quer remarcar a visita/serviço; duvida=fez pergunta que precisa de humano; cancela=quer cancelar a visita/serviço; parar=pediu pra não receber mais mensagens (descadastro); outro=qualquer outra coisa.",
      },
      nps_score: {
        type: ["integer", "null"],
        description: "Se a mensagem enviada era uma pesquisa NPS e o cliente deu uma nota de 0 a 10, a nota. Caso contrário, null.",
      },
      resumo: { type: "string", description: "Resumo de uma frase do que o cliente disse." },
    },
    required: ["intencao", "resumo"],
  },
};

// Detecta e trata uma resposta de pós-venda. Retorna true se ESTE inbound era a
// resposta a uma mensagem de pós-venda pendente (e já foi tratado) — nesse caso
// o caller NÃO deve rodar o agente conversacional.
async function handlePosVendaReply(supabase: SupabaseClient, cfg: any, j: Job): Promise<boolean> {
  const desde = new Date(Date.now() - POSVENDA_JANELA_DIAS * 24 * 3600 * 1000).toISOString();
  // Mensagens enviadas, sem resposta, dentro da janela, da mesma empresa.
  const { data: candidatos } = await supabase
    .from("pos_venda_mensagens")
    .select("id, tipo, conteudo, telefone, cliente_id, cliente_nome, os_numero, metadata")
    .eq("company_id", cfg.company_id)
    .eq("status", "enviada")
    .is("respondida_em", null)
    .gte("enviada_em", desde)
    .order("enviada_em", { ascending: false })
    .limit(50);
  if (!candidatos || candidatos.length === 0) return false;

  // Casa pelo telefone (tolera DDI/DDD/máscara via phonesMatch).
  const alvo = candidatos.find((c) => phonesMatch(c.telefone, j.phone));
  if (!alvo) return false;

  // Classifica a intenção + nota NPS.
  let cls: { intencao: string; nps_score: number | null; resumo: string };
  try {
    cls = await classifyPosVendaReply(alvo.tipo, alvo.conteudo, j.text);
  } catch (e) {
    console.error("[pos-venda] classify erro:", e);
    // Fallback: registra a resposta crua e marca pra humano (não perde o retorno).
    cls = { intencao: "outro", nps_score: null, resumo: "" };
  }

  const precisaHumano =
    ["duvida", "cancela", "parar"].includes(cls.intencao) ||
    (alvo.tipo === "nps" && cls.nps_score != null && cls.nps_score <= 6) ||
    // Resposta a uma proposta de reagendamento: o humano fecha o agendamento (Inbox).
    alvo.tipo === "reagendamento";

  // Atualiza a linha da fila com a resposta classificada.
  const metaPrev = (alvo.metadata && typeof alvo.metadata === "object") ? alvo.metadata as Record<string, unknown> : {};
  await supabase.from("pos_venda_mensagens").update({
    status: "respondida",
    resposta_cliente: j.text,
    intencao_detectada: cls.intencao,
    respondida_em: new Date().toISOString(),
    precisa_humano: precisaHumano,
    metadata: { ...metaPrev, nps_score: cls.nps_score, resumo: cls.resumo, classificado_em: new Date().toISOString() },
  }).eq("id", alvo.id);

  // Opt-out: cliente pediu pra parar → não recebe mais pós-venda.
  if (cls.intencao === "parar" && alvo.cliente_id) {
    await supabase.from("pos_venda_optout").insert({
      cliente_id: alvo.cliente_id,
      company_id: cfg.company_id,
      motivo: "cliente pediu para parar via WhatsApp (pós-venda)",
      origem: "whatsapp_reply",
    }); // erro de duplicado é ignorado (cliente já opt-out)
  }

  const evoBase = String(cfg.evolution_url || "").replace(/\/+$/, "");
  const apikey = cfg.metadata?.evolution_apikey || "";

  // Reagendamento automático: resposta positiva a um lembrete → propõe a data prevista.
  // O texto vem pré-renderizado do App.jsx (metadata.reagendamento_conteudo, só quando
  // enviar_reagendamento está ligado). Envia na hora e grava a linha `reagendamento`
  // (status enviada) pra próxima resposta do cliente casar e cair no Inbox. Só uma
  // proposta por OS (idempotência) e só nasce de resposta a lembrete (sem loop).
  let reagendamentoEnviado = false;
  if (alvo.tipo === "lembrete_visita" && ["confirma", "reagenda"].includes(cls.intencao) && alvo.os_id && alvo.cliente_id) {
    const reagText = (alvo.metadata && typeof alvo.metadata === "object")
      ? (alvo.metadata as Record<string, unknown>).reagendamento_conteudo
      : null;
    if (reagText && evoBase && apikey) {
      const { data: jaReag } = await supabase.from("pos_venda_mensagens")
        .select("id").eq("company_id", cfg.company_id).eq("os_id", alvo.os_id).eq("tipo", "reagendamento").limit(1);
      if (!jaReag || jaReag.length === 0) {
        try {
          await enviarTexto(evoBase, cfg.evolution_instance, apikey, j.phone, String(reagText));
          await supabase.from("pos_venda_mensagens").insert({
            company_id: cfg.company_id,
            os_id: alvo.os_id,
            cliente_id: alvo.cliente_id,
            cliente_nome: alvo.cliente_nome,
            os_numero: alvo.os_numero,
            tipo: "reagendamento",
            status: "enviada",
            canal: "whatsapp",
            conteudo: String(reagText),
            telefone: alvo.telefone,
            agendada_para: new Date().toISOString(),
            enviada_em: new Date().toISOString(),
          });
          reagendamentoEnviado = true;
        } catch (e) { console.error("[pos-venda] reagendamento erro:", e); }
      } else {
        reagendamentoEnviado = true; // já proposto antes → não manda ack genérico duplicado
      }
    }
  }

  // Ack curto pro cliente não ficar no vácuo (pulado quando já mandamos a proposta).
  if (!reagendamentoEnviado) {
    const ack = ackPosVenda(cls.intencao, alvo.tipo);
    if (ack && evoBase && apikey) {
      try {
        await enviarTexto(evoBase, cfg.evolution_instance, apikey, j.phone, ack);
      } catch (e) { console.error("[pos-venda] ack erro:", e); }
    }
  }

  // Escala humano: Inbox (precisa_humano já setado) + email pra admin/gerente.
  if (precisaHumano) {
    await notifyPosVendaHumano(supabase, cfg.company_id, alvo, j.text, cls).catch((e) =>
      console.error("[pos-venda] email erro:", e));
  }

  return true;
}

// Classifica a resposta do cliente via Haiku, forçando saída estruturada (tool).
async function classifyPosVendaReply(
  tipo: string, enviado: string, resposta: string,
): Promise<{ intencao: string; nps_score: number | null; resumo: string }> {
  const sys =
    "Você classifica respostas de clientes a mensagens de pós-venda de uma assistência técnica de refrigeração. " +
    "Tipos de mensagem enviada: nps (pesquisa de satisfação com nota 0-10), lembrete_visita (lembrete de manutenção), " +
    "reagendamento (proposta de nova data), custom. Classifique a INTENÇÃO da resposta e, se a mensagem enviada era NPS " +
    "e o cliente deu uma nota, extraia a nota de 0 a 10. Sempre chame a tool registrar_classificacao.";
  const user = `Mensagem que ENVIAMOS (tipo=${tipo}):\n"""${enviado || ""}"""\n\nResposta do CLIENTE:\n"""${resposta}"""`;
  const r = await fetch(ANTHROPIC_URL, {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: POSVENDA_MODEL,
      max_tokens: 512,
      system: sys,
      tools: [CLASSIFY_TOOL],
      tool_choice: { type: "tool", name: "registrar_classificacao" },
      messages: [{ role: "user", content: user }],
    }),
  });
  if (!r.ok) throw new Error(`Anthropic ${r.status}: ${(await r.text()).slice(0, 300)}`);
  const jr = await r.json();
  const tu = (jr.content || []).find((c: any) => c.type === "tool_use");
  const out = (tu?.input || {}) as Record<string, unknown>;
  const intencao = INTENCOES.includes(String(out.intencao)) ? String(out.intencao) : "outro";
  const rawNps = out.nps_score;
  const nps = (typeof rawNps === "number" && rawNps >= 0 && rawNps <= 10) ? Math.round(rawNps) : null;
  return { intencao, nps_score: nps, resumo: String(out.resumo || "").slice(0, 300) };
}

// Ack curto enviado ao cliente após capturar a resposta.
function ackPosVenda(intencao: string, tipo: string): string {
  switch (intencao) {
    case "parar": return "Tudo bem, não enviaremos mais mensagens. Obrigado! 🙏";
    case "reagenda": return "Certo! Vou encaminhar pra nossa equipe remarcar com você. 👍";
    case "cancela": return "Entendido. Vou avisar nossa equipe e em breve falamos com você.";
    case "duvida": return "Recebi sua mensagem! Nossa equipe vai te responder em seguida. 🙏";
    case "confirma": return tipo === "nps" ? "Muito obrigado pelo seu feedback! 🙏" : "Perfeito, obrigado pela confirmação! 👍";
    default: return tipo === "nps" ? "Obrigado pelo seu retorno! 🙏" : "Recebido, obrigado!";
  }
}

// ─── Notificações por email (admin/gerente) ─────────────────────────────────

// Escapa HTML antes de interpolar em email. O conteúdo vem do WhatsApp do
// cliente (input não confiável): sem isso um "<img src=x onerror=...>" no nome
// ou no problema vira markup dentro da caixa de entrada do gestor.
function escapeHtml(v: unknown): string {
  return String(v ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Emails dos admin/gerente ATIVOS da empresa. auth.users só é legível com
// service_role — daí a resolução um a um por getUserById.
async function emailsGestores(supabase: SupabaseClient, companyId: string): Promise<string[]> {
  const { data: gestores } = await supabase
    .from("company_members")
    .select("user_id")
    .eq("company_id", companyId)
    .in("role", ["admin", "gerente"])
    .eq("status", "ativo");
  const ids = [...new Set((gestores || []).map((m: { user_id: string }) => m.user_id))];
  const emails: string[] = [];
  for (const uid of ids) {
    const { data, error } = await supabase.auth.admin.getUserById(uid);
    if (!error && data?.user?.email) emails.push(data.user.email);
  }
  return emails;
}

// Nome da empresa pro assunto/corpo do email (fallback: FrostERP).
async function nomeEmpresa(supabase: SupabaseClient, companyId: string): Promise<string> {
  const { data } = await supabase.from("companies").select("nome").eq("id", companyId).maybeSingle();
  return String((data as { nome?: string } | null)?.nome || "FrostERP");
}

// Dispara o email pela edge function send-email (Resend centralizado).
async function enviarEmailInterno(
  to: string[], subject: string, html: string, text: string,
): Promise<void> {
  if (!to.length) return;
  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") || "";
  const INTERNAL_SECRET = Deno.env.get("INTERNAL_FUNCTION_SECRET") || "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  // ANON_KEY no Authorization: o gateway rejeita (401) o token service_role na
  // chamada entre Edge Functions. Auth real é o x-internal-secret abaixo.
  if (ANON_KEY) { headers.apikey = ANON_KEY; headers.Authorization = `Bearer ${ANON_KEY}`; }
  if (INTERNAL_SECRET) headers["x-internal-secret"] = INTERNAL_SECRET;
  const r = await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
    method: "POST",
    headers,
    body: JSON.stringify({ to, subject, html, text }),
  });
  if (!r.ok) console.error("[whatsapp-webhook] send-email:", r.status, (await r.text()).slice(0, 200));
}

// Email de "nova proposta de OS aguardando aprovação". Chamado pela tool
// propose_os DEPOIS que a resposta já foi pro cliente (não atrasa a conversa).
async function notificarPropostaOS(
  supabase: SupabaseClient, companyId: string, payload: Record<string, unknown>,
): Promise<void> {
  const emails = await emailsGestores(supabase, companyId);
  if (!emails.length) return;
  const empresa = escapeHtml(await nomeEmpresa(supabase, companyId));
  const cliente = String(payload.customer_name || "cliente");
  const equipamento = [payload.equipment_type, payload.equipment_brand, payload.equipment_model]
    .map((x) => String(x || "").trim()).filter(Boolean).join(" ") || "—";
  const desconto = String(payload.discount_note || "").trim();
  const html = `
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="color:#d97706;margin-bottom:8px;">Nova proposta de OS aguardando aprovação</h2>
      <p style="color:#374151;">O agente de WhatsApp registrou uma solicitação em <strong>${empresa}</strong>. Ela só vira OS depois que você aprovar.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Cliente</td><td><strong>${escapeHtml(cliente)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Telefone</td><td>${escapeHtml(payload.phone || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Endereço</td><td>${escapeHtml(payload.address || "—")}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Equipamento</td><td>${escapeHtml(equipamento)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Problema</td><td>${escapeHtml(payload.problem || "—")}</td></tr>
        ${desconto ? `<tr><td style="padding:6px 0;color:#6b7280;">Desconto</td><td>${escapeHtml(desconto)}</td></tr>` : ""}
      </table>
      <p style="color:#6b7280;font-size:13px;">Abra o FrostERP → IA / Atendimento → Propostas de OS pra aprovar ou rejeitar.</p>
    </div>`;
  const text = `Nova proposta de OS em ${await nomeEmpresa(supabase, companyId)}. Cliente: ${cliente}. Aprovar no FrostERP → IA / Atendimento → Propostas de OS.`;
  await enviarEmailInterno(emails, `[Frost] Nova proposta de OS — ${cliente}`, html, text);
}

// Email de "cliente pedindo humano". Chamado pela tool handoff_to_human.
async function notificarHandoff(
  supabase: SupabaseClient, companyId: string, conversationId: string,
  phone: string, motivo: string,
): Promise<void> {
  const emails = await emailsGestores(supabase, companyId);
  if (!emails.length) return;
  const { data: conv } = await supabase
    .from("ai_conversations")
    .select("customer_name, customer_phone")
    .eq("id", conversationId)
    .maybeSingle();
  const c = conv as { customer_name?: string; customer_phone?: string } | null;
  const nome = c?.customer_name || "Cliente";
  const tel = c?.customer_phone || phone || "—";
  const html = `
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="color:#dc2626;margin-bottom:8px;">Cliente pedindo atendimento humano</h2>
      <p style="color:#374151;">A IA pausou esta conversa e não responde mais até alguém assumir.</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px;">
        <tr><td style="padding:6px 0;color:#6b7280;">Cliente</td><td><strong>${escapeHtml(nome)}</strong></td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Telefone</td><td>${escapeHtml(tel)}</td></tr>
        <tr><td style="padding:6px 0;color:#6b7280;">Motivo</td><td>${escapeHtml(motivo)}</td></tr>
      </table>
      <p style="color:#6b7280;font-size:13px;">Responda direto no WhatsApp ou pelo FrostERP → IA / Atendimento. Pra devolver o atendimento à IA, mande <strong>${escapeHtml(REENABLE_COMMAND)}</strong> no chat ou use o botão "Reativar IA".</p>
    </div>`;
  const text = `Cliente pedindo humano: ${nome} (${tel}). Motivo: ${motivo}. Responda no WhatsApp ou no FrostERP.`;
  await enviarEmailInterno(emails, `[Frost] Cliente pedindo humano — ${nome}`, html, text);
}

// Notifica admin/gerente ativos por email quando uma resposta precisa de humano.
// Reusa a edge function send-email (Resend). Roda em contexto service_role.
async function notifyPosVendaHumano(
  supabase: SupabaseClient, companyId: string, alvo: any, respostaCliente: string,
  cls: { intencao: string; nps_score: number | null; resumo: string },
): Promise<void> {
  const emails = await emailsGestores(supabase, companyId);
  if (!emails.length) return;

  const cliente = alvo.cliente_nome || "Cliente";
  const intLabel: Record<string, string> = {
    confirma: "Confirmou", reagenda: "Quer reagendar", duvida: "Dúvida (precisa humano)",
    cancela: "Cancelou", parar: "Pediu opt-out", outro: "Outro",
  };
  const label = intLabel[cls.intencao] || cls.intencao;
  const subject = `Pós-venda: resposta de ${cliente} precisa de atenção`;
  const npsLine = cls.nps_score != null ? ` · NPS ${cls.nps_score}` : "";
  const html = `
    <div style="font-family:-apple-system,'Segoe UI',sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#111;">
      <h2 style="color:#b91c1c;margin-bottom:8px;">Resposta de pós-venda aguardando atendimento</h2>
      <p style="color:#374151;"><strong>${escapeHtml(cliente)}</strong>${alvo.os_numero ? ` · OS ${escapeHtml(alvo.os_numero)}` : ""}</p>
      <p style="color:#6b7280;">Intenção detectada: <strong>${escapeHtml(label)}</strong>${npsLine}</p>
      <p style="color:#6b7280;margin-bottom:4px;">Enviamos:</p>
      <blockquote style="margin:0 0 12px;color:#374151;">${escapeHtml(alvo.conteudo || "")}</blockquote>
      <p style="color:#111;margin-bottom:4px;">Cliente respondeu:</p>
      <blockquote style="margin:0;border-left:3px solid #06b6d4;padding-left:8px;color:#111;">${escapeHtml(respostaCliente)}</blockquote>
      <p style="color:#6b7280;font-size:13px;margin-top:16px;">Abra o FrostERP → Pós-Venda → Inbox pra responder.</p>
    </div>`;
  const text = `Pós-venda: ${cliente} respondeu (${label}${npsLine}): "${respostaCliente}"`;

  await enviarEmailInterno(emails, subject, html, text);
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

// Campos que a proposta precisa ter pra o atendente conseguir aprová-la no app.
// Espelha `required` de validateOSProposal (src/utils.js) — se divergir, a
// proposta entra na fila mas trava na aprovação com "Proposta incompleta".
const PROPOSTA_OBRIGATORIOS: Record<string, string> = {
  customer_name: "nome do cliente",
  address: "endereço",
  equipment_type: "tipo de equipamento",
  problem: "descrição do problema",
  phone: "telefone",
};

async function executarTool(
  supabase: SupabaseClient, cfg: any, conversationId: string, phone: string,
  name: string, input: any, mediaUrl: string | null,
  tarefasPosResposta: Array<() => Promise<void>> = [],
): Promise<string> {
  if (name === "propose_os") {
    const payload: Record<string, unknown> = {
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

    // Valida ANTES de gravar. Sem isso a IA conseguia registrar proposta sem
    // endereço/telefone: ela caía na fila do atendente e só falhava na hora de
    // aprovar. Devolvendo o que falta, o modelo volta e pergunta ao cliente.
    const faltando = Object.entries(PROPOSTA_OBRIGATORIOS)
      .filter(([k]) => !String(payload[k] || "").trim())
      .map(([, rotulo]) => rotulo);
    if (faltando.length) {
      return `Não registrei: faltam dados obrigatórios (${faltando.join(", ")}). Pergunte ao cliente e chame a ferramenta de novo.`;
    }

    // Idempotência: o modelo costuma chamar propose_os de novo depois que o
    // cliente corrige um dado ("na verdade é no bloco B"). Sem isso a fila do
    // atendente enche de propostas duplicadas da mesma conversa — atualiza a
    // pendente em vez de empilhar.
    const { data: pendente } = await supabase
      .from("ai_os_proposals")
      .select("id, payload")
      .eq("conversation_id", conversationId)
      .eq("status", "pending_approval")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (pendente) {
      // Preserva fotos anexadas em mensagens anteriores da mesma conversa: a
      // execução atual só conhece a mídia da mensagem que a disparou.
      const anteriores = Array.isArray((pendente as any).payload?.media_urls)
        ? (pendente as any).payload.media_urls as string[]
        : [];
      const atuais = payload.media_urls as string[];
      payload.media_urls = [...new Set([...anteriores, ...atuais])];
      const { error: updErr } = await supabase
        .from("ai_os_proposals")
        .update({ payload })
        .eq("id", (pendente as { id: string }).id);
      if (updErr) {
        console.error("[whatsapp-webhook] propose_os update:", updErr.message);
        return "Erro ao atualizar a proposta. Tente novamente.";
      }
      return "Proposta atualizada com os novos dados. Um atendente vai analisar.";
    }

    const { data: ins, error } = await supabase
      .from("ai_os_proposals")
      .insert({
        company_id: cfg.company_id,
        conversation_id: conversationId,
        payload,
        // Explícito e não só pelo DEFAULT da coluna: o painel de aprovação
        // filtra por status e uma proposta com status errado fica invisível.
        status: "pending_approval",
      })
      .select("id")
      .single();
    if (error || !ins) {
      console.error("[whatsapp-webhook] propose_os insert:", error?.message);
      return "Erro ao registrar a proposta. Tente novamente.";
    }

    // Avisa admin/gerente por email. O push do app (listener Realtime em
    // IAAtendimentoModule) só chega em quem está com o FrostERP aberto na aba
    // de IA — o email é o canal que não depende de ninguém estar olhando.
    tarefasPosResposta.push(() => notificarPropostaOS(supabase, cfg.company_id, payload));
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
    const motivo = String(input.reason || "").trim().slice(0, 500) || "Cliente pediu atendimento humano";
    // Pausa a IA NA HORA (status='pending_human'), junto com o motivo. Antes só
    // o motivo era gravado aqui e o status ficava pra um `if (handoff)` no fim
    // do handleMessage, depois de um `return` que disparava quando o modelo
    // chamava a tool sem escrever texto: a conversa ficava com o aviso na tela
    // mas status='active', e a IA seguia respondendo por cima do atendente.
    const { error } = await supabase.from("ai_conversations")
      .update({ status: "pending_human", ai_handoff_reason: motivo })
      .eq("id", conversationId);
    if (error) {
      console.error("[whatsapp-webhook] handoff:", error.message);
      return "Não consegui registrar a transferência. Peça ao cliente que aguarde e não prometa retorno imediato.";
    }
    tarefasPosResposta.push(() => notificarHandoff(supabase, cfg.company_id, conversationId, phone, motivo));
    return "Atendimento transferido para um atendente humano. A IA não responde mais nesta conversa até um humano devolvê-la.";
  }

  return "Ferramenta desconhecida.";
}

// Transcreve uma nota de voz (base64) via Groq Whisper (large-v3). OpenAI-compat.
// Retorna o texto transcrito ou "" em caso de erro/sem chave. WhatsApp manda a
// voz em OGG/Opus; Whisper aceita direto.
async function transcreverAudio(base64: string, mimetype?: string): Promise<string> {
  const key = Deno.env.get("GROQ_API_KEY");
  if (!key) { console.warn("[whatsapp-webhook] GROQ_API_KEY ausente — áudio não transcrito"); return ""; }
  try {
    const bin = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const type = mimetype || "audio/ogg";
    const ext = /mp4|m4a|aac/.test(type) ? "m4a" : /mpeg|mp3/.test(type) ? "mp3" : /wav/.test(type) ? "wav" : "ogg";
    const form = new FormData();
    form.append("file", new Blob([bin], { type }), `audio.${ext}`);
    form.append("model", "whisper-large-v3");
    form.append("language", "pt");
    form.append("response_format", "json");
    const r = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
    if (!r.ok) { console.error("[whatsapp-webhook] Groq transcrição:", r.status, (await r.text()).slice(0, 200)); return ""; }
    const jr = await r.json();
    return String(jr?.text || "").trim();
  } catch (e) {
    console.error("[whatsapp-webhook] transcreverAudio:", e);
    return "";
  }
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
