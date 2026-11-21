// ─── Logo da empresa: tratamento da imagem enviada ─────────────────────────
// Usado pelo LogoPicker (Configurações e painel Master). A logo aparece na
// bolinha do perfil no celular, no menu do desktop e no topo de Orçamento/OS/
// Recibo — então precisa chegar sem margem sobrando e com resolução boa.
//
// Duas etapas, ambas no próprio aparelho (nada vai para servidor):
//  1. processarLogo: recorta a margem vazia (branca ou transparente), reduz para
//     no máximo 512px e grava PNG (WebP/JPEG só se o PNG passar do limite).
//  2. vetorizarLogo (opcional, o usuário escolhe): converte em SVG com o
//     imagetracerjs. Fica nítido em qualquer tamanho, mas só compensa em logo
//     de cores chapadas — foto e degradê viram manchas. Por isso a tela mostra
//     as duas versões lado a lado antes de trocar.
//
// As funções puras (limitesConteudo, dimensoesAlvo, recomendarVetor) não tocam
// no DOM e têm teste em src/lib/logo.test.js.

export const LADO_MAXIMO = 512; // px no lado maior — nítido em tela retina e na impressão
export const LIMITE_BYTES = 280 * 1024; // data URL final; vai no erp:config (sync)
const LIMITE_SVG = 250 * 1024;

// Pixel é "fundo" quando é quase transparente ou parecido com a cor dos cantos
// (a maioria das logos vem em fundo branco liso). `tol` é a distância máxima
// por canal para contar como fundo.
function corDoFundo(data, w, h) {
  const cantos = [0, w - 1, (h - 1) * w, h * w - 1].map((p) => p * 4);
  // Se algum canto é transparente, o fundo é transparência.
  if (cantos.some((i) => data[i + 3] < 16)) return null;
  const [r, g, b] = [0, 1, 2].map((c) => Math.round(cantos.reduce((s, i) => s + data[i + c], 0) / 4));
  return { r, g, b };
}

// Retângulo que contém o desenho (sem a margem de fundo). Retorna null se a
// imagem inteira é fundo (imagem vazia) — quem chama mantém a original.
export function limitesConteudo(data, w, h, tol = 24) {
  if (!data || w <= 0 || h <= 0) return null;
  const fundo = corDoFundo(data, w, h);
  const ehFundo = (i) => {
    if (data[i + 3] < 16) return true;
    if (!fundo) return false;
    return Math.abs(data[i] - fundo.r) <= tol && Math.abs(data[i + 1] - fundo.g) <= tol && Math.abs(data[i + 2] - fundo.b) <= tol;
  };
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ehFundo((y * w + x) * 4)) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  if (x1 < 0) return null;
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// Recorte final com uma folga pequena (3% do lado maior) para o desenho não
// encostar na borda, sem sair da imagem.
export function recorteComFolga(lim, w, h, folga = 0.03) {
  const f = Math.round(Math.max(lim.w, lim.h) * folga);
  const x = Math.max(0, lim.x - f);
  const y = Math.max(0, lim.y - f);
  return { x, y, w: Math.min(w, lim.x + lim.w + f) - x, h: Math.min(h, lim.y + lim.h + f) - y };
}

// Só reduz (ampliar PNG não ganha nitidez, só peso).
export function dimensoesAlvo(w, h, max = LADO_MAXIMO) {
  if (w <= max && h <= max) return { w, h };
  const r = Math.min(max / w, max / h);
  return { w: Math.max(1, Math.round(w * r)), h: Math.max(1, Math.round(h * r)) };
}

// Sugere a conversão para SVG quando o desenho (já recortado) é pequeno: abaixo
// de ~300px no lado maior a logo fica borrada na impressão e em tela retina.
export function recomendarVetor(larguraDesenho, alturaDesenho) {
  return Math.max(larguraDesenho, alturaDesenho) < 300;
}

// Tamanho aproximado em bytes de um data URL (para o limite e para a tela).
export function bytesDataUrl(dataUrl) {
  if (!dataUrl) return 0;
  const i = dataUrl.indexOf(",");
  const corpo = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return /;base64,/.test(dataUrl) ? Math.floor(corpo.length * 0.75) : decodeURIComponent(corpo).length;
}

// ─── Daqui para baixo: navegador (canvas) ───────────────────────────────────

function lerArquivo(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error("Não foi possível ler o arquivo."));
    r.readAsDataURL(file);
  });
}

export function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Imagem inválida ou corrompida."));
    img.src = src;
  });
}

