// ─── Abertura de marca: só na primeira abertura do dia ──────────────────────
// Decisão de 2026-10-27: o logo do FrostERP fica ~1,2 s na tela na PRIMEIRA
// vez que o app abre em cada dia, naquele aparelho. Nas outras aberturas do
// dia o app vai direto para a tela pronta (0,3 s com o app instalado). Antes
// de 24/09 havia abertura fixa de 3,6 s em TODA entrada — saiu por ser espera
// pura (docs/wiki/decisions/010-performance-abertura.md). Quem mostra e tira o
// logo é o src/main.jsx; aqui fica só a regra, coberta por abertura.test.js.

export const CHAVE_ABERTURA = 'frost:abertura-dia';
export const DURACAO_ABERTURA_MS = 1200;

// "AAAA-MM-DD" no fuso do aparelho: o "dia" é o do usuário, não o UTC.
export function diaLocal(data = new Date()) {
  const mes = String(data.getMonth() + 1).padStart(2, '0');
  const dia = String(data.getDate()).padStart(2, '0');
  return `${data.getFullYear()}-${mes}-${dia}`;
}

// true só na primeira chamada de cada dia — e já registra o dia. Sem storage
// gravável (aba anônima, cota cheia) devolve false: sem como lembrar que já
// mostrou, a abertura apareceria em toda entrada, o contrário do combinado.
export function primeiraAberturaDoDia(storage, hoje = diaLocal()) {
  try {
    if (storage.getItem(CHAVE_ABERTURA) === hoje) return false;
    storage.setItem(CHAVE_ABERTURA, hoje);
    return storage.getItem(CHAVE_ABERTURA) === hoje;
  } catch {
    return false;
  }
}

// Quanto falta para o logo completar a duração mínima, contando de quando ele
// foi pintado. Se o app demorou mais que isso para carregar, não espera nada.
export function tempoRestanteAbertura(pintouEmMs, agoraMs, duracaoMs = DURACAO_ABERTURA_MS) {
  return Math.max(0, duracaoMs - Math.max(0, agoraMs - pintouEmMs));
}
