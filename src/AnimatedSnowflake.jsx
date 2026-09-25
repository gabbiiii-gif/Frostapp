// Floco da marca FrostERP em SVG.
//
// Performance (2026-09-24): antes cada galho animava `stroke-dashoffset` (24
// linhas), o grupo girava num loop infinito e o anel central pulsava animando
// o atributo `r`. Nada disso é composto pela GPU: o navegador repintava o SVG
// a cada quadro para sempre, e o PageSpeed media ~30 s de trabalho na thread
// principal na tela de login. Agora o desenho é estático e só o contêiner HTML
// faz UMA entrada curta com opacity + transform (propriedades compostas), que
// some com `prefers-reduced-motion`.
import React from "react";

const STYLES = `
.fs-floco-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
  animation: fs-entrada 0.7s cubic-bezier(0.22, 1, 0.36, 1) both;
}
@keyframes fs-entrada {
  from { opacity: 0; transform: scale(0.85) rotate(-30deg); }
  to   { opacity: 1; transform: none; }
}
@media (prefers-reduced-motion: reduce) {
  .fs-floco-wrap { animation: none; }
}
`;

// Desenho do floco (400x400), sem nenhuma animação. Reusado pelo splash
// (BrandSplash) — o placeholder do index.html tem uma cópia desse mesmo SVG.
export function FlocoSVG({ className = "", title = "FrostERP" }) {
  return (
    <svg
      className={className}
      width="100%"
      height="100%"
      viewBox="0 0 400 400"
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      {/* 6 braços principais, cada um com 2 pares de galhos */}
      <g stroke="#1B8FE8" strokeLinecap="round" fill="none">
        {/* Braço 0° */}
        <line x1="200" y1="200" x2="200" y2="40" strokeWidth="4" />
        <line x1="200" y1="110" x2="172" y2="82" strokeWidth="2.5" />
        <line x1="200" y1="110" x2="228" y2="82" strokeWidth="2.5" />
        <line x1="200" y1="76" x2="182" y2="58" strokeWidth="1.8" />
        <line x1="200" y1="76" x2="218" y2="58" strokeWidth="1.8" />

        {/* Braço 60° */}
        <line x1="200" y1="200" x2="339" y2="120" strokeWidth="4" />
        <line x1="270" y1="160" x2="270" y2="128" strokeWidth="2.5" />
        <line x1="270" y1="160" x2="298" y2="176" strokeWidth="2.5" />
        <line x1="296" y1="146" x2="296" y2="120" strokeWidth="1.8" />
        <line x1="296" y1="146" x2="318" y2="158" strokeWidth="1.8" />

        {/* Braço 120° */}
        <line x1="200" y1="200" x2="339" y2="280" strokeWidth="4" />
        <line x1="270" y1="240" x2="298" y2="224" strokeWidth="2.5" />
        <line x1="270" y1="240" x2="270" y2="272" strokeWidth="2.5" />
        <line x1="296" y1="254" x2="318" y2="242" strokeWidth="1.8" />
        <line x1="296" y1="254" x2="296" y2="280" strokeWidth="1.8" />

        {/* Braço 180° */}
        <line x1="200" y1="200" x2="200" y2="360" strokeWidth="4" />
        <line x1="200" y1="290" x2="228" y2="318" strokeWidth="2.5" />
        <line x1="200" y1="290" x2="172" y2="318" strokeWidth="2.5" />
        <line x1="200" y1="324" x2="218" y2="342" strokeWidth="1.8" />
        <line x1="200" y1="324" x2="182" y2="342" strokeWidth="1.8" />

        {/* Braço 240° */}
        <line x1="200" y1="200" x2="61" y2="280" strokeWidth="4" />
        <line x1="130" y1="240" x2="130" y2="272" strokeWidth="2.5" />
        <line x1="130" y1="240" x2="102" y2="224" strokeWidth="2.5" />
        <line x1="104" y1="254" x2="104" y2="280" strokeWidth="1.8" />
        <line x1="104" y1="254" x2="82" y2="242" strokeWidth="1.8" />

        {/* Braço 300° */}
        <line x1="200" y1="200" x2="61" y2="120" strokeWidth="4" />
        <line x1="130" y1="160" x2="102" y2="176" strokeWidth="2.5" />
        <line x1="130" y1="160" x2="130" y2="128" strokeWidth="2.5" />
        <line x1="104" y1="146" x2="82" y2="158" strokeWidth="1.8" />
        <line x1="104" y1="146" x2="104" y2="120" strokeWidth="1.8" />
      </g>

      {/* Pontas */}
      <g fill="#6CB4F0">
        <circle cx="200" cy="38" r="5" />
        <circle cx="341" cy="118" r="5" />
        <circle cx="341" cy="282" r="5" />
        <circle cx="200" cy="362" r="5" />
        <circle cx="59" cy="282" r="5" />
        <circle cx="59" cy="118" r="5" />
      </g>

      {/* Losangos */}
      <g fill="#2272CC">
        <polygon points="200,80 194,90 200,100 206,90" />
        <polygon points="272,122 266,132 272,142 278,132" />
        <polygon points="272,258 266,268 272,278 278,268" />
        <polygon points="200,300 194,310 200,320 206,310" />
        <polygon points="128,258 122,268 128,278 134,268" />
        <polygon points="128,122 122,132 128,142 134,132" />
      </g>

      {/* Hexágono central + núcleo. O anel é o estado médio do antigo pulso. */}
      <polygon points="200,170 222,182 222,210 200,222 178,210 178,182" fill="#0A2A6E" stroke="#6CB4F0" strokeWidth="1.5" />
      <circle cx="200" cy="196" r="18" fill="#1B8FE8" />
      <circle cx="200" cy="196" r="9" fill="#E0F4FF" />
      <circle cx="200" cy="196" r="10" fill="none" stroke="#6CB4F0" strokeWidth="1" opacity="0.75" />
    </svg>
  );
}

// Floco da tela de login: desenho estático + uma entrada curta no contêiner.
// Aceita className/style para controlar o tamanho externamente (ex.: w-40).
export default function AnimatedSnowflake({ className = "", style }) {
  return (
    <div className={`fs-floco-wrap ${className}`} style={style}>
      <style>{STYLES}</style>
      <FlocoSVG title="FrostERP" />
    </div>
  );
}
