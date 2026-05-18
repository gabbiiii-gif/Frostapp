# Agente IA WhatsApp v2 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar áudio (Whisper), imagem (GPT-4o vision), confirmação humana antes de criar OS, e multi-empresa ao agente IA WhatsApp do FrostERP, e ingerir o conhecimento no wiki.

**Architecture:** n8n resolve `company_id` por `evolution_instance`; ramos de mídia baixam o binário da Evolution, sobem ao Supabase Storage e geram texto (Whisper/vision); o agente registra uma *proposta* de OS (`ai_os_proposals`) em vez de criar a OS; o app `IAAtendimentoModule` mostra propostas pendentes e, ao aprovar, cria a OS pelo DB layer existente (audit/scope/sync preservados) e notifica o admin via push.

**Tech Stack:** n8n (langchain agent, Postgres, HTTP nodes), Supabase (Postgres + Storage + Realtime), OpenAI (`whisper-1`, `gpt-4o`, `gpt-4o-mini`), React 19 (`src/App.jsx`), Vitest.

**Spec:** `docs/superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md`

**Repo:** `https://github.com/gabbiiii-gif/Frostapp.git` — diretório local ainda **não** é git (ver Fase 0).

---

## File Structure

| Arquivo | Responsabilidade | Ação |
|---|---|---|
| `docs/ai-agent/01-supabase-schema.sql` | tabela `ai_os_proposals` + RLS + Realtime | Modify |
| `docs/ai-agent/02-n8n-workflow.json` | nós: resolve empresa, áudio, imagem, `propose_os` | Modify |
| `docs/ai-agent/03-setup-guide.md` | bucket `ai-media`, custos vision, roteiro de teste manual | Modify |
| `src/utils.js` | helper puro `buildOSProposalPayload` / `validateOSProposal` | Modify |
| `src/utils.test.js` | testes do helper | Modify |
| `src/App.jsx` | `createOSFromProposal()` + aba "Propostas" no `IAAtendimentoModule` + push | Modify |
| `docs/wiki/*` | ingest (5 páginas + index + log) | Create/Modify |

---

## Fase 0 — Git e baseline

### Task 0: Inicializar git e conectar ao repositório

**Files:** (nenhum arquivo de código — setup de repo)

- [ ] **Step 1: Inicializar e conectar remote**

Run:
```bash
cd "C:/Users/T-GAMER/Downloads/Frostapp-main (4)/Frostapp-main"
git init
git remote add origin https://github.com/gabbiiii-gif/Frostapp.git
git fetch origin
```
Expected: `git fetch` lista branches remotas (ex.: `origin/main`). Se falhar por auth, PARAR e pedir ao usuário para autenticar (`! gh auth login` ou credenciais).

- [ ] **Step 2: Reconciliar com o remoto sem destruir**

Run:
```bash
git checkout -b main
git reset --soft origin/main   # alinha histórico sem mexer nos arquivos locais
git status
```
Expected: árvore de trabalho intacta; `git status` mostra os arquivos locais como modificações sobre `origin/main`. Se `origin/main` não existir, pular o `reset` e seguir com `main` novo.

- [ ] **Step 3: Branch de feature**

Run:
```bash
git checkout -b feat/ia-whatsapp-v2
```
Expected: branch `feat/ia-whatsapp-v2` ativa. Todos os commits seguintes vão aqui.

- [ ] **Step 4: Commit baseline do spec/plan**

```bash
git add docs/superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md docs/superpowers/plans/2026-05-18-ia-whatsapp-v2.md
git commit -m "docs: spec e plano do agente IA WhatsApp v2

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```
Expected: commit criado.

---

## Fase 1 — Schema Supabase

### Task 1: Tabela `ai_os_proposals` + RLS + Realtime

**Files:**
- Modify: `docs/ai-agent/01-supabase-schema.sql` (append antes do bloco final `do $$ ... realtime`)

