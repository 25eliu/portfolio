import {
  ACTIVE_MIN_N,
  PROVISIONAL_MIN_N,
  type LessonState,
  type MetricWindow,
  type WikiLesson,
  type WikiMetric,
} from "../domain/index.ts";

const pct = (x: number | null): string => (x == null ? "n/a" : `${(x * 100).toFixed(1)}%`);
const rmult = (x: number | null): string => (x == null ? "n/a" : `${x.toFixed(2)}R`);
const windowLabel = (w: MetricWindow): string => (w === "all_time" ? "all-time" : "rolling 90d");

/** Human-readable cohort label from a cohort key (e.g. "strategy_family:momentum" → "momentum"). */
export function cohortLabel(cohortKey: string): string {
  if (cohortKey === "overall") return "all";
  const [, ...rest] = cohortKey.split(":");
  return rest.join(":").replace(/_/g, " ");
}

/** Evidence-gated state purely from sample size (roadmap §9): n≥20 active, n≥5 provisional, else draft. */
export function stateForN(n: number): LessonState {
  if (n >= ACTIVE_MIN_N) return "active";
  if (n >= PROVISIONAL_MIN_N) return "provisional";
  return "draft";
}

/**
 * Derive an evidence-backed prose lesson from ONE computed metric. The prose is a deterministic
 * template over the metric's numbers — the system never invents statistics or grades itself from
 * memory. Every lesson carries its sample size, window, and source forecast ids.
 */
export function deriveLesson(m: WikiMetric, opts: { now: string; freshnessDays?: number }): WikiLesson {
  const label = cohortLabel(m.cohortKey);
  const deadline = new Date(new Date(opts.now).getTime() + (opts.freshnessDays ?? 90) * 86_400_000).toISOString();
  const body =
    `Across ${m.n} resolved ${label} forecasts (${windowLabel(m.window)}), the target was reached before ` +
    `the stop ${pct(m.hitRate)} of the time; mean realized ${rmult(m.expectancyR)}, mean return ` +
    `${pct(m.avgTerminalReturn)}, vs SPY ${pct(m.avgSpyExcess)}. Calibration Brier ` +
    `${m.brier != null ? m.brier.toFixed(3) : "n/a"} (n=${m.n}).`;
  return {
    id: m.id,
    title: `${label === "all" ? "Overall" : label} (${windowLabel(m.window)})`,
    body,
    state: stateForN(m.n),
    cohortKind: m.cohortKind,
    cohortKey: m.cohortKey,
    window: m.window,
    n: m.n,
    dateWindowStart: null,
    dateWindowEnd: opts.now.slice(0, 10),
    sourceForecastIds: m.sampleForecastIds,
    freshnessDeadline: deadline,
    metrics: {
      hitRate: m.hitRate, avgConviction: m.avgConviction, expectancyR: m.expectancyR,
      avgTerminalReturn: m.avgTerminalReturn, avgSpyExcess: m.avgSpyExcess, brier: m.brier,
      cohortKind: m.cohortKind, cohortKey: m.cohortKey,
    },
    createdAt: opts.now,
    updatedAt: opts.now,
  };
}

/** Candidate lessons from metrics meeting the provisional floor (n≥5). Sub-threshold cohorts stay silent. */
export function generateLessons(metrics: WikiMetric[], opts: { now: string }): WikiLesson[] {
  return metrics.filter((m) => m.n >= PROVISIONAL_MIN_N).map((m) => deriveLesson(m, opts));
}
