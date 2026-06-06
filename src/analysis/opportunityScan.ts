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
  // Each source degrades to [] independently, but we log WHY — a silently-empty scan (free-tier 402,
  // data-plan gating, etc.) is otherwise invisible and looks like "no opportunities exist".
  const warn = (label: string) => (err: unknown) => {
    console.warn(`[scan] ${label} unavailable: ${err instanceof Error ? err.message : String(err)}`);
    return [] as never[];
  };
  const [movers, value, quality] = await Promise.all([
    market.getMovers(per).catch(warn("movers (Alpaca most-actives)")),
    fundamentals.screen({ peLowerThan: 20, marketCapMoreThan: 2e9, limit: per }).catch(warn("value screen (FMP)")),
    fundamentals.screen({ roeMoreThan: 15, marketCapMoreThan: 2e9, limit: per }).catch(warn("quality screen (FMP)")),
  ]);
  const out: ScanCandidate[] = [];
  for (const m of movers) out.push({ symbol: m.symbol, screen: "momentum", reason: `most active, vol ${m.volume.toLocaleString()}`, sources: [] });
  for (const s of value) out.push({ symbol: s, screen: "value", reason: "low P/E, mid+ cap", sources: [] });
  for (const s of quality) out.push({ symbol: s, screen: "quality_growth", reason: "ROE > 15%", sources: [] });
  // dedupe by symbol, keep first occurrence, cap
  const seen = new Set<string>();
  const deduped = out.filter((c) => (seen.has(c.symbol) ? false : (seen.add(c.symbol), true))).slice(0, limit);
  console.log(`[scan] movers=${movers.length} value=${value.length} quality=${quality.length} → ${deduped.length} candidates`);
  return deduped;
}
