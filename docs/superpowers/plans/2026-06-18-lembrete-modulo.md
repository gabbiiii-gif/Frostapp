# Módulo de Lembrete (aba dedicada) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aba "Lembrete" na sidebar com config + listas (próximas manutenções, visitas agendadas, histórico) + seção do dono com botão "Enviar resumo agora"; corrige o fuso do resumo e adiciona a edge function de teste.

**Architecture:** Módulo React em arquivo próprio (`src/modules/LembreteModule.jsx`) que recebe `db`/`addToast`/`user` por prop (igual `PosVendaModule` recebe `supabase`), calcula as listas localmente com a lib pura `src/lib/lembrete.js`, lê config/histórico via helpers do `src/supabase.js`, e dispara o teste do dono numa edge function autenticada `lembrete-teste`.

**Tech Stack:** React 19, Vitest, Supabase Edge Functions (Deno), Evolution (WhatsApp), Claude `claude-sonnet-4-6`.

Spec: `docs/superpowers/specs/2026-06-18-lembrete-modulo-design.md`

**Fatos do código (confirmados):**
- Registro de módulo: import em `App.jsx:104`; `navItems` em `App.jsx:16287` (`{ id, label, iconName, module }`); render no ModuleSwitcher em `App.jsx:16930` (`{activeModule === "pos-venda" && (<PosVendaModule supabase={supabase} />)}`).
- `ALL_MODULES` em `App.jsx:1350`. `TOGGLEABLE_MODULES` em `App.jsx:1367`.
- `ROLE_PERMISSIONS` em `constants.js:43` (gerente = lista na linha 45; atendente linha 47).
- `LembreteConfigPanel` (a remover do Settings) renderizado em `App.jsx` logo após `<AutoBackupPanel .../>`.
- `DB` é objeto com `{ get, set, list, delete }` (scoped) — passável como prop.
- Lib `src/lib/lembrete.js` exporta `tipoCliente`, `intervaloEfetivo`, `ultimaVisitaCliente`, `proximaManutencao`, `manutencaoDue`, `preencherTemplate`.

---

## File Structure
- `src/supabase.js` (modificar) — `getLembreteEnviados`, `sendLembreteResumoDono`.
- `supabase/functions/lembrete-dispatch/index.ts` (modificar) — fix fuso do resumo.
- `supabase/functions/lembrete-teste/index.ts` (novo) — envio sob demanda do resumo do dono (verify_jwt=true).
- `src/modules/LembreteModule.jsx` (novo) — o módulo (5 abas).
- `src/App.jsx` (modificar) — registro do módulo + remover painel do Settings.
- `src/constants.js` (modificar) — ROLE_PERMISSIONS.

---

### Task 1: Helpers no `src/supabase.js`

**Files:** Modify `src/supabase.js`

- [ ] **Step 1: Adicionar os helpers** logo após `saveLembreteConfig`:

```js
// Histórico de lembretes enviados (tabela lembrete_enviado, RLS admin/gerente).
export async function getLembreteEnviados(companyId, limit = 200) {
  if (!supabase || !companyId) return [];
  const { data, error } = await supabase.from("lembrete_enviado")
    .select("*").eq("company_id", companyId).order("enviado_em", { ascending: false }).limit(limit);
  if (error) { console.warn("getLembreteEnviados:", error.message); return []; }
  return data || [];
}

// Dispara o resumo do dono na hora (edge function autenticada lembrete-teste).
export async function sendLembreteResumoDono() {
  if (!supabase) return { ok: false, error: "no_supabase" };
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.access_token) return { ok: false, error: "Sessão expirada." };
    const resp = await fetch(`${supabaseUrl}/functions/v1/lembrete-teste`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: supabaseKey, Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({}),
    });
    const body = await resp.json().catch(() => ({}));
    if (!resp.ok || !body.ok) return { ok: false, error: body.error || `HTTP ${resp.status}` };
    return { ok: true, sent_to: body.sent_to };
  } catch (e) { return { ok: false, error: e.message }; }
}
```

- [ ] **Step 2: Build** — `npm run build` → OK.
- [ ] **Step 3: Commit**

```bash
git add src/supabase.js
git commit -m "feat(lembrete): helpers getLembreteEnviados + sendLembreteResumoDono"
```

---

### Task 2: Fix de fuso no `lembrete-dispatch`

**Files:** Modify `supabase/functions/lembrete-dispatch/index.ts`

- [ ] **Step 1: Trocar o cálculo da janela do resumo do dono**

