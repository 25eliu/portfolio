import type { Bar } from "../market/types.ts";

/**
 * Historical daily bars over an explicit date range, split- and dividend-adjusted, for forecast
 * resolution. Deliberately separate from the live `MarketData.getBars` (which takes a lookback and is
 * used for technicals): resolution needs an exact `[start, end]` window, corporate-action adjustment,
 * and pagination across long ranges. Adapters own the adjustment policy and stamp its version.
 */
export interface HistoricalBarsProvider {
  /** A short label recorded on every outcome for provenance (e.g. "alpaca", "fake"). */
  readonly name: string;
  /** The corporate-action adjustment policy version this provider applies (e.g. "all-v1"). */
  readonly adjustmentPolicyVersion: string;
  /** Daily bars with date in [start, end] inclusive (ISO calendar dates). Trading days only. */
  getDailyBars(symbol: string, start: string, end: string): Promise<Bar[]>;
}
