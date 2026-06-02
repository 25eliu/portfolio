import type { ScanCandidate } from "../domain/scan.ts";

export type UniverseSource = "held" | "watchlist" | "scan" | "ai_held" | "ai_thesis";
export type UniverseEntry = { symbol: string; source: UniverseSource; candidate?: ScanCandidate };
export type Universe = { symbols: string[]; bySymbol: Map<string, UniverseEntry> };

/**
 * Merge ai_thesis ∪ ai_held ∪ scan ∪ watchlist ∪ (user) held with precedence
 * held > watchlist > scan > ai_held > ai_thesis; dedupe by symbol. `aiThesis` carries the AI's own
 * prior theses forward so its hunting universe grows from its research; `aiHeld` ensures its open
 * positions are always re-analyzed (ADD/TRIM/SELL) even when nothing else surfaces them.
 */
export function buildUniverse(input: {
  held: string[];
  watchlist: string[];
  scan: ScanCandidate[];
  aiHeld?: string[];
  aiThesis?: string[];
}): Universe {
  const bySymbol = new Map<string, UniverseEntry>();
  for (const s of input.aiThesis ?? []) bySymbol.set(s, { symbol: s, source: "ai_thesis" });
  for (const s of input.aiHeld ?? []) bySymbol.set(s, { symbol: s, source: "ai_held" });
  for (const c of input.scan) {
    const prev = bySymbol.get(c.symbol);
    if (!prev || prev.source === "ai_held" || prev.source === "ai_thesis") {
      bySymbol.set(c.symbol, { symbol: c.symbol, source: "scan", candidate: c });
    }
  }
  for (const s of input.watchlist) bySymbol.set(s, { symbol: s, source: "watchlist", candidate: bySymbol.get(s)?.candidate });
  for (const s of input.held) bySymbol.set(s, { symbol: s, source: "held", candidate: bySymbol.get(s)?.candidate });
  return { symbols: [...bySymbol.keys()], bySymbol };
}
