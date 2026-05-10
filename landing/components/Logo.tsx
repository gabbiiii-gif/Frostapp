"use client";

import { useEffect, useRef } from "react";
import anime from "animejs";

export function Logo({ size = 36 }: { size?: number }) {
  const ref = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!ref.current) return;
    const rotate = anime({
      targets: ref.current,
      rotate: "1turn",
      duration: 20000,
      easing: "linear",
      loop: true,
    });
    const pulse = anime({
      targets: ref.current.querySelectorAll("[data-arm]"),
      opacity: [0.55, 1, 0.55],
      duration: 3200,
      easing: "easeInOutSine",
      loop: true,
      delay: anime.stagger(180),
    });
    return () => {
      rotate.pause();
      pulse.pause();
    };
  }, []);

  return (
    <div className="flex items-center gap-2.5">
      <svg
        ref={ref}
        width={size}
        height={size}
        viewBox="0 0 64 64"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-label="FrostERP"
      >
        <defs>
          <linearGradient id="frostGrad" x1="0" y1="0" x2="64" y2="64">
            <stop offset="0%" stopColor="#22D3EE" />
            <stop offset="100%" stopColor="#3B82F6" />
          </linearGradient>
        </defs>
        {[0, 60, 120, 180, 240, 300].map((deg) => (
          <g key={deg} transform={`rotate(${deg} 32 32)`} data-arm>
            <line x1="32" y1="10" x2="32" y2="54" stroke="url(#frostGrad)" strokeWidth="2.4" strokeLinecap="round" />
            <line x1="32" y1="16" x2="26" y2="22" stroke="url(#frostGrad)" strokeWidth="2" strokeLinecap="round" />
            <line x1="32" y1="16" x2="38" y2="22" stroke="url(#frostGrad)" strokeWidth="2" strokeLinecap="round" />
            <line x1="32" y1="26" x2="27" y2="31" stroke="url(#frostGrad)" strokeWidth="1.8" strokeLinecap="round" />
            <line x1="32" y1="26" x2="37" y2="31" stroke="url(#frostGrad)" strokeWidth="1.8" strokeLinecap="round" />
          </g>
        ))}
        <circle cx="32" cy="32" r="3" fill="#22D3EE" />
      </svg>
      <span className="font-bold text-lg tracking-tight">
        Frost<span className="text-accent-cyan2">ERP</span>
      </span>
    </div>
  );
}
