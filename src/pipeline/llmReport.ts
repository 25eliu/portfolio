import type { App } from "../app.ts";
import { newId, type DailyReport, type Recommendation, type ScanCandidate } from "../domain/index.ts";
import type { StreamSink } from "../llm/analyze.ts";
import { computeTechnicals } from "../analysis/technicals.ts";
import { buildMarketContext } from "../analysis/marketContext.ts";
import { runOpportunityScan } from "../analysis/opportunityScan.ts";
import { buildUniverse, type UniverseEntry } from "../analysis/universe.ts";
import { collectAiThesisTickers } from "../analysis/aiUniverse.ts";
import { retrieveEvidence } from "../knowledge/retrieve.ts";
import type { RetrievedExcerpt } from "../domain/index.ts";
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

/** Watch-worthiness for a non-held idea in a long-only book: a credible *buy* setup ranks highest.
 *  Bullish over neutral, a concrete entry trigger matters, genuine WATCH (the model chose it) over a
 *  reclassified PASS, conviction only as a minor tiebreak. Bearish names are excluded upstream. */
function watchScore(r: Recommendation, genuine: boolean): number {
  return (
    (r.prediction.direction === "bullish" ? 2 : 1) +
    (r.prediction.trigger ? 1 : 0) +
    (genuine ? 0.5 : 0) +
    r.conviction * 0.25
  );
}

/**
 * Decide which analyzed recommendations make the report. Held positions and non-held BUY ideas are
 * always kept. The remaining non-held ideas are surfaced as WATCH so Opportunities is never silently
 * empty after a scan — but only the *actionable* ones: a non-held name the model rated bearish is not
 * a buy opportunity in a long-only book, so it is dropped rather than shown as a misleading "high
 * conviction" watch. Survivors are ranked by watch-worthiness (not raw conviction) and capped to
 * `maxWatch`; the long tail is dropped. Pure + immutable (PASS→WATCH produces copies).
 */
export function surfaceRecommendations(
  recs: Recommendation[],
  maxWatch: number,
  aiHeld: ReadonlySet<string> = new Set(),
): { surfaced: Recommendation[]; dropped: number } {
  // AI-held tickers are always retained (even bearish), so the AI can decide to exit them and they get
  // journaled — they must never be silently dropped the way unactionable user-side candidates are.
  const held = recs.filter((r) => r.held || aiHeld.has(r.ticker));
  const heldTickers = new Set(held.map((r) => r.ticker));
  const nonHeld = recs.filter((r) => !heldTickers.has(r.ticker));
  const buys = nonHeld.filter((r) => r.action === "BUY");
  const watchable = nonHeld.filter((r) => r.action !== "BUY" && r.prediction.direction !== "bearish");
  const ranked = watchable
    .map((r) => ({ rec: r.action === "PASS" ? { ...r, action: "WATCH" as const } : r, genuine: r.action === "WATCH" }))
    .sort((a, b) => watchScore(b.rec, b.genuine) - watchScore(a.rec, a.genuine));
  const keptWatch = ranked.slice(0, Math.max(0, maxWatch)).map((x) => x.rec);
  const dropped = nonHeld.length - buys.length - keptWatch.length;
  return { surfaced: [...held, ...buys, ...keptWatch], dropped };
}

/**
 * Real per-ticker analysis. Requires app.analyzer; emits live progress events when `emit` is given.
 * Returns the report plus the per-ticker reference prices captured at analysis time — the journal
 * needs the live quote each recommendation was made against, and it isn't recoverable from the report.
 */