- [ ] **Step 1: Adicionar a tabela e índice**

Inserir no `01-supabase-schema.sql`, após a seção `-- ─── 3. Configuração do agente ───` e antes de `-- ─── 4. RLS`:

```sql
-- ─── 3b. Propostas de OS (gate de aprovação humana) ──────────────────────────
create table if not exists public.ai_os_proposals (
  id               uuid primary key default gen_random_uuid(),
  company_id       text not null references public.companies(id) on delete cascade,
  conversation_id  uuid not null references public.ai_conversations(id) on delete cascade,
  payload          jsonb not null,   -- {customer_name,address,equipment_type,equipment_brand,equipment_model,problem,phone,media_urls[]}
  status           text not null default 'pending_approval'
                     check (status in ('pending_approval','approved','rejected')),
  created_os_id    text,
  decided_by       text,
  created_at       timestamptz not null default now(),
  decided_at       timestamptz
);

create index if not exists ai_os_prop_company_idx
  on public.ai_os_proposals(company_id, status, created_at desc);
```

- [ ] **Step 2: Habilitar RLS + policy (mesmo padrão das outras tabelas)**

Na seção `-- ─── 4. RLS`, adicionar:

```sql
alter table public.ai_os_proposals enable row level security;

drop policy if exists "prop_company_scope" on public.ai_os_proposals;
create policy "prop_company_scope" on public.ai_os_proposals
  for all
  using (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  )
  with check (
    company_id in (select cm.company_id from public.company_members cm where cm.user_id = auth.uid())
  );
```

- [ ] **Step 3: Publicar no Realtime**

No bloco `do $$ begin ... end $$;` da seção 5, adicionar mais um `if not exists`:

```sql
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and tablename = 'ai_os_proposals'
  ) then
    alter publication supabase_realtime add table public.ai_os_proposals;
  end if;
```

- [ ] **Step 4: Validar SQL sintaticamente**

Run (não há banco local; checagem só de sintaxe via verificação visual e, se disponível, MCP Supabase `execute_sql` num branch de teste):
```
Revisar manualmente: parênteses balanceados, vírgulas, nomes de coluna consistentes com o payload do spec.
```
Expected: sem placeholders, nomes batem com Task 4/Task 6.

- [ ] **Step 5: Commit**

```bash
git add docs/ai-agent/01-supabase-schema.sql
git commit -m "feat(ai): tabela ai_os_proposals com RLS e Realtime

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Fase 2 — Workflow n8n

> n8n não tem runner automatizado neste projeto. "Teste" = validar JSON e roteiro manual (Fase 6). Cada task edita `docs/ai-agent/02-n8n-workflow.json` mantendo JSON válido.

### Task 2: Nó "Resolve empresa" (instance → company_id)

**Files:**
- Modify: `docs/ai-agent/02-n8n-workflow.json`

- [ ] **Step 1: Adicionar nó Postgres "Resolve empresa"**

Adicionar ao array `nodes` (id `"16"`):

```json
{
  "parameters": {
    "operation": "executeQuery",
    "query": "select company_id from ai_agent_config where evolution_instance = '{{ $('Extrai campos').item.json.instance }}' and enabled = true limit 1;"
  },
  "id": "16",
  "name": "Resolve empresa",
  "type": "n8n-nodes-base.postgres",
  "typeVersion": 2.5,
  "position": [740, 360],
  "credentials": { "postgres": { "id": "SUPABASE_POSTGRES_CRED_ID", "name": "Supabase Postgres" } }
}
```

- [ ] **Step 2: Reencadear connections**

Em `connections`: `"Extrai campos"` passa a apontar para `"Resolve empresa"`; `"Resolve empresa"` aponta para `"Upsert conversa"`:

```json
"Extrai campos": { "main": [[{ "node": "Resolve empresa", "type": "main", "index": 0 }]] },
"Resolve empresa": { "main": [[{ "node": "Upsert conversa", "type": "main", "index": 0 }]] },
```

- [ ] **Step 3: Trocar todas as referências de company_id**

Substituir, em todos os nós downstream (`Upsert conversa`, `Grava msg cliente`, `Tool: get_recent_os`, `Grava resposta IA`, e o futuro `propose_os`), `$('Extrai campos').item.json.company_id` por `$('Resolve empresa').item.json.company_id`. Remover o campo `company_id` do nó "Extrai campos" (`assignments` id `p5`) — não é mais derivado do body.

- [ ] **Step 4: Validar JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/ai-agent/02-n8n-workflow.json','utf8')); console.log('JSON OK')"
```
Expected: `JSON OK`

