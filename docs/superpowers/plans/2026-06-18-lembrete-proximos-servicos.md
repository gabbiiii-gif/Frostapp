# Lembrete de próxima visita / manutenção — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lembrar automaticamente da próxima manutenção (intervalo por tipo de cliente PJ/PF + override por cliente, contado da última OS finalizada, avisando X dias antes) e resumir visitas já agendadas, por WhatsApp/Push, com resumo do dono escrito por IA.

**Architecture:** Lib pura (`src/lib/lembrete.js`, testável) para as regras; tabelas Postgres (`lembrete_config`, `lembrete_enviado`) com RLS; edge function `lembrete-dispatch` rodada por `pg_cron` (auth `x-dispatch-key`, igual `pos-venda-dispatch`) que varre `erp:client`/`erp:os` no `kv_store`, dispara via Evolution/`send-push` e gera o resumo do dono com Claude Sonnet; painel de config no `SettingsModule`.

**Tech Stack:** React 19, Vitest, Supabase (Postgres + Edge Functions Deno + pg_cron), Evolution API (WhatsApp), Claude `claude-sonnet-4-6`.

Spec: `docs/superpowers/specs/2026-06-18-lembrete-proximos-servicos-design.md`

**Shapes confirmados no banco:**
- `erp:client:*`: `{ id, nome, tipo:'pf'|'pj', cpf, cnpj, telefone, endereco:{...}, intervalo_manutencao_dias? }`
- `erp:os:*`: `{ id, clienteId, clienteNome, status:'finalizado'|'aguardando'|..., dataConclusao(ISO), dataAgendada(ISO), horaAgendada('HH:MM'), equipamentoTipo, tecnicoNome, endereco, valor }`

---

## File Structure
- `src/lib/lembrete.js` (novo) — regras puras: tipo de cliente, intervalo efetivo, próxima manutenção, due, template.
- `src/lib/lembrete.test.js` (novo) — Vitest.
- `supabase/migrations/2026_06_18_lembrete.sql` (novo) — tabelas + RLS + RPC da chave.
- `supabase/functions/lembrete-dispatch/index.ts` (novo) — cron dispatcher.
- `src/supabase.js` (modificar) — helpers `getLembreteConfig`/`saveLembreteConfig`/`sendLembreteTeste`.
- `src/App.jsx` (modificar) — painel "Lembrete de manutenção" no SettingsModule + campo `intervalo_manutencao_dias` na ficha do cliente.
- `docs/ai-agent/05-lembrete-pg-cron.sql` (novo) — agendamento pg_cron.

Comandos: `npm run test`, `npm run build`. Deploy edge via MCP `deploy_edge_function`. SQL via MCP `apply_migration`.

---

### Task 1: Lib pura `src/lib/lembrete.js` (regras)

**Files:**
- Create: `src/lib/lembrete.js`, `src/lib/lembrete.test.js`

- [ ] **Step 1: Escrever os testes**

Criar `src/lib/lembrete.test.js`:

