import { z } from "zod";

/**
 * Risk tolerance preset (architecture doc §6). In this slice it is STORED ONLY — it does not
 * yet parameterize analysis or sizing. The full preset table is wired in Phase 5.
 */
export const RiskPreset = z.enum(["conservative", "balanced", "aggressive"]);
export type RiskPreset = z.infer<typeof RiskPreset>;

export const RiskProfile = z.object({
  portfolioId: z.string().min(1),
  preset: RiskPreset,
});
export type RiskProfile = z.infer<typeof RiskProfile>;

/** Reference presets (informational for now; not yet applied to the pipeline). */
export const RISK_PRESETS = {
  conservative: { maxPositionPct: 5, maxPositions: 6, minConfidence: 0.65 },
  balanced: { maxPositionPct: 10, maxPositions: 10, minConfidence: 0.58 },
  aggressive: { maxPositionPct: 20, maxPositions: 15, minConfidence: 0.52 },
} as const;
