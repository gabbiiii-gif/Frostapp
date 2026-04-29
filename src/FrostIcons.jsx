// ─── FrostIcons — pacote de ícones SVG do FrostERP ──────────────────────────
// Variantes disponíveis: outline, bold, solid, duotone, frost, minimal.
// Variante padrão usada na sidebar/UI: minimal (1px geométrico, ultra limpo).
// Uso: <FrostIcon name="dashboard" variant="minimal" size={18} color="#1B8FE8" />
import React from "react";

// Cor de preenchimento usada nas variantes "frost"/"duotone" (fundo escuro)
const PD = "#060d1a";

// ─── Definições por ícone ────────────────────────────────────────────────────
// Cada entrada possui ao menos a variante minimal usada no app.
// Estrutura: { [name]: { [variant]: ({c}) => <>...children...</> } }
const IC = {
  dashboard: {
    minimal: ({ c }) => (
      <>
        <rect x="3" y="3" width="8" height="8" stroke={c} strokeWidth="1" fill="none" />
        <rect x="13" y="3" width="8" height="8" stroke={c} strokeWidth="1" fill="none" />
        <rect x="3" y="13" width="8" height="8" stroke={c} strokeWidth="1" fill="none" />
        <rect x="13" y="13" width="8" height="8" stroke={c} strokeWidth="1" fill="none" />
      </>
    ),
    outline: ({ c }) => (
      <>
        <rect x="3" y="3" width="8" height="8" rx="1.5" stroke={c} strokeWidth="1.5" fill="none" />
        <rect x="13" y="3" width="8" height="8" rx="1.5" stroke={c} strokeWidth="1.5" fill="none" />
        <rect x="3" y="13" width="8" height="8" rx="1.5" stroke={c} strokeWidth="1.5" fill="none" />
        <rect x="13" y="13" width="8" height="8" rx="1.5" stroke={c} strokeWidth="1.5" fill="none" />
      </>
    ),
  },

  os: {
    minimal: ({ c }) => (
      <>
        <rect x="5" y="3" width="14" height="18" stroke={c} strokeWidth="1" fill="none" />
        <line x1="8" y1="3" x2="8" y2="6" stroke={c} strokeWidth="1" />
        <line x1="16" y1="3" x2="16" y2="6" stroke={c} strokeWidth="1" />
        <line x1="8" y1="6" x2="16" y2="6" stroke={c} strokeWidth="1" />
        <line x1="8" y1="11" x2="16" y2="11" stroke={c} strokeWidth="1" strokeLinecap="square" />
        <line x1="8" y1="15" x2="13" y2="15" stroke={c} strokeWidth="1" strokeLinecap="square" />
      </>
    ),
  },

  agenda: {
    minimal: ({ c }) => (
      <>
        <rect x="3" y="4" width="18" height="18" stroke={c} strokeWidth="1" fill="none" />
        <line x1="3" y1="10" x2="21" y2="10" stroke={c} strokeWidth="1" />
        <line x1="8" y1="2" x2="8" y2="6" stroke={c} strokeWidth="1" />
        <line x1="16" y1="2" x2="16" y2="6" stroke={c} strokeWidth="1" />
        <rect x="7" y="14" width="2" height="2" fill={c} />
        <rect x="11" y="14" width="2" height="2" fill={c} />
      </>
    ),
  },

  financeiro: {
    minimal: ({ c }) => (
      <>
        <polyline
          points="3,18 7.5,12 11,15 15.5,8 21,8"
          stroke={c}
          strokeWidth="1"
          strokeLinecap="square"
          strokeLinejoin="miter"
          fill="none"
        />
        <line x1="19" y1="8" x2="21" y2="8" stroke={c} strokeWidth="1" />
        <line x1="21" y1="8" x2="21" y2="10" stroke={c} strokeWidth="1" />
      </>
    ),
  },

  cadastros: {
    minimal: ({ c }) => (
      <>
        <circle cx="9" cy="7" r="3.5" stroke={c} strokeWidth="1" fill="none" />
        <path d="M2 21v-1a5 5 0 0 1 5-5h4a5 5 0 0 1 5 5v1" stroke={c} strokeWidth="1" fill="none" />
        <path d="M15.5 4a3 3 0 0 1 0 6" stroke={c} strokeWidth="1" fill="none" />
      </>
    ),
  },

  config: {
    minimal: ({ c }) => (
      <>
        <line x1="4" y1="6" x2="20" y2="6" stroke={c} strokeWidth="1" />
        <line x1="4" y1="12" x2="20" y2="12" stroke={c} strokeWidth="1" />
        <line x1="4" y1="18" x2="20" y2="18" stroke={c} strokeWidth="1" />
        <circle cx="9" cy="6" r="2" stroke={c} strokeWidth="1" fill={PD} />
        <circle cx="15" cy="12" r="2" stroke={c} strokeWidth="1" fill={PD} />
        <circle cx="10" cy="18" r="2" stroke={c} strokeWidth="1" fill={PD} />
      </>
    ),
  },

  bell: {
    minimal: ({ c }) => (
      <>
        <path
          d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"
          stroke={c}
          strokeWidth="1"
          fill="none"
        />
        <line x1="10.27" y1="21" x2="13.73" y2="21" stroke={c} strokeWidth="1" strokeLinecap="square" />
      </>
    ),
  },

  search: {
    minimal: ({ c }) => (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" stroke={c} strokeWidth="1" fill="none" />
        <line x1="15.5" y1="15.5" x2="21" y2="21" stroke={c} strokeWidth="1" />
      </>
    ),
  },

  user: {
    minimal: ({ c }) => (
      <>
        <circle cx="12" cy="8" r="4" stroke={c} strokeWidth="1" fill="none" />
        <path d="M4 20c0-4 3.6-7 8-7s8 3 8 7" stroke={c} strokeWidth="1" fill="none" />
      </>
    ),
  },

  logout: {
    minimal: ({ c }) => (
      <>
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" stroke={c} strokeWidth="1" fill="none" />
        <polyline points="16,17 21,12 16,7" stroke={c} strokeWidth="1" fill="none" />
        <line x1="21" y1="12" x2="9" y2="12" stroke={c} strokeWidth="1" />
      </>
    ),
  },

  tecnico: {
    minimal: ({ c }) => (
      <>
        <path
          d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"
          stroke={c}
          strokeWidth="1"
          fill="none"
        />
      </>
    ),
  },

  relatorios: {
    minimal: ({ c }) => (
      <>
        <rect x="3" y="3" width="18" height="18" stroke={c} strokeWidth="1" fill="none" />
        <line x1="7" y1="8" x2="7" y2="18" stroke={c} strokeWidth="1" />
        <line x1="11" y1="11" x2="11" y2="18" stroke={c} strokeWidth="1" />
        <line x1="15" y1="6" x2="15" y2="18" stroke={c} strokeWidth="1" />
      </>
    ),
  },
};

// Cor padrão por variante (minimal usa cinza neutro; demais usam azul brand)
const STYLE_ACCENT = {
  outline: "#1B8FE8",
  bold: "#3b82f6",
  solid: "#1B8FE8",
  duotone: "#1B8FE8",
  frost: "#1B8FE8",
  minimal: "#94a3b8",
};

// ─── Componente FrostIcon ────────────────────────────────────────────────────
// Renderiza o SVG da variante solicitada. Se o ícone/variante não existir,
// faz fallback para minimal (ou null se nem isso existir).
export function FrostIcon({ name, variant = "minimal", size = 18, color }) {
  const def = IC[name]?.[variant] || IC[name]?.minimal;
  if (!def) return null;
  const c = color || STYLE_ACCENT[variant] || "#94a3b8";
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      {def({ c })}
    </svg>
  );
}

export default FrostIcon;
