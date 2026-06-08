/** Per-ticker track record: every forecast for a ticker (resolved + still-open) rolled into a record
 *  card and a newest-first call timeline, ordered how-right → how-wrong by average R. Backs the
 *  Performance wiki's "Track record by ticker" section and its journal drill-downs. */

export type OutcomeKind = "target_hit" | "stop_hit" | "expired" | "ambiguous_touch";
export type MarkStatus = "on_track" | "near_target" | "at_risk" | "near_stop";
export type ForecastSide = "bullish" | "bearish";

/** One forecast row joined with its outcome (if resolved) and its latest daily mark (if open). */
export type TickerHistoryRow = {
  forecastId: string;
  journalEntryId: string;
  ticker: string;
  side: ForecastSide;
  createdAt: string;
  resolveAt: string;
  conviction: number;
  entry: number | null;
  target: number;
  stop: number;
  // resolved (null while open)
  outcome: OutcomeKind | null;
  resolutionDate: string | null;
  realizedR: number | null;
  terminalReturn: number | null;
  spyExcess: number | null;
  // latest daily mark (null once resolved or never marked)
  unrealizedR: number | null;
  markStatus: MarkStatus | null;
  markDate: string | null;
};

/** One call in a ticker's timeline — resolved (graded outcome + realized R) or open (live R + status). */
export type TickerCall = {
  forecastId: string;
  journalEntryId: string;
  side: ForecastSide;
  createdAt: string;
  resolveAt: string;
  conviction: number;
  entry: number | null;
  target: number;
  stop: number;
  resolved: boolean;
  outcome: OutcomeKind | null;
  resolutionDate: string | null;
  realizedR: number | null;
  terminalReturn: number | null;
  spyExcess: number | null;
  unrealizedR: number | null;
  status: string | null; // outcome label when resolved, mark status when open
  markDate: string | null;
};

export type TickerHistory = {
  ticker: string;
  total: number;
  open: number;
  resolved: number;
  wins: number; // target_hit count
  losses: number; // stop_hit count
  hitRate: number | null; // wins / graded (resolved excl. ambiguous)
  expectancyR: number | null; // mean realized R over resolved calls that have an R
  avgUnrealizedR: number | null; // mean live R over open calls that have an R
  trackR: number | null; // expectancyR ?? avgUnrealizedR — the headline + sort key
  bull: number;
  bear: number;
  lastActivity: string; // YYYY-MM-DD of most recent activity (resolution, mark, or creation)
  calls: TickerCall[]; // newest-first
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);

/**
 * Group forecast rows by ticker into a per-ticker track record + newest-first call timeline. Tickers
 * are ordered how-right → how-wrong by average R (resolved expectancy, falling back to open avg);
 * tickers with no R yet sink to the bottom, most-recent first.
 */
export function buildTickerHistory(rows: TickerHistoryRow[]): TickerHistory[] {
  const byTicker = new Map<string, TickerHistoryRow[]>();
  for (const r of rows) (byTicker.get(r.ticker) ?? byTicker.set(r.ticker, []).get(r.ticker)!).push(r);

  const out = [...byTicker.entries()].map(([ticker, rs]): TickerHistory => {
    const calls = rs
      .map((r): TickerCall => {
        const resolved = r.outcome != null;
        return {
          forecastId: r.forecastId, journalEntryId: r.journalEntryId, side: r.side,
          createdAt: r.createdAt, resolveAt: r.resolveAt, conviction: r.conviction,
          entry: r.entry, target: r.target, stop: r.stop,
          resolved,
          outcome: r.outcome, resolutionDate: r.resolutionDate, realizedR: r.realizedR,
          terminalReturn: r.terminalReturn, spyExcess: r.spyExcess,
          unrealizedR: resolved ? null : r.unrealizedR,
          status: resolved ? r.outcome : r.markStatus,
          markDate: r.markDate,
        };
      })
      // Newest call first (createdAt is an ISO datetime; lexical compare is chronological).
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));

    const resolvedCalls = calls.filter((c) => c.resolved);
    const openCalls = calls.filter((c) => !c.resolved);
    const graded = resolvedCalls.filter((c) => c.outcome !== "ambiguous_touch");
    const wins = resolvedCalls.filter((c) => c.outcome === "target_hit").length;
    const losses = resolvedCalls.filter((c) => c.outcome === "stop_hit").length;
    const expectancyR = mean(resolvedCalls.map((c) => c.realizedR).filter((r): r is number => r != null));
    const avgUnrealizedR = mean(openCalls.map((c) => c.unrealizedR).filter((r): r is number => r != null));
    const lastActivity = calls.reduce((mx, c) => {
      const t = c.resolutionDate ?? c.markDate ?? c.createdAt.slice(0, 10);
      return t > mx ? t : mx;
    }, "");

    return {
      ticker, total: calls.length, open: openCalls.length, resolved: resolvedCalls.length,
      wins, losses,
      hitRate: graded.length ? wins / graded.length : null,
      expectancyR, avgUnrealizedR,
      trackR: expectancyR ?? avgUnrealizedR,
      bull: calls.filter((c) => c.side === "bullish").length,
      bear: calls.filter((c) => c.side === "bearish").length,
      lastActivity, calls,
    };
  });

  return out.sort((a, b) => {
    if (a.trackR == null && b.trackR == null) return a.lastActivity < b.lastActivity ? 1 : -1;
    if (a.trackR == null) return 1;
    if (b.trackR == null) return -1;
    return b.trackR - a.trackR;
  });
}
