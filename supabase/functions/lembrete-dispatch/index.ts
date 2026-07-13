// Edge Function: lembrete-dispatch
// Cron (pg_cron) que avisa da próxima manutenção (intervalo por tipo de cliente)
// e das visitas já agendadas. Resumo do dono escrito por Claude Sonnet.
// Auth: header x-dispatch-key (env DISPATCH_KEY ou RPC lembrete_dispatch_key).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const JANELA_MIN = 15;
const TZ = "America/Sao_Paulo";

function json(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });
}
function normalizarTelefoneBR(raw: string): string {
  const d = String(raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.length >= 12 && d.startsWith("55")) return d;
  if (d.length === 10 || d.length === 11) return "55" + d;
  return d;
}
function preencherTemplate(tpl: string, vars: Record<string, string>): string {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}
function tipoCliente(c: Record<string, unknown>): "pj" | "pf" {
  const t = String(c?.tipo || "").toLowerCase();
  if (t === "pj" || t === "pf") return t;
  if (c?.cnpj && String(c.cnpj).trim()) return "pj";
  if (c?.cpf && String(c.cpf).trim()) return "pf";
  return "pf";
}
function fmtData(iso: string | Date): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR", { timeZone: TZ });
}
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

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  let expected = Deno.env.get("DISPATCH_KEY") ?? null;
  if (!expected) {
    const { data, error } = await sb.rpc("lembrete_dispatch_key");
    if (error) return json({ error: "key_lookup_failed", detail: error.message }, 500);
    expected = typeof data === "string" && data.length ? data : null;
  }
  if (!expected || req.headers.get("x-dispatch-key") !== expected) return json({ error: "unauthorized" }, 401);

  const { data: configs } = await sb.from("lembrete_config").select("*").eq("ativo", true);
  if (!configs || configs.length === 0) return json({ skipped: "nenhuma_empresa_ativa" });

  const agora = new Date();
  const hojeStr = agora.toLocaleDateString("en-CA", { timeZone: TZ });
  let manut = 0, agend = 0, resumos = 0, falhas = 0;

  for (const cfg of configs) {
    const companyId = cfg.company_id as string;

    const { data: evo } = await sb.from("ai_agent_config")
      .select("evolution_url, evolution_instance, enabled, metadata").eq("company_id", companyId).eq("enabled", true).limit(1).maybeSingle();
    const apikey = String((evo?.metadata as Record<string, unknown> | null)?.evolution_apikey || "") || Deno.env.get("EVOLUTION_APIKEY") || "";
    const evoBase = evo?.evolution_url ? String(evo.evolution_url).replace(/\/+$/, "") : "";
    const evoInstance = evo?.evolution_instance ? String(evo.evolution_instance) : "";
    const podeWhats = !!(evoBase && evoInstance && apikey);
    const sendWhats = async (tel: string, text: string) => {
      if (!podeWhats) throw new Error("evolution_nao_configurada");
      const numero = normalizarTelefoneBR(tel);
      if (!numero) throw new Error("telefone_invalido");
      const r = await fetch(`${evoBase}/message/sendText/${evoInstance}`, {
        method: "POST", headers: { "Content-Type": "application/json", apikey },
        body: JSON.stringify({ number: numero, text }),
      });
      if (!r.ok) throw new Error(`Evolution ${r.status}: ${(await r.text()).slice(0, 150)}`);
    };
    const marcar = async (tipo: string, clienteId: string | null, refData: string, dest: string, canal: string, status = "enviado", erro: string | null = null) => {
      const { error } = await sb.from("lembrete_enviado").insert({ company_id: companyId, tipo, cliente_id: clienteId, ref_data: refData, destinatario: dest, canal, status, erro });
      return !error;
    };

    const clientes = await kvList(sb, companyId, "erp:client:");
    const oss = await kvList(sb, companyId, "erp:os:");
    const empresaNome = "FrostERP";

    const vencendo: { nome: string; proxima: string; equip: string }[] = [];
    if (cfg.manutencao_ativa) {
      for (const c of clientes) {
        const clienteId = String(c.id || "");
        if (!clienteId) continue;
        let ultima: string | null = null;
        let ultimaOs: Record<string, unknown> | null = null;
        for (const os of oss) {
          if (os.clienteId !== clienteId || os.status !== "finalizado") continue;
          const d = (os.dataConclusao || os.updatedAt) as string | undefined;
          if (d && (!ultima || new Date(d) > new Date(ultima))) { ultima = d; ultimaOs = os; }
        }
        if (!ultima) continue;
        const override = Number(c.intervalo_manutencao_dias);
        const intervalo = override > 0 ? override : (tipoCliente(c) === "pj" ? Number(cfg.intervalo_pj_dias) : Number(cfg.intervalo_pf_dias));
        const proxima = new Date(ultima); proxima.setDate(proxima.getDate() + intervalo);
        const diasRest = Math.ceil((proxima.getTime() - agora.getTime()) / 86400000);
        if (diasRest < 0 || diasRest > Number(cfg.antecedencia_dias)) continue;
        const refData = proxima.toISOString().slice(0, 10);
        const vars: Record<string, string> = {
          cliente: String(c.nome || "cliente"), empresa: empresaNome,
          ultima_visita: fmtData(ultima), proxima_visita: fmtData(proxima),
          dias: String(diasRest), equipamento: String((ultimaOs?.equipamentoTipo as string) || "—"),
          endereco: String((c.endereco as Record<string, unknown>)?.rua || ""), telefone: String(c.telefone || ""),
        };
        vencendo.push({ nome: vars.cliente, proxima: vars.proxima_visita, equip: vars.equipamento });
        if (cfg.para_cliente && cfg.canais.includes("whatsapp") && c.telefone) {
          if (await marcar("manutencao", clienteId, refData, "cliente", "whatsapp")) {
            try { await sendWhats(String(c.telefone), preencherTemplate(cfg.template_cliente || "", vars)); manut++; }
            catch (e) { falhas++; await sb.from("lembrete_enviado").update({ status: "erro", erro: String((e as Error).message).slice(0, 300) }).eq("company_id", companyId).eq("tipo", "manutencao").eq("cliente_id", clienteId).eq("ref_data", refData).eq("destinatario", "cliente").eq("canal", "whatsapp"); }
          }
        }
      }
    }

    if (cfg.agendados_ativo) {
      const limite = new Date(agora); limite.setDate(limite.getDate() + Number(cfg.lookahead_dias));
      for (const os of oss) {
        if (os.status === "finalizado" || os.status === "cancelado") continue;
        if (!os.dataAgendada) continue;
        const quando = new Date(String(os.dataAgendada).slice(0, 10) + "T" + String(os.horaAgendada || "08:00") + ":00");
        if (isNaN(quando.getTime()) || quando < agora || quando > limite) continue;
        const refData = quando.toISOString().slice(0, 10);
        const clienteId = String(os.clienteId || "");
        const cli = clientes.find((c) => c.id === clienteId);
        const tel = String((cli?.telefone as string) || "");
        const vars: Record<string, string> = {
          cliente: String(os.clienteNome || "cliente"), empresa: empresaNome,
          proxima_visita: fmtData(quando), ultima_visita: "", dias: "",
          equipamento: String(os.equipamentoTipo || "—"),
          endereco: String(os.endereco || ""), telefone: tel,
        };
        if (cfg.para_cliente && cfg.canais.includes("whatsapp") && tel) {
          if (await marcar("agendado", clienteId, refData, "cliente", "whatsapp")) {
            try { await sendWhats(tel, preencherTemplate(cfg.template_cliente || "", vars)); agend++; }
            catch { falhas++; }
          }
        }
      }
    }

    if (cfg.para_dono && cfg.dono_telefone) {
      // Compara em horário de Brasília (não UTC). brNow tem os campos locais = Brasília.
      const brNow = new Date(agora.toLocaleString("en-US", { timeZone: TZ }));
      const nowMin = brNow.getHours() * 60 + brNow.getMinutes();
      const [hh, mm] = String(cfg.resumo_hora || "07:00").split(":").map(Number);
      const alvoMin = hh * 60 + mm;
      const dentroJanela = nowMin >= alvoMin && nowMin - alvoMin < JANELA_MIN;
      if (dentroJanela) {
        if (await marcar("resumo_dono", null, hojeStr, "dono", "whatsapp")) {
          try {
            // Panorama operacional geral — só dados reais (OS + clientes já carregados)
            const vencendoLinhas = vencendo.slice(0, 20).map((v) => `- ${v.nome} (${v.equip}) — vence ${v.proxima}`);
            const fatos = montarFatosDono({ oss, clientes, vencendoLinhas, vencendoQtd: vencendo.length, agora, lookaheadDias: Number(cfg.lookahead_dias) || 7 });
            const sys = "Voce escreve um resumo operacional curto, cordial e em pt-BR para o DONO de uma assistencia tecnica de refrigeracao. Use SOMENTE os dados fornecidos abaixo — nao estime, nao invente e nao adicione numeros que nao estejam nos fatos.";
            const user = `Fatos de hoje (${empresaNome}):\n\n${fatos.texto}\n\nEscreva 1 mensagem de WhatsApp com um panorama do dia pro dono, destacando o que precisa de atencao.`;
            const r = await fetch(ANTHROPIC_URL, {
              method: "POST",
              headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] }),
            });
            const jr = await r.json();
            const texto = (jr.content || []).filter((x: { type: string }) => x.type === "text").map((x: { text: string }) => x.text).join("\n").trim()
              || fatos.fallback;
            await sendWhats(String(cfg.dono_telefone), texto);
            resumos++;
          } catch { falhas++; }
        }
      }
    }
  }

  return json({ manutencao: manut, agendados: agend, resumos, falhas });
});