- [ ] **Step 5: Commit**

```bash
git add docs/ai-agent/02-n8n-workflow.json
git commit -m "feat(ai): resolve company_id por evolution_instance no n8n

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 3: Ramos de áudio (Whisper) e imagem (GPT-4o vision) + Storage

**Files:**
- Modify: `docs/ai-agent/02-n8n-workflow.json`

- [ ] **Step 1: Nó IF "Tipo de mídia"**

Após "Resolve empresa", adicionar nó `n8n-nodes-base.switch` (id `"17"`, name `"Tipo de mídia"`) com 3 saídas: `audio` se `{{ $('Extrai campos').item.json }}` tiver `body.data.message.audioMessage`; `image` se `imageMessage`; `text` caso contrário (default). Posição `[940, 360]`. Encadear "Resolve empresa" → "Tipo de mídia". Saída `text` → "Upsert conversa" (fluxo atual).

- [ ] **Step 2: Nó "Baixa mídia Evolution" (compartilhado)**

`n8n-nodes-base.httpRequest` (id `"18"`), POST `=https://SEU_EVOLUTION_HOST/chat/getBase64FromMediaMessage/{{ $('Extrai campos').item.json.instance }}`, header `apikey: SUBSTITUA_PELA_API_KEY_EVOLUTION`, body JSON `{ "message": { "key": {{ JSON.stringify($('Webhook Evolution').item.json.body.data.key) }} }, "convertToMp4": false }`, `responseFormat: file`. Saídas `audio` e `image` do switch entram aqui.

> Nota: o endpoint exato (`/chat/getBase64FromMediaMessage`) deve ser confirmado contra `atendai/evolution-api:latest` na Fase 6. Documentar como ponto de verificação.

- [ ] **Step 3: Nó "Upload Storage"**

`n8n-nodes-base.httpRequest` (id `"19"`), POST `={{ supabase }}/storage/v1/object/ai-media/{{ $('Resolve empresa').item.json.company_id }}/{{ $('Upsert conversa').item.json.id }}/{{ $now.toMillis() }}.{{ $('Tipo de mídia').item.json.ext }}`. Header `Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>` (credencial n8n), `Content-Type` do binário. Saída expõe `media_url` = `<SUPABASE_URL>/storage/v1/object/public/ai-media/...`.

> Como `Upsert conversa` ocorre depois no fluxo atual, mover o upload para depois do upsert OU usar `phone+now` como path provisório. Decisão: path = `ai-media/{company_id}/{phone}/{millis}.{ext}` (não depende de conversation_id). Atualizar o template do Step 3 para usar `$('Extrai campos').item.json.phone`.

- [ ] **Step 4: Nó "Whisper" (ramo áudio)**

`@n8n/n8n-nodes-langchain` OpenAI / `n8n-nodes-base.httpRequest` para `https://api.openai.com/v1/audio/transcriptions`, model `whisper-1`, arquivo = binário do Step 2, `language: pt`. Saída `transcription`. Encadear: switch.audio → "Baixa mídia" → "Upload Storage" → "Whisper".

- [ ] **Step 5: Nó "Vision" (ramo imagem)**

