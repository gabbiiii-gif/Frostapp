// ─── Enquadrar imagem (tela cheia, no estilo do WhatsApp) ──────────────────
// Depois de escolher a foto (câmera ou galeria), o usuário arrasta, dá zoom
// com pinça (ou pela barra), gira 90° e escolhe o formato; "OK" devolve o
// recorte como File PNG (recortarImagem em src/lib/logo.js).
//
// Carregado sob demanda pelo LogoPicker (React.lazy) — o react-easy-crop só
// baixa quando alguém vai trocar a logo. Renderiza num portal no <body>: a
// tela de Configurações no celular abre dentro do "modo completo", que tem
// animação com transform e prenderia um `position: fixed` dentro dela.
import { useCallback, useState } from "react";
import { createPortal } from "react-dom";
import Cropper from "react-easy-crop";
import { recortarImagem } from "./lib/logo.js";

// Quadrado combina com a bolinha do perfil; os retangulares, com logo larga
// no topo dos documentos.
const FORMATOS = [
  { id: "1", rotulo: "Quadrado", aspecto: 1 },
  { id: "3:2", rotulo: "Retângulo", aspecto: 3 / 2 },
  { id: "2:1", rotulo: "Largo", aspecto: 2 },
];

export default function EnquadrarImagem({ src, onCancelar, onConfirmar }) {
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [giro, setGiro] = useState(0);
  const [formato, setFormato] = useState(FORMATOS[0]);
  const [area, setArea] = useState(null);
  const [salvando, setSalvando] = useState(false);

  const aoTerminar = useCallback((_, pixels) => setArea(pixels), []);

  const confirmar = async () => {
    if (!area || salvando) return;
    setSalvando(true);
    try {
      onConfirmar(await recortarImagem(src, area, giro));
    } catch (e) {
      setSalvando(false);
      alert(e.message || "Não foi possível recortar a imagem.");
    }
  };

  const botaoTexto = "px-4 py-3 text-base font-semibold text-emerald-400 active:opacity-60 disabled:opacity-40";

  return createPortal(
    <div className="fixed inset-0 z-[9999] bg-black flex flex-col select-none" role="dialog" aria-modal="true" aria-label="Enquadrar imagem"
      style={{ paddingTop: "env(safe-area-inset-top)", paddingBottom: "env(safe-area-inset-bottom)" }}>
      {/* Área de enquadramento */}
      <div className="relative flex-1 min-h-0">
        <Cropper
          image={src}
          crop={crop}
          zoom={zoom}
          rotation={giro}
          aspect={formato.aspecto}
          minZoom={0.4}
          maxZoom={5}
          zoomSpeed={0.15}
          restrictPosition={false} // deixa diminuir uma logo larga para caber inteira no quadrado
          showGrid
          objectFit="contain"
          onCropChange={setCrop}
          onZoomChange={setZoom}
          onRotationChange={setGiro}
          onCropComplete={aoTerminar}
          style={{
            containerStyle: { background: "#05080d" },
            cropAreaStyle: { border: "2px solid rgba(255,255,255,.9)", color: "rgba(0,0,0,.62)" },
          }}
        />
      </div>

      {/* Formato + zoom */}
      <div className="px-4 pt-3 space-y-3 bg-black">
        <div className="flex justify-center gap-2">
          {FORMATOS.map((f) => (
            <button key={f.id} type="button" onClick={() => setFormato(f)}
              className={`px-3.5 py-1.5 rounded-full text-sm transition ${formato.id === f.id ? "bg-white text-black font-semibold" : "bg-white/10 text-gray-200"}`}>
              {f.rotulo}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-gray-400">
          <span className="text-lg" aria-hidden>−</span>
          <input type="range" min={0.4} max={5} step={0.01} value={zoom} onChange={(e) => setZoom(Number(e.target.value))}
            className="flex-1 accent-emerald-400" aria-label="Zoom" />
          <span className="text-lg" aria-hidden>+</span>
        </div>
        <p className="text-center text-xs text-gray-500">Arraste e use dois dedos para aproximar</p>
      </div>

      {/* Barra inferior: Cancelar · girar · OK */}
      <div className="flex items-center justify-between px-2 py-2 bg-black">
        <button type="button" className={botaoTexto} onClick={onCancelar} disabled={salvando}>Cancelar</button>
        <button type="button" onClick={() => setGiro((g) => (g + 270) % 360)} aria-label="Girar 90 graus"
          className="w-12 h-12 flex items-center justify-center rounded-full text-white active:bg-white/10">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v4h4" /><rect x="9" y="9" width="6" height="6" rx="1" />
          </svg>
        </button>
        <button type="button" className={botaoTexto} onClick={confirmar} disabled={!area || salvando}>{salvando ? "..." : "OK"}</button>
      </div>
    </div>,
    document.body,
  );
}
