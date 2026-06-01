import { z } from "zod";

const num = z.number().nullable().default(null);

export const Technicals = z.object({
  price: num,
  sma20: num, sma50: num, sma200: num,
  ema20: num, ema50: num, ema200: num,
  priceVsSma200Pct: num,
  goldenCross: z.boolean().nullable().default(null),
  rsi14: num,
  macd: num, macdSignal: num, macdHist: num,
  stochK: num, stochD: num,
  atr14: num,
  bbUpper: num, bbLower: num, bbPercentB: num,
  high52w: num, low52w: num, pctFrom52wHigh: num, pctFrom52wLow: num,
  avgVolume20: num, relativeVolume: num,
  obv: num, vwap: num, beta: num,
  support: num, resistance: num,
});
export type Technicals = z.infer<typeof Technicals>;

export const emptyTechnicals = (): Technicals => Technicals.parse({});
