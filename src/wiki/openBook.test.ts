import { describe, expect, test } from "bun:test";
import { newId, ScoredForecast } from "../domain/index.ts";
import { computeOpenBook, renderOpenBook } from "./openBook.ts";

function forecast(over: { ticker: string; side?: "bullish" | "bearish"; ref: number; target: number; stop: number; createdAt?: string; resolveAt?: string }): ScoredForecast {
  return ScoredForecast.parse({
    id: newId(), journalEntryId: newId(), ticker: over.ticker, side: over.side ?? "bullish",
    strategyFamily: "momentum", signals: [], createdAt: over.createdAt ?? "2026-06-01T00:00:00.000Z",
    asOfTimestamp: "2026-06-01T00:00:00.000Z", marketSession: "regular", quoteTimestamp: null, priceFeed: "fake",
    referencePrice: over.ref, entry: over.ref, target: over.target, stop: over.stop, horizonTradingSessions: 21,
    resolveAt: over.resolveAt ?? "2026-07-01", conviction: 0.7, benchmarkSymbol: "SPY", benchmarkReferencePrice: 500,
    resolutionPolicyVersion: "v1", marketContextId: null, citedSourceIds: [], retrievedChunkIds: [],
  });
}

describe("computeOpenBook", () => {
  test("marks long theses to current price: progress, R, and status", () => {
    const book = computeOpenBook(
      [forecast({ ticker: "WIN", ref: 100, target: 130, stop: 90 }), forecast({ ticker: "RISK", ref: 100, target: 130, stop: 90 })],
      new Map([["WIN", 115], ["RISK", 95]]),
      "2026-06-11",
    );
    const win = book.theses.find((t) => t.ticker === "WIN")!;
    expect(win.toTarget).toBeCloseTo(0.5, 2);
    expect(win.unrealizedR).toBeCloseTo(1.5, 2);
    expect(win.status).toBe("on_track");
    const risk = book.theses.find((t) => t.ticker === "RISK")!;
    expect(risk.unrealizedR).toBeCloseTo(-0.5, 2);
    expect(risk.status).toBe("at_risk");
    expect(book.onTrack).toBe(1);
    expect(book.atRisk).toBe(1);
    expect(book.avgUnrealizedR).toBeCloseTo(0.5, 2);
  });

  test("flags near_stop and skips tickers with no price", () => {
    const book = computeOpenBook(
      [forecast({ ticker: "DROP", ref: 100, target: 130, stop: 90 }), forecast({ ticker: "NOPRICE", ref: 100, target: 130, stop: 90 })],
      new Map([["DROP", 91]]),
      "2026-06-11",
    );
    expect(book.theses).toHaveLength(1);
    expect(book.theses[0]!.status).toBe("near_stop");
  });
});

describe("renderOpenBook", () => {
  test("renders an attention-first blotter with a summary, or empty when no theses", () => {
    expect(renderOpenBook(computeOpenBook([], new Map(), "2026-06-11"), "2026-06-11")).toBe("");
    const book = computeOpenBook([forecast({ ticker: "NVDA", ref: 100, target: 130, stop: 90 })], new Map([["NVDA", 112]]), "2026-06-11");
    const text = renderOpenBook(book, "2026-06-11");
    expect(text).toContain("OPEN BOOK");
    expect(text).toContain("NVDA");
    expect(text).toContain("Summary:");
  });
});
