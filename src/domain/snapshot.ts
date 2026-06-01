import { z } from "zod";
import { Symbol } from "./holding.ts";

/** A position priced at a point in time. */
export const PricedPosition = z.object({
  symbol: Symbol,
  shares: z.number(),
  price: z.number().nonnegative(),
  marketValue: z.number(),
});
export type PricedPosition = z.infer<typeof PricedPosition>;

/** A dated valuation of one portfolio, written once per dailyRun. Drives the equity curve. */
export const Snapshot = z.object({
  id: z.string().min(1),
  portfolioId: z.string().min(1),
  /** ISO calendar date (YYYY-MM-DD). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  totalValue: z.number(),
  cash: z.number(),
  positions: z.array(PricedPosition),
});
export type Snapshot = z.infer<typeof Snapshot>;

/** Benchmark close used to normalize the SPY series on the equity curve. */
export const MarketSnapshot = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  spyClose: z.number().nonnegative(),
});
export type MarketSnapshot = z.infer<typeof MarketSnapshot>;
