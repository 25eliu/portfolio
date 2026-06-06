/**
 * Deterministic portfolio risk/performance analytics (Phase 6) computed from an equity time series —
 * the same snapshots the dashboard already stores. Pure and IO-free so it unit-tests cleanly and can be
 * surfaced anywhere (API, wiki, UI). Annualization assumes the series is per-trading-day (252/yr).
 */

const TRADING_DAYS = 252;
/** Min daily returns before annualized vol / Sharpe / beta are meaningful (~1 month). Below this they'd
 *  be dominated by noise and read as absurd (e.g. 2000%+ vol on 4 points), so they're reported as null. */
const MIN_SAMPLE = 20;
const round = (n: number, d = 4) => Math.round(n * 10 ** d) / 10 ** d;

export type EquityPoint = { date: string; value: number };

export type PerformanceMetrics = {
  /** Periods (returns) the metrics are computed over. */
  n: number;
  /** Cumulative return over the window, as a fraction (0.12 = +12%). */
  totalReturn: number;
  /** Return annualized from the window length, as a fraction. */
  annualizedReturn: number | null;
  /** Annualized standard deviation of daily returns, as a fraction. */
  annualizedVolatility: number | null;
  /** Annualized Sharpe ratio (risk-free = 0). Null when volatility is zero/undefined. */
  sharpe: number | null;
  /** Worst peak-to-trough decline over the window, as a positive fraction (0.2 = -20% drawdown). */
  maxDrawdown: number;
  /** Decline from the running peak at the last point, as a positive fraction (0 = at a high). */
  currentDrawdown: number;
  /** vs benchmark (when provided), over the overlapping dates: */
  excessReturn: number | null;
  beta: number | null;
};

function dailyReturns(values: number[]): number[] {
  const r: number[] = [];
  for (let i = 1; i < values.length; i++) {
    if (values[i - 1]! > 0) r.push(values[i]! / values[i - 1]! - 1);
  }
  return r;
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Sample standard deviation (n-1); 0 for <2 points. */
function stdevSample(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** Worst peak-to-trough decline (positive fraction) over the series. */
export function maxDrawdown(values: number[]): number {
  let peak = -Infinity;
  let worst = 0;
  for (const v of values) {
    if (v > peak) peak = v;
    if (peak > 0) worst = Math.max(worst, (peak - v) / peak);
  }
  return round(worst);
}

/** Decline from the running peak at the final point (0 when at an all-time high). */
export function currentDrawdown(values: number[]): number {
  const peak = Math.max(...values);
  const last = values.at(-1)!;
  return peak > 0 ? round(Math.max(0, (peak - last) / peak)) : 0;
}

export function computePerformanceMetrics(equity: EquityPoint[], benchmark: EquityPoint[] = []): PerformanceMetrics | null {
  if (equity.length < 2) return null;
  const values = equity.map((p) => p.value);
  const returns = dailyReturns(values);
  const totalReturn = values[0]! > 0 ? values.at(-1)! / values[0]! - 1 : 0;
  const n = returns.length;

  const enough = n >= MIN_SAMPLE;
  const annualizedReturn = enough ? round((1 + totalReturn) ** (TRADING_DAYS / n) - 1) : null;
  const sd = stdevSample(returns);
  const annualizedVolatility = enough ? round(sd * Math.sqrt(TRADING_DAYS)) : null;
  const sharpe = enough && sd > 0 ? round((mean(returns) / sd) * Math.sqrt(TRADING_DAYS), 2) : null;

  // vs benchmark over the overlapping dates (date-aligned, returns-based).
  let excessReturn: number | null = null;
  let beta: number | null = null;
  if (benchmark.length >= 2) {
    const benchByDate = new Map(benchmark.map((p) => [p.date, p.value]));
    const pairs = equity.filter((p) => benchByDate.has(p.date)).map((p) => ({ t: p.value, b: benchByDate.get(p.date)! }));
    if (pairs.length >= 2) {
      const tr: number[] = [], br: number[] = [];
      for (let i = 1; i < pairs.length; i++) {
        if (pairs[i - 1]!.t > 0 && pairs[i - 1]!.b > 0) {
          tr.push(pairs[i]!.t / pairs[i - 1]!.t - 1);
          br.push(pairs[i]!.b / pairs[i - 1]!.b - 1);
        }
      }
      const benchTotal = pairs[0]!.b > 0 ? pairs.at(-1)!.b / pairs[0]!.b - 1 : 0;
      const portTotal = pairs[0]!.t > 0 ? pairs.at(-1)!.t / pairs[0]!.t - 1 : 0;
      excessReturn = round(portTotal - benchTotal);
      if (br.length >= MIN_SAMPLE) {
        const mt = mean(tr), mb = mean(br);
        let cov = 0, varB = 0;
        for (let i = 0; i < br.length; i++) { cov += (tr[i]! - mt) * (br[i]! - mb); varB += (br[i]! - mb) ** 2; }
        beta = varB > 0 ? round(cov / varB, 2) : null;
      }
    }
  }

  return {
    n,
    totalReturn: round(totalReturn),
    annualizedReturn,
    annualizedVolatility,
    sharpe,
    maxDrawdown: maxDrawdown(values),
    currentDrawdown: currentDrawdown(values),
    excessReturn,
    beta,
  };
}
