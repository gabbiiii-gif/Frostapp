// Logo FrostERP completa animada (versão React do frosterp_logo_animated.html).
// Inclui floco rotativo + wordmark "FROSTERP" + tagline "REFRIGERAÇÕES".
// Usada principalmente no splash de abertura.
import React from "react";

const STYLES = `
.fr-logo-wrap {
  display: flex;
  justify-content: center;
  align-items: center;
}
#frosterp-floco-group {
  transform-origin: 340px 170px;
  animation: fr-spin 14s linear infinite;
}
@keyframes fr-spin {
  from { transform: rotate(0deg); }
  to   { transform: rotate(360deg); }
}
.fr-arm-main {
  stroke-dasharray: 240;
  stroke-dashoffset: 240;
  animation: fr-draw 0.7s ease forwards;
}
.fr-b1 { animation-delay: 0.1s; }
.fr-b2 { animation-delay: 0.15s; }
.fr-b3 { animation-delay: 0.2s; }
.fr-b4 { animation-delay: 0.25s; }
.fr-b5 { animation-delay: 0.3s; }
.fr-b6 { animation-delay: 0.35s; }

.fr-branch {
  stroke-dasharray: 50;
  stroke-dashoffset: 50;
  animation: fr-draw 0.5s ease forwards;
}
.fr-br1 { animation-delay: 0.55s; }
.fr-br2 { animation-delay: 0.6s; }
.fr-br3 { animation-delay: 0.65s; }
.fr-br4 { animation-delay: 0.7s; }
.fr-br5 { animation-delay: 0.75s; }
.fr-br6 { animation-delay: 0.8s; }
.fr-br7 { animation-delay: 0.85s; }
.fr-br8 { animation-delay: 0.9s; }
.fr-br9 { animation-delay: 0.95s; }
.fr-br10 { animation-delay: 1.0s; }
.fr-br11 { animation-delay: 1.05s; }
.fr-br12 { animation-delay: 1.1s; }

.fr-sub-branch {
  stroke-dasharray: 30;
  stroke-dashoffset: 30;
  animation: fr-draw 0.4s ease forwards;
}
.fr-sb1 { animation-delay: 1.1s; }
.fr-sb2 { animation-delay: 1.15s; }
.fr-sb3 { animation-delay: 1.2s; }
.fr-sb4 { animation-delay: 1.25s; }
.fr-sb5 { animation-delay: 1.3s; }
.fr-sb6 { animation-delay: 1.35s; }
.fr-sb7 { animation-delay: 1.4s; }
.fr-sb8 { animation-delay: 1.45s; }
.fr-sb9 { animation-delay: 1.5s; }
.fr-sb10 { animation-delay: 1.55s; }
.fr-sb11 { animation-delay: 1.6s; }
.fr-sb12 { animation-delay: 1.65s; }
@keyframes fr-draw { to { stroke-dashoffset: 0; } }

.fr-tip { opacity: 0; animation: fr-pop 0.35s ease forwards; }
.fr-td1 { animation-delay: 1.5s; }
.fr-td2 { animation-delay: 1.55s; }
.fr-td3 { animation-delay: 1.6s; }
.fr-td4 { animation-delay: 1.65s; }
.fr-td5 { animation-delay: 1.7s; }
.fr-td6 { animation-delay: 1.75s; }

.fr-diamond { opacity: 0; animation: fr-pop 0.35s ease forwards; }
.fr-dm1 { animation-delay: 1.3s; }
.fr-dm2 { animation-delay: 1.35s; }
.fr-dm3 { animation-delay: 1.4s; }
.fr-dm4 { animation-delay: 1.45s; }
.fr-dm5 { animation-delay: 1.5s; }
.fr-dm6 { animation-delay: 1.55s; }
@keyframes fr-pop {
  0%   { opacity: 0; transform: scale(0); }
  70%  { opacity: 1; transform: scale(1.4); }
  100% { opacity: 1; transform: scale(1); }
}

.fr-center-hex {
  opacity: 0;
  animation: fr-pop 0.4s ease forwards;
  animation-delay: 1.7s;
  transform-origin: 340px 170px;
}
.fr-center-dot {
  opacity: 0;
  animation: fr-pop 0.4s ease forwards;
  animation-delay: 1.85s;
  transform-origin: 340px 170px;
}
.fr-center-pulse {
  transform-origin: 340px 170px;
  animation: fr-pulse 2.8s ease-in-out infinite;
  animation-delay: 2.2s;
  opacity: 0;
}
@keyframes fr-pulse {
  0%   { opacity: 0.3; transform: scale(0.9); }
  50%  { opacity: 0.8; transform: scale(1.15); }
  100% { opacity: 0.3; transform: scale(0.9); }
}

.fr-wordmark {
  opacity: 0;
  animation: fr-fade-up 0.7s ease forwards;
  animation-delay: 2s;
}
.fr-tagline {
  opacity: 0;
  animation: fr-fade-up 0.6s ease forwards;
  animation-delay: 2.3s;
}
.fr-ruleline {
  opacity: 0;
  stroke-dasharray: 300;
  stroke-dashoffset: 300;
  animation: fr-draw 0.6s ease forwards;
  animation-delay: 2.15s;
}
@keyframes fr-fade-up {
  from { opacity: 0; transform: translateY(8px); }
  to   { opacity: 1; transform: translateY(0); }
}
`;