function canvasDe(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

// Arquivo → { dataUrl, largura, altura, cortouMargem, sugerirVetor, formato }
export async function processarLogo(file) {
  if (!file || !file.type?.startsWith("image/")) throw new Error("Escolha um arquivo de imagem.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Arquivo acima de 8MB. Escolha uma imagem menor.");
  const original = await lerArquivo(file);

  // SVG já é vetor: guarda como veio (no <img> o SVG não executa script).
  if (file.type === "image/svg+xml") {
    if (bytesDataUrl(original) > LIMITE_SVG) throw new Error("SVG muito pesado (acima de 250KB).");
    const img = await carregarImagem(original).catch(() => null);
    return { dataUrl: original, largura: img?.naturalWidth || 0, altura: img?.naturalHeight || 0, cortouMargem: false, sugerirVetor: false, formato: "SVG" };
  }

  const img = await carregarImagem(original);
  const w0 = img.naturalWidth, h0 = img.naturalHeight;
  const base = canvasDe(w0, h0);
  const ctx = base.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);

  // 1. Recorta a margem vazia
  let corte = { x: 0, y: 0, w: w0, h: h0 };
  const lim = limitesConteudo(ctx.getImageData(0, 0, w0, h0).data, w0, h0);
  if (lim) corte = recorteComFolga(lim, w0, h0);
  const cortouMargem = corte.w < w0 * 0.97 || corte.h < h0 * 0.97;

  // 2. Reduz para o lado máximo
  const alvo = dimensoesAlvo(corte.w, corte.h);
  const saida = canvasDe(alvo.w, alvo.h);
  const sctx = saida.getContext("2d");
  sctx.imageSmoothingQuality = "high";
  sctx.drawImage(base, corte.x, corte.y, corte.w, corte.h, 0, 0, alvo.w, alvo.h);

  // 3. PNG (mantém transparência e borda nítida); se pesado, WebP e por fim JPEG
  let dataUrl = saida.toDataURL("image/png");
  let formato = "PNG";
  if (bytesDataUrl(dataUrl) > LIMITE_BYTES) {
    const webp = saida.toDataURL("image/webp", 0.92);
    if (webp.startsWith("data:image/webp") && bytesDataUrl(webp) <= LIMITE_BYTES) { dataUrl = webp; formato = "WebP"; }
    else { dataUrl = saida.toDataURL("image/jpeg", 0.88); formato = "JPEG"; }
  }
  if (bytesDataUrl(dataUrl) > LIMITE_BYTES) throw new Error("Imagem muito pesada mesmo após otimizar. Tente um arquivo mais simples.");

  return { dataUrl, largura: alvo.w, altura: alvo.h, cortouMargem, sugerirVetor: recomendarVetor(corte.w, corte.h), formato };
}

// Opções do imagetracerjs para logo: poucas cores, curvas suaves, descarta
// manchinhas (pathomit) e grava viewBox para o SVG escalar em qualquer tamanho.
const OPCOES_VETOR = {
  numberofcolors: 8, colorsampling: 2, colorquantcycles: 4,
  ltres: 1, qtres: 1, pathomit: 24, rightangleenhance: false,
  blurradius: 0, strokewidth: 0, linefilter: true,
  roundcoords: 1, viewbox: true, desc: false,
};
// Lado maior usado no traçado. Imagem pequena é AMPLIADA com suavização antes:
// traçar 116px direto dá contorno serrilhado (cada pixel vira um degrau).
const LADO_TRACADO = 900;

// data URL (PNG/JPEG/WebP) → { dataUrl SVG, bytes }. A lib (~47KB) só baixa
// quando o usuário toca em "Converter para SVG".
export async function vetorizarLogo(dataUrl) {
  const mod = await import("imagetracerjs");
  const tracer = mod.default || mod;
  const img = await carregarImagem(dataUrl);
  const r = LADO_TRACADO / Math.max(img.naturalWidth, img.naturalHeight);
  const alvo = { w: Math.max(1, Math.round(img.naturalWidth * r)), h: Math.max(1, Math.round(img.naturalHeight * r)) };
  const c = canvasDe(alvo.w, alvo.h);
  const ctx = c.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, 0, 0, alvo.w, alvo.h);
  const svg = tracer.imagedataToSVG(ctx.getImageData(0, 0, alvo.w, alvo.h), OPCOES_VETOR);
  const svgDataUrl = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  const bytes = bytesDataUrl(svgDataUrl);
  if (bytes > LIMITE_SVG) throw new Error("A logo tem detalhe demais para virar SVG leve. Mantenha a versão PNG.");
  return { dataUrl: svgDataUrl, bytes };
}
