import type { Bar } from "../market/types.ts";
import type { OutcomeKind, ScoredForecast } from "../domain/index.ts";

/** Bump this whenever the grading logic changes; outcomes record the version they were resolved under. */
export const RESOLUTION_POLICY_VERSION = "v1";

/** The graded result of one forecast, before id/timestamp/provenance are stamped on by the service. */
export type ResolutionResult = {
  outcome: OutcomeKind;
  resolutionDate: string;
  entryPrice: number;
  exitPrice: number;
  terminalReturn: number;
  spyExcessReturn: number | null;
  maxFavorableExcursion: number;
  maxAdverseExcursion: number;
  forecastR: number | null;
  warnings: string[];
};

/** SPY close on `date`, else the most recent close on/before it (null if none precedes it). */
function benchmarkCloseAt(spyBars: Bar[], date: string): number | null {
  let chosen: number | null = null;
  for (const b of spyBars) {
    if (b.date <= date) chosen = b.close;
    else break;
  }
  return chosen;
}

/**
 * Resolve a scored forecast against historical daily bars. Pure and IO-free.
 *
 * Honest, lookahead-safe grading (roadmap §5):
 * - Only bars strictly AFTER the forecast's as-of date and on/before its resolveAt are considered, so
 *   the same-session bar the call was made within can never leak into the outcome.
 * - Resolves on daily high/low, not just the close: the first bar to touch target or stop decides it.
 * - A single bar that spans BOTH target and stop is `ambiguous_touch` — graded conservatively
 *   stop-first and excluded from primary calibration downstream.
 * - If neither is touched by the horizon, the forecast `expired` at the terminal close.
 *
 * Returns null when no eligible bar exists yet (e.g. provider has no data past the as-of date); the
 * caller leaves the forecast unresolved and retries on a later run.
 */
export function resolveForecast(
  forecast: ScoredForecast,
  bars: Bar[],
  spyBars: Bar[],
): ResolutionResult | null {
  const asOfDate = forecast.asOfTimestamp.slice(0, 10);
  const window = bars
    .filter((b) => b.date > asOfDate && b.date <= forecast.resolveAt)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  if (window.length === 0) return null;

  const bullish = forecast.side === "bullish";
  const entry = forecast.entry ?? forecast.referencePrice;
  const { target, stop } = forecast;
  const warnings: string[] = [];

  let outcome: OutcomeKind = "expired";
  let exitPrice = window[window.length - 1]!.close;
  let resolutionDate = window[window.length - 1]!.date;
  let resolutionIndex = window.length - 1;

  for (let i = 0; i < window.length; i++) {
    const bar = window[i]!;
    const targetTouched = bullish ? bar.high >= target : bar.low <= target;
    const stopTouched = bullish ? bar.low <= stop : bar.high >= stop;
    if (targetTouched && stopTouched) {
      outcome = "ambiguous_touch";
      exitPrice = stop; // conservative: assume the stop filled first
      warnings.push(`target and stop both touched in the ${bar.date} daily bar; graded stop-first`);
    } else if (targetTouched) {
      outcome = "target_hit";
      exitPrice = target;
    } else if (stopTouched) {
      outcome = "stop_hit";
      exitPrice = stop;
    } else {
      continue;
    }
    resolutionDate = bar.date;
    resolutionIndex = i;
    break;
  }

  // Excursions over the bars up to and including resolution (max unrealized favorable/adverse move).
  let mfe = 0;
  let mae = 0;
  for (let i = 0; i <= resolutionIndex; i++) {
    const bar = window[i]!;
    const favorable = bullish ? (bar.high - entry) / entry : (entry - bar.low) / entry;
    const adverse = bullish ? (bar.low - entry) / entry : (entry - bar.high) / entry;
    if (favorable > mfe) mfe = favorable;
    if (adverse < mae) mae = adverse;
  }

  const terminalReturn = (exitPrice - entry) / entry;

  // Realized R, sign-aware to the forecast side: +reward:risk on target, ≈ -1 on stop.
  const risk = bullish ? entry - stop : stop - entry;
  const forecastR = risk > 0 ? (bullish ? exitPrice - entry : entry - exitPrice) / risk : null;

  // SPY excess over the same window: stock return minus SPY return from the forecast's benchmark anchor.
  const spyEntry = forecast.benchmarkReferencePrice;
  const spyExit = benchmarkCloseAt(spyBars, resolutionDate);
  let spyExcessReturn: number | null = null;
  if (spyEntry != null && spyEntry > 0 && spyExit != null) {
    spyExcessReturn = terminalReturn - (spyExit - spyEntry) / spyEntry;
  }

  return {
    outcome,
    resolutionDate,
    entryPrice: entry,
    exitPrice,
    terminalReturn,
    spyExcessReturn,
    maxFavorableExcursion: mfe,
    maxAdverseExcursion: mae,
    forecastR,
    warnings,
  };
}
