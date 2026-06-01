import { Fundamentals, type Fundamentals as F } from "../../domain/fundamentals.ts";
import type { FundamentalsSource, ScreenCriteria } from "../types.ts";

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

export function createFakeFundamentals(): FundamentalsSource {
  return {
    kind: "fake",
    async get(symbol: string): Promise<F> {
      const s = hash(symbol);
      return Fundamentals.parse({
        symbol,
        name: `${symbol} Inc.`,
        sector: ["Tech", "Health", "Energy", "Financials"][s % 4],
        marketCap: 1e9 + (s % 900) * 1e9,
        peTrailing: 10 + (s % 40),
        peForward: 9 + (s % 35),
        ps: 1 + (s % 12), pb: 1 + (s % 8), peg: 0.8 + (s % 30) / 10, evEbitda: 6 + (s % 20),
        fcfYield: round2((s % 80) / 10), dividendYield: round2((s % 40) / 10),
        grossMargin: 30 + (s % 50), operatingMargin: 10 + (s % 30), netMargin: 5 + (s % 25),
        roe: 5 + (s % 35), roa: 2 + (s % 18), roic: 4 + (s % 25),
        revenueGrowthYoY: -10 + (s % 60), epsGrowthYoY: -15 + (s % 70),
        debtToEquity: round2((s % 200) / 100), currentRatio: 1 + (s % 30) / 10,
        quickRatio: 0.8 + (s % 25) / 10, freeCashFlowPerShare: round2((s % 200) / 10), interestCoverage: 2 + (s % 30),
        analystRating: ["Strong Buy", "Buy", "Hold", "Sell"][s % 4],
        priceTargetMean: 50 + (s % 300), priceTargetHigh: 60 + (s % 320), priceTargetLow: 40 + (s % 250),
        numAnalysts: 3 + (s % 25),
        nextEarningsDate: null,
      });
    },
    async screen(criteria: ScreenCriteria): Promise<string[]> {
      const pool = ["NVDA", "AMD", "AAPL", "MSFT", "GOOGL", "META", "AMZN", "TSLA", "AVGO", "CRM"];
      return pool.slice(0, criteria.limit ?? 5);
    },
  };
}
const round2 = (n: number) => Math.round(n * 100) / 100;
