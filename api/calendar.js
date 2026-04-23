// Endpoint serverless Vercel — gera feed iCalendar (ICS) com Agendamentos + Ordens de Serviço
// do FrostERP. Permite sincronização automática com Google Calendar, Apple Calendar e outros.
//
// Variáveis de ambiente necessárias (configurar na Vercel):
//   SUPABASE_URL              — URL do projeto Supabase
//   SUPABASE_SERVICE_ROLE_KEY — service role key (recomendado)
//   (alternativa) SUPABASE_ANON_KEY — anon key (funciona se as tabelas forem públicas)
//
// Acesso: GET /api/calendar?token=<TOKEN>
// O token é gerado pela tela de Configurações do app e salvo em erp:calendarFeedToken.

import { createClient } from '@supabase/supabase-js';

// Escapa caracteres especiais do iCalendar conforme RFC 5545
function escapeICS(text) {
  if (!text) return '';
  return String(text)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '');
}

// Formata Date como "YYYYMMDDTHHmmss" (UTC, com Z no fim)
function toICSDate(date) {
  const d = date instanceof Date ? date : new Date(date);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

// Converte um agendamento (erp:schedule) em um bloco VEVENT
function scheduleToVEvent(appt) {
  if (!appt || !appt.data) return null;
  const start = new Date(appt.data);
  const end = appt.dataFim ? new Date(appt.dataFim) : new Date(start.getTime() + 60 * 60 * 1000);
  const summary = `${appt.tipo || 'Agendamento'} — ${appt.clienteNome || ''}`.trim();
  const description = [
    appt.observacoes ? `Observações: ${appt.observacoes}` : null,
    appt.tecnicoNome ? `Técnico: ${appt.tecnicoNome}` : null,
    `Status: ${appt.status || 'agendado'}`,
  ].filter(Boolean).join('\n');

  return [
    'BEGIN:VEVENT',
    `UID:frost-sched-${appt.id}@frosterp`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICS(summary)}`,
    description ? `DESCRIPTION:${escapeICS(description)}` : null,
    appt.endereco ? `LOCATION:${escapeICS(appt.endereco)}` : null,
    `STATUS:${appt.status === 'cancelado' ? 'CANCELLED' : 'CONFIRMED'}`,
    'CATEGORIES:Agendamento,FrostERP',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

// Converte uma OS (erp:os) em VEVENT (usa dataAgendada ou dataAbertura)
function osToVEvent(os) {
  if (!os) return null;
  const baseDate = os.dataAgendada || os.dataAbertura;
  if (!baseDate) return null;

  // Se dataAgendada vem como YYYY-MM-DDT00:00:00.000Z (só data), plota às 09:00 local
  let start;
  if (os.dataAgendada && /T00:00:00/.test(os.dataAgendada)) {
    const datePart = String(os.dataAgendada).slice(0, 10);
    start = new Date(`${datePart}T09:00:00-03:00`); // BRT padrão
  } else {
    start = new Date(baseDate);
  }
  const end = new Date(start.getTime() + 60 * 60 * 1000);

  const summary = `OS ${os.numero || ''} — ${os.tipo || 'Serviço'} — ${os.clienteNome || ''}`.trim();
  const description = [
    os.descricao ? os.descricao : null,
    os.tecnicoNome ? `Técnico: ${os.tecnicoNome}` : null,
    `Status: ${os.status || 'aguardando'}`,
    os.valor ? `Valor: R$ ${Number(os.valor).toFixed(2)}` : null,
  ].filter(Boolean).join('\n');

  return [
    'BEGIN:VEVENT',
    `UID:frost-os-${os.id}@frosterp`,
    `DTSTAMP:${toICSDate(new Date())}`,
    `DTSTART:${toICSDate(start)}`,
    `DTEND:${toICSDate(end)}`,
    `SUMMARY:${escapeICS(summary)}`,
    description ? `DESCRIPTION:${escapeICS(description)}` : null,
    os.endereco ? `LOCATION:${escapeICS(os.endereco)}` : null,
    `STATUS:${os.status === 'cancelado' ? 'CANCELLED' : (os.status === 'finalizado' || os.status === 'concluido' ? 'CONFIRMED' : 'TENTATIVE')}`,
    'CATEGORIES:OS,FrostERP',
    'END:VEVENT',
  ].filter(Boolean).join('\r\n');
}

export default async function handler(req, res) {
  // CORS básico — apps de calendário fazem requisição simples
  res.setHeader('Access-Control-Allow-Origin', '*');

  const token = req.query?.token;
  if (!token || typeof token !== 'string' || token.length < 16) {
    res.status(401).send('Token ausente ou inválido.');
    return;
  }

  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseKey) {
    res.status(500).send('Servidor sem credenciais do Supabase configuradas.');
    return;
  }

  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Valida o token comparando com o salvo em erp:calendarFeedToken
    const { data: tokenRow, error: tokenErr } = await supabase
      .from('kv_store')
      .select('value')
      .eq('key', 'erp:calendarFeedToken')
      .maybeSingle();

    if (tokenErr) {
      res.status(500).send('Erro ao validar token.');
      return;
    }
    if (!tokenRow || !tokenRow.value || tokenRow.value.token !== token || tokenRow.value.enabled === false) {
      res.status(403).send('Token revogado ou inválido.');
      return;
    }

    // Busca agendamentos e OS
    const { data: rows, error } = await supabase
      .from('kv_store')
      .select('key, value')
      .or('key.like.erp:schedule:%,key.like.erp:os:%');

    if (error) {
      res.status(500).send('Erro ao buscar eventos.');
      return;
    }

    const events = [];
    (rows || []).forEach((row) => {
      const v = row.value;
      if (!v) return;
      const vevent = row.key.startsWith('erp:os:') ? osToVEvent(v) : scheduleToVEvent(v);
      if (vevent) events.push(vevent);
    });

    const calendarName = (tokenRow.value.name || 'FrostERP — Agenda');

    const ics = [
      'BEGIN:VCALENDAR',
      'VERSION:2.0',
      'PRODID:-//FrostERP//Calendar Feed//PT-BR',
      'CALSCALE:GREGORIAN',
      'METHOD:PUBLISH',
      `X-WR-CALNAME:${escapeICS(calendarName)}`,
      `X-WR-TIMEZONE:America/Sao_Paulo`,
      ...events,
      'END:VCALENDAR',
    ].join('\r\n');

    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="frosterp.ics"');
    // Cache curto para evitar sobrecarregar o Supabase com requests frequentes de clientes de calendário
    res.setHeader('Cache-Control', 'public, max-age=300, s-maxage=300');
    res.status(200).send(ics);
  } catch (err) {
    res.status(500).send(`Erro inesperado: ${err.message || err}`);
  }
}
