import type { App } from "../app.ts";
import {
  newId,
  nodeId,
  edgeId,
  type DailyReport,
  type Horizon,
  type JournalEntry,
  type Recommendation,
  type RetrievedExcerpt,
  type ScoredForecast,
} from "../domain/index.ts";
import { addTradingSessions } from "../resolution/calendar.ts";

/** Actions that can become a scored forecast (roadmap §5). HOLD/WATCH/PASS stay visible but unscored. */
const SCORABLE_ACTIONS = new Set(["BUY", "ADD", "TRIM", "SELL"]);

/** Trading sessions per prediction horizon — the horizon over which target-before-stop is judged. */
export const HORIZON_SESSIONS: Record<Horizon, number> = {
  "1d": 1,
  "1w": 5,
  "1mo": 21,
  "3mo": 63,
  "6mo": 126,
  "1y": 252,
};

/** Calendar date by which `sessions` trading days have elapsed from `asOfDate` (weekday calendar). */
export function resolveAtDate(asOfDate: string, sessions: number): string {
  return addTradingSessions(asOfDate, sessions);
}

/** Map the long-only book's actionable verbs to a scored direction. */
function sideForAction(action: Recommendation["action"]): ScoredForecast["side"] | null {
  if (action === "BUY" || action === "ADD") return "bullish";
  if (action === "TRIM" || action === "SELL") return "bearish";
  return null;
}

/** The live-quote context captured during analysis that derivation needs but the report doesn't carry. */
export type ForecastContext = {
  journalEntryId: string;
  createdAt: string; // ISO datetime — also the as-of/quote timestamp in v1
  date: string; // YYYY-MM-DD report date
  referencePrice: number | null;
  priceFeed: string;
  benchmarkReferencePrice: number | null;
  marketContextId: string | null;
  /** Knowledge-base chunk ids retrieved into this call's research (Phase 3). */
  retrievedChunkIds: string[];
  /** Source ids backing the retrieved evidence, merged into the forecast's cited sources. */
  evidenceSourceIds: string[];
};

/**
 * Derive a scored forecast from a recommendation, or null when it isn't a complete actionable plan.
 * Pure and IO-free — the unit-testable heart of the journal. A plan qualifies only when the action is
 * scorable AND it carries both a target and a stop; otherwise the recommendation is journaled unscored.
 */
export function deriveScoredForecast(rec: Recommendation, ctx: ForecastContext): ScoredForecast | null {
  if (!SCORABLE_ACTIONS.has(rec.action)) return null;
  const side = sideForAction(rec.action);
  if (!side) return null;

  const { target, stop } = rec.prediction;
  if (target == null || stop == null) return null;

  const referencePrice = ctx.referencePrice ?? rec.technicals.price ?? rec.prediction.entry;
  if (referencePrice == null) return null; // no usable baseline → cannot score honestly

  const sessions = HORIZON_SESSIONS[rec.prediction.horizon];

  return {
    id: newId(),
    journalEntryId: ctx.journalEntryId,
    ticker: rec.ticker,
    side,
    strategyFamily: rec.strategyFamily,
    signals: rec.signals,
    createdAt: ctx.createdAt,
    asOfTimestamp: ctx.createdAt,
    marketSession: "unknown",
    quoteTimestamp: ctx.createdAt,
    priceFeed: ctx.priceFeed,
    referencePrice,
    entry: rec.prediction.entry ?? referencePrice,
    target,
    stop,
    horizonTradingSessions: sessions,
    resolveAt: resolveAtDate(ctx.date, sessions),
    conviction: rec.conviction,
    benchmarkSymbol: "SPY",
    benchmarkReferencePrice: ctx.benchmarkReferencePrice,
    resolutionPolicyVersion: "v1",
    marketContextId: ctx.marketContextId,
    citedSourceIds: [...new Set([...rec.sources.map((s) => s.url), ...ctx.evidenceSourceIds])],
    retrievedChunkIds: ctx.retrievedChunkIds,
  };
}

/** Map the market adapter to the price feed recorded on each forecast for reproducibility. */
export function priceFeedFor(gatewayKind: string): string {
  return gatewayKind === "alpaca" ? "iex" : "fake";
}

/**
 * Build the journal entries and scored forecasts for a report. Pure: every recommendation becomes an
 * immutable entry (recommendation preserved verbatim); complete actionable plans additionally yield a
 * scored forecast, and the entry's `scored` flag reflects that.
 */