```js
import { describe, it, expect } from "vitest";
import {
  tipoCliente, intervaloEfetivo, ultimaVisitaCliente,
  proximaManutencao, manutencaoDue, preencherTemplate,
} from "./lembrete.js";

describe("lembrete.tipoCliente", () => {
  it("usa o campo tipo quando existe", () => {
    expect(tipoCliente({ tipo: "pj" })).toBe("pj");
    expect(tipoCliente({ tipo: "pf" })).toBe("pf");
  });
  it("cai no cnpj→pj / cpf→pf quando não há tipo", () => {
    expect(tipoCliente({ cnpj: "11.111.111/0001-11" })).toBe("pj");
    expect(tipoCliente({ cpf: "123.456.789-00" })).toBe("pf");
  });
  it("default pf", () => {
    expect(tipoCliente({})).toBe("pf");
  });
});

describe("lembrete.intervaloEfetivo", () => {
  const cfg = { intervalo_pj_dias: 90, intervalo_pf_dias: 180 };
  it("override do cliente tem prioridade", () => {
    expect(intervaloEfetivo({ tipo: "pj", intervalo_manutencao_dias: 30 }, cfg)).toBe(30);
  });
  it("usa o padrão por tipo quando sem override", () => {
    expect(intervaloEfetivo({ tipo: "pj" }, cfg)).toBe(90);
    expect(intervaloEfetivo({ tipo: "pf" }, cfg)).toBe(180);
  });
});

describe("lembrete.ultimaVisitaCliente", () => {
  it("pega a maior dataConclusao das OS finalizadas do cliente", () => {
    const os = [
      { clienteId: "c1", status: "finalizado", dataConclusao: "2026-01-10T00:00:00Z" },
      { clienteId: "c1", status: "finalizado", dataConclusao: "2026-03-20T00:00:00Z" },
      { clienteId: "c1", status: "aguardando", dataConclusao: null },
      { clienteId: "c2", status: "finalizado", dataConclusao: "2026-05-01T00:00:00Z" },
    ];
    expect(ultimaVisitaCliente(os, "c1")).toBe("2026-03-20T00:00:00Z");
  });
  it("null quando o cliente não tem OS finalizada", () => {
    expect(ultimaVisitaCliente([{ clienteId: "c1", status: "aguardando" }], "c1")).toBeNull();
  });
});

describe("lembrete.proximaManutencao / manutencaoDue", () => {
  it("soma os dias do intervalo à última visita", () => {
    const p = proximaManutencao("2026-01-01T00:00:00Z", 90);
    expect(p.toISOString().slice(0, 10)).toBe("2026-04-01");
  });
  it("due quando faltam <= antecedência e >= 0 dias", () => {
    const proxima = new Date("2026-06-20T00:00:00Z");
    expect(manutencaoDue(proxima, new Date("2026-06-10T00:00:00Z"), 15)).toBe(true);  // faltam 10
    expect(manutencaoDue(proxima, new Date("2026-06-01T00:00:00Z"), 15)).toBe(false); // faltam 19
    expect(manutencaoDue(proxima, new Date("2026-06-21T00:00:00Z"), 15)).toBe(false); // já passou
  });
});

describe("lembrete.preencherTemplate", () => {
  it("substitui {variaveis}", () => {
    const out = preencherTemplate("Olá {cliente}, próxima {proxima_visita}", {
      cliente: "João", proxima_visita: "20/06/2026",
    });
    expect(out).toBe("Olá João, próxima 20/06/2026");
  });
  it("variável ausente vira string vazia", () => {
    expect(preencherTemplate("oi {nada}", {})).toBe("oi ");
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/lib/lembrete.test.js`
Expected: FAIL ("Failed to resolve import ./lembrete.js").

- [ ] **Step 3: Implementar `src/lib/lembrete.js`**

