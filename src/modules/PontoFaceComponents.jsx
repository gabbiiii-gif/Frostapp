// ─── Componentes faciais do módulo Ponto ─────────────────────────────────────
// Dois modais:
//   FaceEnrollmentModal — captura N amostras (default 3), calcula descriptor
//     médio e devolve para o caller via onSaved(descriptor).
//   FaceVerifyModal    — captura 1 amostra, compara com descriptor armazenado
//     e devolve via onMatch(distance, score).
//
// Stream da webcam via navigator.mediaDevices.getUserMedia. Para câmera
// frontal usamos facingMode='user'. Em desktop sem câmera frontal cai na
// padrão. Fecha o stream ao desmontar (importante para não deixar luz da
// webcam acesa).
//
// LGPD: face descriptor é dado biométrico — o usuário precisa consentir
// explicitamente antes do enrollment. O modal exibe um aviso curto no topo.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  loadFaceModels,
  detectAndDescribe,
  averageDescriptors,
  euclideanDistance,
  similarityScore,
  isMatch,
  DEFAULT_MATCH_THRESHOLD,
} from "../lib/face.js";

// ─── Hook compartilhado: stream da câmera ────────────────────────────────────
function useCameraStream(active) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [erro, setErro] = useState("");
  const [pronto, setPronto] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    async function start() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "user", width: { ideal: 480 }, height: { ideal: 480 } },
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        setPronto(true);
      } catch (err) {
        setErro(
          err?.name === "NotAllowedError"
            ? "Permissão de câmera negada. Habilite nas configurações do navegador."
            : "Não foi possível acessar a câmera."
        );
      }
    }

    start();
    return () => {
      cancelled = true;
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
      setPronto(false);
    };
  }, [active]);

  return { videoRef, pronto, erro };
}

// Pré-carrega os modelos quando o modal abre (uma vez por sessão).
function useFaceModels(active) {
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setCarregando(true);
    loadFaceModels()
      .then(() => { if (!cancelled) { setCarregando(false); setErro(""); } })
      .catch((e) => {
        if (cancelled) return;
        setCarregando(false);
        setErro("Falha ao carregar modelos faciais. Verifique conexão.");
        console.error("loadFaceModels falhou:", e);
      });
    return () => { cancelled = true; };
  }, [active]);

  return { carregando, erro };
}

