import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./content/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          base: "#0A1628",
          surface: "#0F1E36",
        },
        accent: {
          DEFAULT: "#3B82F6",
          cyan: "#06B6D4",
          cyan2: "#22D3EE",
        },
        ink: {
          DEFAULT: "#F8FAFC",
          muted: "#94A3B8",
        },
        ok: "#10B981",
        warn: "#F59E0B",
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
        mono: ["var(--font-geist-mono)", "ui-monospace", "monospace"],
      },
      borderRadius: {
        xl2: "16px",
      },
      boxShadow: {
        cyan: "0 25px 50px -12px rgba(34, 211, 238, 0.10)",
        cyanHover: "0 30px 60px -10px rgba(34, 211, 238, 0.18)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 220ms ease-out",
        "accordion-up": "accordion-up 220ms ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
