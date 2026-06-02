/**
 * Single source of truth for chart colors. These hexes mirror the Tailwind tokens in
 * `tailwind.config.js` / the CSS variables in `index.css`, so every Recharts surface
 * (equity curve, donut, sparklines) draws from the exact same palette as the rest of the UI.
 */
export const chart = {
  accent: "#4F8DFD",
  pos: "#2FB574",
  neg: "#E5484D",
  warn: "#E3B341",
  grid: "#232830",
  axis: "#646B76",
  muted: "#8B94A3",
  surface: "#181C22",
  hairline: "#2E343D",
  text: "#E6E9EE",
} as const;

/** Ordered, harmonious categorical sequence for allocation / multi-series charts. */
export const CHART_SERIES = [
  "#4F8DFD",
  "#36C5CF",
  "#2FB574",
  "#E3B341",
  "#A78BFA",
  "#F472A0",
  "#8B94A3",
] as const;

export const seriesColor = (i: number) => CHART_SERIES[i % CHART_SERIES.length];

/** Shared tooltip container style for Recharts `contentStyle` — frosted glass to match the UI. */
export const tooltipStyle = {
  background: "var(--glass-strong, rgba(18,21,26,0.72))",
  border: "1px solid var(--glass-edge, rgba(255,255,255,0.08))",
  borderRadius: 12,
  boxShadow:
    "inset 0 1px 0 0 rgba(255,255,255,0.10), 0 24px 64px -16px rgba(0,0,0,0.7)",
  backdropFilter: "blur(20px) saturate(1.5)",
  WebkitBackdropFilter: "blur(20px) saturate(1.5)",
  padding: "10px 12px",
} as const;