```js
// ─── Lib pura: regras do Lembrete de manutenção/visita ───────────────────────
// Sem JSX, sem rede. Funções determinísticas (testáveis com Vitest). A leitura
// de OS/clientes e o envio ficam na edge function; aqui só a lógica de regra.

// Tipo do cliente: usa o campo `tipo` ('pf'|'pj') quando existe; senão deduz por
// cnpj (→ pj) ou cpf (→ pf); default 'pf'.
export function tipoCliente(client) {
  const t = String(client?.tipo || "").toLowerCase();
  if (t === "pj" || t === "pf") return t;
  if (client?.cnpj && String(client.cnpj).trim()) return "pj";
  if (client?.cpf && String(client.cpf).trim()) return "pf";
  return "pf";
}

// Intervalo (em dias) até a próxima manutenção desse cliente. Override do cliente
// (`intervalo_manutencao_dias`) tem prioridade sobre o padrão por tipo.
export function intervaloEfetivo(client, config) {
  const override = Number(client?.intervalo_manutencao_dias);
  if (override > 0) return override;
  return tipoCliente(client) === "pj"
    ? Number(config?.intervalo_pj_dias) || 90
    : Number(config?.intervalo_pf_dias) || 180;
}

// Maior dataConclusao das OS finalizadas do cliente (ISO) ou null.
export function ultimaVisitaCliente(osList, clienteId) {
  let max = null;
  for (const os of osList || []) {
    if (os?.clienteId !== clienteId) continue;
    if (os?.status !== "finalizado") continue;
    const d = os.dataConclusao || os.updatedAt;
    if (!d) continue;
    if (!max || new Date(d) > new Date(max)) max = d;
  }
  return max;
}

// Próxima manutenção = última visita + intervalo (dias). Retorna Date.
export function proximaManutencao(ultimaVisitaISO, intervaloDias) {
  const base = new Date(ultimaVisitaISO);
  base.setDate(base.getDate() + (Number(intervaloDias) || 0));
  return base;
}

// Due = está dentro da janela de antecedência (0 <= dias_restantes <= antecedência).
export function manutencaoDue(proxima, hoje, antecedenciaDias) {
  const ms = proxima.getTime() - hoje.getTime();
  const dias = Math.ceil(ms / 86400000);
  return dias >= 0 && dias <= (Number(antecedenciaDias) || 0);
}

// Preenche um template trocando {chave} pelos valores de `vars` (ausente = "").
export function preencherTemplate(tpl, vars) {
  return String(tpl || "").replace(/\{(\w+)\}/g, (_, k) =>
    vars && vars[k] != null ? String(vars[k]) : ""
  );
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- src/lib/lembrete.test.js`
Expected: PASS (todos).

- [ ] **Step 5: Commit**

```bash
git add src/lib/lembrete.js src/lib/lembrete.test.js
git commit -m "feat(lembrete): lib pura de regras (tipo cliente, intervalo, due, template)"
```

---

### Task 2: Tabelas + RLS + RPC da chave (migração)

**Files:**
- Create: `supabase/migrations/2026_06_18_lembrete.sql` (e aplicar via MCP `apply_migration` name `lembrete_tables`)

- [ ] **Step 1: Escrever a migração**

Conteúdo de `supabase/migrations/2026_06_18_lembrete.sql`:

```sql
-- Config do lembrete por empresa
create table if not exists public.lembrete_config (
  company_id        text primary key,
  ativo             boolean     not null default false,
  manutencao_ativa  boolean     not null default true,
  intervalo_pj_dias int         not null default 90,
  intervalo_pf_dias int         not null default 180,
  antecedencia_dias int         not null default 15,
  agendados_ativo   boolean     not null default true,
  lookahead_dias    int         not null default 7,
  resumo_hora       text        not null default '07:00',
  canais            text[]      not null default '{whatsapp}',
  para_cliente      boolean     not null default true,
  para_admin        boolean     not null default true,
  para_dono         boolean     not null default false,
  dono_telefone     text,
  template_cliente  text,
  template_admin    text,
  updated_at        timestamptz not null default now()
);

-- Dedupe + histórico de envios
create table if not exists public.lembrete_enviado (
  id           uuid primary key default gen_random_uuid(),
  company_id   text not null,
  tipo         text not null,        -- 'manutencao' | 'agendado' | 'resumo_dono'
  cliente_id   text,
  ref_data     date not null,
  destinatario text not null,        -- 'cliente' | 'admin' | 'dono'
  canal        text not null,        -- 'whatsapp' | 'push'
  status       text not null default 'enviado',
  erro         text,
  enviado_em   timestamptz not null default now(),
  unique (company_id, tipo, cliente_id, ref_data, destinatario, canal)
);
create index if not exists lembrete_enviado_company_idx on public.lembrete_enviado (company_id, enviado_em desc);

-- RLS: config só admin/gerente da empresa; enviado só leitura admin/gerente.
alter table public.lembrete_config  enable row level security;
alter table public.lembrete_enviado enable row level security;

drop policy if exists lembrete_config_rw on public.lembrete_config;
create policy lembrete_config_rw on public.lembrete_config
  for all
  using (company_id = private.user_company_id() and private.user_role() in ('admin','gerente'))
  with check (company_id = private.user_company_id() and private.user_role() in ('admin','gerente'));

drop policy if exists lembrete_enviado_ro on public.lembrete_enviado;
create policy lembrete_enviado_ro on public.lembrete_enviado
  for select
  using (company_id = private.user_company_id() and private.user_role() in ('admin','gerente'));

-- Chave de dispatch (Vault) reaproveitando o padrão do pos-venda.
create or replace function public.lembrete_dispatch_key()
returns text language sql security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'lembrete_dispatch_key' limit 1;
$$;
revoke all on function public.lembrete_dispatch_key() from anon, authenticated;
```

