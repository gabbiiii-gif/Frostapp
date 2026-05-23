import { useRef, useEffect, useState } from "react";

// ─── SignaturePad ─────────────────────────────────────────────────────────────
// Componente de canvas para captura de assinatura (touch + mouse).
// Props:
//   - onChange(blob|null): chamado quando assinatura é alterada ou limpa.
//   - height: altura do canvas (default 180).
//   - disabled: bloqueia desenho.
// Uso: o pai recebe um Blob PNG ao salvar e o envia ao Storage.
export default function SignaturePad({ onChange, height = 180, disabled = false }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef(null);
  const [hasContent, setHasContent] = useState(false);

  // ─── Ajusta resolução do canvas ao tamanho real em pixels do dispositivo ───
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = rect.width * dpr;
      canvas.height = rect.height * dpr;
      ctx.scale(dpr, dpr);
      ctx.lineWidth = 2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#0f172a";
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, rect.width, rect.height);
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ─── Extrai coordenada relativa ao canvas (touch ou mouse) ───
  const getPoint = (e) => {
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const touch = e.touches?.[0] || e.changedTouches?.[0];
    const clientX = touch ? touch.clientX : e.clientX;
    const clientY = touch ? touch.clientY : e.clientY;
    return { x: clientX - rect.left, y: clientY - rect.top };
  };

  const start = (e) => {
    if (disabled) return;
    e.preventDefault();
    drawingRef.current = true;
    lastPointRef.current = getPoint(e);
  };

  const move = (e) => {
    if (!drawingRef.current || disabled) return;
    e.preventDefault();
    const ctx = canvasRef.current.getContext("2d");
    const p = getPoint(e);
    const last = lastPointRef.current;
    if (last) {
      ctx.beginPath();
      ctx.moveTo(last.x, last.y);
      ctx.lineTo(p.x, p.y);
      ctx.stroke();
    }
    lastPointRef.current = p;
    if (!hasContent) setHasContent(true);
  };

  const end = (e) => {
    if (!drawingRef.current) return;
    e.preventDefault();
    drawingRef.current = false;
    lastPointRef.current = null;
    // Notifica pai com Blob PNG da assinatura atual
    canvasRef.current.toBlob((blob) => onChange?.(blob), "image/png");
  };

  const clear = () => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    const rect = canvas.getBoundingClientRect();
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, rect.width, rect.height);
    setHasContent(false);
    onChange?.(null);
  };

  return (
    <div className="space-y-2">
      <div
        className="relative bg-white rounded-lg border border-gray-300 overflow-hidden"
        style={{ height }}
      >
        <canvas
          ref={canvasRef}
          className="w-full h-full touch-none"
          onMouseDown={start}
          onMouseMove={move}
          onMouseUp={end}
          onMouseLeave={end}
          onTouchStart={start}
          onTouchMove={move}
          onTouchEnd={end}
        />
        {!hasContent && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none text-gray-400 text-sm">
            Assine aqui
          </div>
        )}
      </div>
      <div className="flex justify-between items-center text-xs">
        <span className="text-gray-500">
          {hasContent ? "Assinatura capturada" : "Aguardando assinatura..."}
        </span>
        <button
          type="button"
          onClick={clear}
          disabled={disabled || !hasContent}
          className="text-red-600 hover:text-red-700 disabled:opacity-40 font-medium"
        >
          Limpar
        </button>
      </div>
    </div>
  );
}
