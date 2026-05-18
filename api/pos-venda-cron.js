// Endpoint serverless Vercel — gatilho de cron do Pos-Venda.
// Disparado pelo Vercel Cron (ver "crons" em vercel.json). Apenas repassa a
// chamada para a Edge Function `pos-venda-dispatch` no Supabase, com o segredo
// compartilhado. Mantido fino de proposito: toda a logica vive na Edge Function.
//
// Variaveis de ambiente necessarias (configurar na Vercel):
//   SUPABASE_URL  — URL do projeto Supabase (ex: https://xxxx.supabase.co)
//   DISPATCH_KEY  — mesmo segredo definido na Edge Function pos-venda-dispatch
//   CRON_SECRET   — (opcional) se setado, exige Authorization: Bearer <CRON_SECRET>
//                   O Vercel Cron envia esse header automaticamente quando a env existe.

export default async function handler(req, res) {
  // Guard opcional: se CRON_SECRET existir, exige o header do Vercel Cron.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers['authorization'] || '';
    if (auth !== `Bearer ${cronSecret}`) {
      return res.status(401).json({ error: 'unauthorized' });
    }
  }

  const base = process.env.SUPABASE_URL;
  const key = process.env.DISPATCH_KEY;
  if (!base || !key) {
    return res.status(500).json({ error: 'missing_env', need: ['SUPABASE_URL', 'DISPATCH_KEY'] });
  }

  try {
    const r = await fetch(`${base.replace(/\/+$/, '')}/functions/v1/pos-venda-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-dispatch-key': key },
      body: '{}',
    });
    const body = await r.json().catch(() => ({}));
    return res.status(r.status).json(body);
  } catch (e) {
    return res.status(502).json({ error: 'dispatch_unreachable', detail: String(e && e.message || e) });
  }
}
