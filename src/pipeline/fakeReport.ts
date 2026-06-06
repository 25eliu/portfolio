import { newId, type Action, type DailyReport, type Recommendation, emptyTechnicals } from "../domain/index.ts";
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

const HELD_ACTIONS: Action[] = ["HOLD", "ADD", "TRIM", "HOLD"];
const OPP_ACTIONS: Action[] = ["BUY", "WATCH"];
const FAMILIES = ["momentum_breakout", "mean_reversion", "news_reaction", "trend"];
const SIGNALS = ["vwap_reclaim", "unusual_volume", "breakout", "gap_up", "earnings_reaction"];
const DEFAULT_WATCHLIST = ["AAPL", "NVDA", "MSFT"];

function makeRecommendation(symbol: string, date: string, symbols: string[]): Recommendation {
  const s = seed(`${symbol}@${date}`);
  const price = fakePrice(symbol, date);
  const held = symbols.includes(symbol);
  const action = held ? HELD_ACTIONS[s % HELD_ACTIONS.length]! : OPP_ACTIONS[s % OPP_ACTIONS.length]!;
  const conviction = Math.round((0.5 + (s % 50) / 100) * 100) / 100;
  const family = FAMILIES[s % FAMILIES.length]!;
  const signals = [SIGNALS[s % SIGNALS.length]!, SIGNALS[(s >>> 3) % SIGNALS.length]!];
  const stop = Math.round(price * 0.97 * 100) / 100;
  const target = Math.round(price * 1.06 * 100) / 100;

  return {
    ticker: symbol,
    held,
    action,
    conviction,
    strategyFamily: family,
    thesis: `[demo] ${family.replace(/_/g, " ")} setup on ${symbol}; placeholder thesis until the LLM step lands.`,
    signals: [...new Set(signals)],
    prediction: {
      direction: held ? "neutral" : "bullish",
      horizon: "1mo",
      entry: price,
      target: Math.round(price * 1.06 * 100) / 100,
      stop: Math.round(price * 0.97 * 100) / 100,
      expectedReturnPct: 6,
      rMultiple: 2,
      trigger: held ? null : `close above ${Math.round(price * 1.02 * 100) / 100}`,
      actionIfTriggered: held ? null : "BUY",
      invalidation: `close below ${Math.round(price * 0.95 * 100) / 100}`,
      rationale: `[demo] ${symbol} ${held ? "position review" : "opportunity"}`,
    },
    // Decision Engine v2 fields, seeded deterministically so the offline/e2e path exercises the bull/bear
    // deliberation + calibration plumbing. Offline has no track record, so calibration is a no-op (factor 1).
    deliberation: {
      bullCase: `[demo] bull case for ${symbol}: ${family.replace(/_/g, " ")} setup intact.`,
      bearCase: `[demo] bear case for ${symbol}: setup fails if momentum stalls.`,
      keyUncertainties: ["[demo] follow-through on volume"],
      disconfirmers: [`[demo] would be wrong if ${symbol} closes below support`],
      baseRateNote: null,
      reversalCheck: null,
      provisionalStance: held ? "neutral" : "bullish",
      provisionalConviction: conviction,
    },
    calibratedConviction: conviction,
    calibration: { factor: 1, regimeFactor: 1, reason: "[demo] no track record yet", adjustments: [] },
    technicals: {
      ...emptyTechnicals(),
      rsi14: 30 + (s % 40),
      macd: s % 2 === 0 ? 0.5 : -0.5,
      support: stop,
      resistance: target,
    },
    catalyst: null,
    briefingNote: null,
    fundamentals: null,
    priceTargetUpside: null,
    sources: [],
    screen: null,
    // Symbol-only (NOT date- or family-seeded) so a later run re-emits the identical fact and the
    // dedup guard holds the library steady — exercises the self-curated memory path offline.
    memorableFacts: [
      {
        fact: `[demo] ${symbol}: durable competitive characteristic noted for future runs`,
        citationUrl: `https://example.com/${symbol.toLowerCase()}`,
        scope: "ticker" as const,
        significance: 0.9,
        category: "moat",
      },
    ],
  };
}

export function generateFakeReport(symbols: string[], date: string): DailyReport {
  const universe = [...new Set([...symbols, ...DEFAULT_WATCHLIST])];
  return {
    id: newId(),
    date,
    generatedAt: new Date().toISOString(),
    source: "fake",
    recommendations: universe.map((sym) => makeRecommendation(sym, date, symbols)),
    marketContext: null,
    outlook: null,
  };
}
