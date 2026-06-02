import { z } from "zod";
import { Symbol } from "./holding.ts";

/**
 * Forecast resolution (roadmap §5, 3D). A scored forecast resolves to exactly one immutable outcome
 * once its horizon elapses, graded against historical daily high/low bars — not just the final close.
 */

export const OutcomeKind = z.enum([
  "target_hit", // the target was reached before the stop within the horizon
  "stop_hit", // the stop was reached before the target
  "expired", // neither touched by the horizon — resolved at the terminal close
  "ambiguous_touch", // a single daily bar spans both target and stop (excluded from primary calibration)
]);
export type OutcomeKind = z.infer<typeof OutcomeKind>;

export const ForecastOutcome = z.object({
  id: z.string().min(1),
  forecastId: z.string().min(1),
  outcome: OutcomeKind,
  /** When resolution ran (ISO datetime). */
  resolvedAt: z.string().datetime(),
  /** The trading date the outcome occurred / the terminal session (YYYY-MM-DD). */
  resolutionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  ticker: Symbol,
  entryPrice: z.number(),
  exitPrice: z.number(),
  /** The stock's return over the interval (exit vs entry), regardless of forecast direction. */
  terminalReturn: z.number(),
  /** terminalReturn minus SPY's return over the same window (null when SPY data is unavailable). */
  spyExcessReturn: z.number().nullable().default(null),
  /** Largest favorable move (fraction, ≥0) and largest adverse move (fraction, ≤0), in the forecast's direction. */
  maxFavorableExcursion: z.number(),
  maxAdverseExcursion: z.number(),
  /** Realized R-multiple, sign-aware to the forecast side (target_hit > 0, stop_hit = -1). Null if undefined. */
  forecastR: z.number().nullable().default(null),
  barsProvider: z.string(),
  adjustmentPolicyVersion: z.string(),
  resolutionPolicyVersion: z.string(),
  warnings: z.array(z.string()).default([]),
});
export type ForecastOutcome = z.infer<typeof ForecastOutcome>;
