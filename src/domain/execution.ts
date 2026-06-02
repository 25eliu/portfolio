import { z } from "zod";
import { Symbol } from "./holding.ts";

/**
 * Always-on AI paper trading (roadmap §6/§7). The LLM only supplies a holder-neutral thesis; a
 * deterministic planner turns it into trades, filled against an isolated DB-backed book. Every
 * decision is logged with an auditable reason and linked back to the journal entry + scored forecast
 * it came from. PAPER ONLY — a simulated ledger, never real money or a live broker account.
 */

/** The AI's self-contained paper book starts here. Fixed; never seeded from the user's portfolio. */
export const AI_STARTING_CASH = 100_000;

export const TradeSide = z.enum(["buy", "sell"]);
export type TradeSide = z.infer<typeof TradeSide>;

/** The AI's intent for its own book. BUY = open, ADD = grow, TRIM = partial reduce, SELL = full exit. */
export const TradeAction = z.enum(["BUY", "ADD", "TRIM", "SELL"]);
export type TradeAction = z.infer<typeof TradeAction>;

export const TradeStatus = z.enum(["proposed", "skipped", "submitted", "filled", "failed"]);
export type TradeStatus = z.infer<typeof TradeStatus>;

export const TradeDecision = z.object({
  id: z.string().min(1),
  runId: z.string().nullable().default(null),
  journalEntryId: z.string().nullable().default(null),
  forecastId: z.string().nullable().default(null),
  ticker: Symbol,
  side: TradeSide,
  action: TradeAction,
  qty: z.number().nonnegative(),
  intendedPrice: z.number().nonnegative(),
  notional: z.number(),
  status: TradeStatus,
  /** Auditable reason — the guard that fired (skipped) or a short why (proposed/submitted). */
  reason: z.string().nullable().default(null),
  brokerOrderId: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  submittedAt: z.string().datetime().nullable().default(null),
});
export type TradeDecision = z.infer<typeof TradeDecision>;
