// Lógica PURA de auto-religamento do agente WhatsApp.
// Extraída do index.ts para poder ser testada com Vitest (o index.ts usa
// imports por URL do Deno e não roda no Node). NÃO importe nada do Deno aqui.

// Decide se a IA deve REASSUMIR uma conversa que foi pausada para um humano.
// Regra: só religa conversas em 'pending_human'; e só quando o time não
// respondeu (nenhuma mensagem SAINDO do número — role=agent) há pelo menos
// `thresholdMs`. Se não há registro de resposta do time (lastAgentAtMs null),
// a conversa está pausada sem ninguém tê-la assumido de fato → pode religar.
export function podeAutoReligar(
  status: string,
  lastAgentAtMs: number | null,
  nowMs: number,
  thresholdMs: number,
): boolean {
  if (status !== "pending_human") return false;
  if (lastAgentAtMs == null) return true;
  return nowMs - lastAgentAtMs >= thresholdMs;
}
