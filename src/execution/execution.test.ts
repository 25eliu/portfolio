import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { newId, Recommendation, TradeDecision, type DailyReport } from "../domain/index.ts";
import { priceAiPortfolio } from "../pipeline/pricing.ts";
import { executeAiTrades, type ExecutionContext } from "./index.ts";
import { applyFills } from "./ledger.ts";

function reportFor(rec: Partial<Parameters<typeof Recommendation.parse>[0]> = {}): DailyReport {
  const parsed = Recommendation.parse({
    ticker: "AAPL", held: false, action: "BUY", conviction: 0.8, strategyFamily: "momentum",
    thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", entry: 100, target: 130, stop: 95 }, technicals: {},
    ...rec,
  });
  return { id: newId(), date: "2026-06-01", generatedAt: "2026-06-01T00:00:00.000Z", source: "llm", marketContext: null, recommendations: [parsed] };
}

/** Build an execution context priced off the AI's current DB-backed book. */
async function ctxFor(app: App, refs: Record<string, number> = { AAPL: 100 }): Promise<ExecutionContext> {
  const ai = await priceAiPortfolio(app);
  return { ai, referencePrices: new Map(Object.entries(refs)), journalLink: new Map() };
}

/** A hand-built proposed decision, for exercising the ledger directly without the planner. */
function decision(d: { ticker: string; side: "buy" | "sell"; action: "BUY" | "ADD" | "TRIM" | "SELL"; qty: number; intendedPrice: number; reason?: string }): TradeDecision {
  return TradeDecision.parse({
    id: newId(), ticker: d.ticker, side: d.side, action: d.action, qty: d.qty, intendedPrice: d.intendedPrice,
    notional: d.qty * d.intendedPrice, status: "proposed", reason: d.reason ?? null,
    createdAt: "2026-06-01T00:00:00.000Z",
  });
}

let app: App;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => "2026-06-01" }), now: () => "2026-06-01" });
});

describe("executeAiTrades (planner → ledger)", () => {
  test("always-on: fills a BUY against the $100k book, sized to its own equity", async () => {
    const summary = await executeAiTrades(app, reportFor(), "run-1", await ctxFor(app));
    expect(summary.filled).toBe(1);

    const trades = app.repos.tradeDecisions.listRecent();
    expect(trades).toHaveLength(1);
    expect(trades[0]!.action).toBe("BUY");
    expect(trades[0]!.status).toBe("filled");
    expect(trades[0]!.qty).toBe(100); // 10% of the AI's own $100k equity / $100 — never the user's portfolio

    // The fill landed on the AI's isolated DB book: a holding row + debited cash.
    const holdings = app.repos.holdings.listByPortfolio(app.ai.id);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]).toMatchObject({ symbol: "AAPL", shares: 100, costBasis: 100, acquiredAt: "2026-06-01" });
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(90_000);

    // Nothing touched the broker account — it's a pure paper ledger.
    expect((await app.gateway.getPositions()).length).toBe(0);
  });

  test("compounding: a bigger book sizes a bigger position", async () => {
    // Book at $200k → 10% cap = $20k → 200 shares at $100.
    app.repos.portfolios.setCash(app.ai.id, 200_000);
    const summary = await executeAiTrades(app, reportFor(), "run-1", await ctxFor(app));
    expect(summary.filled).toBe(1);
    expect(app.repos.tradeDecisions.listRecent()[0]!.qty).toBe(200);
  });
});

