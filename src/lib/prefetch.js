// ─── Pré-carga do que o app usa logo depois do login ────────────────────────
// Os gráficos do Dashboard (Recharts) e o BlurText (motion) saíram do bundle
// inicial e viraram chunks carregados com React.lazy no App.jsx. Para o
// Dashboard não abrir "vazio" esperando a rede, a tela de login chama
// prefetchPosLogin(): enquanto a pessoa digita a senha, o navegador baixa e
// avalia esses chunks num momento ocioso. Quando o React.lazy pedir o mesmo
// módulo, o import() só reaproveita o que já está em memória.
//
// Os especificadores abaixo apontam para os MESMOS arquivos dos React.lazy do
// App.jsx ("./DashboardCharts.jsx" e "./BlurText.jsx" vistos de src/) — o
// Vite resolve para o mesmo chunk. Se um novo lazy pós-login entrar no App,
// vale acrescentá-lo aqui.

let jaAgendado = false;

// Espera o navegador ficar ocioso (sem competir com a pintura do login).
// Safari/iOS não tem requestIdleCallback: cai no setTimeout.
function quandoOcioso(fn) {
  if (typeof window.requestIdleCallback === "function") {
    window.requestIdleCallback(fn, { timeout: 3000 });
  } else {
    setTimeout(fn, 1200);
  }
}

// Idempotente: só a primeira chamada agenda algo. Respeita o "economia de
// dados" (navigator.connection.saveData) — nesse caso não baixa nada antes da
// hora e os chunks vêm quando o Dashboard pedir. Erro de rede é engolido: a
// pré-carga é só otimização, e o React.lazy tenta de novo ao renderizar.
export function prefetchPosLogin() {
  if (jaAgendado) return;
  jaAgendado = true;
  if (typeof window === "undefined") return;
  try {
    if (navigator.connection?.saveData) return;
  } catch {
    // navigator.connection ausente/bloqueado: segue com a pré-carga.
  }
  quandoOcioso(() => {
    import("../DashboardCharts.jsx").catch(() => {});
    import("../BlurText.jsx").catch(() => {});
  });
}
