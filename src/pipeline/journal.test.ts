import { describe, expect, test } from "bun:test";
import {
  Recommendation,
  type Action,
  type DailyReport,
  type Prediction,
} from "../domain/index.ts";
import {
  HORIZON_SESSIONS,
  buildJournal,
  deriveScoredForecast,
  persistJournal,
  priceFeedFor,
  resolveAtDate,
  type ForecastContext,
} from "./journal.ts";
import { createApp } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createFakeFundamentals } from "../fundamentals/index.ts";
import { nodeId } from "../domain/index.ts";

const baseCtx: ForecastContext = {
  journalEntryId: "je-1",
  createdAt: "2026-06-01T14:30:00.000Z",
  date: "2026-06-01",
  referencePrice: 100,
  priceFeed: "fake",
  benchmarkReferencePrice: 500,
  marketContextId: "report-1",
  retrievedChunkIds: [],
  evidenceSourceIds: [],
};

function rec(overrides: {
  action: Action;
  prediction?: Partial<Prediction>;
  conviction?: number;
}): Recommendation {
  return Recommendation.parse({
    ticker: "AAPL",
    held: false,
    action: overrides.action,
    conviction: overrides.conviction ?? 0.6,
    strategyFamily: "momentum_breakout",
    thesis: "test thesis",
    signals: ["vwap_reclaim"],
    prediction: {
      direction: "bullish",
      horizon: "1mo",
      invalidation: "closes below stop",
      rationale: "test",
      target: 120,
      stop: 95,
      ...overrides.prediction,
    },
    technicals: {},
  });
}

describe("deriveScoredForecast", () => {
  test("BUY and ADD map to bullish", () => {
    expect(deriveScoredForecast(rec({ action: "BUY" }), baseCtx)?.side).toBe("bullish");
    expect(deriveScoredForecast(rec({ action: "ADD" }), baseCtx)?.side).toBe("bullish");
  });

  test("TRIM and SELL map to bearish", () => {
    expect(deriveScoredForecast(rec({ action: "TRIM" }), baseCtx)?.side).toBe("bearish");
    expect(deriveScoredForecast(rec({ action: "SELL" }), baseCtx)?.side).toBe("bearish");
  });

  test("HOLD, WATCH, PASS are unscored (null)", () => {
    for (const action of ["HOLD", "WATCH", "PASS"] as const) {
      expect(deriveScoredForecast(rec({ action }), baseCtx)).toBeNull();
    }
  });

  test("incomplete plans (missing target or stop) are unscored", () => {
    expect(deriveScoredForecast(rec({ action: "BUY", prediction: { target: null } }), baseCtx)).toBeNull();
    expect(deriveScoredForecast(rec({ action: "BUY", prediction: { stop: null } }), baseCtx)).toBeNull();
  });

  test("captures the scoring contract: target, stop, conviction, benchmark, policy", () => {
    const f = deriveScoredForecast(rec({ action: "BUY", conviction: 0.72 }), baseCtx)!;
    expect(f.target).toBe(120);
    expect(f.stop).toBe(95);
    expect(f.conviction).toBe(0.72);
    expect(f.referencePrice).toBe(100);
    expect(f.benchmarkReferencePrice).toBe(500);
    expect(f.benchmarkSymbol).toBe("SPY");
    expect(f.resolutionPolicyVersion).toBe("v1");
    expect(f.journalEntryId).toBe("je-1");
  });

  test("entry falls back to referencePrice when the prediction has none", () => {
    const f = deriveScoredForecast(rec({ action: "BUY", prediction: { entry: null } }), baseCtx)!;
    expect(f.entry).toBe(100); // referencePrice
  });

  test("referencePrice falls back to technicals.price, then prediction.entry", () => {
    const noRefCtx = { ...baseCtx, referencePrice: null };
    // prediction.entry is the only baseline available
    const f = deriveScoredForecast(rec({ action: "BUY", prediction: { entry: 88 } }), noRefCtx)!;
    expect(f.referencePrice).toBe(88);
  });

  test("returns null when no baseline price is available at all", () => {
    const noRefCtx = { ...baseCtx, referencePrice: null };
    const r = rec({ action: "BUY", prediction: { entry: null } });
    // technicals.price defaults to null in the builder, so there is no baseline
    expect(deriveScoredForecast(r, noRefCtx)).toBeNull();
  });

  test("horizon maps to the documented trading-session counts", () => {
    expect(HORIZON_SESSIONS).toEqual({ "1d": 1, "1w": 5, "1mo": 21, "3mo": 63, "6mo": 126, "1y": 252 });
    const f = deriveScoredForecast(rec({ action: "BUY", prediction: { horizon: "1w" } }), baseCtx)!;
    expect(f.horizonTradingSessions).toBe(5);
  });
});

