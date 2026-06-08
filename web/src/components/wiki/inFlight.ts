import type { InFlightCall } from "../../api/client.ts";

// In-flight call status → semantic tone + worst-first severity rank (lower = needs attention sooner).
export const CALL_TONE: Record<string, "neg" | "warn" | "accent" | "pos" | "neutral"> = {
  near_stop: "neg", at_risk: "warn", near_target: "accent", on_track: "pos",
};
export const CALL_SEVERITY: Record<string, number> = { near_stop: 0, at_risk: 1, near_target: 2, on_track: 3 };

// Attention-first order for composite status summaries ("1 near stop · 8 on track").
export const STATUS_ORDER = ["near_stop", "at_risk", "near_target", "on_track"] as const;
export type CallStatus = (typeof STATUS_ORDER)[number];
export const STATUS_LABEL: Record<CallStatus, string> = {
  near_stop: "near stop", at_risk: "at risk", near_target: "near target", on_track: "on track",
};

export type StatusCount = { status: CallStatus; n: number };

export type InFlightGroup = {
  key: string;
  ticker: string;
  side: string | null;
  count: number;
  netR: number | null; // average CURRENT unrealized R across the group's bets — the book's standing
  worstR: number | null; // most-negative current R — the risk chip
  worstStatus: string; // worst status across bets — drives the composite badge tone
  statusCounts: StatusCount[]; // attention-ordered, only non-zero buckets
  calls: InFlightCall[]; // members ordered by resolve deadline (soonest first) so dates read in order
};

/** Sort by resolve deadline ascending; YYYY-MM-DD compares lexically. Nulls sort last. */
function byResolveAsc(a: InFlightCall, b: InFlightCall): number {
  if (a.resolveBy == null && b.resolveBy == null) return 0;
  if (a.resolveBy == null) return 1;
  if (b.resolveBy == null) return -1;
  return a.resolveBy < b.resolveBy ? -1 : a.resolveBy > b.resolveBy ? 1 : 0;
}

/**
 * Collapse calls into ticker+direction groups so repeated bets on one thesis (concentration) surface
 * as one row. The headline is the net (average) CURRENT R — the book's real standing — with the worst R
 * and a composite status describing the spread, so a net-positive book no longer flashes a lone red
 * `near_stop`. Members are ordered by resolve deadline (soonest first) so the per-bet dates read in order.
 * Groups are ordered by net R descending — how-right to how-wrong on average — so the best-performing
 * theses sit on top and the ones bleeding the most fall to the bottom.
 */
export function groupCalls(calls: InFlightCall[]): InFlightGroup[] {
  const map = new Map<string, InFlightCall[]>();
  for (const c of calls) {
    const key = `${c.ticker}|${c.side ?? ""}`;
    (map.get(key) ?? map.set(key, []).get(key)!).push(c);
  }
  const groups = [...map.entries()].map(([key, members]): InFlightGroup => {
    const sorted = [...members].sort(byResolveAsc);
    const rs = members.map((m) => m.unrealizedR).filter((r): r is number => r != null);
    const worstStatus = members.reduce(
      (w, m) => ((CALL_SEVERITY[m.status] ?? 9) < (CALL_SEVERITY[w] ?? 9) ? m.status : w),
      members[0]!.status,
    );
    const statusCounts = STATUS_ORDER.map((status) => ({
      status,
      n: members.filter((m) => m.status === status).length,
    })).filter((s): s is StatusCount => s.n > 0);
    return {
      key, ticker: members[0]!.ticker, side: members[0]!.side, count: members.length,
      netR: rs.length ? rs.reduce((s, r) => s + r, 0) / rs.length : null,
      worstR: rs.length ? Math.min(...rs) : null,
      worstStatus, statusCounts, calls: sorted,
    };
  });
  // How-right → how-wrong: highest average current R first, deepest-negative last. Groups with no R
  // yet (null) sort to the bottom; ties break by deepest-negative worst R so riskier ties rank lower.
  return groups.sort((a, b) => {
    if (a.netR == null && b.netR == null) return 0;
    if (a.netR == null) return 1;
    if (b.netR == null) return -1;
    return b.netR - a.netR || (a.worstR ?? 0) - (b.worstR ?? 0);
  });
}
