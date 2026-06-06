import type { App } from "../app.ts";

/** `isoDate` (YYYY-MM-DD) shifted back by `days`, as YYYY-MM-DD. */
function isoDaysBefore(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

/**
 * The AI's carried-forward thesis tickers: names it still has a live forecast on (open, unresolved)
 * plus names it recently rated BUY/ADD/WATCH within the lookback window. This is what makes the AI's
 * focus grow from its own research instead of a brute-force daily scan. Deduped, newest-first,
 * capped to MAX_AI_THESIS. Degrades to [] on any error — a missing thesis layer never aborts a run.
 */
export function collectAiThesisTickers(app: App): string[] {
  const cap = app.env.MAX_AI_THESIS;
  if (cap <= 0) return [];
  try {
    const asOf = app.now();
    const since = isoDaysBefore(asOf, app.env.AI_THESIS_LOOKBACK_DAYS);
    const open = app.repos.scoredForecasts.listOpen(asOf, cap).map((f) => f.ticker);
    const recent = app.repos.journalEntries.recentActionableTickers(since, cap);
    const seen = new Set<string>();
    const out: string[] = [];
    for (const t of [...open, ...recent]) {
      if (seen.has(t)) continue;
      seen.add(t);
      out.push(t);
      if (out.length >= cap) break;
    }
    return out;
  } catch (err) {
    console.warn(`[ai-universe] thesis collection failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}
