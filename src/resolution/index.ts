import type { App } from "../app.ts";
import type { Env } from "../config/env.ts";
import type { Bar } from "../market/types.ts";
import { newId } from "../domain/index.ts";
import { createFakeBarsProvider } from "./fake.ts";
import { createAlpacaBarsProvider } from "./alpaca.ts";
import { resolveForecast, RESOLUTION_POLICY_VERSION } from "./resolve.ts";
import type { HistoricalBarsProvider } from "./provider.ts";

export type { HistoricalBarsProvider } from "./provider.ts";
export { resolveForecast, RESOLUTION_POLICY_VERSION } from "./resolve.ts";
export { addTradingSessions, isTradingDay } from "./calendar.ts";

/** Pick the historical-bars provider for the selected market adapter (fake by default). */
export function createBarsProvider(env: Env): HistoricalBarsProvider {
  return env.MARKET_ADAPTER === "alpaca" ? createAlpacaBarsProvider(env) : createFakeBarsProvider();
}

const dateOf = (ts: string): string => ts.slice(0, 10);

/**
 * Resolve every scored forecast whose horizon has elapsed and that has no outcome yet. Runs before new
 * analysis in dailyRun. Degrades gracefully: a per-symbol data failure logs and is retried next run,
 * never aborting the daily report. Outcomes are immutable — a forecast already resolved is skipped.
 */
export async function resolveDueForecasts(app: App): Promise<{ resolved: number; skipped: number }> {
  const date = app.now();
  const due = app.repos.scoredForecasts.listDueForResolution(date);
  if (due.length === 0) return { resolved: 0, skipped: 0 };

  const provider = app.barsProvider;
  // SPY benchmark series across the full span the due forecasts cover (fetched once).
  const earliest = due.reduce((min, f) => (dateOf(f.asOfTimestamp) < min ? dateOf(f.asOfTimestamp) : min), date);
  let spyBars: Bar[] = [];
  try {
    spyBars = await provider.getDailyBars("SPY", earliest, date);
  } catch (err) {
    console.warn(`[resolution] SPY bars unavailable: ${err instanceof Error ? err.message : String(err)}`);
  }

  let resolved = 0;
  let skipped = 0;
  for (const f of due) {
    try {
      const bars = await provider.getDailyBars(f.ticker, dateOf(f.asOfTimestamp), f.resolveAt);
      const result = resolveForecast(f, bars, spyBars);
      if (!result) {
        skipped++;
        continue;
      }
      app.repos.forecastOutcomes.insert({
        id: newId(),
        forecastId: f.id,
        ticker: f.ticker,
        outcome: result.outcome,
        resolvedAt: new Date().toISOString(),
        resolutionDate: result.resolutionDate,
        entryPrice: result.entryPrice,
        exitPrice: result.exitPrice,
        terminalReturn: result.terminalReturn,
        spyExcessReturn: result.spyExcessReturn,
        maxFavorableExcursion: result.maxFavorableExcursion,
        maxAdverseExcursion: result.maxAdverseExcursion,
        forecastR: result.forecastR,
        barsProvider: provider.name,
        adjustmentPolicyVersion: provider.adjustmentPolicyVersion,
        resolutionPolicyVersion: RESOLUTION_POLICY_VERSION,
        warnings: result.warnings,
      });
      resolved++;
    } catch (err) {
      console.warn(`[resolution] ${f.ticker} failed: ${err instanceof Error ? err.message : String(err)}`);
      skipped++;
    }
  }
  return { resolved, skipped };
}