`n8n-nodes-base.httpRequest` para `https://api.openai.com/v1/chat/completions`, model `gpt-4o`, mensagem com `image_url` = `media_url` do Step 3 e prompt: `"Você é técnico de refrigeração. Descreva objetivamente o equipamento e possíveis defeitos visíveis nesta imagem enviada por um cliente. Seja conciso."`. Saída `description`. Encadear: switch.image → "Baixa mídia" → "Upload Storage" → "Vision".

- [ ] **Step 6: Convergir para o fluxo principal**

Adicionar nó Set "Texto efetivo" (id `"20"`): `text` = transcrição (áudio) | `"[Imagem do cliente]: " + description + " " + (legenda)` (imagem) | texto original. `media_url` = saída do Upload (ou vazio). "Whisper" e "Vision" → "Texto efetivo" → "Upsert conversa". Ajustar nós "Grava msg cliente" e entrada do "AI Agent" para usar `$('Texto efetivo').item.json.text` e gravar `media_url` em `ai_messages` (`insert ... (conversation_id, company_id, role, content, media_url) values (..., '{{ $('Texto efetivo').item.json.media_url }}')`).

- [ ] **Step 7: Validar JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/ai-agent/02-n8n-workflow.json','utf8')); console.log('JSON OK')"
```
Expected: `JSON OK`

- [ ] **Step 8: Commit**

```bash
git add docs/ai-agent/02-n8n-workflow.json
git commit -m "feat(ai): ramos de audio (Whisper) e imagem (vision) com Storage

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 4: `create_os` → `propose_os`

**Files:**
- Modify: `docs/ai-agent/02-n8n-workflow.json`

- [ ] **Step 1: Converter o tool**

No nó id `"10"`: renomear `name` para `propose_os`, trocar `type` para `@n8n/n8n-nodes-langchain.toolPostgres`, `operation: executeQuery`, query:

```sql
insert into ai_os_proposals (company_id, conversation_id, payload)
values (
  '{{ $('Resolve empresa').item.json.company_id }}',
  '{{ $('Upsert conversa').item.json.id }}',
  json_build_object(
    'customer_name', $$ {{ $fromAI('customer_name') }} $$,
    'address',       $$ {{ $fromAI('address') }} $$,
    'equipment_type',$$ {{ $fromAI('equipment_type') }} $$,
    'equipment_brand',$$ {{ $fromAI('equipment_brand') }} $$,
    'equipment_model',$$ {{ $fromAI('equipment_model') }} $$,
    'problem',       $$ {{ $fromAI('problem') }} $$,
    'phone',         '{{ $('Extrai campos').item.json.phone }}',
    'media_urls', case when '{{ $('Texto efetivo').item.json.media_url }}' = '' then '[]'::jsonb
                       else jsonb_build_array('{{ $('Texto efetivo').item.json.media_url }}') end
  )::jsonb
) returning id;
```

`description` do tool: `"Registra uma PROPOSTA de Ordem de Serviço para aprovação humana. Use quando tiver nome, endereço, equipamento (tipo/marca/modelo) e descrição do problema. NÃO afirme que a OS foi criada — diga que o pedido foi registrado e será analisado por um atendente."`. Remover credencial de `toolWorkflow`; adicionar `credentials.postgres` igual aos outros tools Postgres.

- [ ] **Step 2: Ajustar system prompt do Agent**

No nó "AI Agent" (id `"7"`), `options.systemMessage`: trocar "use a ferramenta create_os para registrar a Ordem de Serviço. Confirme ao cliente." por "use a ferramenta propose_os para registrar a solicitação. Informe que o pedido foi registrado e que um atendente fará a análise e retornará em breve. Nunca afirme que a OS já está criada ou agendada."

- [ ] **Step 3: Validar JSON**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('docs/ai-agent/02-n8n-workflow.json','utf8')); console.log('JSON OK')"
```
Expected: `JSON OK`

- [ ] **Step 4: Commit**

```bash
git add docs/ai-agent/02-n8n-workflow.json
git commit -m "feat(ai): create_os vira propose_os (gate de aprovacao humana)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Fase 3 — Helper puro + testes (TDD)

