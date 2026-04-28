// Floco animado em SVG — versão React do frosterp_animated_snowflake.html
// Convertido para JSX para poder ser embutido na tela de login (e onde mais
// for útil) sem usar iframe. As animações CSS rodam direto via <style/>.
import React from "react";

// CSS exclusivo do floco. Selectores são bem específicos (#floco, .branch-in,
// .tip-dot, .diamond, .center-ring) para não colidir com o resto do app.
const STYLES = `
.fs-floco-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
}
#floco {
  transform-origin: 200px 200px;
  animation: fs-spin 12s linear infinite;
}
.branch-in {
  stroke-dasharray: 60;
  stroke-dashoffset: 60;
  animation: fs-draw 1.2s ease forwards;
}
.tip-dot {
  transform-origin: center;
  animation: fs-pop 0.4s ease forwards;
  opacity: 0;
}
.diamond {
  animation: fs-pop 0.5s ease forwards;
  opacity: 0;
}
.center-ring {
  transform-origin: 200px 200px;
  animation: fs-pulse 3s ease-in-out infinite;
}
@keyframes fs-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
@keyframes fs-draw {
  to { stroke-dashoffset: 0; }
}
@keyframes fs-pop {
  0%   { opacity: 0; transform: scale(0); }
  70%  { opacity: 1; transform: scale(1.3); }
  100% { opacity: 1; transform: scale(1); }
}
@keyframes fs-pulse {
  0%, 100% { opacity: 1; r: 8; }
  50%      { opacity: 0.5; r: 11; }
}
`;

