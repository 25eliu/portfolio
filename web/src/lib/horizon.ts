/**
 * Shared time-horizon model for the equity curve and the You-vs-AI-vs-SPY returns, so both
 * respond to the same selector. A "return" here is the % change of a dated series over the
 * selected window (first → last point), which is why it moves when the horizon changes.
 */
export type HorizonKey = "1W" | "1M" | "3M" | "1Y" | "All";

export const HORIZONS: { key: HorizonKey; days: number }[] = [
  { key: "1W", days: 7 },
  { key: "1M", days: 31 },
  { key: "3M", days: 92 },
  { key: "1Y", days: 366 },
  { key: "All", days: Infinity },
];

export const horizonDays = (key: HorizonKey): number =>
  HORIZONS.find((h) => h.key === key)?.days ?? Infinity;

/** Most recent date across several dated row-sets, or null if all are empty. */
export function latestDate(...sets: { date: string }[][]): string | null {
  let max: string | null = null;
  for (const set of sets) for (const r of set) if (max == null || r.date > max) max = r.date;
  return max;
}

const DAY_MS = 86_400_000;

/** Rows whose date falls within `days` of `ref` (inclusive). `Infinity` keeps everything. */
export function withinHorizon<T extends { date: string }>(
  rows: T[],
  days: number,
  ref: string | null,
): T[] {
  if (days === Infinity || ref == null) return rows;
  const cutoff = Date.parse(ref) - days * DAY_MS;
  return rows.filter((r) => Date.parse(r.date) >= cutoff);
}

/** % change from the first to the last value in the series, or null if too few / invalid points. */
export function periodReturn(values: number[]): number | null {
  if (values.length < 2) return null;
  const first = values[0];
  const last = values[values.length - 1];
  if (first == null || first <= 0 || last == null) return null;
  return (last / first - 1) * 100;
}
