import { colors } from "./src/components/ui/tokens.js";

/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      // Design tokens live in src/components/ui/tokens.js (shared with the charts)
      colors: {
        ink: colors.ink,
        paper: colors.paper,
        surface: colors.surface,
        line: colors.line,
        muted: colors.muted,
        brand: colors.brand,
        safe: colors.safe,
        risk: colors.risk,
        danger: colors.danger,
        accent: colors.accent,
        slate: { 850: "#182233" },
      },
      fontFamily: {
        display: ["'Fraunces'", "serif"],
        body: ["'Inter'", "sans-serif"],
        mono: ["'IBM Plex Mono'", "monospace"],
      },
      borderRadius: { card: "14px" },
      boxShadow: {
        card: "0 1px 2px rgba(16,24,38,0.04), 0 1px 1px rgba(16,24,38,0.03)",
        pop: "0 12px 32px -8px rgba(16,24,38,0.22)",
      },
      keyframes: {
        shimmer: { "100%": { transform: "translateX(100%)" } },
        "slide-in": { from: { transform: "translateX(100%)" }, to: { transform: "translateX(0)" } },
        "fade-up": { from: { opacity: 0, transform: "translateY(6px)" }, to: { opacity: 1, transform: "none" } },
      },
      animation: {
        shimmer: "shimmer 1.4s infinite",
        "slide-in": "slide-in 220ms cubic-bezier(.2,.8,.2,1)",
        "fade-up": "fade-up 200ms ease-out",
      },
    },
  },
  plugins: [],
};