- [ ] **Step 2: Aplicar a migração**

Via MCP: `apply_migration(project_id, name="lembrete_tables", query=<conteúdo acima>)`.
Expected: sucesso. Conferir com `list_tables` que `lembrete_config` e `lembrete_enviado` existem.

- [ ] **Step 3: Semear a config da empresa + o segredo do cron**

Via MCP `execute_sql`:
```sql
insert into public.lembrete_config (company_id, dono_telefone,
  template_cliente, template_admin)
values ('cmp_default', '5593991106818',
  'Olá {cliente}! Já faz um tempo desde a última manutenção ({ultima_visita}). Recomendamos a próxima visita até {proxima_visita}. Quer que a {empresa} agende pra você?',
  'Lembrete: {cliente} ({equipamento}) está chegando na hora da manutenção (prevista até {proxima_visita}).')
on conflict (company_id) do nothing;

select vault.create_secret(encode(gen_random_bytes(24),'hex'), 'lembrete_dispatch_key');
```
Expected: 1 linha inserida + 1 secret criado. (Se o secret já existir, ignorar erro.)

- [ ] **Step 4: Advisors**

Via MCP `get_advisors(type="security")` — confirmar que as 2 tabelas novas não aparecem como "RLS disabled".

- [ ] **Step 5: Commit do arquivo**

```bash
git add supabase/migrations/2026_06_18_lembrete.sql
git commit -m "feat(lembrete): tabelas lembrete_config/lembrete_enviado + RLS + chave dispatch"
```

---

### Task 3: Edge function `lembrete-dispatch`

**Files:**
- Create: `supabase/functions/lembrete-dispatch/index.ts`

- [ ] **Step 1: Escrever a função**

Criar `supabase/functions/lembrete-dispatch/index.ts`:

