import type { Calibration, CalibrationAdjustment, WikiMetric } from "../domain/index.ts";

/**
 * Graph-propagated conviction calibration (Decision Engine v2).
 *
 * The model emits a raw conviction; this turns the performance wiki's measured track record into a
 * deterministic, auditable adjustment instead of advisory prose. Calibration is empirical-Bayes
 * SHRINKAGE along the ticker's knowledge-graph cohorts — its sector, its strategy family, and the
 * global prior — so a learning measured on one cohort (e.g. the system is overconfident on
 * Semiconductors) propagates to a ticker in that sector that has little history of its own.
 *
 * Two invariants:
 *  - DAMPEN-ONLY. The factor is ≤ 1 and floored gently (never below {@link CALIBRATION_FLOOR}); it
 *    nudges sizing, never manufactures confidence the model didn't have.
 *  - It NEVER mutates stated conviction. The caller stores the result as a separate
 *    `calibratedConviction`; the wiki keeps measuring stated-vs-realized, so the loop can't self-eat.
 *
 * Per-ticker history is intentionally NOT a separate term: per-ticker samples are tiny and noisy, which
 * is exactly why shrinkage borrows from the sector/strategy groups instead. Themes are deferred.
 */

export type CalibrationRegime = "risk_on" | "neutral" | "risk_off" | null;

export type CalibrateInput = {
  /** The model's raw, stated conviction (0..1) — never mutated. */
  stated: number;
  strategyFamily: string;
  /** The ticker's GICS sector (from the graph), null when unknown. */
  sector: string | null;
  /** All wiki metrics; only all_time cohorts the ticker belongs to are read. */
  metrics: WikiMetric[];
  regime?: CalibrationRegime;
};

export type CalibrationResult = Calibration & { calibrated: number };

/** Resolved, non-ambiguous trades a cohort needs to earn half-weight (shrinkage smoothing). */
const SHRINKAGE_K = 20;
/** Graph-proximity weight per cohort kind — own-sector/own-strategy outrank the global prior. */
const PROXIMITY: Record<string, number> = { sector: 0.7, strategy_family: 0.7, overall: 0.3 };
/** Cap on the aggregated overconfidence signal so a single extreme cohort can't dominate. */
const MAX_OVERCONFIDENCE = 0.4;
/** How hard aggregated overconfidence dampens conviction (≤ LAMBDA·MAX from this term). */
const LAMBDA = 0.5;
/** Extra overconfidence credited to a cohort with negative realized expectancy. */
const EXPECTANCY_PENALTY = 0.1;
/** Gentle regime brake applied in a risk-off tape. */
const RISK_OFF_FACTOR = 0.9;
/** The gentlest total factor — calibration can shave at most 25% off conviction. */
export const CALIBRATION_FLOOR = 0.75;

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** The cohort keys (all_time) a ticker belongs to, in graph-proximity order. */
function candidateKeys(strategyFamily: string, sector: string | null): { kind: string; key: string }[] {
  const out: { kind: string; key: string }[] = [];
  if (sector) out.push({ kind: "sector", key: `sector:${sector}` });
  out.push({ kind: "strategy_family", key: `strategy_family:${strategyFamily}` });
  out.push({ kind: "overall", key: "overall" });
  return out;
}

export function calibrateConviction(input: CalibrateInput): CalibrationResult {
  const { stated, strategyFamily, sector, metrics, regime = null } = input;
  const allTime = new Map(metrics.filter((m) => m.window === "all_time").map((m) => [m.cohortKey, m]));

  // Gather each cohort's overconfidence signal and shrinkage×proximity weight.
  const raw: { adj: CalibrationAdjustment; rawWeight: number }[] = [];
  for (const { kind, key } of candidateKeys(strategyFamily, sector)) {
    const m = allTime.get(key);
    if (!m || m.n <= 0 || m.hitRate == null || m.avgConviction == null) continue;
    let o = m.avgConviction - m.hitRate; // positive ⇒ historically too sure here
    if (m.expectancyR != null && m.expectancyR < 0) o += EXPECTANCY_PENALTY;
    const shrink = m.n / (m.n + SHRINKAGE_K);
    const rawWeight = shrink * (PROXIMITY[kind] ?? 0.3);
    raw.push({ adj: { cohortKind: kind, cohortKey: key, n: m.n, overconfidence: o, weight: rawWeight }, rawWeight });
  }

  const totalWeight = raw.reduce((a, x) => a + x.rawWeight, 0);
  // Weighted-average overconfidence, clamped to [0, MAX]; no boosts (dampen-only).
  const aggregate = totalWeight > 0 ? clamp(raw.reduce((a, x) => a + x.rawWeight * x.adj.overconfidence, 0) / totalWeight, 0, MAX_OVERCONFIDENCE) : 0;
  const overconfFactor = 1 - LAMBDA * aggregate;
  const regimeFactor = regime === "risk_off" ? RISK_OFF_FACTOR : 1;
  const factor = clamp(overconfFactor * regimeFactor, CALIBRATION_FLOOR, 1);

  // Normalize weights to shares for the persisted, human-readable chain.
  const adjustments = raw.map((x) => ({ ...x.adj, weight: totalWeight > 0 ? x.rawWeight / totalWeight : 0 }));

  const parts: string[] = [];
  for (const a of adjustments) {
    if (a.overconfidence > 0.01) parts.push(`${a.cohortKey.replace(/^[^:]+:/, "")} +${a.overconfidence.toFixed(2)} (n=${a.n})`);
  }
  if (regimeFactor < 1) parts.push(`risk_off ×${regimeFactor.toFixed(2)}`);
  const reason = factor >= 1 ? "well-calibrated — no adjustment" : parts.length ? `dampened: ${parts.join("; ")}` : `regime brake ×${factor.toFixed(2)}`;

  return { calibrated: clamp(stated * factor, 0, stated), factor, regimeFactor, reason, adjustments };
}
