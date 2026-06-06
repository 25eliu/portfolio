import { z } from "zod";

/**
 * Performance wiki (roadmap §9). Deterministic cohort metrics from resolved outcomes, evidence-gated
 * prose lessons compiled strictly from those metrics, and dated briefings injected into future
 * analysis. The calibration event is binary and explicit: target reached before stop within horizon.
 */

export const CohortKind = z.enum(["overall", "strategy_family", "side", "sector", "horizon", "confidence_bucket"]);
export type CohortKind = z.infer<typeof CohortKind>;

export const MetricWindow = z.enum(["all_time", "rolling_90d"]);
export type MetricWindow = z.infer<typeof MetricWindow>;

export const WikiMetric = z.object({
  id: z.string().min(1),
  cohortKind: CohortKind,
  cohortKey: z.string(),
  window: MetricWindow,
  /** Resolved, non-ambiguous forecasts in the cohort (the calibration sample). */
  n: z.number().int().nonnegative(),
  /** P(target hit before stop) over the sample. */
  hitRate: z.number().nullable().default(null),
  /** Mean stated conviction over the sample — compared to hitRate, this is the calibration gap. */
  avgConviction: z.number().nullable().default(null),
  /** Mean realized R-multiple (expectancy). */
  expectancyR: z.number().nullable().default(null),
  avgTerminalReturn: z.number().nullable().default(null),
  avgSpyExcess: z.number().nullable().default(null),
  /** Brier score on the binary target-before-stop event vs stated conviction (lower is better). */
  brier: z.number().nullable().default(null),
  /** Fraction of the cohort's scored forecasts that have resolved. */
  coverage: z.number().nullable().default(null),
  sampleForecastIds: z.array(z.string()).default([]),
  computedAt: z.string().datetime(),
  resolutionPolicyVersion: z.string(),
});
export type WikiMetric = z.infer<typeof WikiMetric>;

export const LessonState = z.enum(["draft", "provisional", "active", "superseded", "expired", "rejected"]);
export type LessonState = z.infer<typeof LessonState>;

export const WikiLesson = z.object({
  id: z.string().min(1),
  title: z.string(),
  body: z.string(),
  state: LessonState,
  cohortKind: CohortKind,
  cohortKey: z.string(),
  window: MetricWindow,
  n: z.number().int().nonnegative(),
  dateWindowStart: z.string().nullable().default(null),
  dateWindowEnd: z.string().nullable().default(null),
  sourceForecastIds: z.array(z.string()).default([]),
  freshnessDeadline: z.string().nullable().default(null),
  metrics: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type WikiLesson = z.infer<typeof WikiLesson>;

export const Briefing = z.object({
  id: z.string().min(1),
  date: z.string(),
  body: z.string(),
  includedLessonIds: z.array(z.string()).default([]),
  includedMetricIds: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
});
export type Briefing = z.infer<typeof Briefing>;

/** Evidence-gated lifecycle thresholds (roadmap §9). */
export const PROVISIONAL_MIN_N = 5;
export const ACTIVE_MIN_N = 20;