// ────────────────────────────────────────────────────────────────────────────
// FaceEnrollmentModal — captura 3 amostras → descriptor médio
// ────────────────────────────────────────────────────────────────────────────
export function FaceEnrollmentModal({ onClose, onSaved, samplesNeeded = 3 }) {
  const { videoRef, pronto, erro: erroCam } = useCameraStream(true);
  const { carregando: carregModel, erro: erroModel } = useFaceModels(true);

  const [samples, setSamples] = useState([]); // array de descriptors
  const [capturing, setCapturing] = useState(false);
  const [statusMsg, setStatusMsg] = useState("Posicione o rosto na câmera.");
  const [erroCap, setErroCap] = useState("");

  const handleCapture = useCallback(async () => {
    if (capturing || !videoRef.current) return;
    setErroCap("");
    setCapturing(true);
    setStatusMsg("Detectando rosto…");
    try {
      const descriptor = await detectAndDescribe(videoRef.current, { inputSize: 320 });
      if (!descriptor) {
        setErroCap("Nenhum rosto encontrado. Aproxime e tente de novo.");
        return;
      }
      const novo = [...samples, descriptor];
      setSamples(novo);
      setStatusMsg(`Captura ${novo.length}/${samplesNeeded} ✓`);
      if (novo.length >= samplesNeeded) {
        const media = averageDescriptors(novo);
        if (!media) {
          setErroCap("Falha ao calcular descritor médio.");
          return;
        }
        onSaved?.(media);
      }
    } catch (err) {
      setErroCap(err?.message || "Erro na detecção facial.");
    } finally {
      setCapturing(false);
    }
  }, [capturing, samples, samplesNeeded, onSaved, videoRef]);

  const bloqueado = !pronto || carregModel || capturing;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Cadastrar reconhecimento facial</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <div className="p-5 space-y-3">
          <div className="rounded-lg border border-yellow-500/30 bg-yellow-500/10 text-yellow-100 text-xs px-3 py-2">
            <strong>Aviso LGPD:</strong> serão geradas características biométricas do seu rosto
            para autenticar o ponto. Os dados ficam apenas no FrostERP e podem ser removidos
            a qualquer momento.
          </div>

          {/* Preview da câmera */}
          <div className="aspect-square rounded-xl overflow-hidden bg-black relative">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            {(carregModel || !pronto) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
                {carregModel ? "Carregando modelos…" : "Preparando câmera…"}
              </div>
            )}
          </div>

          {/* Status + progresso */}
          <div className="space-y-1">
            <p className="text-sm text-gray-200">{statusMsg}</p>
            <div className="h-1.5 bg-gray-800 rounded overflow-hidden">
              <div
                className="h-full bg-blue-500 transition-all"
                style={{ width: `${Math.min(100, (samples.length / samplesNeeded) * 100)}%` }}
              />
            </div>
          </div>

          {(erroCam || erroModel || erroCap) && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erroCam || erroModel || erroCap}
            </div>
          )}

          <button
            type="button"
            onClick={handleCapture}
            disabled={bloqueado}
            className="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
          >
            {capturing ? "Capturando…" : `Capturar ${samples.length + 1}/${samplesNeeded}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// FaceVerifyModal — captura única, compara, devolve match
// ────────────────────────────────────────────────────────────────────────────
export function FaceVerifyModal({ storedDescriptor, onClose, onMatch, onFail, threshold = DEFAULT_MATCH_THRESHOLD }) {
  const { videoRef, pronto, erro: erroCam } = useCameraStream(true);
  const { carregando: carregModel, erro: erroModel } = useFaceModels(true);

  const [verificando, setVerificando] = useState(false);
  const [erroVer, setErroVer] = useState("");
  const [tentativas, setTentativas] = useState(0);

  const handleVerify = useCallback(async () => {
    if (verificando || !videoRef.current) return;
    setErroVer("");
    setVerificando(true);
    try {
      const descriptor = await detectAndDescribe(videoRef.current, { inputSize: 320 });
      if (!descriptor) {
        const novaTent = tentativas + 1;
        setTentativas(novaTent);
        setErroVer("Nenhum rosto encontrado. Tente novamente.");
        if (novaTent >= 2) onFail?.("no_face");
        return;
      }
      const distance = euclideanDistance(storedDescriptor, descriptor);
      const score = similarityScore(distance);
      const ok = isMatch(distance, threshold);
      if (ok) {
        onMatch?.({ distance, score });
      } else {
        const novaTent = tentativas + 1;
        setTentativas(novaTent);
        setErroVer(`Não reconhecido (similaridade ${score}%). Tente novamente.`);
        if (novaTent >= 2) onFail?.("no_match");
      }
    } catch (err) {
      setErroVer(err?.message || "Erro na verificação.");
    } finally {
      setVerificando(false);
    }
  }, [verificando, storedDescriptor, tentativas, threshold, onMatch, onFail, videoRef]);

  const bloqueado = !pronto || carregModel || verificando;

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md bg-gray-900 border border-gray-700 rounded-2xl shadow-2xl">
        <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
          <h3 className="text-base font-bold text-white">Reconhecimento facial</h3>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-white" aria-label="Fechar">✕</button>
        </div>

        <div className="p-5 space-y-3">
          <div className="aspect-square rounded-xl overflow-hidden bg-black relative">
            <video
              ref={videoRef}
              playsInline
              muted
              className="w-full h-full object-cover"
              style={{ transform: "scaleX(-1)" }}
            />
            {(carregModel || !pronto) && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/60 text-white text-sm">
                {carregModel ? "Carregando modelos…" : "Preparando câmera…"}
              </div>
            )}
          </div>

          {(erroCam || erroModel || erroVer) && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
              {erroCam || erroModel || erroVer}
            </div>
          )}

          <p className="text-xs text-gray-400 text-center">
            Tentativa {Math.min(tentativas + 1, 2)}/2. Após 2 falhas, será sugerido o PIN como fallback.
          </p>

          <button
            type="button"
            onClick={handleVerify}
            disabled={bloqueado}
            className="w-full px-4 py-3 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-semibold disabled:opacity-50"
          >
            {verificando ? "Verificando…" : "Confirmar com face"}
          </button>
        </div>
      </div>
    </div>
  );
}
