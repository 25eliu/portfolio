import { z } from "zod";
export const ScreenType = z.enum(["momentum", "mean_reversion", "value", "quality_growth", "catalyst"]);
export type ScreenType = z.infer<typeof ScreenType>;
export const ScanCandidate = z.object({
  symbol: z.string(),
  screen: ScreenType,
  reason: z.string(),
});
export type ScanCandidate = z.infer<typeof ScanCandidate>;
