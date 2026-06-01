import type { ScanCandidate } from "../domain/scan.ts";

export type UniverseSource = "held" | "watchlist" | "scan";
export type UniverseEntry = { symbol: string; source: UniverseSource; candidate?: ScanCandidate };
export type Universe = { symbols: string[]; bySymbol: Map<string, UniverseEntry> };

/** Merge held ∪ watchlist ∪ scan with precedence held > watchlist > scan; dedupe by symbol. */
export function buildUniverse(input: {
  held: string[];
  watchlist: string[];
  scan: ScanCandidate[];
}): Universe {
  const bySymbol = new Map<string, UniverseEntry>();
  for (const c of input.scan) if (!bySymbol.has(c.symbol)) bySymbol.set(c.symbol, { symbol: c.symbol, source: "scan", candidate: c });
  for (const s of input.watchlist) bySymbol.set(s, { symbol: s, source: "watchlist", candidate: bySymbol.get(s)?.candidate });
  for (const s of input.held) bySymbol.set(s, { symbol: s, source: "held", candidate: bySymbol.get(s)?.candidate });
  return { symbols: [...bySymbol.keys()], bySymbol };
}