export function buildJournal(
  report: DailyReport,
  runId: string | null,
  benchmarkPrice: number | null,
  referencePrices: Map<string, number>,
  priceFeed: string,
  evidenceByTicker: Map<string, RetrievedExcerpt[]> = new Map(),
): { entries: JournalEntry[]; forecasts: ScoredForecast[] } {
  const entries: JournalEntry[] = [];
  const forecasts: ScoredForecast[] = [];

  for (const rec of report.recommendations) {
    const journalEntryId = newId();
    const evidence = evidenceByTicker.get(rec.ticker) ?? [];
    const ctx: ForecastContext = {
      journalEntryId,
      createdAt: report.generatedAt,
      date: report.date,
      referencePrice: referencePrices.get(rec.ticker) ?? null,
      priceFeed,
      benchmarkReferencePrice: benchmarkPrice,
      marketContextId: report.id,
      retrievedChunkIds: evidence.map((e) => e.chunkId),
      evidenceSourceIds: [...new Set(evidence.map((e) => e.sourceId))],
    };
    const forecast = deriveScoredForecast(rec, ctx);
    if (forecast) forecasts.push(forecast);

    entries.push({
      id: journalEntryId,
      reportId: report.id,
      runId,
      date: report.date,
      createdAt: report.generatedAt,
      ticker: rec.ticker,
      held: rec.held,
      action: rec.action,
      conviction: rec.conviction,
      strategyFamily: rec.strategyFamily,
      recommendation: rec,
      marketContextId: report.id,
      scored: forecast !== null,
    });
  }

  return { entries, forecasts };
}

/**
 * Persist the journal for a freshly generated report. Runs inside one transaction so a journal write
 * never half-commits. Called after `reports.insert` in dailyRun; the reports table is untouched.
 */
export function persistJournal(
  app: App,
  report: DailyReport,
  runId: string | null,
  benchmarkPrice: number | null,
  referencePrices: Map<string, number>,
  evidenceByTicker: Map<string, RetrievedExcerpt[]> = new Map(),
): {
  entries: number;
  scored: number;
  evidence: number;
  /** Per-ticker link so downstream steps (AI execution) can attribute trades to journal + forecast. */
  linkByTicker: Map<string, { journalEntryId: string; forecastId: string | null }>;
} {
  const { entries, forecasts } = buildJournal(
    report,
    runId,
    benchmarkPrice,
    referencePrices,
    priceFeedFor(app.gateway.kind),
    evidenceByTicker,
  );
  let evidenceCount = 0;
  app.db.transaction(() => {
    app.repos.journalEntries.insertMany(entries);
    app.repos.scoredForecasts.insertMany(forecasts);
    // Record the exact evidence each recommendation used, and connect it in the graph.
    for (const entry of entries) {
      const excerpts = evidenceByTicker.get(entry.ticker) ?? [];
      excerpts.forEach((ex, rank) => {
        app.repos.knowledge.insertEvidence({
          id: newId(),
          journalEntryId: entry.id,
          chunkId: ex.chunkId,
          sourceId: ex.sourceId,
          rank,
          createdAt: report.generatedAt,
        });
        // source —mentions→ ticker: the source informed analysis of this ticker.
        const src = nodeId("source", ex.sourceId);
        const tkr = nodeId("ticker", entry.ticker);
        app.repos.graph.upsertNode({
          id: tkr, type: "ticker", label: entry.ticker, summary: "",
          data: {}, status: "active", createdAt: report.generatedAt, updatedAt: report.generatedAt,
        });
        app.repos.graph.upsertEdge({
          id: edgeId(src, "mentions", tkr),
          srcId: src,
          dstId: tkr,
          rel: "mentions",
          weight: 1,
          data: {},
          createdAt: report.generatedAt,
        });
        evidenceCount++;
      });
    }

    // Materialize ticker —belongs_to→ sector from fundamentals. Sector is ground truth (from the data
    // provider), not a model judgment, so it's wired deterministically. This is the edge the sector
    // calibration cohort and the graph's sector clusters traverse — without it the sector layer is inert.
    for (const entry of entries) {
      const sector = entry.recommendation.fundamentals?.sector;
      if (!sector) continue;
      const tkr = nodeId("ticker", entry.ticker);
      const sec = nodeId("sector", sector);
      app.repos.graph.upsertNode({
        id: tkr, type: "ticker", label: entry.ticker, summary: "",
        data: {}, status: "active", createdAt: report.generatedAt, updatedAt: report.generatedAt,
      });
      app.repos.graph.upsertNode({
        id: sec, type: "sector", label: sector, summary: "",
        data: {}, status: "active", createdAt: report.generatedAt, updatedAt: report.generatedAt,
      });
      app.repos.graph.upsertEdge({
        id: edgeId(tkr, "belongs_to", sec),
        srcId: tkr, dstId: sec, rel: "belongs_to", weight: 1, data: {}, createdAt: report.generatedAt,
      });
    }
  })();

  const forecastByEntry = new Map(forecasts.map((f) => [f.journalEntryId, f.id]));
  const linkByTicker = new Map(
    entries.map((e) => [e.ticker, { journalEntryId: e.id, forecastId: forecastByEntry.get(e.id) ?? null }]),
  );
  return { entries: entries.length, scored: forecasts.length, evidence: evidenceCount, linkByTicker };
}
