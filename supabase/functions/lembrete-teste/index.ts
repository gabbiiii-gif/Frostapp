// Edge Function: lembrete-teste
// Envia o resumo do dono NA HORA (ignora janela/dedupe). Caller precisa ser
// admin/gerente da empresa. Usado pelo botao "Enviar resumo agora".
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const TZ = "America/Sao_Paulo";

function json(b: unknown, s = 200) { return new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } }); }
function normalizarTelefoneBR(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return ""; if (d.length >= 12 && d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d; return d;
}
function tipoCliente(c: Record<string, unknown>): "pj" | "pf" {
  const t = String(c?.tipo || "").toLowerCase();
  if (t === "pj" || t === "pf") return t;
  if (c?.cnpj && String(c.cnpj).trim()) return "pj";
  if (c?.cpf && String(c.cpf).trim()) return "pf"; return "pf";
}
function fmtData(iso: string): string { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: TZ }); }
async function kvList(sb: SupabaseClient, companyId: string, suffix: string) {
  const scoped = await sb.from("kv_store").select("value").like("key", `${companyId}:${suffix}%`).limit(5000);
  if (scoped.data && scoped.data.length) return scoped.data.map((r: { value: unknown }) => r.value as Record<string, unknown>);
  const bare = await sb.from("kv_store").select("value").eq("company_id", companyId).like("key", `${suffix}%`).limit(5000);
  return (bare.data || []).map((r: { value: unknown }) => r.value as Record<string, unknown>);
}

// Rótulos pt-BR dos status de OS (alinhado ao STATUS_MAP do app). Os fechados são ignorados.
const STATUS_LABEL_OS: Record<string, string> = {
  aguardando: "Aguardando", agendado: "Agendado", confirmado: "Confirmado",
  em_deslocamento: "Em Deslocamento", em_execucao: "Em Execução", em_andamento: "Em Andamento",
  em_servico: "Em Serviço", aguardando_finalizacao: "Aguardando Finalização", pendente: "Pendente",
};
const STATUS_OS_FECHADO = new Set(["finalizado", "cancelado", "recusado"]);

