import type { App } from "../app.ts";
import { newId, type DailyReport, type Recommendation, type ScanCandidate } from "../domain/index.ts";
import { computeTechnicals } from "../analysis/technicals.ts";
import { buildMarketContext } from "../analysis/marketContext.ts";
import { runOpportunityScan } from "../analysis/opportunityScan.ts";
import { buildUniverse, type UniverseEntry } from "../analysis/universe.ts";

const LOOKBACK = 252;

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return out;
}

/** Dedupe candidates by symbol, keeping the first occurrence (quant scan before thematic). */
function dedupeBySymbol(candidates: ScanCandidate[]): ScanCandidate[] {
  const seen = new Set<string>();
  const out: ScanCandidate[] = [];
  for (const c of candidates) {
    if (seen.has(c.symbol)) continue;
    seen.add(c.symbol);
    out.push(c);
  }
  return out;
}

/** Real per-ticker analysis. Requires app.analyzer (else the caller falls back to the fake report). */
export async function generateLlmReport(app: App): Promise<DailyReport> {
  const analyzer = app.analyzer!;
  const date = app.now();
  const riskPreset = app.repos.risk.get(app.user.id)?.preset ?? "balanced";

  const ctx = await buildMarketContext(app.gateway, analyzer, date);

  const held = app.repos.holdings.listByPortfolio(app.user.id).map((h) => h.symbol);
  const watchlist = app.repos.watchlist.list().map((w) => w.symbol);
  const scan = await runOpportunityScan(app.gateway, app.fundamentals, app.env.MAX_SCAN_CANDIDATES).catch(() => []);
  // Addendum A item 5: fold LLM-grounded thematic/sentiment discovery into the universe.
  const thematic = await analyzer.discoverOpportunities(ctx, app.env.MAX_THEMATIC_CANDIDATES).catch(() => []);
  const combined = dedupeBySymbol([...scan, ...thematic]);
  const universe = buildUniverse({ held, watchlist, scan: combined });

  const results = await mapLimit(universe.symbols, app.env.LLM_CONCURRENCY, async (symbol) => {
    const entry = universe.bySymbol.get(symbol) as UniverseEntry;
    try {
      const [bars, quote, fundamentals] = await Promise.all([
        app.gateway.getBars(symbol, LOOKBACK),
        app.gateway.getQuote(symbol),
        app.fundamentals.get(symbol),
      ]);
      const technicals = computeTechnicals(bars, null); // beta wired from FMP profile in a later pass
      const rec = await analyzer.analyzeTicker(
        {
          symbol,
          source: entry.source,
          screen: entry.candidate?.screen ?? null,
          screenReason: entry.candidate?.reason,
          price: quote.price,
          technicals,
          fundamentals,
          riskPreset,
        },
        ctx,
      );
      return rec;
    } catch (err) {
      console.error(`analyze ${symbol} failed:`, err instanceof Error ? err.message : err);
      return null;
    }
  });

  const recommendations = results.filter((r): r is Recommendation => r !== null);
  return { id: newId(), date, generatedAt: new Date().toISOString(), source: "llm", recommendations, marketContext: ctx };
}
