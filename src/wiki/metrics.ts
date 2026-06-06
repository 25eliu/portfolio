import type { CohortKind, MetricWindow, OutcomeKind, WikiMetric } from "../domain/index.ts";

/** One resolved forecast flattened for cohort math (forecast fields joined with its outcome). */
export type ResolvedRow = {
  forecastId: string;
  side: "bullish" | "bearish";
  strategyFamily: string;
  /** GICS sector of the ticker (from the knowledge graph), null when unknown — drives the sector cohort. */
  sector: string | null;
  horizonSessions: number;
  conviction: number;
  createdAt: string; // ISO datetime
  outcome: OutcomeKind;
  terminalReturn: number;
  spyExcessReturn: number | null;
  forecastR: number | null;
};

const mean = (xs: number[]): number | null => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

/** Confidence-bucket label for reliability cohorts: 0.0-0.2 … 0.8-1.0. */
export function confidenceBucket(conviction: number): string {
  const lo = Math.min(0.8, Math.floor(conviction * 5) / 5);
  return `${lo.toFixed(1)}-${(lo + 0.2).toFixed(1)}`;
}

/** A cohort key of `null` means the row doesn't belong to this cohort (e.g. unknown sector) and is skipped. */
type CohortDef = { kind: CohortKind; key: (r: ResolvedRow) => string | null };
const COHORTS: CohortDef[] = [
  { kind: "overall", key: () => "overall" },
  { kind: "strategy_family", key: (r) => `strategy_family:${r.strategyFamily}` },
  { kind: "side", key: (r) => `side:${r.side}` },
  // Sector cohort powers graph-propagated calibration: overconfidence learned on a sector flows to its
  // tickers. Rows whose ticker has no sector node yet contribute nothing (null key) — self-healing.
  { kind: "sector", key: (r) => (r.sector ? `sector:${r.sector}` : null) },
  { kind: "confidence_bucket", key: (r) => `confidence_bucket:${confidenceBucket(r.conviction)}` },
  { kind: "horizon", key: (r) => `horizon:${r.horizonSessions}` },
];

const WINDOW_DAYS: Record<MetricWindow, number | null> = { all_time: null, rolling_90d: 90 };

function inWindow(row: ResolvedRow, window: MetricWindow, nowMs: number): boolean {
  const days = WINDOW_DAYS[window];
  if (days == null) return true;
  return nowMs - new Date(row.createdAt).getTime() <= days * 86_400_000;
}

/**
 * Compute deterministic cohort metrics from resolved outcomes. `ambiguous_touch` outcomes are excluded
 * from the calibration sample (roadmap §5) but inform coverage. The binary calibration event is
 * target-hit; Brier compares stated conviction to that event. Pure and IO-free.
 */
export function computeMetrics(
  rows: ResolvedRow[],
  opts: { nowMs: number; resolutionPolicyVersion: string; computedAt: string },
): WikiMetric[] {
  const out: WikiMetric[] = [];
  for (const window of ["all_time", "rolling_90d"] as MetricWindow[]) {
    const windowed = rows.filter((r) => inWindow(r, window, opts.nowMs));
    for (const cohort of COHORTS) {
      const groups = new Map<string, ResolvedRow[]>();
      for (const r of windowed) {
        const k = cohort.key(r);
        if (k == null) continue; // row doesn't belong to this cohort (e.g. unknown sector)
        (groups.get(k) ?? groups.set(k, []).get(k)!).push(r);
      }
      for (const [cohortKey, all] of groups) {
        // Primary sample excludes ambiguous touches; coverage tracks how much of the cohort that is.
        const primary = all.filter((r) => r.outcome !== "ambiguous_touch");
        if (primary.length === 0) continue;
        const success = primary.map((r) => (r.outcome === "target_hit" ? 1 : 0));
        out.push({
          id: `${window}:${cohortKey}`,
          cohortKind: cohort.kind,
          cohortKey,
          window,
          n: primary.length,
          hitRate: mean(success),
          avgConviction: mean(primary.map((r) => r.conviction)),
          expectancyR: mean(primary.map((r) => r.forecastR).filter((x): x is number => x != null)),
          avgTerminalReturn: mean(primary.map((r) => r.terminalReturn)),
          avgSpyExcess: mean(primary.map((r) => r.spyExcessReturn).filter((x): x is number => x != null)),
          brier: mean(primary.map((r, i) => (r.conviction - success[i]!) ** 2)),
          coverage: null, // filled for the overall cohort by the orchestrator (resolved / scored)
          sampleForecastIds: primary.map((r) => r.forecastId),
          computedAt: opts.computedAt,
          resolutionPolicyVersion: opts.resolutionPolicyVersion,
        });
      }
    }
  }
  return out;
}