Substituir o trecho:
```ts
      const [hh, mm] = String(cfg.resumo_hora || "07:00").split(":").map(Number);
      const alvo = new Date(`${hojeStr}T00:00:00`); alvo.setHours(hh, mm, 0, 0);
      const dentroJanela = agora >= alvo && agora.getTime() - alvo.getTime() < JANELA_MIN * 60000;
```
por:
```ts
      // Compara em horário de Brasília (não UTC). brNow tem os campos locais = Brasília.
      const brNow = new Date(agora.toLocaleString("en-US", { timeZone: TZ }));
      const nowMin = brNow.getHours() * 60 + brNow.getMinutes();
      const [hh, mm] = String(cfg.resumo_hora || "07:00").split(":").map(Number);
      const alvoMin = hh * 60 + mm;
      const dentroJanela = nowMin >= alvoMin && nowMin - alvoMin < JANELA_MIN;
```

- [ ] **Step 2: Redeploy** via MCP `deploy_edge_function(name="lembrete-dispatch", verify_jwt=false, files=[index.ts com o conteúdo atualizado])`.
Expected: ACTIVE, nova versão.

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/lembrete-dispatch/index.ts
git commit -m "fix(lembrete): janela do resumo do dono compara em Brasilia (nao UTC)"
```

---

### Task 3: Edge function `lembrete-teste` (envio sob demanda)

**Files:** Create `supabase/functions/lembrete-teste/index.ts`

- [ ] **Step 1: Escrever a função**

```ts
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

  // Monta a lista de clientes vencendo (mesma regra do dispatch)
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

  let texto = "";
  try {
    const sys = "Voce escreve um resumo curto, cordial e em pt-BR para o DONO de uma assistencia tecnica de refrigeracao. Seja objetivo, sem inventar dados.";
    const user = `Clientes vencendo a manutencao:\n${vencendo.slice(0, 20).join("\n") || "nenhum no momento"}\n\nEscreva 1 mensagem de WhatsApp (teste) resumindo pro dono.`;
    const r = await fetch(ANTHROPIC_URL, { method: "POST", headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" }, body: JSON.stringify({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] }) });
    const jr = await r.json();
    texto = (jr.content || []).filter((x: { type: string }) => x.type === "text").map((x: { text: string }) => x.text).join("\n").trim();
  } catch { /* usa fallback abaixo */ }
  if (!texto) texto = `[Teste] Resumo do dia: ${vencendo.length} cliente(s) vencendo a manutencao.`;

  const numero = normalizarTelefoneBR(String(cfg.dono_telefone));
  const resp = await fetch(`${evoBase}/message/sendText/${evoInstance}`, { method: "POST", headers: { "Content-Type": "application/json", apikey }, body: JSON.stringify({ number: numero, text: texto }) });
  if (!resp.ok) return json({ ok: false, error: `Evolution ${resp.status}: ${(await resp.text()).slice(0, 150)}` }, 502);
  return json({ ok: true, sent_to: numero, vencendo: vencendo.length });
});
```

- [ ] **Step 2: Deploy** via MCP `deploy_edge_function(name="lembrete-teste", verify_jwt=true, files=[index.ts])`.
- [ ] **Step 3: Commit**

```bash
git add supabase/functions/lembrete-teste/index.ts
git commit -m "feat(lembrete): edge function lembrete-teste (resumo do dono sob demanda)"
```

---

### Task 4: `src/modules/LembreteModule.jsx`

**Files:** Create `src/modules/LembreteModule.jsx`

- [ ] **Step 1: Escrever o módulo**

```jsx
import { useState, useEffect, useMemo, useCallback } from "react";
import {
  getLembreteConfig, saveLembreteConfig, getLembreteEnviados, sendLembreteResumoDono,
} from "../supabase.js";
import {
  tipoCliente, intervaloEfetivo, ultimaVisitaCliente, proximaManutencao, manutencaoDue,
} from "../lib/lembrete.js";

const DEFAULTS = {
  ativo: false, manutencao_ativa: true, intervalo_pj_dias: 90, intervalo_pf_dias: 180,
  antecedencia_dias: 15, agendados_ativo: true, lookahead_dias: 7, resumo_hora: "07:00",
  canais: ["whatsapp"], para_cliente: true, para_admin: true, para_dono: false,
  dono_telefone: "", template_cliente: "", template_admin: "",
};
const ABAS = [
  ["config", "Configuração"], ["proximas", "Próximas manutenções"],
  ["agendadas", "Visitas agendadas"], ["historico", "Histórico"], ["dono", "Dono"],
];
const fmt = (iso) => { const d = new Date(iso); return isNaN(d.getTime()) ? "—" : d.toLocaleDateString("pt-BR"); };