```ts
// Edge Function: lembrete-dispatch
// Cron (pg_cron) que avisa da próxima manutenção (intervalo por tipo de cliente)
// e das visitas já agendadas. Resumo do dono escrito por Claude Sonnet.
// Auth: header x-dispatch-key (env DISPATCH_KEY ou RPC lembrete_dispatch_key).
import { createClient, SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const MODEL = "claude-sonnet-4-6";
const JANELA_MIN = 15;        // intervalo do cron
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
// Lista kv por sufixo, tolerando chave escopada (cmp:erp:...) e bare (erp:...).
async function kvList(sb: SupabaseClient, companyId: string, suffix: string) {
  const scoped = await sb.from("kv_store").select("value").like("key", `${companyId}:${suffix}%`).limit(5000);
  if (scoped.data && scoped.data.length) return scoped.data.map((r: { value: unknown }) => r.value as Record<string, unknown>);
  const bare = await sb.from("kv_store").select("value").eq("company_id", companyId).like("key", `${suffix}%`).limit(5000);
  return (bare.data || []).map((r: { value: unknown }) => r.value as Record<string, unknown>);
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const sb = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // Auth
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
  const hojeStr = agora.toLocaleDateString("en-CA", { timeZone: TZ }); // YYYY-MM-DD
  let manut = 0, agend = 0, resumos = 0, falhas = 0;

  for (const cfg of configs) {
    const companyId = cfg.company_id as string;

    // Evolution
    const { data: evo } = await sb.from("ai_agent_config")
      .select("evolution_url, evolution_instance, enabled, metadata").eq("enabled", true).limit(1).maybeSingle();
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
    // Dedupe: grava lembrete_enviado; retorna false se já existia (UNIQUE).
    const marcar = async (tipo: string, clienteId: string | null, refData: string, dest: string, canal: string, status = "enviado", erro: string | null = null) => {
      const { error } = await sb.from("lembrete_enviado").insert({ company_id: companyId, tipo, cliente_id: clienteId, ref_data: refData, destinatario: dest, canal, status, erro });
      return !error; // erro de UNIQUE → já enviado
    };

    const clientes = await kvList(sb, companyId, "erp:client:");
    const oss = await kvList(sb, companyId, "erp:os:");
    const empresaNome = "FrostERP";

    // ── Parte A: manutenção recorrente ──────────────────────────────────────
    const vencendo: { nome: string; proxima: string; equip: string }[] = [];
    if (cfg.manutencao_ativa) {
      for (const c of clientes) {
        const clienteId = String(c.id || "");
        if (!clienteId) continue;
        // última visita finalizada
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
        // cliente
        if (cfg.para_cliente && cfg.canais.includes("whatsapp") && c.telefone) {
          if (await marcar("manutencao", clienteId, refData, "cliente", "whatsapp")) {
            try { await sendWhats(String(c.telefone), preencherTemplate(cfg.template_cliente || "", vars)); manut++; }
            catch (e) { falhas++; await sb.from("lembrete_enviado").update({ status: "erro", erro: String((e as Error).message).slice(0, 300) }).eq("company_id", companyId).eq("tipo", "manutencao").eq("cliente_id", clienteId).eq("ref_data", refData).eq("destinatario", "cliente").eq("canal", "whatsapp"); }
          }
        }
      }
    }

    // ── Parte B: visitas já agendadas no lookahead ──────────────────────────
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

    // ── Parte C: resumo do dono (IA) ────────────────────────────────────────
    if (cfg.para_dono && cfg.dono_telefone) {
      const [hh, mm] = String(cfg.resumo_hora || "07:00").split(":").map(Number);
      const alvo = new Date(`${hojeStr}T00:00:00`); alvo.setHours(hh, mm, 0, 0);
      const dentroJanela = agora >= alvo && agora.getTime() - alvo.getTime() < JANELA_MIN * 60000;
      if (dentroJanela) {
        if (await marcar("resumo_dono", null, hojeStr, "dono", "whatsapp")) {
          try {
            const linhasVenc = vencendo.slice(0, 20).map((v) => `- ${v.nome} (${v.equip}) — vence ${v.proxima}`).join("\n") || "nenhum";
            const sys = "Voce escreve um resumo curto, cordial e em pt-BR para o DONO de uma assistencia tecnica de refrigeracao, sobre os proximos servicos. Seja objetivo, sem inventar dados.";
            const user = `Clientes vencendo a manutencao:\n${linhasVenc}\n\nEscreva 1 mensagem de WhatsApp resumindo pro dono o que precisa de atencao hoje.`;
            const r = await fetch(ANTHROPIC_URL, {
              method: "POST",
              headers: { "x-api-key": Deno.env.get("ANTHROPIC_API_KEY")!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
              body: JSON.stringify({ model: MODEL, max_tokens: 600, system: sys, messages: [{ role: "user", content: user }] }),
            });
            const jr = await r.json();
            const texto = (jr.content || []).filter((x: { type: string }) => x.type === "text").map((x: { text: string }) => x.text).join("\n").trim()
              || `Resumo do dia: ${vencendo.length} cliente(s) vencendo a manutencao.`;
            await sendWhats(String(cfg.dono_telefone), texto);
            resumos++;
          } catch { falhas++; }
        }
      }
    }
  }

  return json({ manutencao: manut, agendados: agend, resumos, falhas });
});
```

- [ ] **Step 2: Deploy**

Via MCP: `deploy_edge_function(project_id, name="lembrete-dispatch", entrypoint_path="index.ts", verify_jwt=false, files=[{name:"index.ts", content:<acima>}])`.
Expected: status ACTIVE.

