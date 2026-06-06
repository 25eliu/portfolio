import type { MarketContext } from "../domain/index.ts";

/**
 * Coarse market-regime read used for regime-aware sizing and conviction calibration (Decision Engine v2).
 * Deterministic and intentionally simple: blends SPY trend, VIX level, and (when available) the
 * synthesized outlook's regime stance into one of three buckets. Risk-off is the only bucket that
 * actively brakes — the system stays long-biased otherwise.
 */
export type Regime = "risk_on" | "neutral" | "risk_off";

export function classifyRegime(input: {
  spyTrend?: "up" | "down" | "sideways" | null;
  vix?: number | null;
  /** Optional stance from the synthesized outlook regime (risk_on|neutral|risk_off|defensive). */
  outlookStance?: string | null;
}): Regime {
  const { spyTrend = null, vix = null, outlookStance = null } = input;
  let score = 0;
  if (outlookStance === "risk_off" || outlookStance === "defensive") score -= 2;
  else if (outlookStance === "risk_on") score += 1;
  if (spyTrend === "down") score -= 1;
  else if (spyTrend === "up") score += 1;
  if (vix != null) {
    if (vix >= 25) score -= 1;
    else if (vix < 15) score += 1;
  }
  if (score <= -2) return "risk_off";
  if (score >= 1) return "risk_on";
  return "neutral";
}

/** Classify directly from a MarketContext (during analysis the outlook isn't synthesized yet → omit it). */
export function regimeFromContext(ctx: MarketContext | null, outlookStance?: string | null): Regime {
  return classifyRegime({ spyTrend: ctx?.spyTrend ?? null, vix: ctx?.macro?.vix ?? null, outlookStance: outlookStance ?? null });
}

/** Entry-sizing brake for the planner — only a risk-off tape shrinks new positions. */
export function regimeSizingMultiplier(regime: Regime): number {
  return regime === "risk_off" ? 0.8 : 1;
}
