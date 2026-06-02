import { z } from "zod";
import { Symbol } from "./holding.ts";
import { Technicals } from "./technicals.ts";
import { Fundamentals } from "./fundamentals.ts";
import { MarketContext, Source } from "./marketContext.ts";
import { ScreenType } from "./scan.ts";

export const Action = z.enum(["ADD", "TRIM", "HOLD", "SELL", "BUY", "WATCH", "PASS"]);
export type Action = z.infer<typeof Action>;

export const Horizon = z.enum(["1d", "1w", "1mo", "3mo", "6mo", "1y"]);
export type Horizon = z.infer<typeof Horizon>;

export const Direction = z.enum(["bullish", "bearish", "neutral"]);
export type Direction = z.infer<typeof Direction>;

export const Prediction = z.object({
  direction: Direction,
  horizon: Horizon,
  entry: z.number().nullable().default(null),
  target: z.number().nullable().default(null),
  stop: z.number().nullable().default(null),
  expectedReturnPct: z.number().nullable().default(null),
  rMultiple: z.number().nullable().default(null),
  trigger: z.string().nullable().default(null),
  actionIfTriggered: z.string().nullable().default(null),
  invalidation: z.string(),
  rationale: z.string(),
});
export type Prediction = z.infer<typeof Prediction>;

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
  /** Whether the portfolio currently holds this ticker (drives the position-aware verb set). */
  held: z.boolean(),
  action: Action,
  conviction: z.number().min(0).max(1),
  strategyFamily: z.string(),
  thesis: z.string(),
  signals: z.array(z.string()),
  /** Forward-looking, structured prediction backing the recommendation. */
  prediction: Prediction,
  technicals: Technicals,
  /** Fundamental snapshot used in the analysis (null until the LLM/FMP step populates it). */
  fundamentals: Fundamentals.nullable().default(null),
  /** Analyst price-target upside vs latest price, as a percentage (null when unavailable). */
  priceTargetUpside: z.number().nullable().default(null),
  /** Grounding citations backing the recommendation. */
  sources: z.array(Source).default([]),
  /** Originating opportunity screen for scan candidates (null for held/watchlist). */
  screen: ScreenType.nullable().default(null),
  catalyst: Catalyst.nullable().default(null),
  briefingNote: z.string().nullable().default(null),
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
