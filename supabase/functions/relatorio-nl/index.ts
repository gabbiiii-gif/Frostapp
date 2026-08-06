// Edge Function: relatorio-nl
// ─────────────────────────────────────────────────────────────────────────────
// Traduz uma pergunta em português para um ReportSpec do módulo Relatórios.
//
// A IA recebe SÓ metadados (fontes, campos, tipos) — nenhum dado de cliente sai
// do dispositivo — e não calcula nada: quem executa é o engine puro no cliente,
// depois de validar o spec contra o registry. Isso mantém o custo baixo (uma
// chamada curta por pergunta) e o resultado auditável e reproduzível.
//
// Deploy: supabase functions deploy relatorio-nl
// Auth: verify_jwt = true.
// Secret necessário: ANTHROPIC_API_KEY
//
// Payload (POST JSON): { pergunta: string, registry: object[], hoje: "YYYY-MM-DD" }
// Resposta: { ok: true, spec } | { ok: false, error }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// Schema da tool. Forçar tool_choice faz o modelo responder SEMPRE neste
// formato — sem texto solto que o cliente teria de adivinhar como interpretar.
const FERRAMENTA = {
  name: "montar_relatorio",
  description: "Monta a consulta (ReportSpec) que responde à pergunta do usuário.",
  input_schema: {
    type: "object",
    properties: {
      fonte: { type: "string", description: "id da fonte de dados escolhida" },
      periodo: {
        type: "object",
        properties: {
          campo: { type: "string", description: "id do campo de data usado no recorte" },
          de: { type: "string", description: "data inicial YYYY-MM-DD" },
          ate: { type: "string", description: "data final YYYY-MM-DD" },
        },
        required: ["campo", "de", "ate"],
      },
      filtros: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campo: { type: "string" },
            op: {
              type: "string",
              enum: ["igual", "diferente", "contem", "maior", "menor", "entre", "vazio", "nao_vazio", "em"],
            },
            valor: { description: "valor do filtro; lista de 2 elementos para 'entre', lista para 'em'" },
          },
          required: ["campo", "op"],
        },
      },
      agrupamento: { type: "array", items: { type: "string" } },
      metricas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            campo: { type: "string", description: "omitir quando a agregação for contagem" },
            agregacao: {
              type: "string",
              enum: ["soma", "media", "contagem", "minimo", "maximo", "contagem_distinta"],
            },
          },
          required: ["agregacao"],
        },
      },
      ordenacao: {
        type: "object",
        properties: {
          campo: { type: "string", description: "nome da coluna do resultado, ex: valor_soma" },
          direcao: { type: "string", enum: ["asc", "desc"] },
        },
      },
      limite: { type: "number" },
      grafico: {
        type: "object",
        properties: {
          tipo: { type: "string", enum: ["barra", "linha", "pizza", "area"] },
          eixoX: { type: "string" },
          series: { type: "array", items: { type: "string" } },
        },
      },
    },
    required: ["fonte", "periodo", "metricas"],
  },
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
  if (!API_KEY) return json({ ok: false, error: "ia_nao_configurada" }, 503);

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const pergunta = String(body.pergunta || "").trim();
  const registry = body.registry;
  const hoje = String(body.hoje || new Date().toISOString().slice(0, 10));
  if (!pergunta || !Array.isArray(registry) || registry.length === 0) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }
  // Teto simples de abuso: pergunta é uma frase, não um documento.
  if (pergunta.length > 500) return json({ ok: false, error: "pergunta_muito_longa" }, 400);

  const system = [
    "Você monta consultas para o módulo de relatórios de um ERP brasileiro de refrigeração.",
    "Use SOMENTE as fontes e campos do catálogo fornecido — nunca invente id de campo.",
    `Hoje é ${hoje}. Traduza expressões como "março", "este mês" ou "últimos 30 dias" em datas YYYY-MM-DD.`,
    "Período é obrigatório. Na dúvida sobre o recorte, use o mês corrente.",
    "Escolha a agregação compatível com o tipo do campo: soma e média só valem em numero ou moeda.",
    "Em ordenacao.campo e grafico.series use o nome da coluna do resultado: <campo>_<agregacao>, ou 'contagem'.",
    "grafico.eixoX precisa ser um dos campos de agrupamento.",
    "Responda chamando a ferramenta montar_relatorio. Não escreva texto fora dela.",
  ].join(" ");

  let resp: Response;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 1024,
        system,
        tools: [FERRAMENTA],
        tool_choice: { type: "tool", name: "montar_relatorio" },
        messages: [{
          role: "user",
          content: `Catálogo de fontes:\n${JSON.stringify(registry)}\n\nPergunta: ${pergunta}`,
        }],
      }),
    });
  } catch (e) {
    return json({ ok: false, error: "anthropic_inacessivel", detalhe: String(e).slice(0, 200) }, 502);
  }

  if (!resp.ok) {
    const detalhe = await resp.text().catch(() => "");
    return json({ ok: false, error: `anthropic_${resp.status}`, detalhe: detalhe.slice(0, 200) }, 502);
  }

  const data = await resp.json();
  const bloco = (data.content || []).find((c: Record<string, unknown>) => c.type === "tool_use");
  if (!bloco?.input) return json({ ok: false, error: "sem_resposta_estruturada" }, 502);

  return json({ ok: true, spec: bloco.input });
});