### Task 5: `validateOSProposal` em `src/utils.js`

**Files:**
- Modify: `src/utils.js`
- Test: `src/utils.test.js`

- [ ] **Step 1: Escrever o teste que falha**

Adicionar em `src/utils.test.js`:

```js
import { validateOSProposal } from "./utils";

describe("validateOSProposal", () => {
  const base = {
    customer_name: "Maria", address: "Rua A, 10, Centro, SP",
    equipment_type: "Geladeira", equipment_brand: "Brastemp",
    equipment_model: "BRM44", problem: "não gela", phone: "5511999998888",
  };
  it("aceita payload completo e normaliza telefone", () => {
    const r = validateOSProposal({ ...base, phone: "+55 (11) 99999-8888" });
    expect(r.valid).toBe(true);
    expect(r.payload.phone).toBe("5511999998888");
    expect(r.payload.media_urls).toEqual([]);
  });
  it("rejeita quando falta campo obrigatório", () => {
    const r = validateOSProposal({ ...base, problem: "" });
    expect(r.valid).toBe(false);
    expect(r.missing).toContain("problem");
  });
  it("preserva media_urls existentes", () => {
    const r = validateOSProposal({ ...base, media_urls: ["http://x/a.jpg"] });
    expect(r.payload.media_urls).toEqual(["http://x/a.jpg"]);
  });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm run test -- src/utils.test.js`
Expected: FAIL — `validateOSProposal is not a function`.

- [ ] **Step 3: Implementar o mínimo**

Adicionar em `src/utils.js` (exportado, junto dos outros helpers puros):

```js
// Valida e normaliza o payload de uma proposta de OS vinda do agente IA.
// Retorna { valid, missing[], payload } — payload com telefone só dígitos e
// media_urls sempre array. Helper puro: testado em utils.test.js.
export function validateOSProposal(input) {
  const required = ["customer_name", "address", "equipment_type", "equipment_brand", "equipment_model", "problem", "phone"];
  const src = input || {};
  const missing = required.filter((k) => !String(src[k] ?? "").trim());
  const payload = {
    customer_name: String(src.customer_name ?? "").trim(),
    address: String(src.address ?? "").trim(),
    equipment_type: String(src.equipment_type ?? "").trim(),
    equipment_brand: String(src.equipment_brand ?? "").trim(),
    equipment_model: String(src.equipment_model ?? "").trim(),
    problem: String(src.problem ?? "").trim(),
    phone: String(src.phone ?? "").replace(/\D/g, ""),
    media_urls: Array.isArray(src.media_urls) ? src.media_urls.filter(Boolean) : [],
  };
  return { valid: missing.length === 0, missing, payload };
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm run test -- src/utils.test.js`
Expected: PASS (3 testes).

- [ ] **Step 5: Commit**

