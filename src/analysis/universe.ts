import type { ScanCandidate } from "../domain/scan.ts";

export type UniverseSource = "held" | "watchlist" | "scan" | "ai_held";
export type UniverseEntry = { symbol: string; source: UniverseSource; candidate?: ScanCandidate };
export type Universe = { symbols: string[]; bySymbol: Map<string, UniverseEntry> };

/**
 * Merge ai_held ∪ scan ∪ watchlist ∪ (user) held with precedence held > watchlist > scan > ai_held;
 * dedupe by symbol. `aiHeld` ensures the AI's own positions are always analyzed each run (so it can
 * decide ADD/TRIM/SELL on them) even when the user doesn't hold them and they didn't screen in.
 */
export function buildUniverse(input: {
  held: string[];
  watchlist: string[];
  scan: ScanCandidate[];
  aiHeld?: string[];
}): Universe {
  const bySymbol = new Map<string, UniverseEntry>();
  for (const s of input.aiHeld ?? []) bySymbol.set(s, { symbol: s, source: "ai_held" });
  for (const c of input.scan) {
    const prev = bySymbol.get(c.symbol);
    if (!prev || prev.source === "ai_held") bySymbol.set(c.symbol, { symbol: c.symbol, source: "scan", candidate: c });
  }
  for (const s of input.watchlist) bySymbol.set(s, { symbol: s, source: "watchlist", candidate: bySymbol.get(s)?.candidate });
  for (const s of input.held) bySymbol.set(s, { symbol: s, source: "held", candidate: bySymbol.get(s)?.candidate });
  return { symbols: [...bySymbol.keys()], bySymbol };
}
