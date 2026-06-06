import type { Snapshot } from "../api/types.ts";

/**
 * Running time-weighted return (%) at each snapshot — the cumulative curve whose last point is the
 * portfolio's actual P&L since tracking began (not its balance growth). Each step credits only the
 * price change on shares already held at the step's start, so depositing cash, adding a position, or
 * swapping holdings never registers as performance (those are contributions, not gains).
 *
 * The first point is always 0% (the baseline), so plotting this rebases the series to whatever
 * window it was sliced to. Returns `[]` for an empty input. `steps` counts how many transitions had
 * a priced, non-empty starting basis — used by `timeWeightedReturn` to decide when there's nothing
 * to measure.
 */
function cumulativeReturn(snaps: Snapshot[]): {
  series: { date: string; value: number }[];
  steps: number;
} {
  if (snaps.length === 0) return { series: [], steps: 0 };

  const series = [{ date: snaps[0]!.date, value: 0 }];
  let growth = 1;
  let steps = 0;
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1]!;
    const cur = snaps[i]!;
    const startValue = prev.positions.reduce((sum, p) => sum + p.marketValue, 0);
    if (startValue > 0) {
      // P&L on shares held going in, repriced at this step's close. Names added or dropped
      // mid-step contribute nothing — only continuously-held shares move the return.
      const priceNow = new Map(cur.positions.map((p) => [p.symbol, p.price]));
      let stepPnL = 0;
      for (const p of prev.positions) {
        const now = priceNow.get(p.symbol);
        if (now != null) stepPnL += p.shares * (now - p.price);
      }
      growth *= 1 + stepPnL / startValue;
      steps++;
    }
    series.push({ date: cur.date, value: (growth - 1) * 100 });
  }

  return { series, steps };
}

/**
 * Cumulative time-weighted return (%) at each snapshot date, starting at 0% on the first date.
 * Plot this to compare portfolios on one rebased axis (see {@link timeWeightedReturn} for the
 * contribution-neutral semantics). Empty input → `[]`.
 */
export function cumulativeReturnSeries(snaps: Snapshot[]): { date: string; value: number }[] {
  return cumulativeReturn(snaps).series;
}

/**
 * Time-weighted return (%) across the given snapshots — the last point of {@link cumulativeReturnSeries}.
 * Returns null when there aren't two snapshots with a priced, non-empty starting basis.
 */
export function timeWeightedReturn(snaps: Snapshot[]): number | null {
  const { series, steps } = cumulativeReturn(snaps);
  return steps > 0 ? series[series.length - 1]!.value : null;
}
