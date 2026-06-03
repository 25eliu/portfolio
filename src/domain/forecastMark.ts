import { z } from "zod";

/** One daily mark-to-market of an open scored forecast. Immutable; one per (forecastId, date). */
export const ForecastDailyMark = z.object({
  id: z.string().min(1),
  forecastId: z.string().min(1),
  ticker: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  markPrice: z.number(),
  moveFromEntry: z.number(),
  progressToTarget: z.number(),
  progressToStop: z.number(),
  unrealizedR: z.number().nullable().default(null),
  mfe: z.number(),
  mae: z.number(),
  spyExcess: z.number().nullable().default(null),
  status: z.enum(["on_track", "near_target", "at_risk", "near_stop"]),
  createdAt: z.string().datetime(),
});
export type ForecastDailyMark = z.infer<typeof ForecastDailyMark>;
