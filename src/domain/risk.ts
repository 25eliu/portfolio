import { z } from "zod";
import type { Horizon } from "./recommendation.ts";

/**
 * Risk tolerance preset. Stored per portfolio (the user's advisory book and the AI's paper book each
 * carry their own), and — as of Phase 5 — it fully governs the AI execution planner: position sizing,
 * count, confidence floor, reward:risk floor, allowed forecast horizons, and strategy-family eligibility.
 */
export const RiskPreset = z.enum(["conservative", "balanced", "aggressive"]);
export type RiskPreset = z.infer<typeof RiskPreset>;

export const RiskProfile = z.object({
  portfolioId: z.string().min(1),
  preset: RiskPreset,
});
export type RiskProfile = z.infer<typeof RiskProfile>;

export type RiskPresetConfig = {
  /** Max single-position weight, as a % of the book's equity. */
  maxPositionPct: number;
  /** Max concurrent positions. */
  maxPositions: number;
  /** Minimum stated conviction to act on a bullish idea. */
  minConfidence: number;
  /** Minimum reward:risk (from target/stop) for a new BUY/ADD. */
  rewardRiskFloor: number;
  /** Forecast horizons eligible to trade (shorter horizons = more speculative). */
  horizons: readonly Horizon[];
  /** Strategy families eligible to trade; `null` means all (no restriction). Matched loosely. */
  strategies: readonly string[] | null;
};

/**
 * The preset table. Conservative favors longer horizons, lower-variance strategies, and a 2:1 reward
 * floor; aggressive permits everything incl. day-horizon and a 1:1 floor. These parameterize the planner.
 */
export const RISK_PRESETS: Record<RiskPreset, RiskPresetConfig> = {
  conservative: {
    maxPositionPct: 5,
    maxPositions: 6,
    minConfidence: 0.65,
    rewardRiskFloor: 2.0,
    horizons: ["1mo", "3mo", "6mo", "1y"],
    strategies: ["value", "quality", "dividend", "mean-reversion", "mean_reversion"],
  },
  balanced: {
    maxPositionPct: 10,
    maxPositions: 10,
    minConfidence: 0.58,
    rewardRiskFloor: 1.5,
    horizons: ["1w", "1mo", "3mo", "6mo", "1y"],
    strategies: ["value", "quality", "dividend", "mean-reversion", "mean_reversion", "growth", "momentum", "event", "macro"],
  },
  aggressive: {
    maxPositionPct: 20,
    maxPositions: 15,
    minConfidence: 0.52,
    rewardRiskFloor: 1.0,
    horizons: ["1d", "1w", "1mo", "3mo", "6mo", "1y"],
    strategies: null,
  },
};

/** Whether a forecast horizon is eligible to trade under this preset. */
export function horizonAllowed(preset: RiskPresetConfig, horizon: Horizon): boolean {
  return preset.horizons.includes(horizon);
}

/** Whether a (free-form) strategy family is eligible under this preset. `null` strategies = all allowed;
 *  otherwise a loose, case-insensitive substring match in either direction so label variants still map. */
export function strategyAllowed(preset: RiskPresetConfig, strategyFamily: string): boolean {
  if (!preset.strategies) return true;
  const s = strategyFamily.toLowerCase();
  return preset.strategies.some((a) => s.includes(a) || a.includes(s));
}