export default function LembreteModule({ db, addToast }) {
  const companyId = (typeof window !== "undefined" && window.__activeCompanyId) || null;
  const [aba, setAba] = useState("config");
  const [cfg, setCfg] = useState(null);
  const [saving, setSaving] = useState(false);
  const [historico, setHistorico] = useState([]);
  const [enviandoDono, setEnviandoDono] = useState(false);

  // companyId via prop seria melhor; aqui usamos getActiveCompanyId via supabase config.
  useEffect(() => {
    let cancel = false;
    (async () => {
      const cid = companyId;
      const c = await getLembreteConfig(cid);
      if (!cancel) setCfg(c || { ...DEFAULTS });
    })();
    return () => { cancel = true; };
  }, [companyId]);

  const upd = (k, v) => setCfg((p) => ({ ...p, [k]: v }));
  const salvar = useCallback(async () => {
    setSaving(true);
    const r = await saveLembreteConfig(companyId, cfg);
    setSaving(false);
    addToast(r.ok ? "Lembrete salvo." : (r.error || "Erro ao salvar."), r.ok ? "success" : "error");
  }, [companyId, cfg, addToast]);

  // Listas locais
  const clientes = useMemo(() => (db ? db.list("erp:client:") : []), [db, aba]);
  const oss = useMemo(() => (db ? db.list("erp:os:") : []), [db, aba]);

  const proximas = useMemo(() => {
    if (!cfg) return [];
    const hoje = new Date();
    const out = [];
    for (const c of clientes) {
      const ultima = ultimaVisitaCliente(oss, c.id);
      if (!ultima) continue;
      const intervalo = intervaloEfetivo(c, cfg);
      const proxima = proximaManutencao(ultima, intervalo);
      if (!manutencaoDue(proxima, hoje, cfg.antecedencia_dias)) continue;
      const dias = Math.ceil((proxima.getTime() - hoje.getTime()) / 86400000);
      out.push({ nome: c.nome, tipo: tipoCliente(c).toUpperCase(), ultima, proxima: proxima.toISOString(), dias, tel: c.telefone || "—" });
    }
    return out.sort((a, b) => a.dias - b.dias);
  }, [clientes, oss, cfg]);

  const agendadas = useMemo(() => {
    if (!cfg) return [];
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const limite = new Date(hoje); limite.setDate(limite.getDate() + Number(cfg.lookahead_dias));
    return oss.filter((os) => os && !["finalizado", "cancelado"].includes(os.status) && os.dataAgendada)
      .map((os) => ({ ...os, d: new Date(String(os.dataAgendada).slice(0, 10) + "T12:00:00") }))
      .filter((os) => !isNaN(os.d.getTime()) && os.d >= hoje && os.d <= limite)
      .sort((a, b) => a.d - b.d);
  }, [oss, cfg]);

  useEffect(() => {
    if (aba !== "historico") return;
    let cancel = false;
    getLembreteEnviados(companyId).then((h) => { if (!cancel) setHistorico(h); });
    return () => { cancel = true; };
  }, [aba, companyId]);

  const enviarDono = useCallback(async () => {
    setEnviandoDono(true);
    const r = await sendLembreteResumoDono();
    setEnviandoDono(false);
    addToast(r.ok ? `Resumo enviado para ${r.sent_to}.` : (r.error || "Falha ao enviar."), r.ok ? "success" : "error");
  }, [addToast]);

  if (!cfg) return <div className="p-6 text-gray-400">Carregando…</div>;

  const numField = (label, key) => (
    <label className="block"><span className="text-xs text-gray-300">{label}</span>
      <input type="number" min="0" max="3650" value={cfg[key] ?? 0}
        onChange={(e) => upd(key, parseInt(e.target.value, 10) || 0)}
        className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
    </label>
  );

  return (
    <div className="p-4 sm:p-6 space-y-4">
      <h2 className="text-xl font-bold text-white">Lembrete de manutenção</h2>
      <div className="flex flex-wrap gap-2 border-b border-gray-700 pb-2">
        {ABAS.map(([id, lbl]) => (
          <button key={id} onClick={() => setAba(id)}
            className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${aba === id ? "bg-blue-600 text-white" : "bg-gray-800 text-gray-300 hover:text-white"}`}>{lbl}</button>
        ))}
      </div>

      {aba === "config" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => upd("ativo", e.target.checked)} /> Lembrete ativo
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {numField("Intervalo PJ (dias)", "intervalo_pj_dias")}
            {numField("Intervalo PF (dias)", "intervalo_pf_dias")}
            {numField("Avisar antes (dias)", "antecedencia_dias")}
            {numField("Agendadas: janela (dias)", "lookahead_dias")}
          </div>
          <div className="flex flex-wrap gap-4 text-sm text-gray-200">
            <label className="flex items-center gap-2"><input type="checkbox" checked={(cfg.canais||[]).includes("whatsapp")} onChange={() => upd("canais", (cfg.canais||[]).includes("whatsapp") ? cfg.canais.filter(c=>c!=="whatsapp") : [...(cfg.canais||[]),"whatsapp"])} /> WhatsApp</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.para_cliente} onChange={(e) => upd("para_cliente", e.target.checked)} /> Cliente</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.manutencao_ativa} onChange={(e) => upd("manutencao_ativa", e.target.checked)} /> Manutenção recorrente</label>
            <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.agendados_ativo} onChange={(e) => upd("agendados_ativo", e.target.checked)} /> Visitas agendadas</label>
          </div>
          <label className="block"><span className="text-xs text-gray-300">Mensagem pro cliente (vars: {"{cliente} {empresa} {ultima_visita} {proxima_visita} {equipamento} {endereco}"})</span>
            <textarea rows={3} value={cfg.template_cliente || ""} onChange={(e) => upd("template_cliente", e.target.value)}
              className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
          </label>
          <div className="flex justify-end"><button onClick={salvar} disabled={saving} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button></div>
        </div>
      )}

      {aba === "proximas" && (
        <Tabela vazio="Nenhuma manutenção vencendo na janela." colunas={["Cliente","Tipo","Última visita","Próxima","Dias","Telefone"]}
          linhas={proximas.map((p) => [p.nome, p.tipo, fmt(p.ultima), fmt(p.proxima), String(p.dias), p.tel])} />
      )}

      {aba === "agendadas" && (
        <Tabela vazio="Nenhuma visita agendada na janela." colunas={["Cliente","Data","Hora","Equipamento","Técnico"]}
          linhas={agendadas.map((o) => [o.clienteNome || "—", fmt(o.dataAgendada), o.horaAgendada || "—", o.equipamentoTipo || "—", o.tecnicoNome || "—"])} />
      )}

      {aba === "historico" && (
        <Tabela vazio="Nada enviado ainda." colunas={["Quando","Tipo","Cliente","Destino","Canal","Status"]}
          linhas={historico.map((h) => [new Date(h.enviado_em).toLocaleString("pt-BR"), h.tipo, h.cliente_id || "—", h.destinatario, h.canal, h.status])} />
      )}

      {aba === "dono" && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-5 space-y-4">
          <p className="text-sm text-gray-400">Resumo diário escrito pela IA, enviado no WhatsApp do dono.</p>
          <label className="flex items-center gap-2 text-sm text-gray-200">
            <input type="checkbox" checked={!!cfg.para_dono} onChange={(e) => upd("para_dono", e.target.checked)} /> Enviar resumo pro dono
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block"><span className="text-xs text-gray-300">Telefone do dono</span>
              <input type="text" value={cfg.dono_telefone || ""} onChange={(e) => upd("dono_telefone", e.target.value)} placeholder="5593991106818"
                className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" /></label>
            <label className="block"><span className="text-xs text-gray-300">Hora do resumo</span>
              <input type="time" value={cfg.resumo_hora || "07:00"} onChange={(e) => upd("resumo_hora", e.target.value)}
                className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" /></label>
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <button onClick={salvar} disabled={saving} className="px-4 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
            <button onClick={enviarDono} disabled={enviandoDono} className="px-4 py-2 rounded-lg bg-green-600 hover:bg-green-500 text-white text-sm font-semibold disabled:opacity-50">{enviandoDono ? "Enviando…" : "Enviar resumo agora"}</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Tabela({ colunas, linhas, vazio }) {
  if (!linhas.length) return <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 text-gray-400 text-sm">{vazio}</div>;
  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl overflow-x-auto">
      <table className="w-full text-sm">
        <thead><tr className="text-left text-gray-400 border-b border-gray-700">{colunas.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr></thead>
        <tbody>{linhas.map((l, i) => <tr key={i} className="border-b border-gray-700/50 text-gray-200">{l.map((cel, j) => <td key={j} className="px-3 py-2">{cel}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}
```

NOTA: o `companyId` vem de `window.__activeCompanyId` (variável global setada em App.jsx). Se durante a implementação isso não estiver acessível, passar `companyId` como prop a partir do ModuleSwitcher (`getActiveCompanyId()`), ajustando a assinatura para `LembreteModule({ db, addToast, companyId })`.

- [ ] **Step 2: Build** — `npm run build` → OK (sem erro de import).
- [ ] **Step 3: Commit**

```bash
git add src/modules/LembreteModule.jsx
git commit -m "feat(lembrete): modulo dedicado (config + listas + historico + dono)"
```

---

### Task 5: Registrar o módulo + remover painel do Settings

**Files:** Modify `src/App.jsx`, `src/constants.js`

- [ ] **Step 1: Import** — em `src/App.jsx` perto da linha 104:
```jsx
import LembreteModule from "./modules/LembreteModule.jsx";
```

- [ ] **Step 2: ALL_MODULES** (App.jsx:1350) — adicionar antes de `config`:
```jsx
  { id: "lembrete", label: "Lembrete" },
```

- [ ] **Step 3: TOGGLEABLE_MODULES** (App.jsx:1367) — adicionar:
```jsx
  { id: "lembrete", label: "Lembrete" },
```

- [ ] **Step 4: navItems** (App.jsx:16287, junto do pos-venda) — adicionar:
```jsx
      { id: "lembrete", label: "Lembrete", iconName: "agenda", module: "lembrete" },
```

- [ ] **Step 5: ModuleSwitcher** (App.jsx:16930, ao lado do pos-venda) — adicionar:
```jsx
            {activeModule === "lembrete" && (
              <LembreteModule db={DB} addToast={addToast} companyId={getActiveCompanyId()} />
            )}
```
E ajustar a assinatura do módulo para receber `companyId` (Task 4) em vez de `window.__activeCompanyId`, se preferir explícito:
`export default function LembreteModule({ db, addToast, companyId }) {` e remover a linha do `window.__activeCompanyId`.

- [ ] **Step 6: ROLE_PERMISSIONS** (constants.js:45) — adicionar `"lembrete"` à lista do `gerente`. Conferir o `admin` (linha 44): se for `["all"]` não mexer; se for lista, adicionar `"lembrete"` também.

- [ ] **Step 7: Remover o painel duplicado do Settings** — apagar a linha:
```jsx
      {(user.role === "admin" || user.role === "gerente") && <LembreteConfigPanel addToast={addToast} />}
```
e a definição do componente `LembreteConfigPanel` em `App.jsx` (todo o bloco da função). Conferir que `getLembreteConfig`/`saveLembreteConfig` ainda são importados (agora usados pelo módulo via `src/supabase.js`, não pelo App.jsx) — se ficarem sem uso no App.jsx, remover do import do `./supabase.js` em App.jsx para não deixar import órfão.

- [ ] **Step 8: Build + suite**

Run: `npm run test && npm run build`
Expected: 200 testes PASS + build OK. Abrir o app (admin/gerente) → aba "Lembrete" aparece na sidebar → as 5 abas funcionam; "Enviar resumo agora" manda WhatsApp pro dono (com WhatsApp conectado).

- [ ] **Step 9: Commit**

```bash
git add src/App.jsx src/constants.js
git commit -m "feat(lembrete): registra modulo na sidebar e remove painel do Settings"
```

---

## Self-Review

- **Spec coverage:** módulo + 5 abas (Task 4) ✓; config movida + removida do Settings (Task 5 Step 7) ✓; listas client-side via lib (Task 4) ✓; histórico via helper (Tasks 1+4) ✓; seção dono + "enviar agora" (Tasks 1,3,4) ✓; fix fuso (Task 2) ✓; edge teste verify_jwt=true admin-only (Task 3) ✓; registro/permissões (Task 5) ✓.
- **Placeholders:** sem TODO/TBD; código completo. A nota do `companyId` é uma decisão de implementação explícita (prop vs global), não um placeholder.
- **Type/contract consistency:** `getLembreteEnviados`/`sendLembreteResumoDono` definidos (Task 1) e usados (Task 4) com as mesmas assinaturas; `LembreteModule({ db, addToast, companyId })` consistente entre Task 4/5; lib funcs usadas com as assinaturas reais de `src/lib/lembrete.js`.
- **Risco:** App.jsx é gigante — as edições do Task 5 são pontuais (import, 2 listas, 1 navItem, 1 render, remoção do painel). Conferir números de linha por grep (eles driftam).

## Deploy
- Front-end: merge na `main` → Vercel.
- Edge: redeploy `lembrete-dispatch` (Task 2) + deploy `lembrete-teste` (Task 3) via MCP.