// Componente do floco animado. Aceita className/style para controlar o
// tamanho externamente (ex.: w-40 no login). O SVG ocupa 100% do container,
// preservando a proporção quadrada.
export default function AnimatedSnowflake({ className = "", style }) {
  return (
    <div className={`fs-floco-wrap ${className}`} style={style}>
      <style>{STYLES}</style>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 400 400"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="FrostERP — Floco animado"
      >
        <title>FrostERP — Floco animado</title>
        <g id="floco">
          {/* 6 braços principais do floco */}
          <g stroke="#1B8FE8" strokeLinecap="round" fill="none">
            {/* Braço 0° */}
            <line x1="200" y1="200" x2="200" y2="40" strokeWidth="4" />
            <line x1="200" y1="110" x2="172" y2="82" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.3s" }} />
            <line x1="200" y1="110" x2="228" y2="82" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.35s" }} />
            <line x1="200" y1="76" x2="182" y2="58" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.6s" }} />
            <line x1="200" y1="76" x2="218" y2="58" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.65s" }} />

            {/* Braço 60° */}
            <line x1="200" y1="200" x2="339" y2="120" strokeWidth="4" />
            <line x1="270" y1="160" x2="270" y2="128" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.4s" }} />
            <line x1="270" y1="160" x2="298" y2="176" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.45s" }} />
            <line x1="296" y1="146" x2="296" y2="120" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.7s" }} />
            <line x1="296" y1="146" x2="318" y2="158" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.75s" }} />

            {/* Braço 120° */}
            <line x1="200" y1="200" x2="339" y2="280" strokeWidth="4" />
            <line x1="270" y1="240" x2="298" y2="224" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.5s" }} />
            <line x1="270" y1="240" x2="270" y2="272" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.55s" }} />
            <line x1="296" y1="254" x2="318" y2="242" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.8s" }} />
            <line x1="296" y1="254" x2="296" y2="280" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.85s" }} />

            {/* Braço 180° */}
            <line x1="200" y1="200" x2="200" y2="360" strokeWidth="4" />
            <line x1="200" y1="290" x2="228" y2="318" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.35s" }} />
            <line x1="200" y1="290" x2="172" y2="318" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.4s" }} />
            <line x1="200" y1="324" x2="218" y2="342" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.65s" }} />
            <line x1="200" y1="324" x2="182" y2="342" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.7s" }} />

            {/* Braço 240° */}
            <line x1="200" y1="200" x2="61" y2="280" strokeWidth="4" />
            <line x1="130" y1="240" x2="130" y2="272" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.45s" }} />
            <line x1="130" y1="240" x2="102" y2="224" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.5s" }} />
            <line x1="104" y1="254" x2="104" y2="280" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.75s" }} />
            <line x1="104" y1="254" x2="82" y2="242" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.8s" }} />

            {/* Braço 300° */}
            <line x1="200" y1="200" x2="61" y2="120" strokeWidth="4" />
            <line x1="130" y1="160" x2="102" y2="176" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.5s" }} />
            <line x1="130" y1="160" x2="130" y2="128" strokeWidth="2.5" className="branch-in" style={{ animationDelay: "0.55s" }} />
            <line x1="104" y1="146" x2="82" y2="158" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.85s" }} />
            <line x1="104" y1="146" x2="104" y2="120" strokeWidth="1.8" className="branch-in" style={{ animationDelay: "0.9s" }} />
          </g>

          {/* Pontas (bolinhas que aparecem ao final do desenho dos braços) */}
          <circle cx="200" cy="38" r="5" fill="#6CB4F0" className="tip-dot" style={{ animationDelay: "0.9s", transformOrigin: "200px 38px" }} />
          <circle cx="341" cy="118" r="5" fill="#6CB4F0" className="tip-dot" style={{ animationDelay: "1.0s", transformOrigin: "341px 118px" }} />
          <circle cx="341" cy="282" r="5" fill="#6CB4F0" className="tip-dot" style={{ animationDelay: "1.1s", transformOrigin: "341px 282px" }} />
          <circle cx="200" cy="362" r="5" fill="#6CB4F0" className="tip-dot" style={{ animationDelay: "1.0s", transformOrigin: "200px 362px" }} />
          <circle cx="59" cy="282" r="5" fill="#6CB4F0" className="tip-dot" style={{ animationDelay: "1.1s", transformOrigin: "59px 282px" }} />
          <circle cx="59" cy="118" r="5" fill="#6CB4F0" className="tip-dot" style={{ animationDelay: "0.9s", transformOrigin: "59px 118px" }} />

          {/* Losangos nível 1 */}
          <polygon points="200,80 194,90 200,100 206,90" fill="#2272CC" className="diamond" style={{ animationDelay: "1.1s", transformOrigin: "200px 90px" }} />
          <polygon points="272,122 266,132 272,142 278,132" fill="#2272CC" className="diamond" style={{ animationDelay: "1.15s", transformOrigin: "272px 132px" }} />
          <polygon points="272,258 266,268 272,278 278,268" fill="#2272CC" className="diamond" style={{ animationDelay: "1.2s", transformOrigin: "272px 268px" }} />
          <polygon points="200,300 194,310 200,320 206,310" fill="#2272CC" className="diamond" style={{ animationDelay: "1.15s", transformOrigin: "200px 310px" }} />
          <polygon points="128,258 122,268 128,278 134,268" fill="#2272CC" className="diamond" style={{ animationDelay: "1.2s", transformOrigin: "128px 268px" }} />
          <polygon points="128,122 122,132 128,142 134,132" fill="#2272CC" className="diamond" style={{ animationDelay: "1.1s", transformOrigin: "128px 132px" }} />

          {/* Hexágono central */}
          <polygon points="200,170 222,182 222,210 200,222 178,210 178,182" fill="#0A2A6E" stroke="#6CB4F0" strokeWidth="1.5" />

          {/* Núcleo (círculo pulsante) */}
          <circle cx="200" cy="196" r="18" fill="#1B8FE8" />
          <circle cx="200" cy="196" r="9" fill="#E0F4FF" />
          <circle cx="200" cy="196" r="24" fill="none" stroke="#6CB4F0" strokeWidth="1" className="center-ring" />
        </g>
      </svg>
    </div>
  );
}