describe("applyFills (ledger math)", () => {
  test("BUY opens a position and debits cash", () => {
    app.repos.tradeDecisions.insertMany([decision({ ticker: "AAPL", side: "buy", action: "BUY", qty: 100, intendedPrice: 100 })]);
    const d = app.repos.tradeDecisions.listRecent();
    const out = applyFills(app, d, { acquiredAt: "2026-06-01", now: "2026-06-01T00:00:00.000Z" });
    expect(out.filled).toBe(1);
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(90_000);
    expect(app.repos.holdings.listByPortfolio(app.ai.id)[0]).toMatchObject({ symbol: "AAPL", shares: 100, costBasis: 100, acquiredAt: "2026-06-01" });
  });

  test("ADD recomputes a weighted-average cost basis: 100@100 + 50@130 → 150 @ 110", () => {
    app.repos.holdings.setPosition(app.ai.id, "AAPL", 100, 100, "2026-05-01");
    app.repos.portfolios.setCash(app.ai.id, 100_000);
    app.repos.tradeDecisions.insertMany([decision({ ticker: "AAPL", side: "buy", action: "ADD", qty: 50, intendedPrice: 130 })]);
    applyFills(app, app.repos.tradeDecisions.listRecent(), { acquiredAt: "2026-06-01", now: "2026-06-01T00:00:00.000Z" });
    const [h] = app.repos.holdings.listByPortfolio(app.ai.id);
    expect(h).toMatchObject({ shares: 150, costBasis: 110, acquiredAt: "2026-05-01" }); // original buy date preserved
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(100_000 - 50 * 130);
  });

  test("TRIM partially sells, credits cash, leaves basis unchanged", () => {
    app.repos.holdings.setPosition(app.ai.id, "AAPL", 100, 100, "2026-05-01");
    app.repos.portfolios.setCash(app.ai.id, 0);
    app.repos.tradeDecisions.insertMany([decision({ ticker: "AAPL", side: "sell", action: "TRIM", qty: 40, intendedPrice: 120 })]);
    applyFills(app, app.repos.tradeDecisions.listRecent(), { acquiredAt: "2026-06-01", now: "2026-06-01T00:00:00.000Z" });
    const [h] = app.repos.holdings.listByPortfolio(app.ai.id);
    expect(h).toMatchObject({ shares: 60, costBasis: 100 });
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(40 * 120);
  });

  test("SELL fully exits, removes the row, credits cash", () => {
    app.repos.holdings.setPosition(app.ai.id, "AAPL", 100, 100, "2026-05-01");
    app.repos.portfolios.setCash(app.ai.id, 0);
    app.repos.tradeDecisions.insertMany([decision({ ticker: "AAPL", side: "sell", action: "SELL", qty: 100, intendedPrice: 120 })]);
    applyFills(app, app.repos.tradeDecisions.listRecent(), { acquiredAt: "2026-06-01", now: "2026-06-01T00:00:00.000Z" });
    expect(app.repos.holdings.listByPortfolio(app.ai.id)).toHaveLength(0);
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(100 * 120);
  });

  test("insufficient cash clamps the BUY rather than overdrawing", () => {
    app.repos.portfolios.setCash(app.ai.id, 550); // funds only 5 shares at $100
    app.repos.tradeDecisions.insertMany([decision({ ticker: "AAPL", side: "buy", action: "BUY", qty: 100, intendedPrice: 100 })]);
    const out = applyFills(app, app.repos.tradeDecisions.listRecent(), { acquiredAt: "2026-06-01", now: "2026-06-01T00:00:00.000Z" });
    expect(out.filled).toBe(1);
    const [h] = app.repos.holdings.listByPortfolio(app.ai.id);
    expect(h!.shares).toBe(5);
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(50);
    expect(app.repos.tradeDecisions.listRecent()[0]!.reason).toContain("clamped");
  });

  test("a BUY with zero affordable shares is skipped, not filled", () => {
    app.repos.portfolios.setCash(app.ai.id, 50); // can't afford even one $100 share
    app.repos.tradeDecisions.insertMany([decision({ ticker: "AAPL", side: "buy", action: "BUY", qty: 100, intendedPrice: 100 })]);
    const out = applyFills(app, app.repos.tradeDecisions.listRecent(), { acquiredAt: "2026-06-01", now: "2026-06-01T00:00:00.000Z" });
    expect(out.filled).toBe(0);
    expect(out.skipped).toBe(1);
    expect(app.repos.tradeDecisions.listRecent()[0]!.status).toBe("skipped");
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(50); // untouched
  });
});
