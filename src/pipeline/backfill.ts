import type { App } from "../app.ts";

/**
 * One-time anchor for holdings that were added before entry tracking existed: treat them as bought
 * at the open on this date. Chosen with the user (their positions were entered around this date).
 */
const BACKFILL_DATE = "2026-06-01";

/**
 * Stamp a cost basis + buy date on any My-Portfolio holding still missing one, so Total P&L stops
 * reading $0. Uses each symbol's open on {@link BACKFILL_DATE} (from daily bars); falls back to the
 * nearest earlier bar, then to the current quote. Idempotent: a holding is only ever stamped once
 * (`recordEntry` no-ops when a cost basis already exists), and the whole pass returns immediately
 * once nothing is untracked — cheap to call on every portfolio fetch.
 */
export async function backfillUntrackedEntries(app: App): Promise<number> {
  const untracked = app.repos.holdings.listByPortfolio(app.user.id).filter((h) => h.costBasis == null);
  if (untracked.length === 0) return 0;

  let stamped = 0;
  for (const h of untracked) {
    try {
      const bars = await app.gateway.getBars(h.symbol, 14);
      const onDate = bars.find((b) => b.date === BACKFILL_DATE);
      const nearest = [...bars].reverse().find((b) => b.date <= BACKFILL_DATE);
      const price = onDate?.open ?? nearest?.open ?? (await app.gateway.getQuote(h.symbol)).price;
      if (app.repos.holdings.recordEntry(h.id, Math.round(price * 100) / 100, BACKFILL_DATE)) stamped++;
    } catch (err) {
      console.warn(`[backfill] ${h.symbol} skipped: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  if (stamped > 0) console.log(`[backfill] stamped ${stamped} holding(s) as acquired ${BACKFILL_DATE}`);
  return stamped;
}
