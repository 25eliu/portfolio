/**
 * Visual language for the knowledge-graph ego view. Node types map onto the dashboard's `chart`
 * categorical palette (the same hex sequence every chart uses, so colors stay consistent), and edge
 * relationships group into three families with distinct line styling. All pure data + math so the layout
 * is unit-testable and renders deterministically.
 */

export type NodeStyle = { color: string; glyph: string; label: string };

const MUTED = "#8B94A3"; // chart-7 / text-secondary-ish — the neutral fallback

/** Type → color (chart palette) + a small geometric glyph + a human label. */
export const NODE_TYPE_STYLE: Record<string, NodeStyle> = {
  ticker: { color: "#4F8DFD", glyph: "⬢", label: "ticker" }, // accent
  sector: { color: "#36C5CF", glyph: "▣", label: "sector" }, // teal
  theme: { color: "#A78BFA", glyph: "✦", label: "theme" }, // violet
  strategy_family: { color: "#2FB574", glyph: "◆", label: "strategy" }, // green
  lesson: { color: "#E3B341", glyph: "▲", label: "lesson" }, // amber
  thesis: { color: "#F472A0", glyph: "◇", label: "thesis" }, // pink
  source: { color: MUTED, glyph: "▢", label: "source" },
  forecast: { color: "#36C5CF", glyph: "◷", label: "forecast" }, // appears only as a null-node edge target
  metric: { color: MUTED, glyph: "▭", label: "metric" },
  cohort: { color: MUTED, glyph: "▦", label: "cohort" },
  catalyst: { color: "#E3B341", glyph: "◈", label: "catalyst" },
  signal: { color: "#36C5CF", glyph: "⟁", label: "signal" },
  concept: { color: "#9BA3AE", glyph: "◌", label: "concept" },
  tag: { color: "#646B76", glyph: "#", label: "tag" },
};

export function nodeStyle(type: string): NodeStyle {
  return NODE_TYPE_STYLE[type] ?? { color: MUTED, glyph: "•", label: type };
}

/** The node types worth surfacing first in the picker (the rest stay reachable by traversal). */
export const PICKER_TYPES = ["ticker", "sector", "theme", "lesson", "thesis", "strategy_family", "source"] as const;

/** Edge relation → short midpoint label (full name shown on hover). */
export const REL_LABEL: Record<string, string> = {
  belongs_to: "in",
  tagged_with: "tag",
  mentions: "mentions",
  cites: "cites",
  derived_from: "from",
  supports: "supports",
  contradicts: "vs",
  supersedes: "replaces",
  in_cohort: "cohort",
  related_to: "related",
};

export type RelFamily = "structural" | "provenance" | "conflict";

const REL_FAMILY: Record<string, RelFamily> = {
  belongs_to: "structural",
  tagged_with: "structural",
  mentions: "structural",
  related_to: "structural",
  cites: "provenance",
  derived_from: "provenance",
  supports: "provenance",
  in_cohort: "provenance",
  contradicts: "conflict",
  supersedes: "conflict",
};

/** Stroke color + dash for an edge, by relationship family. */
export function relStyle(rel: string): { stroke: string; dash: string | undefined; family: RelFamily } {
  const family = REL_FAMILY[rel] ?? "structural";
  if (family === "provenance") return { stroke: "#4F8DFD", dash: undefined, family };
  if (family === "conflict") return { stroke: "#E3B341", dash: "5 4", family };
  return { stroke: "#2E343D", dash: undefined, family }; // hairline-strong
}

/** Split a node id slug ("ticker:aapl") into its type + key. Used to render null-node edge targets. */
export function parseNodeId(id: string): { type: string; key: string } {
  const i = id.indexOf(":");
  return i === -1 ? { type: "concept", key: id } : { type: id.slice(0, i), key: id.slice(i + 1) };
}

/** Frontend mirror of the backend `nodeId(type, key)` slug rule — so deep links build matching ids. */
export function nodeId(type: string, key: string): string {
  const slug = key.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${type}:${slug}`;
}

export type NodePosition = { x: number; y: number; angle: number };

export type LayoutResult = { positions: NodePosition[]; hiddenCount: number };

/**
 * Place up to `cap` neighbors on a ring (two alternating radii once it gets crowded, to cut overlap)
 * around a focal point. Deterministic — angle is a pure function of index — so re-fetching the same node
 * lays out identically and there is nothing to snapshot. Returns how many were dropped by the cap so the
 * UI can show a "+N more" affordance rather than silently truncate.
 */
export function layoutNeighbors(
  n: number,
  opts: { cx: number; cy: number; r1: number; r2: number; cap: number },
): LayoutResult {
  const { cx, cy, r1, r2, cap } = opts;
  const shown = Math.min(n, cap);
  const positions: NodePosition[] = [];
  for (let i = 0; i < shown; i++) {
    const ring = shown > 10 && i % 2 === 1 ? r2 : r1;
    const angle = -Math.PI / 2 + (i / shown) * 2 * Math.PI;
    positions.push({ x: cx + ring * Math.cos(angle), y: cy + ring * Math.sin(angle), angle });
  }
  return { positions, hiddenCount: Math.max(0, n - shown) };
}
