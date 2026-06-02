// ─── Lib: reconhecimento facial para o ponto eletrônico ──────────────────────
// Wrapper sobre @vladmandic/face-api (fork moderno, compatível com TF 4.x).
// Estratégia:
//   - Modelos carregados sob demanda da CDN do vladmandic (não vão no bundle).
//     Tamanho total dos modelos: ~6 MB. Service Worker do FrostERP precachea
//     em uma futura otimização — nesta fase, o carregamento ocorre só quando
//     o usuário abre a UI facial pela primeira vez.
//   - Detector usado: TinyFaceDetector (rápido, ~190 KB). Suficiente para
//     enrollment em ambientes de luz razoável.
//   - Recognition: FaceRecognitionNet (~6 MB) gera o descritor de 128 dim.
//
// Funções puras (testáveis):
//   - euclideanDistance(a, b)
//   - averageDescriptors(arr)
//   - serializeDescriptor(arr) / deserializeDescriptor(any)
//   - similarityScore(distance)  // distance → 0..1 humano
//
// Threshold padrão: 0.5 (vladmandic default). Maior = mais permissivo.

const CDN_BASE = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.15/model";

// Singletons — uma vez carregados, ficam em memória até o reload do app.
let _faceapi = null;
let _modelsLoaded = false;
let _loadingPromise = null;

// Carrega o módulo face-api somente quando necessário. Code-splitting via
// import dinâmico — o chunk fica fora do bundle inicial.
async function loadFaceApiModule() {
  if (_faceapi) return _faceapi;
  const mod = await import("@vladmandic/face-api");
  _faceapi = mod;
  return mod;
}

// Carrega os 3 modelos necessários (detector + landmark + recognition).
// Idempotente: chamadas paralelas compartilham o mesmo Promise.
export async function loadFaceModels() {
  if (_modelsLoaded) return true;
  if (_loadingPromise) return _loadingPromise;
  _loadingPromise = (async () => {
    const faceapi = await loadFaceApiModule();
    await Promise.all([
      faceapi.nets.tinyFaceDetector.loadFromUri(CDN_BASE),
      faceapi.nets.faceLandmark68Net.loadFromUri(CDN_BASE),
      faceapi.nets.faceRecognitionNet.loadFromUri(CDN_BASE),
    ]);
    _modelsLoaded = true;
    return true;
  })();
  try {
    return await _loadingPromise;
  } finally {
    // Não limpa _loadingPromise — mantém para idempotência.
  }
}

// Detecta UM rosto em um elemento de mídia (video, canvas ou image) e devolve
// o descriptor 128-dim. Retorna null se nenhum rosto encontrado.
//
// Opções:
//   - inputSize: 224 ou 320 (padrão 320 — mais preciso, ainda rápido em mobile)
//   - scoreThreshold: 0.5 (padrão face-api)
export async function detectAndDescribe(mediaEl, opts = {}) {
  await loadFaceModels();
  const faceapi = _faceapi;
  const inputSize = opts.inputSize || 320;
  const scoreThreshold = opts.scoreThreshold ?? 0.5;
  const detectorOpts = new faceapi.TinyFaceDetectorOptions({ inputSize, scoreThreshold });

  const result = await faceapi
    .detectSingleFace(mediaEl, detectorOpts)
    .withFaceLandmarks()
    .withFaceDescriptor();

  if (!result) return null;
  // result.descriptor é Float32Array(128). Converte para Array padrão para
  // poder serializar em JSON (kv_store).
  return Array.from(result.descriptor);
}

// ─── Helpers puros (testáveis sem face-api) ──────────────────────────────────

// Distância Euclidiana entre dois descritores. Retorna -1 em caso de input
// inválido (para diferenciar de 0, que é match perfeito).
export function euclideanDistance(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b)) return -1;
  if (a.length !== b.length) return -1;
  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    const d = a[i] - b[i];
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// Média de N descritores. Cada um é Array de 128 floats. Usado para criar
// um "centroide" do rosto da pessoa a partir de várias capturas — mais
// robusto a variações momentâneas de luz/expressão.
export function averageDescriptors(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return null;
  const first = arr[0];
  if (!Array.isArray(first)) return null;
  const out = new Array(first.length).fill(0);
  let count = 0;
  for (const d of arr) {
    if (!Array.isArray(d) || d.length !== first.length) continue;
    for (let i = 0; i < d.length; i++) out[i] += d[i];
    count++;
  }
  if (count === 0) return null;
  for (let i = 0; i < out.length; i++) out[i] /= count;
  return out;
}

// Serializa descritor para JSON-friendly. Apenas garante Array de números
// (não Float32Array). Existe por simetria com deserializeDescriptor.
export function serializeDescriptor(desc) {
  if (!desc) return null;
  if (desc instanceof Float32Array) return Array.from(desc);
  if (Array.isArray(desc)) return desc.slice();
  return null;
}

// Deserializa um descriptor lido do kv_store. Tolera Float32Array, Array, ou
// objeto-numérico (legado: { 0: 0.1, 1: 0.2, ... }) — devolve sempre Array.
export function deserializeDescriptor(raw) {
  if (!raw) return null;
  if (Array.isArray(raw)) return raw;
  if (raw instanceof Float32Array) return Array.from(raw);
  if (typeof raw === "object") {
    const keys = Object.keys(raw).filter((k) => /^\d+$/.test(k)).sort((a, b) => +a - +b);
    if (keys.length === 0) return null;
    return keys.map((k) => raw[k]);
  }
  return null;
}

// Converte distância (~0.0 perfeito, ~1.0 totalmente diferente) em um score
// de 0 a 100. Útil para feedback ao usuário ("90% match"). Cap em 0/100.
export function similarityScore(distance) {
  if (distance < 0) return 0;
  // Mapeia 0.0 → 100 e 1.0 → 0 (linear). Acima de 1.0 fica 0.
  const s = Math.round((1 - Math.min(distance, 1)) * 100);
  return Math.max(0, Math.min(100, s));
}

// Threshold default para considerar match. Pode ser ajustado por empresa
// no futuro (config). Mais baixo = mais rígido.
export const DEFAULT_MATCH_THRESHOLD = 0.5;

export function isMatch(distance, threshold = DEFAULT_MATCH_THRESHOLD) {
  if (distance < 0) return false;
  return distance < threshold;
}