// Monta o bloco de FATOS operacionais do dono a partir de OS + clientes já carregados.
// Não faz query nova nem inventa nada: só conta/filtra o que existe. Retorna o texto que
// alimenta a IA e um fallback determinístico (usado se a IA falhar/timeout).
function montarFatosDono(p: {
  oss: Record<string, unknown>[]; clientes: Record<string, unknown>[];
  vencendoLinhas: string[]; vencendoQtd: number; agora: Date; lookaheadDias: number;
}): { texto: string; fallback: string } {
  // 1. OS abertas por status (exclui finalizado/cancelado/recusado)
  const contagem: Record<string, number> = {};
  let totalAbertas = 0;
  for (const os of p.oss) {
    const st = String(os.status || "");
    if (!st || STATUS_OS_FECHADO.has(st)) continue;
    contagem[st] = (contagem[st] || 0) + 1; totalAbertas++;
  }
  const linhasStatus = Object.entries(contagem).sort((a, b) => b[1] - a[1])
    .map(([st, n]) => `  - ${STATUS_LABEL_OS[st] || st}: ${n}`).join("\n") || "  - nenhuma";

  // 2. Visitas agendadas nos próximos N dias — SEMPRE (independe do flag de lembrete ao cliente)
  const limite = new Date(p.agora); limite.setDate(limite.getDate() + p.lookaheadDias);
  const agendadas: { quando: Date; txt: string }[] = [];
  for (const os of p.oss) {
    if (STATUS_OS_FECHADO.has(String(os.status || ""))) continue;
    if (!os.dataAgendada) continue;
    const quando = new Date(String(os.dataAgendada).slice(0, 10) + "T" + String(os.horaAgendada || "08:00") + ":00");
    if (isNaN(quando.getTime()) || quando < p.agora || quando > limite) continue;
    agendadas.push({ quando, txt: `  - ${fmtData(quando.toISOString())} — ${String(os.clienteNome || "cliente")} (${String(os.equipamentoTipo || "—")})` });
  }
  agendadas.sort((a, b) => a.quando.getTime() - b.quando.getTime());
  const linhasAgend = agendadas.slice(0, 20).map((a) => a.txt).join("\n") || "  - nenhuma";

  // 3. Manutenções vencendo (já vêm formatadas)
  const linhasVenc = p.vencendoLinhas.length ? p.vencendoLinhas.slice(0, 20).map((l) => `  ${l}`).join("\n") : "  - nenhuma";

  const texto = [
    `OS abertas (${totalAbertas}):`, linhasStatus, "",
    `Manutencoes vencendo (${p.vencendoQtd}):`, linhasVenc, "",
    `Visitas agendadas proximos ${p.lookaheadDias} dias (${agendadas.length}):`, linhasAgend, "",
    `Total de clientes cadastrados: ${p.clientes.length}`,
  ].join("\n");

  const fallback = `Resumo do dia: ${totalAbertas} OS aberta(s), ${p.vencendoQtd} manutencao(oes) vencendo, ${agendadas.length} visita(s) agendada(s) nos proximos ${p.lookaheadDias} dias. ${p.clientes.length} clientes cadastrados.`;

  return { texto, fallback };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } });
  const { data: ud, error: uerr } = await userClient.auth.getUser();
  if (uerr || !ud?.user) return json({ ok: false, error: "invalid_token" }, 401);

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: member } = await admin.from("company_members").select("company_id, role").eq("user_id", ud.user.id).maybeSingle();
  if (!member || !["admin", "gerente"].includes(String(member.role))) return json({ ok: false, error: "forbidden" }, 403);
  const companyId = String(member.company_id);

  const { data: cfg } = await admin.from("lembrete_config").select("*").eq("company_id", companyId).maybeSingle();
  if (!cfg || !cfg.dono_telefone) return json({ ok: false, error: "dono_telefone_nao_configurado" }, 400);

  const { data: evo } = await admin.from("ai_agent_config").select("evolution_url, evolution_instance, enabled, metadata").eq("enabled", true).limit(1).maybeSingle();
  const apikey = String((evo?.metadata as Record<string, unknown> | null)?.evolution_apikey || "") || Deno.env.get("EVOLUTION_APIKEY") || "";
  const evoBase = evo?.evolution_url ? String(evo.evolution_url).replace(/\/+$/, "") : "";
  const evoInstance = evo?.evolution_instance ? String(evo.evolution_instance) : "";
  if (!evoBase || !evoInstance || !apikey) return json({ ok: false, error: "evolution_nao_configurada" }, 400);

  const clientes = await kvList(admin, companyId, "erp:client:");
  const oss = await kvList(admin, companyId, "erp:os:");
  const agora = new Date();
  const vencendo: string[] = [];
  for (const c of clientes) {
    const clienteId = String(c.id || ""); if (!clienteId) continue;
    let ultima: string | null = null;
    for (const os of oss) {
      if (os.clienteId !== clienteId || os.status !== "finalizado") continue;
      const d = (os.dataConclusao || os.updatedAt) as string | undefined;
      if (d && (!ultima || new Date(d) > new Date(ultima))) ultima = d;
    }
    if (!ultima) continue;
    const override = Number(c.intervalo_manutencao_dias);
    const intervalo = override > 0 ? override : (tipoCliente(c) === "pj" ? Number(cfg.intervalo_pj_dias) : Number(cfg.intervalo_pf_dias));
    const proxima = new Date(ultima); proxima.setDate(proxima.getDate() + intervalo);
    const diasRest = Math.ceil((proxima.getTime() - agora.getTime()) / 86400000);
    if (diasRest < 0 || diasRest > Number(cfg.antecedencia_dias)) continue;
    vencendo.push(`- ${String(c.nome || "cliente")} — vence ${fmtData(proxima.toISOString())}`);
  }

  // Panorama operacional geral — só dados reais (OS + clientes já carregados)
  const fatos = montarFatosDono({ oss, clientes, vencendoLinhas: vencendo, vencendoQtd: vencendo.length, agora, lookaheadDias: Number(cfg.lookahead_dias) || 7 });
  let texto = "";
  try {
    const sys = "Voce escreve um resumo operacional curto, cordial e em pt-BR para o DONO de uma assistencia tecnica de refrigeracao. Use SOMENTE os dados fornecidos abaixo — nao estime, nao invente e nao adicione numeros que nao estejam nos fatos.";
    const user = `Fatos de hoje:\n\n${fatos.texto}\n\nEscreva 1 mensagem de WhatsApp (teste) com um panorama do dia pro dono.`;
    const r = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] }) });
    const jr = await r.json();
    texto = (jr.content || []).filter((x: { type: string }) => x.type === "text").map((x: { text: string }) => x.text).join("\n").trim();
  } catch { /* usa fallback abaixo */ }
  if (!texto) texto = "[Teste] " + fatos.fallback;

  const numero = normalizarTelefoneBR(String(cfg.dono_telefone));
  const resp = await fetch(`${evoBase}/message/sendText/${evoInstance}`, { method: "POST", headers: { "Content-Type": "application/json", apikey }, body: JSON.stringify({ number: numero, text: texto }) });
  if (!resp.ok) return json({ ok: false, error: `Evolution ${resp.status}: ${(await resp.text()).slice(0, 150)}` }, 502);
  return json({ ok: true, sent_to: numero, vencendo: vencendo.length });
});
