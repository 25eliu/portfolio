import { newId, type Action, type DailyReport, type Horizon, type Recommendation, emptyTechnicals } from "../domain/index.ts";
import { fakePrice } from "../market/fake/pricing.ts";

/**
 * Deterministic placeholder report generator. This stands in for the Phase 2 LLM analysis step:
 * it emits schema-valid recommendation cards so the UI + contract are exercised before any model
 * exists. Output is fully reproducible per (symbol, date).
 */

function seed(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

const ACTIONS: Action[] = ["BUY", "SELL", "HOLD", "WATCH"];
const HORIZONS: Horizon[] = ["1d", "5d", "30d"];
const FAMILIES = ["momentum_breakout", "mean_reversion", "news_reaction", "trend"];
const SIGNALS = ["vwap_reclaim", "unusual_volume", "breakout", "gap_up", "earnings_reaction"];
const DEFAULT_WATCHLIST = ["AAPL", "NVDA", "MSFT"];

function makeRecommendation(symbol: string, date: string): Recommendation {
  const s = seed(`${symbol}@${date}`);
  const price = fakePrice(symbol, date);
  const action = ACTIONS[s % ACTIONS.length]!;
  const conviction = Math.round((0.5 + (s % 50) / 100) * 100) / 100;
  const horizon = HORIZONS[s % HORIZONS.length]!;
  const family = FAMILIES[s % FAMILIES.length]!;
  const signals = [SIGNALS[s % SIGNALS.length]!, SIGNALS[(s >>> 3) % SIGNALS.length]!];
  const stop = Math.round(price * 0.97 * 100) / 100;
  const target = Math.round(price * 1.06 * 100) / 100;

  const actionable = action === "BUY" || action === "SELL";
  return {
    ticker: symbol,
    action,
    conviction,
    horizon,
    strategyFamily: family,
    thesis: `[demo] ${family.replace(/_/g, " ")} setup on ${symbol}; placeholder thesis until the LLM step lands.`,
    signals: [...new Set(signals)],
    technicals: {
      ...emptyTechnicals(),
      rsi14: 30 + (s % 40),
      macd: s % 2 === 0 ? 0.5 : -0.5,
      support: stop,
      resistance: target,
    },
    catalyst: null,
    tradePlan: actionable
      ? { entry: price, stop, target, rMultiple: 2, invalidation: `close below ${stop}` }
      : null,
    briefingNote: null,
    watchTrigger: action === "WATCH" ? `reclaims ${target}` : null,
    fundamentals: null,
    priceTargetUpside: null,
    sources: [],
    screen: null,
  };
}

export function generateFakeReport(symbols: string[], date: string): DailyReport {
  const universe = [...new Set([...symbols, ...DEFAULT_WATCHLIST])];
  return {
    id: newId(),
    date,
    generatedAt: new Date().toISOString(),
    source: "fake",
    recommendations: universe.map((sym) => makeRecommendation(sym, date)),
    marketContext: null,
  };
}