```bash
git add src/utils.js src/utils.test.js
git commit -m "feat(ai): validateOSProposal helper + testes

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Fase 4 — App: aba Propostas + aprovação + push

### Task 6: `createOSFromProposal` em `src/App.jsx`

**Files:**
- Modify: `src/App.jsx` (inserir após `scheduleOSPosVenda`, função termina ~linha 1043; localizar com grep)

- [ ] **Step 1: Localizar o ponto de inserção e o padrão de foto da OS**

Run:
```bash
grep -n "async function scheduleOSPosVenda" src/App.jsx
grep -n "os-fotos" src/App.jsx
grep -n "getNextNumber(\"OS\"" src/App.jsx
```
Expected: linha de `scheduleOSPosVenda` (inserir a nova função logo após o fim dela); padrão de upload `os-fotos` e assinatura de `getNextNumber` para reuso. Anotar o nome do campo de fotos da OS (provável `fotos`) confirmado pelo bloco `os-fotos`.

- [ ] **Step 2: Inserir a função (reusa DB/genId/getNextNumber, preserva audit/scope/sync)**

Inserir após o fechamento de `scheduleOSPosVenda`:

```js
// Cria uma OS a partir de uma proposta aprovada do agente IA.
// Caminho pelo DB layer (DB.set) — mantém audit trail, escopo por empresa,
// sync Supabase e dispara o pós-venda. Espelha o newOS do ProcessModule
// (App.jsx, getNextNumber("OS", ...)). Fotos do cliente entram em `fotos`.
function createOSFromProposal(p) {
  const orders = DB.list("erp:os:");
  const numero = getNextNumber("OS", orders, "erp:os:");
  const newOS = {
    id: genId(),
    numero,
    clienteId: null,
    clienteNome: p.customer_name || "—",
    endereco: p.address || "",
    servicos: [],
    pecas: [],
    tipo: "Atendimento via IA WhatsApp",
    descricao: p.problem || "",
    equipamentoTipo: p.equipment_type || "",
    equipamentoModelo: [p.equipment_brand, p.equipment_model].filter(Boolean).join(" "),
    equipamentoCapacidade: "",
    equipamentoBTUs: "",
    tecnicoId: "",
    tecnicoNome: "—",
    status: "aguardando",
    dataAbertura: new Date().toISOString(),
    dataAgendada: null,
    horaAgendada: "",
    dataConclusao: null,
    observacoes: `Telefone WhatsApp: ${p.phone || ""}`,
    valor: 0,
    itensUtilizados: [],
    fotos: Array.isArray(p.media_urls) ? p.media_urls : [],
    origem: "ia_whatsapp",
    createdAt: new Date().toISOString(),
  };
  DB.set("erp:os:" + newOS.id, newOS);
  scheduleOSPosVenda(newOS);
  return newOS;
}
```

> Se o Step 1 revelar que o campo de fotos não é `fotos` (ex.: `fotosUrls`), ajustar a chave acima para o nome real antes de prosseguir.

- [ ] **Step 3: Verificar build**

Run: `npm run build`
Expected: build sem erro (função nova referenciada na Task 7).

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx
git commit -m "feat(ai): createOSFromProposal via DB layer

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 7: Aba "Propostas" no `IAAtendimentoModule` + aprovar/rejeitar + push

**Files:**
- Modify: `src/App.jsx` (`IAAtendimentoModule`, ~linha 11980; localizar com grep)

- [ ] **Step 1: Localizar o módulo e o subscribe Realtime existente**

Run:
```bash
grep -n "function IAAtendimentoModule" src/App.jsx
grep -n "postgres_changes.*ai_messages" src/App.jsx
grep -n "sendServerPush" src/App.jsx src/platform.js
```
Expected: corpo do módulo, bloco `supabase.channel(...).on("postgres_changes", ... ai_messages ...)` (anexar escuta de `ai_os_proposals` ali), assinatura de `sendServerPush`.

- [ ] **Step 2: Estado + carga das propostas**

Dentro de `IAAtendimentoModule`, adicionar:

```js
const [proposals, setProposals] = useState([]);
const [showProposals, setShowProposals] = useState(false);

const loadProposals = useCallback(async () => {
  if (!companyId) return;
  const { data } = await supabase
    .from("ai_os_proposals")
    .select("*")
    .eq("company_id", companyId)
    .eq("status", "pending_approval")
    .order("created_at", { ascending: true });
  setProposals(data || []);
}, [companyId]);

