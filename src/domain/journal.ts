import { z } from "zod";
import { Symbol } from "./holding.ts";
import { Action, Recommendation } from "./recommendation.ts";

/**
 * The typed journal (roadmap §6). A `JournalEntry` is the immutable record of one recommendation a
 * report produced — scored or not. A `ScoredForecast` is derived only for complete actionable plans
 * (BUY/ADD/TRIM/SELL with a target and stop) and carries everything forecast resolution needs.
 */

/** Direction a scored forecast is graded on. Long-only book: bullish = upside, bearish = downside. */
export const ForecastSide = z.enum(["bullish", "bearish"]);
export type ForecastSide = z.infer<typeof ForecastSide>;

/** Market session at the time the forecast was made. v1 records `unknown`; refined later. */
export const MarketSession = z.enum(["regular", "extended", "closed", "unknown"]);
export type MarketSession = z.infer<typeof MarketSession>;

export const JournalEntry = z.object({
  id: z.string().min(1),
  reportId: z.string().min(1),
  runId: z.string().nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string().datetime(),
  ticker: Symbol,
  held: z.boolean(),
  action: Action,
  conviction: z.number().min(0).max(1),
  strategyFamily: z.string(),
  /** The exact validated recommendation, preserved verbatim for auditability. */
  recommendation: Recommendation,
  /** Identifies the market context used (currently the owning report id; may normalize later). */
  marketContextId: z.string().nullable().default(null),
  /** Whether a scored forecast was derived from this entry. */
  scored: z.boolean().default(false),
});
export type JournalEntry = z.infer<typeof JournalEntry>;

/** Complete actionable plan with the full scoring contract from roadmap §5. */
export const ScoredForecast = z.object({
  id: z.string().min(1),
  journalEntryId: z.string().min(1),
  ticker: Symbol,
  side: ForecastSide,
  strategyFamily: z.string(),
  signals: z.array(z.string()).default([]),
  createdAt: z.string().datetime(),
  /** The "knowledge cutoff": resolution may only use data strictly after this instant. */
  asOfTimestamp: z.string().datetime(),
  marketSession: MarketSession.default("unknown"),
  quoteTimestamp: z.string().datetime().nullable().default(null),
  priceFeed: z.string(),
  referencePrice: z.number(),
  entry: z.number().nullable().default(null),
  target: z.number(),
  stop: z.number(),
  horizonTradingSessions: z.number().int().positive(),
  resolveAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  conviction: z.number().min(0).max(1),
  benchmarkSymbol: z.string().default("SPY"),
  benchmarkReferencePrice: z.number().nullable().default(null),
  resolutionPolicyVersion: z.string().default("v1"),
  marketContextId: z.string().nullable().default(null),
  /** Source URLs/ids backing the call (grounding citations today; knowledge chunks once 3C lands). */
  citedSourceIds: z.array(z.string()).default([]),
  /** Knowledge-base chunk ids retrieved into analysis (empty until 3C populates it). */
  retrievedChunkIds: z.array(z.string()).default([]),
});
export type ScoredForecast = z.infer<typeof ScoredForecast>;
