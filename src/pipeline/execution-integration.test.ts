import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createMockAnalyzer, type Analyzer } from "../llm/analyze.ts";
import { AI_STARTING_CASH, Recommendation } from "../domain/index.ts";
import { dailyRun } from "./dailyRun.ts";

/** A stub analyzer that rates everything bullish with a clean target/stop, so the AI will want to buy. */
function bullishAnalyzer(): Analyzer {
  const mock = createMockAnalyzer();
  return {
    ...mock,
    async analyzeTicker(input, _ctx, sink) {
      sink?.({ kind: "stage", stage: "structure" });
      return Recommendation.parse({
        ticker: input.symbol,
        held: input.held,
        action: input.held ? "ADD" : "BUY",
        conviction: 0.8,
        strategyFamily: "momentum",
        thesis: "bullish",
        signals: ["breakout"],
        prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", entry: input.price, target: input.price * 1.25, stop: input.price * 0.95 },
        technicals: input.technicals,
        fundamentals: input.fundamentals,
        sources: [],
        screen: input.screen,
      });
    },
  };
}

const DATE = "2026-06-01";
function makeApp(): App {
  return createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }),
    analyzer: bullishAnalyzer(),
    now: () => DATE,
  });
}

let app: App;
beforeEach(() => {
  app = makeApp();
});

describe("dailyRun → AI execution", () => {
  test("the AI book is funded at exactly $100k before any run", () => {
    expect(app.repos.portfolios.get(app.ai.id)?.cash).toBe(100_000);
  });

  test("the AI trades from the analysis against its own $100k book, journal-linked", async () => {
    await dailyRun(app);

    const trades = app.repos.tradeDecisions.listRecent();
    const filled = trades.filter((t) => t.status === "filled");
    expect(filled.length).toBeGreaterThan(0);

    // The fills landed on the AI's isolated DB book — holdings + debited cash, no broker account.
    const holdings = app.repos.holdings.listByPortfolio(app.ai.id);
    expect(holdings.length).toBeGreaterThan(0);
    expect(app.repos.portfolios.get(app.ai.id)!.cash).toBeLessThan(AI_STARTING_CASH);

    // The post-trade AI snapshot reflects this run's fills (fill-before-snapshot ordering).
    const snap = app.repos.snapshots.latestByPortfolio(app.ai.id);
    expect(snap!.positions.length).toBe(holdings.length);

    // Cohesion: at least one trade links back to a journal entry from this run.
    expect(filled.some((t) => t.journalEntryId != null)).toBe(true);

    // Capital discipline: total filled BUY notional never exceeds the book's starting equity.
    const deployed = filled.filter((t) => t.side === "buy").reduce((s, t) => s + t.notional, 0);
    expect(deployed).toBeLessThanOrEqual(AI_STARTING_CASH + 1); // +1 for rounding
  });

  test("a second run sees the AI's positions in the universe (no duplicate same-day buys)", async () => {
    await dailyRun(app);
    const firstCount = app.repos.tradeDecisions.listRecent().length;

    await dailyRun(app); // same date → duplicate-order guard should prevent re-buying the same names
    const dupSkips = app.repos.tradeDecisions.listRecent().filter((t) => t.reason === "already traded today");
    expect(dupSkips.length).toBeGreaterThan(0);
    expect(app.repos.tradeDecisions.listRecent().length).toBeGreaterThan(firstCount);
  });
});