useEffect(() => { loadProposals(); }, [loadProposals]);
```

- [ ] **Step 3: Realtime + push para novas propostas**

No mesmo `supabase.channel(...)` que já escuta `ai_messages`, encadear:

```js
.on("postgres_changes",
  { event: "INSERT", schema: "public", table: "ai_os_proposals", filter: `company_id=eq.${companyId}` },
  (payload) => {
    loadProposals();
    sendServerPush(
      "Nova proposta de OS",
      `${payload.new?.payload?.customer_name || "Cliente"} — aguardando aprovação`
    ).catch(() => {});
  }
)
```

- [ ] **Step 4: Handlers aprovar/rejeitar**

```js
const approveProposal = async (prop) => {
  const v = validateOSProposal(prop.payload);
  if (!v.valid) { addToast("Proposta incompleta: " + v.missing.join(", "), "error"); return; }
  const os = createOSFromProposal(v.payload);
  await supabase.from("ai_os_proposals").update({
    status: "approved", created_os_id: os.id,
    decided_by: user?.id || null, decided_at: new Date().toISOString(),
  }).eq("id", prop.id);
  if (prop.conversation_id) {
    await supabase.from("ai_conversations").update({ linked_os_id: os.id }).eq("id", prop.conversation_id);
  }
  addToast(`OS ${os.numero} criada a partir da proposta.`, "success");
  loadProposals();
};

const rejectProposal = async (prop) => {
  await supabase.from("ai_os_proposals").update({
    status: "rejected", decided_by: user?.id || null, decided_at: new Date().toISOString(),
  }).eq("id", prop.id);
  addToast("Proposta rejeitada.", "info");
  loadProposals();
};
```

> `validateOSProposal` e `createOSFromProposal` já existem (Task 5 / Task 6). Garantir que `validateOSProposal` está importado de `./utils` no topo do `App.jsx` (verificar import existente de utils e adicionar à lista).

- [ ] **Step 5: UI — badge + painel**

No header do módulo (perto do `<h1>IA / Atendimento WhatsApp`), adicionar botão:

```jsx
<button onClick={() => setShowProposals((s) => !s)}
  className="relative px-3 py-1.5 rounded-lg bg-amber-500/20 text-amber-200 text-sm">
  Propostas de OS
  {proposals.length > 0 && (
    <span className="ml-2 px-1.5 rounded-full bg-amber-500 text-black text-xs">{proposals.length}</span>
  )}
</button>
```

E um painel condicional (mesma estética dos cards do módulo) listando `proposals`: para cada uma, mostrar `payload.customer_name`, `address`, equipamento, `problem`, thumbnails de `payload.media_urls`, e botões `Aprovar` (→ `approveProposal`) / `Rejeitar` (→ `rejectProposal`).

- [ ] **Step 6: Build + smoke**

Run: `npm run build`
Expected: build OK.
Run: `npm run test`
Expected: suíte verde (Task 5 inclusa).

- [ ] **Step 7: Commit**

```bash
git add src/App.jsx
git commit -m "feat(ai): aba Propostas de OS com aprovar/rejeitar e push

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Fase 5 — Setup guide + ingest wiki

### Task 8: Atualizar `03-setup-guide.md`

**Files:**
- Modify: `docs/ai-agent/03-setup-guide.md`

- [ ] **Step 1: Bucket `ai-media`**

No Passo 1, após criar o SQL, adicionar instrução: criar bucket público `ai-media` no painel Supabase (Storage → New bucket → public) ou via SQL `insert into storage.buckets (id,name,public) values ('ai-media','ai-media',true) on conflict do nothing;`.

- [ ] **Step 2: Substituir a seção "Próximos passos"**

Trocar a lista de 4 bullets "opcionais" por: "Implementado na v2 — ver `docs/superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md`" + roteiro de **teste manual**:
1. Multi-empresa: cadastrar 2 `ai_agent_config` com instâncias distintas; mandar msg de cada → conferir `company_id` certo nas linhas.
2. Áudio: enviar mensagem de voz → conferir transcrição em `ai_messages.content` e arquivo em `ai-media`.
3. Imagem: enviar foto de equipamento → conferir descrição e `media_url`.
4. Proposta: completar dados → conferir linha em `ai_os_proposals` (status `pending_approval`), aprovar no app → OS criada, push recebido.

