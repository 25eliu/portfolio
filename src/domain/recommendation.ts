import { z } from "zod";
import { Symbol } from "./holding.ts";
import { Technicals } from "./technicals.ts";
import { Fundamentals } from "./fundamentals.ts";
import { MarketContext, Source } from "./marketContext.ts";

export const Action = z.enum(["BUY", "SELL", "HOLD", "WATCH"]);
export type Action = z.infer<typeof Action>;

export const Horizon = z.enum(["30m", "1d", "5d", "30d"]);
export type Horizon = z.infer<typeof Horizon>;

export const TradePlan = z.object({
  entry: z.number(),
  stop: z.number(),
  target: z.number(),
  rMultiple: z.number(),
  invalidation: z.string(),
});
export type TradePlan = z.infer<typeof TradePlan>;

export const Catalyst = z.object({
  kind: z.string(),
  summary: z.string(),
  sentiment: z.number().min(-1).max(1),
});
export type Catalyst = z.infer<typeof Catalyst>;

/**
 * One recommendation card (architecture doc §8). This shape is the contract the Phase 2 LLM
 * step must satisfy; in this slice it is produced by a deterministic fake generator so the
 * card UI and schema are validated before any model is wired in.
 */
export const Recommendation = z.object({
  ticker: Symbol,
  action: Action,
  conviction: z.number().min(0).max(1),
  horizon: Horizon,
  strategyFamily: z.string(),
  thesis: z.string(),
  signals: z.array(z.string()),
  technicals: Technicals,
  /** Fundamental snapshot used in the analysis (null until the LLM/FMP step populates it). */
  fundamentals: Fundamentals.nullable().default(null),
  /** Analyst price-target upside vs latest price, as a percentage (null when unavailable). */
  priceTargetUpside: z.number().nullable().default(null),
  /** Grounding citations backing the recommendation. */
  sources: z.array(Source).default([]),
  /** Originating opportunity screen for scan candidates (null for held/watchlist). */
  screen: z.string().nullable().default(null),
  catalyst: Catalyst.nullable().default(null),
  tradePlan: TradePlan.nullable().default(null),
  briefingNote: z.string().nullable().default(null),
  /** For WATCH cards: the condition that would promote it to BUY. */
  watchTrigger: z.string().nullable().default(null),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** The full structured daily report assembled by a dailyRun. */
export const DailyReport = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string().datetime(),
  source: z.enum(["fake", "llm"]),
  recommendations: z.array(Recommendation),
  /** Daily market regime context (null until the LLM step builds it). */
  marketContext: MarketContext.nullable().default(null),
});
export type DailyReport = z.infer<typeof DailyReport>;
