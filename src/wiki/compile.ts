import type { WikiLesson } from "../domain/index.ts";
import { cohortLabel } from "./lessons.ts";

/** Max cohort rows folded into one briefing — keep the injected context compact (roadmap §9). */
export const BRIEFING_MAX_ROWS = 14;

/** Cohorts that carry decision signal in the prompt. Confidence-bucket / horizon cohorts are dropped
 *  from the briefing (the conv%-vs-hit% gap already conveys calibration) but stay queryable via the
 *  metrics API and the graph. */
const BRIEFING_COHORTS = new Set(["overall", "strategy_family", "side"]);

const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
const pctInt = (v: unknown): string => {
  const x = num(v);
  return x == null ? "—" : `${Math.round(x * 100)}`;
};
const r2 = (v: unknown): string => {
  const x = num(v);
  return x == null ? "—" : x.toFixed(2);
};

/** Material divergence between two windows of the same cohort: hit-rate gap ≥15pts or expectancy sign flip. */
function diverges(a: WikiLesson["metrics"], b: WikiLesson["metrics"]): boolean {
  const ah = num(a.hitRate);
  const bh = num(b.hitRate);
  if (ah != null && bh != null && Math.abs(ah - bh) >= 0.15) return true;
  const ae = num(a.expectancyR);
  const be = num(b.expectancyR);
  return ae != null && be != null && ae !== 0 && be !== 0 && Math.sign(ae) !== Math.sign(be);
}

const row = (label: string, l: WikiLesson): string =>
  `${label} | ${l.n} | ${pctInt(l.metrics.hitRate)} | ${r2(l.metrics.expectancyR)} | ` +
  `${pctInt(l.metrics.avgConviction)} | ${pctInt(l.metrics.avgSpyExcess)} | ${r2(l.metrics.brier)}`;

/**
 * Compile active + provisional lessons into a COMPACT TABLE briefing — the trusted, computed context
 * injected into analysis. One header names the metrics once; one dense row per decision-relevant
 * cohort. Redundancy is stripped: confidence-bucket/horizon cohorts are dropped, and the rolling-90d
 * row for a cohort is emitted only when it diverges materially from all-time. The conv% column
 * (mean stated conviction) sits beside hit% so the calibration gap is visible at a glance.
 */
export function compileBriefing(
  lessons: WikiLesson[],
  opts: { date: string },
): { body: string; lessonIds: string[] } {
  const usable = lessons.filter(
    (l) => (l.state === "active" || l.state === "provisional") && BRIEFING_COHORTS.has(l.cohortKind),
  );
  if (usable.length === 0) return { body: "", lessonIds: [] };

  // Group by cohort so the two windows sit together and we can drop a redundant rolling row.
  const byCohort = new Map<string, { allTime?: WikiLesson; rolling?: WikiLesson }>();
  for (const l of usable) {
    const g = byCohort.get(l.cohortKey) ?? {};
    if (l.window === "all_time") g.allTime = l;
    else g.rolling = l;
    byCohort.set(l.cohortKey, g);
  }

  // Order: overall, then strategy families (largest sample first), then side.
  const kindRank = (k: string) => (k === "overall" ? 0 : k === "strategy_family" ? 1 : 2);
  const ordered = [...byCohort.entries()]
    .map(([key, g]) => ({ key, base: g.allTime ?? g.rolling!, rolling: g.rolling, g }))
    .sort((a, b) => kindRank(a.base.cohortKind) - kindRank(b.base.cohortKind) || b.base.n - a.base.n);

  const lines: string[] = [];
  const lessonIds: string[] = [];
  for (const { base, rolling, g } of ordered) {
    if (lines.length >= BRIEFING_MAX_ROWS) break;
    const label = base.cohortKey === "overall" ? "overall" : cohortLabel(base.cohortKey);
    lines.push(row(label, base));
    lessonIds.push(base.id);
    // Only show the 90-day window when it tells a different story than all-time.
    if (g.allTime && rolling && rolling !== g.allTime && diverges(g.allTime.metrics, rolling.metrics)) {
      lines.push(row(`${label} (90d)`, rolling));
      lessonIds.push(rolling.id);
    }
  }

  const body = [
    `PERFORMANCE WIKI (compiled ${opts.date}) — calibrated stats of this system's own resolved calls, not predictions.`,
    `Use to calibrate conviction and size positions. Columns: cohort | n | hit% | expR | conv% | vsSPY% | Brier`,
    `(hit% = target-before-stop rate; conv% = mean stated conviction — the gap is calibration; expR = mean realized R; Brier lower=better.)`,
    ...lines,
  ].join("\n");
  return { body, lessonIds };
}
