import { z } from "zod";
const num = z.number().nullable().default(null);

export const Fundamentals = z.object({
  symbol: z.string(),
  name: z.string().nullable().default(null),
  sector: z.string().nullable().default(null),
  marketCap: num,
  peTrailing: num, peForward: num, ps: num, pb: num, peg: num, evEbitda: num,
  fcfYield: num, dividendYield: num,
  grossMargin: num, operatingMargin: num, netMargin: num, roe: num, roa: num, roic: num,
  revenueGrowthYoY: num, epsGrowthYoY: num,
  debtToEquity: num, currentRatio: num, quickRatio: num, freeCashFlowPerShare: num, interestCoverage: num,
  analystRating: z.string().nullable().default(null),
  priceTargetMean: num, priceTargetHigh: num, priceTargetLow: num, numAnalysts: num,
  nextEarningsDate: z.string().nullable().default(null),
});
export type Fundamentals = z.infer<typeof Fundamentals>;

export const emptyFundamentals = (symbol: string): Fundamentals => Fundamentals.parse({ symbol });
