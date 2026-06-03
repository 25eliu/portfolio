import type { Thesis } from "../domain/index.ts";

/** Compile the current active outlook into a compact briefing block (the AI's own standing view). */
export function renderOutlook(active: Thesis[]): string {
  if (active.length === 0) return "";
  const regime = active.find((t) => t.level === "regime");
  const sectors = active.filter((t) => t.level === "sector");
  const themes = active.filter((t) => t.level === "theme");
  const lean = (t: Thesis) => `${t.subject} ${t.stance} ${t.conviction.toFixed(2)} (${t.horizon})`;
  return [
    `OUTLOOK (the system's current standing view — trusted, self-authored).`,
    regime ? `Regime: ${regime.stance} ${regime.conviction.toFixed(2)} — ${regime.summary || regime.thesis}` : null,
    sectors.length ? `Sectors: ${sectors.map(lean).join("; ")}` : null,
    themes.length ? `Themes: ${themes.map(lean).join("; ")}` : null,
  ].filter(Boolean).join("\n");
}
