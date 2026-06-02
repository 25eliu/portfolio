import type { App } from "../app.ts";
import { newId, type DailyReport, type Recommendation, type ScanCandidate } from "../domain/index.ts";
import type { StreamSink } from "../llm/analyze.ts";
import { computeTechnicals } from "../analysis/technicals.ts";
import { buildMarketContext } from "../analysis/marketContext.ts";
import { runOpportunityScan } from "../analysis/opportunityScan.ts";
import { buildUniverse, type UniverseEntry } from "../analysis/universe.ts";
import type { Emit } from "./events.ts";

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

/** Real per-ticker analysis. Requires app.analyzer; emits live progress events when `emit` is given. */
export async function generateLlmReport(app: App, emit: Emit = () => {}): Promise<DailyReport> {
  const analyzer = app.analyzer!;
  const date = app.now();
  const riskPreset = app.repos.risk.get(app.user.id)?.preset ?? "balanced";
  const availableCash = app.repos.portfolios.get(app.user.id)?.cash ?? 0;

  // Top-of-run streaming (market context + discovery) shares a sink that maps to context:* events.
  const contextSink: StreamSink = (e) => {
    if (e.kind === "tool") emit({ type: "context:tool", query: e.query, sources: e.sources });
    else if (e.kind !== "stage") emit({ type: "context:delta", channel: e.kind, text: e.text });
  };

  emit({ type: "phase", phase: "context", label: "Reading the market" });
  const ctx = await buildMarketContext(app.gateway, analyzer, date, contextSink);
  emit({ type: "context:done", summary: ctx.macroSummary });

  emit({ type: "phase", phase: "scan", label: "Scanning for opportunities" });
  const held = app.repos.holdings.listByPortfolio(app.user.id).map((h) => h.symbol);
  const watchlist = app.repos.watchlist.list().map((w) => w.symbol);
  const scan = await runOpportunityScan(app.gateway, app.fundamentals, app.env.MAX_SCAN_CANDIDATES).catch(() => []);
  // Addendum A item 5: fold LLM-grounded thematic/sentiment discovery into the universe.
  const thematic = await analyzer
    .discoverOpportunities(ctx, app.env.MAX_THEMATIC_CANDIDATES, contextSink)
    .catch(() => []);
  const combined = dedupeBySymbol([...scan, ...thematic]);
  const universe = buildUniverse({ held, watchlist, scan: combined });

  emit({
    type: "universe",
    tickers: universe.symbols.map((symbol) => {
      const entry = universe.bySymbol.get(symbol) as UniverseEntry;
      return { symbol, source: entry.source, screen: entry.candidate?.screen ?? null };
    }),
  });
  emit({ type: "phase", phase: "analyze", label: `Analyzing ${universe.symbols.length} tickers` });

  const results = await mapLimit(universe.symbols, app.env.LLM_CONCURRENCY, async (symbol) => {
    const entry = universe.bySymbol.get(symbol) as UniverseEntry;
    const tickerSink: StreamSink = (e) => {
      if (e.kind === "stage") emit({ type: "ticker:start", symbol, stage: e.stage });
      else if (e.kind === "tool") emit({ type: "ticker:tool", symbol, query: e.query, sources: e.sources });
      else emit({ type: "ticker:delta", symbol, channel: e.kind, text: e.text });
    };
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
          availableCash,
          held: entry.source === "held",
        },
        ctx,
        tickerSink,
      );
      emit({ type: "ticker:done", symbol, action: rec.action, conviction: rec.conviction });
      return rec;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`analyze ${symbol} failed:`, message);
      emit({ type: "ticker:error", symbol, message });
      return null;
    }
  });

  const recommendations = results.filter(
    (r): r is Recommendation => r !== null && !(r.held === false && r.action === "PASS"),
  );
  return { id: newId(), date, generatedAt: new Date().toISOString(), source: "llm", recommendations, marketContext: ctx };
}