describe("resolveAtDate", () => {
  test("advances by trading sessions, skipping weekends", () => {
    // 2026-06-01 is a Monday: +5 sessions → next Monday; +1 session → Tuesday.
    expect(resolveAtDate("2026-06-01", 5)).toBe("2026-06-08");
    expect(resolveAtDate("2026-06-01", 1)).toBe("2026-06-02");
    // From Friday 2026-06-05, +1 session crosses the weekend to Monday.
    expect(resolveAtDate("2026-06-05", 1)).toBe("2026-06-08");
  });
});

describe("priceFeedFor", () => {
  test("maps adapter kind to a feed label", () => {
    expect(priceFeedFor("alpaca")).toBe("iex");
    expect(priceFeedFor("fake")).toBe("fake");
  });
});

describe("buildJournal", () => {
  const report: DailyReport = {
    id: "report-1",
    date: "2026-06-01",
    generatedAt: "2026-06-01T14:30:00.000Z",
    source: "llm",
    marketContext: null,
    outlook: null,
    recommendations: [
      rec({ action: "BUY" }), // scored
      rec({ action: "HOLD" }), // unscored
      rec({ action: "TRIM" }), // scored
    ],
  };

  test("journals every recommendation; scores only complete actionable calls", () => {
    const refs = new Map([["AAPL", 100]]);
    const { entries, forecasts } = buildJournal(report, "run-1", 500, refs, "fake");
    expect(entries).toHaveLength(3);
    expect(forecasts).toHaveLength(2); // BUY + TRIM
    expect(entries.filter((e) => e.scored)).toHaveLength(2);
    // every forecast links back to a journal entry that exists
    const ids = new Set(entries.map((e) => e.id));
    expect(forecasts.every((f) => ids.has(f.journalEntryId))).toBe(true);
    // entries carry the report + run linkage and preserve the recommendation verbatim
    expect(entries[0]!.reportId).toBe("report-1");
    expect(entries[0]!.runId).toBe("run-1");
    expect(entries[0]!.recommendation.thesis).toBe("test thesis");
  });
});

describe("persistJournal — graph wiring", () => {
  function recWithSector(sector: string | null) {
    return Recommendation.parse({
      ticker: "AAPL", held: false, action: "BUY", conviction: 0.6, strategyFamily: "momentum",
      thesis: "t", signals: [], technicals: {}, fundamentals: sector ? { symbol: "AAPL", sector } : null,
      prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 95 },
    });
  }

  test("materializes ticker —belongs_to→ sector from fundamentals (activates the sector cohort)", () => {
    const app = createApp({
      db: openMemoryDb(),
      gateway: createFakeGateway({ now: () => "2026-06-01" }),
      fundamentals: createFakeFundamentals(),
      now: () => "2026-06-01",
    });
    const rpt: DailyReport = {
      id: "r1", date: "2026-06-01", generatedAt: "2026-06-01T14:30:00.000Z", source: "llm",
      marketContext: null, outlook: null, recommendations: [recWithSector("Information Technology")],
    };
    app.repos.reports.insert(rpt);
    persistJournal(app, rpt, null, 500, new Map([["AAPL", 100]]));

    const sectors = app.repos.graph
      .neighbors(nodeId("ticker", "AAPL"), { rel: "belongs_to", direction: "out" })
      .map((n) => n.node?.label);
    expect(sectors).toContain("Information Technology");
  });

  test("a recommendation without a sector creates no belongs_to edge", () => {
    const app = createApp({
      db: openMemoryDb(),
      gateway: createFakeGateway({ now: () => "2026-06-01" }),
      fundamentals: createFakeFundamentals(),
      now: () => "2026-06-01",
    });
    const rpt: DailyReport = {
      id: "r1", date: "2026-06-01", generatedAt: "2026-06-01T14:30:00.000Z", source: "llm",
      marketContext: null, outlook: null, recommendations: [recWithSector(null)],
    };
    app.repos.reports.insert(rpt);
    persistJournal(app, rpt, null, 500, new Map([["AAPL", 100]]));
    expect(app.repos.graph.neighbors(nodeId("ticker", "AAPL"), { rel: "belongs_to", direction: "out" })).toHaveLength(0);
  });
});
