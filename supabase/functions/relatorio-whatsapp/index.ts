// Edge Function: relatorio-whatsapp
// ─────────────────────────────────────────────────────────────────────────────
// Envia um relatório gerado no app para um número de WhatsApp via Evolution API:
// primeiro o resumo em texto, depois o arquivo como documento.
//
// Roda no servidor por dois motivos: a CSP do app (vite.config.js) só libera
// connect-src para 'self' e *.supabase.co, então um fetch direto ao host do
// Evolution é bloqueado no navegador; e a apikey da instância não pode chegar
// ao cliente.
//
// Caller: cliente front-end logado, admin ou gerente da companyId alvo.
//
// Deploy: supabase functions deploy relatorio-whatsapp
// Auth: verify_jwt = true.
//
// Payload (POST JSON):
//   {
//     companyId: string,
//     telefone: string,          // com ou sem DDI; normalizado aqui
//     nomeRelatorio: string,
//     resumo: string,            // texto da mensagem
//     arquivoBase64: string,     // conteúdo do arquivo, sem prefixo data:
//     arquivoNome: string,       // ex.: "faturamento-2026-03-05.csv"
//     mimetype?: string          // default "text/csv"
//   }

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

// Normaliza telefone brasileiro: só dígitos, sem zero à esquerda, com DDI 55.
// Mesma regra do sendWhatsAppMessage em src/platform.js.
function normalizaTelefone(bruto: string): string {
  const n = String(bruto).replace(/\D/g, "").replace(/^0+/, "");
  return n.startsWith("55") ? n : "55" + n;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json({ ok: false, error: "server_misconfigured" }, 500);
  }

  // ─── 1. Identifica o caller pelo JWT ───
  const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!token) return json({ ok: false, error: "unauthenticated" }, 401);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: callerData, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !callerData?.user) return json({ ok: false, error: "invalid_token" }, 401);
  const callerId = callerData.user.id;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  const companyId = String(body.companyId || "").trim();
  const telefone = String(body.telefone || "").trim();
  const nomeRelatorio = String(body.nomeRelatorio || "Relatório").trim();
  const resumo = String(body.resumo || "").trim();
  const arquivoBase64 = String(body.arquivoBase64 || "");
  const arquivoNome = String(body.arquivoNome || "relatorio.csv");
  const mimetype = String(body.mimetype || "text/csv");
  if (!companyId || !telefone || !arquivoBase64) {
    return json({ ok: false, error: "missing_fields" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // ─── 2. Caller precisa ser admin ou gerente ATIVO desta empresa ───
  const { data: membro } = await admin
    .from("company_members")
    .select("role, is_super_admin, status")
    .eq("user_id", callerId)
    .eq("company_id", companyId)
    .maybeSingle();

  const autorizado = Boolean(membro) && membro.status === "ativo" &&
    (membro.is_super_admin || membro.role === "admin" || membro.role === "gerente");
  if (!autorizado) return json({ ok: false, error: "forbidden" }, 403);

  // ─── 3. Instância Evolution da empresa ───
  const { data: cfg } = await admin
    .from("ai_agent_config")
    .select("evolution_url, evolution_instance, metadata")
    .eq("company_id", companyId)
    .maybeSingle();

  if (!cfg?.evolution_url || !cfg?.evolution_instance) {
    return json({ ok: false, error: "evolution_nao_configurada" }, 400);
  }
  const apikey = String((cfg.metadata as Record<string, unknown> | null)?.evolution_apikey || "")
    || Deno.env.get("EVOLUTION_APIKEY") || "";
  const base = String(cfg.evolution_url).replace(/\/$/, "");
  const numero = normalizaTelefone(telefone);

  // ─── 4. Texto primeiro, arquivo depois ───
  // Se o texto falhar, abortamos: um anexo sem contexto não ajuda ninguém.
  const texto = `📊 *${nomeRelatorio}*\n\n${resumo}\n\n_Enviado pelo FrostERP._`;
  const respTexto = await fetch(`${base}/message/sendText/${cfg.evolution_instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify({ number: numero, text: texto }),
  });
  if (!respTexto.ok) {
    const detalhe = await respTexto.text().catch(() => "");
    return json({ ok: false, error: `evolution_text_${respTexto.status}`, detalhe: detalhe.slice(0, 200) }, 502);
  }

  const respMedia = await fetch(`${base}/message/sendMedia/${cfg.evolution_instance}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey },
    body: JSON.stringify({
      number: numero,
      mediatype: "document",
      mimetype,
      media: arquivoBase64,
      fileName: arquivoNome,
      caption: nomeRelatorio,
    }),
  });
  if (!respMedia.ok) {
    const detalhe = await respMedia.text().catch(() => "");
    // O texto já foi entregue — sinalizamos isso para a UI não sugerir que
    // nada chegou.
    return json({
      ok: false,
      error: `evolution_media_${respMedia.status}`,
      texto_enviado: true,
      detalhe: detalhe.slice(0, 200),
    }, 502);
  }

  return json({ ok: true });
});