- [ ] **Step 3: Teste manual**

Pegar a chave: `execute_sql "select public.lembrete_dispatch_key()"`. Chamar via curl:
```bash
curl -s -X POST "https://rbwzhglsztmjvwrcydcy.supabase.co/functions/v1/lembrete-dispatch" \
  -H "x-dispatch-key: <chave>" -H "Content-Type: application/json" -d '{}'
```
Expected: JSON `{manutencao, agendados, resumos, falhas}` (números). Sem `unauthorized`.
Conferir `select * from lembrete_enviado order by enviado_em desc limit 5;` se algo foi gravado.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/lembrete-dispatch/index.ts
git commit -m "feat(lembrete): edge function lembrete-dispatch (manutencao + agendados + resumo IA)"
```

---

### Task 4: Agendar pg_cron

**Files:**
- Create: `docs/ai-agent/05-lembrete-pg-cron.sql`

- [ ] **Step 1: Escrever e aplicar o agendamento**

Conteúdo de `docs/ai-agent/05-lembrete-pg-cron.sql` (aplicar via MCP `execute_sql`):

```sql
select cron.schedule(
  'lembrete-dispatch-15min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://rbwzhglsztmjvwrcydcy.supabase.co/functions/v1/lembrete-dispatch',
    headers := jsonb_build_object('Content-Type','application/json','x-dispatch-key', public.lembrete_dispatch_key()),
    body := '{}'::jsonb
  );
  $$
);
```
Expected: retorna o jobid. Conferir `select jobname, schedule from cron.job where jobname='lembrete-dispatch-15min';`.

(Se `pg_cron`/`pg_net` não estiverem habilitados, habilitar antes: `create extension if not exists pg_cron; create extension if not exists pg_net;` — checar via `list_extensions`.)

- [ ] **Step 2: Commit**

```bash
git add docs/ai-agent/05-lembrete-pg-cron.sql
git commit -m "feat(lembrete): agenda pg_cron a cada 15min"
```

---

### Task 5: Helpers no `src/supabase.js`

**Files:**
- Modify: `src/supabase.js`

- [ ] **Step 1: Adicionar os helpers**

Adicionar antes da seção `// ─── Master users:` em `src/supabase.js`:

```js
// ─── Lembrete de manutenção: config + teste ─────────────────────────────────
export async function getLembreteConfig(companyId) {
  if (!supabase || !companyId) return null;
  const { data, error } = await supabase.from("lembrete_config").select("*").eq("company_id", companyId).maybeSingle();
  if (error) { console.warn("getLembreteConfig:", error.message); return null; }
  return data;
}

export async function saveLembreteConfig(companyId, cfg) {
  if (!supabase || !companyId) return { ok: false, error: "no_supabase" };
  const row = { ...cfg, company_id: companyId, updated_at: new Date().toISOString() };
  const { error } = await supabase.from("lembrete_config").upsert(row, { onConflict: "company_id" });
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}
```

- [ ] **Step 2: Build pra garantir que importa**

Run: `npm run build`
Expected: build OK.

- [ ] **Step 3: Commit**

```bash
git add src/supabase.js
git commit -m "feat(lembrete): helpers getLembreteConfig/saveLembreteConfig"
```

---

### Task 6: Painel de config + campo na ficha do cliente

**Files:**
- Modify: `src/App.jsx`

- [ ] **Step 1: Importar os helpers**

No import do `./supabase.js` em `src/App.jsx` (a linha grande que termina em `from "./supabase.js";`), acrescentar `getLembreteConfig, saveLembreteConfig` à lista.

- [ ] **Step 2: Adicionar o componente do painel**

Adicionar o componente `LembreteConfigPanel` perto dos outros painéis de Settings (ex.: antes de `CompanyAuditPanel`):

