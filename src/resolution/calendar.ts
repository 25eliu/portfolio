/**
 * Minimal US trading-day calendar (v1): weekdays only, no exchange-holiday table yet. Good enough to
 * step forecast horizons forward by trading sessions; holiday awareness can be layered in later
 * without changing callers. Dates are ISO calendar dates (YYYY-MM-DD), handled in UTC.
 */

function parse(date: string): Date {
  return new Date(`${date}T00:00:00.000Z`);
}

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** True for Monday–Friday. Holidays are not yet modeled. */
export function isTradingDay(date: string): boolean {
  const day = parse(date).getUTCDay();
  return day !== 0 && day !== 6;
}

/**
 * The calendar date `sessions` trading days after `fromDate` (exclusive of the start day). A horizon of
 * one session lands on the next trading day; weekends are skipped. `sessions` must be ≥ 1.
 */
export function addTradingSessions(fromDate: string, sessions: number): string {
  let d = parse(fromDate);
  let remaining = Math.max(1, Math.floor(sessions));
  while (remaining > 0) {
    d = new Date(d);
    d.setUTCDate(d.getUTCDate() + 1);
    if (isTradingDay(fmt(d))) remaining--;
  }
  return fmt(d);
}