export async function generateLlmReport(
  app: App,
  emit: Emit = () => {},
  aiHeld: string[] = [],
): Promise<{
  report: DailyReport;
  referencePrices: Map<string, number>;
  evidenceByTicker: Map<string, RetrievedExcerpt[]>;
}> {
  const analyzer = app.analyzer!;
  const referencePrices = new Map<string, number>();
  const evidenceByTicker = new Map<string, RetrievedExcerpt[]>();
  // Trusted, computed context: the latest performance-wiki briefing (compiled earlier this run).
  const wikiBriefing = app.repos.wiki.latestBriefing()?.body ?? "";
  const date = app.now();
  const riskPreset = app.repos.risk.get(app.user.id)?.preset ?? "balanced";
  const availableCash = app.repos.portfolios.get(app.user.id)?.cash ?? 0;

  // Top-of-run streaming (market context + discovery) shares a sink that maps to context:* events.
  const contextSink: StreamSink = (e) => {
    if (e.kind === "tool") emit({ type: "context:tool", query: e.query, sources: e.sources });
    else if (e.kind !== "stage") emit({ type: "context:delta", channel: e.kind, text: e.text });
  };

  emit({ type: "phase", phase: "context", label: "Reading the market" });
  const ctx = await buildMarketContext(app.gateway, analyzer, date, app.macro, contextSink);
  emit({ type: "context:done", summary: ctx.macroSummary });

  emit({ type: "phase", phase: "scan", label: "Scanning for opportunities" });
  const held = app.repos.holdings.listByPortfolio(app.user.id).map((h) => h.symbol);
  const watchlist = app.repos.watchlist.list().map((w) => w.symbol);
  const scan = await runOpportunityScan(app.gateway, app.fundamentals, app.env.MAX_SCAN_CANDIDATES).catch(
    (err) => (console.warn(`[scan] failed: ${err instanceof Error ? err.message : String(err)}`), []),
  );
  // Addendum A item 5: fold LLM-grounded thematic/sentiment discovery into the universe.
  const thematic = await analyzer
    .discoverOpportunities(ctx, app.env.MAX_THEMATIC_CANDIDATES, contextSink)
    .catch((err) => (console.warn(`[discovery] failed: ${err instanceof Error ? err.message : String(err)}`), []));
  const combined = dedupeBySymbol([...scan, ...thematic]);
  const aiThesis = collectAiThesisTickers(app);
  const universe = buildUniverse({ held, watchlist, scan: combined, aiHeld, aiThesis });
  console.log(
    `[universe] held=${held.length} watchlist=${watchlist.length} scan=${scan.length} thematic=${thematic.length} aiThesis=${aiThesis.length} → ${universe.symbols.length} to analyze`,
  );

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
      referencePrices.set(symbol, quote.price); // the live baseline the journal scores this call against
      const technicals = computeTechnicals(bars, null); // beta wired from FMP profile in a later pass
      // Graph-aware retrieval, expanded with the candidate's screen (strategy signal) for broader recall.
      const extraTerms = entry.candidate?.screen ? [entry.candidate.screen] : [];
      const evidence = retrieveEvidence(app, symbol, { extraTerms });
      if (evidence.length > 0) evidenceByTicker.set(symbol, evidence);
      // The system's existing self-curated memory for this ticker — shown to the model so it only
      // proposes net-new durable facts (keeps the self-curated library dense, not repetitive).
      const priorFacts = app.repos.knowledge.selfCuratedFactsForTicker(symbol);
      // The AI's own most recent call on this name (excluding today) — trusted continuity.
      const prior = app.repos.journalEntries.latestPriorForTicker(symbol, date);
      const priorThesis = prior
        ? {
            date: prior.date,
            action: prior.action,
            conviction: prior.conviction,
            entry: prior.recommendation.prediction.entry,
            target: prior.recommendation.prediction.target,
            stop: prior.recommendation.prediction.stop,
            thesis: prior.recommendation.thesis,
          }
        : undefined;
      const rec = await analyzer.analyzeTicker(
        {
          symbol,
          // AI-only names (its holdings or its carried-forward theses) read as candidates from the
          // user's advisory perspective, so they map to the analyzer's "scan" source.
          source: entry.source === "ai_held" || entry.source === "ai_thesis" ? "scan" : entry.source,
          screen: entry.candidate?.screen ?? null,
          screenReason: entry.candidate?.reason,
          price: quote.price,
          technicals,
          fundamentals,
          riskPreset,
          availableCash,
          held: entry.source === "held",
          evidence,
          wikiBriefing,
          priorFacts,
          priorThesis,
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

  const analyzed = results.filter((r): r is Recommendation => r !== null);
  const { surfaced: recommendations, dropped } = surfaceRecommendations(analyzed, app.env.MAX_WATCH_SURFACED, new Set(aiHeld));
  const opportunities = recommendations.filter((r) => !r.held).length;
  console.log(`[opportunities] surfaced=${opportunities} dropped=${dropped} (held=${recommendations.length - opportunities})`);
  const report: DailyReport = { id: newId(), date, generatedAt: new Date().toISOString(), source: "llm", recommendations, marketContext: ctx, outlook: null };
  return { report, referencePrices, evidenceByTicker };
}