```jsx
// Painel: configuração do Lembrete de manutenção/visita (admin/gerente).
function LembreteConfigPanel() {
  const [cfg, setCfg] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const companyId = getActiveCompanyId();

  useEffect(() => {
    let cancel = false;
    (async () => {
      const c = await getLembreteConfig(companyId);
      if (!cancel) {
        setCfg(c || {
          ativo: false, manutencao_ativa: true, intervalo_pj_dias: 90, intervalo_pf_dias: 180,
          antecedencia_dias: 15, agendados_ativo: true, lookahead_dias: 7, resumo_hora: "07:00",
          canais: ["whatsapp"], para_cliente: true, para_admin: true, para_dono: false,
          dono_telefone: "", template_cliente: "", template_admin: "",
        });
        setLoading(false);
      }
    })();
    return () => { cancel = true; };
  }, [companyId]);

  const upd = (k, v) => setCfg((p) => ({ ...p, [k]: v }));
  const toggleCanal = (canal) => setCfg((p) => {
    const has = (p.canais || []).includes(canal);
    return { ...p, canais: has ? p.canais.filter((c) => c !== canal) : [...(p.canais || []), canal] };
  });

  const salvar = useCallback(async () => {
    setSaving(true);
    const r = await saveLembreteConfig(companyId, cfg);
    setSaving(false);
    addToast(r.ok ? "Lembrete salvo." : (r.error || "Erro ao salvar."), r.ok ? "success" : "error");
  }, [companyId, cfg]);

  if (loading) return <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 text-gray-400">Carregando…</div>;

  const numField = (label, key, min = 0, max = 3650) => (
    <label className="block">
      <span className="text-xs text-gray-300">{label}</span>
      <input type="number" min={min} max={max} value={cfg[key] ?? 0}
        onChange={(e) => upd(key, parseInt(e.target.value, 10) || 0)}
        className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
    </label>
  );

  return (
    <div className="bg-gray-800 border border-gray-700 rounded-xl p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold text-white">Lembrete de manutenção</h3>
          <p className="text-gray-400 text-sm mt-0.5">Avisa da próxima visita por WhatsApp/Push. Resumo do dono escrito por IA.</p>
        </div>
        <label className="flex items-center gap-2 text-sm text-gray-200">
          <input type="checkbox" checked={!!cfg.ativo} onChange={(e) => upd("ativo", e.target.checked)} /> Ativo
        </label>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {numField("Intervalo PJ (dias)", "intervalo_pj_dias")}
        {numField("Intervalo PF (dias)", "intervalo_pf_dias")}
        {numField("Avisar antes (dias)", "antecedencia_dias")}
        {numField("Agendadas: janela (dias)", "lookahead_dias")}
        <label className="block">
          <span className="text-xs text-gray-300">Resumo do dono (hora)</span>
          <input type="time" value={cfg.resumo_hora || "07:00"} onChange={(e) => upd("resumo_hora", e.target.value)}
            className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
        </label>
        <label className="block">
          <span className="text-xs text-gray-300">Telefone do dono</span>
          <input type="text" value={cfg.dono_telefone || ""} onChange={(e) => upd("dono_telefone", e.target.value)}
            placeholder="5593991106818" className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
        </label>
      </div>

      <div className="flex flex-wrap gap-4 text-sm text-gray-200">
        <label className="flex items-center gap-2"><input type="checkbox" checked={(cfg.canais||[]).includes("whatsapp")} onChange={() => toggleCanal("whatsapp")} /> WhatsApp</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={(cfg.canais||[]).includes("push")} onChange={() => toggleCanal("push")} /> Push</label>
        <span className="text-gray-600">|</span>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.para_cliente} onChange={(e) => upd("para_cliente", e.target.checked)} /> Cliente</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.para_admin} onChange={(e) => upd("para_admin", e.target.checked)} /> Admin</label>
        <label className="flex items-center gap-2"><input type="checkbox" checked={!!cfg.para_dono} onChange={(e) => upd("para_dono", e.target.checked)} /> Dono</label>
      </div>

      <label className="block">
        <span className="text-xs text-gray-300">Mensagem pro cliente (vars: {"{cliente} {empresa} {ultima_visita} {proxima_visita} {equipamento} {endereco}"})</span>
        <textarea rows={3} value={cfg.template_cliente || ""} onChange={(e) => upd("template_cliente", e.target.value)}
          className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
      </label>

      <div className="flex justify-end">
        <button onClick={salvar} disabled={saving} className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50">
          {saving ? "Salvando…" : "Salvar"}
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Renderizar o painel no Settings**

No `SettingsModule`, ao lado de `{user.role === "admin" && <CompanyAuditPanel />}` (≈ linha 13277), adicionar:
```jsx
{(user.role === "admin" || user.role === "gerente") && <LembreteConfigPanel />}
```

- [ ] **Step 4: Campo de intervalo na ficha do cliente**

No formulário de cliente do `CadastroModule` (onde estão os inputs do cliente), adicionar um campo opcional que grava `intervalo_manutencao_dias` no objeto do cliente salvo:
```jsx
<label className="block">
  <span className="text-xs text-gray-300">Intervalo de manutenção (dias) — opcional</span>
  <input type="number" min="0" value={clientForm.intervalo_manutencao_dias || ""}
    onChange={(e) => setClientForm((p) => ({ ...p, intervalo_manutencao_dias: parseInt(e.target.value, 10) || 0 }))}
    placeholder="usa o padrão da empresa" className="mt-1 w-full px-3 py-2 rounded-lg bg-gray-900 border border-gray-700 text-white text-sm" />
