// Lógica PURA do debounce de mensagens do agente WhatsApp.
// Extraída do index.ts para poder ser testada com Vitest (o index.ts usa
// imports por URL do Deno e não roda no Node). NÃO importe nada do Deno aqui.

// Teto da janela de espera. O debounce roda dentro do background task
// (EdgeRuntime.waitUntil) e consome wall-clock do worker — acima disso o risco
// de a execução ser cortada antes de responder o cliente não compensa.
export const DEBOUNCE_MAX_SEGUNDOS = 120;

// Converte a env DEBOUNCE_SECONDS em milissegundos.
// Ausente/inválida → padrão. Zero → debounce desligado (comportamento antigo:
// responde cada mensagem na hora). Negativa é tratada como inválida.
export function janelaDebounceMs(raw: string | undefined | null, padraoSegundos = 12): number {
  const n = Number(raw);
  if (raw == null || raw === "" || !Number.isFinite(n) || n < 0) return padraoSegundos * 1000;
  return Math.min(n, DEBOUNCE_MAX_SEGUNDOS) * 1000;
}

// Decide se ESTA execução ainda é a "dona" da resposta depois da janela de
// debounce. Cada mensagem do cliente dispara uma execução própria da edge
// function; passada a espera, só a execução da ÚLTIMA mensagem responde — as
// anteriores morrem aqui. Evita 3 chamadas ao Claude (e 3 respostas fora de
// ordem) quando o cliente escreve em rajada: "oi" / "meu ar não gela" /
// "consegue vir hoje?".
//
// minhaMsgId  — id (ai_messages.id) da mensagem que disparou esta execução.
// ultimaMsgId — id da última mensagem role=customer da conversa, relido DEPOIS
//               da espera.
//
// Nos casos degenerados (id ausente porque o insert falhou, ou nenhuma
// mensagem encontrada na releitura) responde em vez de calar: engolir o
// atendimento é pior que responder duas vezes.
export function souAUltimaMensagem(
  minhaMsgId: string | null | undefined,
  ultimaMsgId: string | null | undefined,
): boolean {
  if (!minhaMsgId) return true;
  if (!ultimaMsgId) return true;
  return minhaMsgId === ultimaMsgId;
}
