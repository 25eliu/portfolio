import { describe, expect, test } from "bun:test";
import { emptyTechnicals, type Action, type Direction, type Recommendation } from "../domain/index.ts";
import { surfaceRecommendations } from "./llmReport.ts";

/** Minimal schema-valid recommendation for surfacing tests. */
function rec(
  ticker: string,
  held: boolean,
  action: Action,
  conviction: number,
  opts: { direction?: Direction; trigger?: string | null } = {},
): Recommendation {
  return {
    ticker,
    held,
    action,
    conviction,
    strategyFamily: "trend",
    thesis: `thesis ${ticker}`,
    signals: ["x"],
    prediction: {
      direction: opts.direction ?? "neutral",
      horizon: "1mo",
      entry: 100,
      target: null,
      stop: null,
      expectedReturnPct: null,
      rMultiple: null,
      trigger: opts.trigger ?? null,
      actionIfTriggered: null,
      invalidation: "thesis broken",
      rationale: `rationale ${ticker}`,
    },
    technicals: emptyTechnicals(),
    catalyst: null,
    briefingNote: null,
    fundamentals: null,
    priceTargetUpside: null,
    sources: [],
    screen: null,
    memorableFacts: [],
  };
}

describe("surfaceRecommendations", () => {
  test("held positions are always kept, untouched", () => {
    const input = [rec("AAPL", true, "HOLD", 0.5), rec("GLD", true, "SELL", 0.7)];
    const { surfaced, dropped } = surfaceRecommendations(input, 6);
    expect(dropped).toBe(0);
    expect(surfaced.map((r) => `${r.ticker}:${r.action}`).sort()).toEqual(["AAPL:HOLD", "GLD:SELL"]);
  });

  test("non-held bullish/neutral PASS is reclassified to WATCH and surfaced", () => {
    const { surfaced } = surfaceRecommendations([rec("PLTR", false, "PASS", 0.4, { direction: "bullish" })], 6);
    expect(surfaced).toHaveLength(1);
    expect(surfaced[0]!.ticker).toBe("PLTR");
    expect(surfaced[0]!.action).toBe("WATCH");
  });

  test("non-held bearish names are dropped (not buy opportunities in a long-only book)", () => {
    const input = [
      rec("WOK", false, "PASS", 0.95, { direction: "bearish" }), // high-conviction PASS, but bearish
      rec("MSFT", false, "WATCH", 0.6, { direction: "bullish", trigger: "breakout" }),
    ];
    const { surfaced, dropped } = surfaceRecommendations(input, 6);
    const tickers = surfaced.map((r) => r.ticker);
    expect(tickers).toEqual(["MSFT"]); // bearish WOK dropped despite higher conviction
    expect(dropped).toBe(1);
  });

  test("ranks by actionability (bullish + trigger) over raw conviction", () => {
    const input = [
      rec("LOWBULL", false, "WATCH", 0.30, { direction: "bullish", trigger: "close above 50" }),
      rec("HIGHNEUT", false, "PASS", 0.95, { direction: "neutral" }),
    ];
    const { surfaced } = surfaceRecommendations(input, 1);
    expect(surfaced.map((r) => r.ticker)).toEqual(["LOWBULL"]); // bullish+trigger beats high-conviction neutral
  });

  test("non-held BUY is always kept and does not count against the watch cap", () => {
    const input = [
      rec("BUY1", false, "BUY", 0.9, { direction: "bullish" }),
      rec("W1", false, "WATCH", 0.8, { direction: "bullish", trigger: "t" }),
      rec("W2", false, "WATCH", 0.7, { direction: "neutral" }),
    ];
    const { surfaced, dropped } = surfaceRecommendations(input, 1);
    const tickers = surfaced.map((r) => r.ticker);
    expect(tickers).toContain("BUY1"); // BUY kept regardless of cap
    expect(tickers).toContain("W1"); // best watch kept
    expect(tickers).not.toContain("W2"); // beyond cap → dropped
    expect(dropped).toBe(1);
  });

  test("input recs are not mutated (immutability)", () => {
    const original = rec("PLTR", false, "PASS", 0.4, { direction: "bullish" });
    surfaceRecommendations([original], 6);
    expect(original.action).toBe("PASS"); // reclassification produced a copy
  });

  test("maxWatch=0 drops all watch candidates but keeps held + BUY", () => {
    const input = [
      rec("AAPL", true, "HOLD", 0.5),
      rec("BUY1", false, "BUY", 0.9, { direction: "bullish" }),
      rec("W1", false, "PASS", 0.8, { direction: "bullish" }),
    ];
    const { surfaced, dropped } = surfaceRecommendations(input, 0);
    expect(surfaced.map((r) => r.ticker).sort()).toEqual(["AAPL", "BUY1"]);
    expect(dropped).toBe(1);
  });
});
