// Troca o favicon da aba conforme o tema do sistema:
//   mode claro  -> /favicon.svg       (floco azul vetorial)
//   mode escuro -> /favicon-dark.svg  (floco branco novo)
// Externo (nao inline) por causa do CSP `script-src 'self'`.
// Os SVGs NAO usam <style>/@media internamente (isso quebra o render no Chrome
// e vira quadrado azul) — a troca e feita aqui via JS.
(function () {
  var mq = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)');
  var link = document.querySelector('link[rel="icon"][type="image/svg+xml"]');
  if (!mq || !link) return;
  function apply() {
    link.href = (mq.matches ? '/favicon-dark.svg' : '/favicon.svg') + '?v=8';
  }
  if (mq.addEventListener) mq.addEventListener('change', apply);
  else if (mq.addListener) mq.addListener(apply); // Safari antigo
  apply();
})();
