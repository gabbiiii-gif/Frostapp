// Endpoint serverless Vercel — healthcheck simples para monitoramento de uptime.
// GET /api/health → 200 { status: "ok", ... } quando saudável; 503 se o Supabase
// estiver inacessível. NÃO expõe segredos. Serve para monitores externos
// (UptimeRobot, BetterStack, etc.) e para checagem rápida pós-deploy.
//
// Variáveis de ambiente (opcionais — se ausentes, reporta só o app como ok):
//   SUPABASE_URL — URL do projeto Supabase (usada só para testar alcançabilidade)

export default async function handler(req, res) {
  const startedAt = Date.now();
  const result = {
    status: "ok",
    service: "frostapp",
    time: new Date().toISOString(),
    checks: {},
  };

  // Alcançabilidade do Supabase — best-effort, timeout curto. Qualquer resposta
  // HTTP prova que a plataforma está de pé; só erro de rede/timeout = "unreachable".
  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  if (supabaseUrl) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 3000);
      const r = await fetch(`${supabaseUrl}/auth/v1/health`, { signal: controller.signal });
      clearTimeout(timer);
      // 5xx da própria Supabase indica degradação; qualquer outra resposta = ok.
      if (r.status >= 500) {
        result.checks.supabase = `http_${r.status}`;
        result.status = "degraded";
      } else {
        result.checks.supabase = "ok";
      }
    } catch {
      result.checks.supabase = "unreachable";
      result.status = "degraded";
    }
  } else {
    result.checks.supabase = "not_configured";
  }

  result.latency_ms = Date.now() - startedAt;

  // Nunca cacheia — o monitor precisa sempre do estado atual.
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.status(result.status === "ok" ? 200 : 503).json(result);
}