- [ ] **Step 3: Atualizar quadro de custos**

Adicionar linha vision: `OpenAI gpt-4o (vision, imagens)` ~ custo variável; nota que áudio usa `whisper-1`.

- [ ] **Step 4: Verificar endpoint Evolution**

Adicionar nota de verificação: confirmar `/chat/getBase64FromMediaMessage` contra a versão `atendai/evolution-api:latest` em uso; ajustar nó "Baixa mídia" se a rota diferir.

- [ ] **Step 5: Commit**

```bash
git add docs/ai-agent/03-setup-guide.md
git commit -m "docs(ai): setup guide v2 (bucket, teste manual, custos)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

### Task 9: Ingest no wiki (CLAUDE.md Regra 5)

**Files:**
- Create: `docs/wiki/modules/pos-venda.md`, `docs/wiki/modules/ia-atendimento.md`, `docs/wiki/flows/whatsapp-ia-os.md`, `docs/wiki/concepts/evolution-multitenant.md`, `docs/wiki/decisions/007-ia-os-aprovacao-humana.md`
- Modify: `docs/wiki/index.md`, `docs/wiki/log.md`

- [ ] **Step 1: Verificar estrutura do wiki**

Run:
```bash
ls docs/wiki && head -20 docs/wiki/index.md && tail -5 docs/wiki/log.md
```
Expected: confirmar formato de `index.md`/`log.md` para seguir o padrão existente.

- [ ] **Step 2: Criar as 5 páginas**

Cada página com frontmatter YAML do CLAUDE.md (`title,type,updated:2026-05-18,sources,related,code_refs`). Conteúdo em pt-BR, **só ponteiros** (`src/App.jsx#IAAtendimentoModule`, `supabase/functions/pos-venda-dispatch`, `docs/ai-agent/02-n8n-workflow.json`), sem colar código. Marcar `[inferido]` o que não tiver fonte em `docs/raw/`. ADR 007 = decisões D1/D2 do spec (sempre aprovação; OS escrita pelo app).

- [ ] **Step 3: Atualizar index.md e log.md**

`index.md`: 1 linha por página nas seções Módulos/Fluxos/Conceitos/Decisões. `log.md`: append:

```markdown
## [2026-05-18] ingest | Agente IA WhatsApp v2 + Pós-Venda
- source: docs/superpowers/specs/2026-05-18-ia-whatsapp-v2-design.md
- new pages: modules/pos-venda.md, modules/ia-atendimento.md, flows/whatsapp-ia-os.md, concepts/evolution-multitenant.md, decisions/007-ia-os-aprovacao-humana.md
- touched: index.md
```

- [ ] **Step 4: Commit**

```bash
git add docs/wiki
git commit -m "docs(wiki): ingest agente IA v2 + pos-venda

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Fase 6 — Push final

### Task 10: Push da branch

- [ ] **Step 1: Rodar suíte e build finais**

Run: `npm run test && npm run build`
Expected: testes verdes, build OK.

- [ ] **Step 2: Push**

```bash
git push -u origin feat/ia-whatsapp-v2
```
Expected: branch publicada em `https://github.com/gabbiiii-gif/Frostapp.git`. Abrir PR fica a critério do usuário (CLAUDE.md Regra 1 — deploy contínuo via Vercel; confirmar com o usuário antes de merge em `main`).

---

## Notas

- **Sem runner para n8n/SQL/Storage:** validação é JSON-parse + roteiro manual da Task 8. Único TDD real = Task 5 (helper puro), padrão do projeto.
- **Endpoint Evolution de mídia** é o maior risco técnico — confirmar cedo (Task 3 / Task 8).
- **Não criar módulo novo** — aba dentro de `IAAtendimentoModule` (padrão do projeto, CLAUDE.md).
- **Ordem de dependência:** Task 5 e 6 antes da 7; Task 1 antes de 4/6/7 (tabela existe). Tasks 2–4 (n8n) independentes do app.
