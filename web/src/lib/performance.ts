import type { Snapshot } from "../api/types.ts";

/**
 * Time-weighted return (%) across the given snapshots — the portfolio's actual P&L since tracking
 * began, not its balance growth. Each step credits only the price change on shares already held at
 * the step's start, so depositing cash, adding a position, or swapping holdings never registers as
 * performance (those are contributions, not gains). Needs no cost-basis input.
 *
 * Returns null when there aren't two snapshots with a priced, non-empty starting basis.
 */
export function timeWeightedReturn(snaps: Snapshot[]): number | null {
  if (snaps.length < 2) return null;

  let growth = 1;
  let steps = 0;
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1]!;
    const cur = snaps[i]!;
    const startValue = prev.positions.reduce((sum, p) => sum + p.marketValue, 0);
    if (startValue <= 0) continue; // nothing held at the start of this step

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

  return steps > 0 ? (growth - 1) * 100 : null;
}
