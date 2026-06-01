import type { MarketData } from "../market/types.ts";
import type { FundamentalsSource } from "../fundamentals/types.ts";
import { type ScanCandidate } from "../domain/scan.ts";

/** Blend momentum (Alpaca movers) with fundamental screens (FMP), capped to `limit` total. */
export async function runOpportunityScan(
  market: MarketData,
  fundamentals: FundamentalsSource,
  limit: number,
): Promise<ScanCandidate[]> {
  if (limit <= 0) return [];
  const per = Math.max(1, Math.ceil(limit / 3));
  const [movers, value, quality] = await Promise.all([
    market.getMovers(per).catch(() => []),
    fundamentals.screen({ peLowerThan: 20, marketCapMoreThan: 2e9, limit: per }).catch(() => []),
    fundamentals.screen({ roeMoreThan: 15, marketCapMoreThan: 2e9, limit: per }).catch(() => []),
  ]);
  const out: ScanCandidate[] = [];
  for (const m of movers) out.push({ symbol: m.symbol, screen: "momentum", reason: `most active, vol ${m.volume.toLocaleString()}` });
  for (const s of value) out.push({ symbol: s, screen: "value", reason: "low P/E, mid+ cap" });
  for (const s of quality) out.push({ symbol: s, screen: "quality_growth", reason: "ROE > 15%" });
  // dedupe by symbol, keep first occurrence, cap
  const seen = new Set<string>();
  return out.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true))).slice(0, limit);
}