</label>
```
E garantir que o `data`/objeto salvo do cliente inclua `intervalo_manutencao_dias: Number(clientForm.intervalo_manutencao_dias) || undefined`. (Localizar o handler de salvar cliente — grep `erp:client:` em App.jsx — e incluir o campo no objeto persistido.)

- [ ] **Step 5: Build + smoke**

Run: `npm run build`
Expected: build OK. Abrir Settings (admin) → ver o painel "Lembrete de manutenção"; salvar → toast sucesso; `select * from lembrete_config where company_id='cmp_default'` reflete os valores.

- [ ] **Step 6: Commit**

```bash
git add src/App.jsx
git commit -m "feat(lembrete): painel de config no Settings + intervalo por cliente na ficha"
```

---

## Self-Review

- **Spec coverage:** intervalo PJ/PF + override (Task 1 intervaloEfetivo, Task 6 ficha) ✓; âncora última OS finalizada (Task 1 ultimaVisitaCliente, Task 3) ✓; avisar X dias antes (Task 1 manutencaoDue, Task 3) ✓; agendadas no lookahead (Task 3 Parte B) ✓; resumo dono IA (Task 3 Parte C) ✓; canais WhatsApp (Task 3) ✓ — **Push**: a config existe (canais inclui 'push') mas o envio push não está implementado na edge (só WhatsApp). **GAP consciente**: Push fica como fase 2 (requer buscar push_subscriptions + chamar send-push por user_id); a UI já permite marcar, mas o dispatcher ignora 'push' por enquanto. Documentar no commit/PR. ; config UI (Task 6) ✓; tabelas+RLS (Task 2) ✓; cron (Task 4) ✓.
- **Placeholders:** sem TODO/TBD; código completo. (Push é gap explícito, não placeholder.)
- **Type consistency:** `tipoCliente`/`intervaloEfetivo`/`preencherTemplate` iguais na lib (Task 1) e replicadas na edge (Task 3, Deno não importa de src/) — assinaturas equivalentes; `lembrete_config`/`lembrete_enviado` colunas idênticas entre Task 2 (SQL), Task 3 (insert/select) e Task 5/6 (UI).
- **Decisão de duplicação:** a edge function (Deno) NÃO importa `src/lib/lembrete.js` (runtime separado) — as 3 helpers puras são reescritas inline na edge de propósito; manter as duas em sincronia se a regra mudar.

## Deploy
- Front-end: merge na `main` → Vercel.
- Edge: `deploy_edge_function lembrete-dispatch` (verify_jwt=false) — já no Task 3.
- SQL/cron: Tasks 2 e 4 aplicam direto via MCP.
- Push como envio: fase 2 (fora deste plano).
