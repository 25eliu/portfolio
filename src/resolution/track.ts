import type { App } from "../app.ts";
import { newId, type ForecastDailyMark, type ScoredForecast } from "../domain/index.ts";

/** Inputs to mark one forecast on one day. `prior` seeds the running MFE/MAE (null on the first mark). */
export type MarkInput = {
  markPrice: number;
  date: string;
  spyPrice: number | null;
  prior: ForecastDailyMark | null;
  now: string;
};

/**
 * Mark one open forecast to a price: move since entry, progress to target/stop, unrealized R, a status
 * bucket, and MFE/MAE rolled forward from the prior mark. Mirrors the openBook math (bullish = long,
 * bearish = short) so the blotter and the persisted marks agree. MFE/MAE are running max/min of the
 * unrealized R-multiple (mae is negative when the call has been underwater).
 */
export function markFor(f: ScoredForecast, input: MarkInput): ForecastDailyMark {
  const ref = f.referencePrice;
  const long = f.side === "bullish";
  const current = input.markPrice;
  const moveFromEntry = ref !== 0 ? (current - ref) / ref : 0;
  const targetSpan = long ? f.target - ref : ref - f.target;
  const stopSpan = long ? ref - f.stop : f.stop - ref;
  const progressToTarget = targetSpan !== 0 ? (long ? current - ref : ref - current) / targetSpan : 0;
  const progressToStop = stopSpan !== 0 ? (long ? ref - current : current - ref) / stopSpan : 0;
  const unrealizedR = stopSpan !== 0 ? (long ? current - ref : ref - current) / stopSpan : null;
  const status =
    progressToStop >= 0.8 ? "near_stop" : progressToTarget >= 0.8 ? "near_target" : (unrealizedR ?? 0) >= 0 ? "on_track" : "at_risk";

  const r = unrealizedR ?? 0;
  const mfe = input.prior ? Math.max(input.prior.mfe, r) : r;
  const mae = input.prior ? Math.min(input.prior.mae, r) : r;

  let spyExcess: number | null = null;
  if (input.spyPrice != null && f.benchmarkReferencePrice != null && f.benchmarkReferencePrice !== 0) {
    const spyMove = (input.spyPrice - f.benchmarkReferencePrice) / f.benchmarkReferencePrice;
    spyExcess = moveFromEntry - spyMove;
  }

  return {
    id: newId(),
    forecastId: f.id,
    ticker: f.ticker,
    date: input.date,
    markPrice: current,
    moveFromEntry,
    progressToTarget,
    progressToStop,
    unrealizedR,
    mfe,
    mae,
    spyExcess,
    status,
    createdAt: input.now,
  };
}

/**
 * Mark every open scored forecast to today's price and persist one daily mark each (idempotent per
 * day). Fetches live quotes once. Degrades gracefully — a forecast whose ticker has no quote is
 * skipped. Returns the count tracked. Called from dailyRun after resolution, before wiki compile.
 */
export async function trackOpenForecasts(app: App): Promise<{ tracked: number }> {
  const date = app.now();
  const now = new Date().toISOString();
  const open = app.repos.scoredForecasts.listOpen(date, 200);
  if (open.length === 0) return { tracked: 0 };

  const symbols = [...new Set([...open.map((f) => f.ticker), "SPY"])];
  const quotes = await app.gateway.getQuotes(symbols);
  const priceBySymbol = new Map(quotes.map((q) => [q.symbol, q.price]));
  const spyPrice = priceBySymbol.get("SPY") ?? null;

  let tracked = 0;
  for (const f of open) {
    const markPrice = priceBySymbol.get(f.ticker);
    if (markPrice == null) continue;
    const prior = app.repos.forecastDailyMarks.priorMark(f.id, date);
    app.repos.forecastDailyMarks.upsert(markFor(f, { markPrice, date, spyPrice, prior, now }));
    tracked++;
  }
  return { tracked };
}