export default function AnimatedLogo({ className = "", style }) {
  return (
    <div className={`fr-logo-wrap ${className}`} style={style}>
      <style>{STYLES}</style>
      <svg
        width="100%"
        height="100%"
        viewBox="0 0 680 440"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="FrostERP — Refrigerações"
      >
        <title>FrostERP — Logo animado Refrigerações</title>
        <g id="frosterp-floco-group">
          {/* 6 braços principais */}
          <g stroke="#1B8FE8" strokeLinecap="round" fill="none">
            <line className="fr-arm-main fr-b1" x1="340" y1="170" x2="340" y2="55" strokeWidth="3" />
            <line className="fr-arm-main fr-b2" x1="340" y1="170" x2="440" y2="112" strokeWidth="3" />
            <line className="fr-arm-main fr-b3" x1="340" y1="170" x2="440" y2="228" strokeWidth="3" />
            <line className="fr-arm-main fr-b4" x1="340" y1="170" x2="340" y2="285" strokeWidth="3" />
            <line className="fr-arm-main fr-b5" x1="340" y1="170" x2="240" y2="228" strokeWidth="3" />
            <line className="fr-arm-main fr-b6" x1="340" y1="170" x2="240" y2="112" strokeWidth="3" />

            {/* Galhos nivel 1 */}
            <line className="fr-branch fr-br1" x1="340" y1="118" x2="317" y2="95" strokeWidth="1.8" />
            <line className="fr-branch fr-br2" x1="340" y1="118" x2="363" y2="95" strokeWidth="1.8" />
            <line className="fr-branch fr-br3" x1="390" y1="141" x2="390" y2="114" strokeWidth="1.8" />
            <line className="fr-branch fr-br4" x1="390" y1="141" x2="413" y2="154" strokeWidth="1.8" />
            <line className="fr-branch fr-br5" x1="390" y1="199" x2="413" y2="186" strokeWidth="1.8" />
            <line className="fr-branch fr-br6" x1="390" y1="199" x2="390" y2="226" strokeWidth="1.8" />
            <line className="fr-branch fr-br7" x1="340" y1="222" x2="363" y2="245" strokeWidth="1.8" />
            <line className="fr-branch fr-br8" x1="340" y1="222" x2="317" y2="245" strokeWidth="1.8" />
            <line className="fr-branch fr-br9" x1="290" y1="199" x2="290" y2="226" strokeWidth="1.8" />
            <line className="fr-branch fr-br10" x1="290" y1="199" x2="267" y2="186" strokeWidth="1.8" />
            <line className="fr-branch fr-br11" x1="290" y1="141" x2="267" y2="154" strokeWidth="1.8" />
            <line className="fr-branch fr-br12" x1="290" y1="141" x2="290" y2="114" strokeWidth="1.8" />

            {/* Galhos nivel 2 */}
            <line className="fr-sub-branch fr-sb1" x1="340" y1="92" x2="325" y2="77" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb2" x1="340" y1="92" x2="355" y2="77" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb3" x1="406" y1="132" x2="406" y2="110" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb4" x1="406" y1="132" x2="423" y2="142" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb5" x1="406" y1="208" x2="423" y2="198" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb6" x1="406" y1="208" x2="406" y2="230" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb7" x1="340" y1="248" x2="355" y2="263" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb8" x1="340" y1="248" x2="325" y2="263" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb9" x1="274" y1="208" x2="274" y2="230" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb10" x1="274" y1="208" x2="257" y2="198" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb11" x1="274" y1="132" x2="257" y2="142" strokeWidth="1.3" />
            <line className="fr-sub-branch fr-sb12" x1="274" y1="132" x2="274" y2="110" strokeWidth="1.3" />
          </g>

          {/* Pontas */}
          <circle className="fr-tip fr-td1" cx="340" cy="53" r="3.5" fill="#1B8FE8" style={{ transformOrigin: "340px 53px" }} />
          <circle className="fr-tip fr-td2" cx="442" cy="110" r="3.5" fill="#1B8FE8" style={{ transformOrigin: "442px 110px" }} />
          <circle className="fr-tip fr-td3" cx="442" cy="230" r="3.5" fill="#1B8FE8" style={{ transformOrigin: "442px 230px" }} />
          <circle className="fr-tip fr-td4" cx="340" cy="287" r="3.5" fill="#1B8FE8" style={{ transformOrigin: "340px 287px" }} />
          <circle className="fr-tip fr-td5" cx="238" cy="230" r="3.5" fill="#1B8FE8" style={{ transformOrigin: "238px 230px" }} />
          <circle className="fr-tip fr-td6" cx="238" cy="110" r="3.5" fill="#1B8FE8" style={{ transformOrigin: "238px 110px" }} />

          {/* Losangos */}
          <polygon className="fr-diamond fr-dm1" points="340,96 335,104 340,112 345,104" fill="#4A90D9" style={{ transformOrigin: "340px 104px" }} />
          <polygon className="fr-diamond fr-dm2" points="396,130 391,138 396,146 401,138" fill="#4A90D9" style={{ transformOrigin: "396px 138px" }} />
          <polygon className="fr-diamond fr-dm3" points="396,206 391,198 396,190 401,198" fill="#4A90D9" style={{ transformOrigin: "396px 198px" }} />
          <polygon className="fr-diamond fr-dm4" points="340,232 335,224 340,216 345,224" fill="#4A90D9" style={{ transformOrigin: "340px 224px" }} />
          <polygon className="fr-diamond fr-dm5" points="284,206 279,198 284,190 289,198" fill="#4A90D9" style={{ transformOrigin: "284px 198px" }} />
          <polygon className="fr-diamond fr-dm6" points="284,130 279,138 284,146 289,138" fill="#4A90D9" style={{ transformOrigin: "284px 138px" }} />

          {/* Centro */}
          <polygon className="fr-center-hex" points="340,150 356,159 356,181 340,190 324,181 324,159" fill="#0d3070" stroke="#6CB4F0" strokeWidth="1.2" />
          <circle className="fr-center-dot" cx="340" cy="170" r="13" fill="#1B8FE8" />
          <circle className="fr-center-dot" cx="340" cy="170" r="6.5" fill="#daeeff" />
          <circle className="fr-center-pulse" cx="340" cy="170" r="20" fill="none" stroke="#6CB4F0" strokeWidth="1.2" />
        </g>

        {/* Wordmark */}
        <text
          className="fr-wordmark"
          textAnchor="middle"
          x="340"
          y="370"
          fontFamily="'Gill Sans','Optima','Segoe UI',sans-serif"
          fontSize="72"
          fontWeight="400"
          letterSpacing="8"
          fill="#1B8FE8"
        >
          FROST<tspan fontWeight="300" fill="#5aaee8">ERP</tspan>
        </text>

        <line className="fr-ruleline" x1="190" y1="383" x2="490" y2="383" stroke="#1B8FE8" strokeWidth="0.6" opacity="0.35" />

        <text
          className="fr-tagline"
          textAnchor="middle"
          x="340"
          y="410"
          fontFamily="'Courier New',monospace"
          fontSize="12"
          letterSpacing="5"
          fill="#1B8FE8"
          opacity="0.6"
        >
          REFRIGERAÇÕES
        </text>
      </svg>
    </div>
  );
}
