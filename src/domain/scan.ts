import { z } from "zod";
import { Source } from "./marketContext.ts";

export const ScreenType = z.enum([
  "momentum",
  "mean_reversion",
  "value",
  "quality_growth",
  "catalyst",
  "sentiment",
  "thematic",
]);
export type ScreenType = z.infer<typeof ScreenType>;

export const ScanCandidate = z.object({
  symbol: z.string(),
  screen: ScreenType,
  reason: z.string(),
  sources: z.array(Source).default([]),
});
export type ScanCandidate = z.infer<typeof ScanCandidate>;
