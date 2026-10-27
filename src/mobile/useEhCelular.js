// ─── Detecta celular (largura < 768px) ───────────────────────────────────────
// Decide se o App mostra a casca mobile (src/mobile/MobileApp.jsx) ou o layout
// do desktop. Fica fora do chunk do MobileApp de propósito: é minúsculo e o App
// precisa dele antes de saber se vai baixar o chunk. Acompanha rotação e
// redimensionamento (tablet de pé < 768 → mobile; deitado → desktop).

import { useEffect, useState } from "react";

export const CONSULTA_CELULAR = "(max-width: 767px)";

function agora() {
  try {
    return typeof window !== "undefined" && !!window.matchMedia?.(CONSULTA_CELULAR).matches;
  } catch {
    return false;
  }
}

export function useEhCelular() {
  const [celular, setCelular] = useState(agora);
  useEffect(() => {
    const mq = window.matchMedia?.(CONSULTA_CELULAR);
    if (!mq) return undefined;
    const onChange = () => setCelular(mq.matches);
    onChange();
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);
  return celular;
}
