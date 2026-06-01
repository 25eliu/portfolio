import { z } from "zod";

/** A cited source (title + URL) attached to grounded LLM output. */
export const Source = z.object({ title: z.string(), url: z.string() });
export type Source = z.infer<typeof Source>;

/** Daily market regime context: SPY trend + grounded macro summary with citations. */
export const MarketContext = z.object({
  date: z.string(),
  spyTrend: z.enum(["up", "down", "sideways"]).nullable().default(null),
  spyPctFromSma200: z.number().nullable().default(null),
  macroSummary: z.string().default(""),
  sources: z.array(Source).default([]),
});
export type MarketContext = z.infer<typeof MarketContext>;
