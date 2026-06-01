/** @type {import('tailwindcss').Config} */
export default {
  content: ["./web/index.html", "./web/src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Surfaces — Quiet Institutional graphite, layered by elevation.
        canvas: "#0B0D10",
        surface: { DEFAULT: "#14171C", 2: "#181C22", 3: "#1E232B" },
        hairline: { DEFAULT: "#232830", strong: "#2E343D" },
        // Text ramp.
        text: { DEFAULT: "#E6E9EE", secondary: "#9BA3AE", muted: "#646B76" },
        // Accent — one calm, confident blue.
        accent: { DEFAULT: "#4F8DFD", strong: "#6BA1FF", soft: "#16243B" },
        // Semantic — gains / losses / caution, each with a tint background.
        pos: { DEFAULT: "#2FB574", soft: "#11271E" },
        neg: { DEFAULT: "#E5484D", soft: "#2A1517" },
        warn: { DEFAULT: "#E3B341", soft: "#2A2310" },
        // Ordered categorical sequence — reused by every chart so colors always match.
        chart: {
          1: "#4F8DFD",
          2: "#36C5CF",
          3: "#2FB574",
          4: "#E3B341",
          5: "#A78BFA",
          6: "#F472A0",
          7: "#8B94A3",
        },
      },
      fontFamily: {
        sans: ["Geist", "system-ui", "sans-serif"],
        mono: ["Geist Mono", "ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
      borderRadius: { xl: "0.875rem", "2xl": "1.125rem" },
      boxShadow: {
        card: "0 1px 0 0 rgba(255,255,255,0.02) inset, 0 8px 24px -12px rgba(0,0,0,0.6)",
        pop: "0 12px 40px -12px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.04)",
        glow: "0 0 0 1px rgba(79,141,253,0.35), 0 6px 24px -8px rgba(79,141,253,0.4)",
      },
      keyframes: {
        "fade-up": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        shimmer: {
          "0%": { backgroundPosition: "-200% 0" },
          "100%": { backgroundPosition: "200% 0" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.45" },
        },
      },
      animation: {
        "fade-up": "fade-up 0.5s cubic-bezier(0.22, 1, 0.36, 1) both",
        shimmer: "shimmer 1.6s linear infinite",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
