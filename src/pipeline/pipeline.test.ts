import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { fakePrice } from "../market/fake/pricing.ts";
import { dailyRun } from "./dailyRun.ts";
import { priceUserPortfolio } from "./pricing.ts";
import { generateFakeReport } from "./fakeReport.ts";
import { DailyReport } from "../domain/index.ts";

const DATE = "2026-06-01";

function makeApp(now = () => DATE): App {
  return createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now, startingCash: 100_000 }),
    now,
  });
}

let app: App;
beforeEach(() => {
  app = makeApp();
});

describe("priceUserPortfolio", () => {
  test("prices holdings and computes cost-based P&L", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 100 });
    const view = await priceUserPortfolio(app);
    const price = fakePrice("AAPL", DATE);
    expect(view.positions[0]!.marketValue).toBeCloseTo(10 * price, 2);
    expect(view.totalPnL).toBeCloseTo((price - 100) * 10, 2);
    expect(view.dayPnL).toBeNull(); // no prior snapshot
  });
});

describe("generateFakeReport", () => {
  test("is schema-valid and includes held + default symbols", () => {
    const report = generateFakeReport(["TSLA"], DATE);
    expect(() => DailyReport.parse(report)).not.toThrow();
    const tickers = report.recommendations.map((r) => r.ticker);
    expect(tickers).toContain("TSLA");
    expect(tickers).toContain("AAPL"); // default watchlist
  });
});

describe("dailyRun", () => {
  test("end-to-end: prices both, persists snapshots + report + run", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 150 });

    const result = await dailyRun(app);
    expect(result.status).toBe("ok");
    expect(result.portfolios).toHaveLength(2);

    // snapshots written for both portfolios
    expect(app.repos.snapshots.listByPortfolio(app.user.id)).toHaveLength(1);
    expect(app.repos.snapshots.listByPortfolio(app.ai.id)).toHaveLength(1);
    // SPY benchmark recorded
    expect(app.repos.marketSnapshots.list()).toHaveLength(1);
    // report + run recorded
    expect(app.repos.reports.latest()?.id).toBe(result.report.id);
    expect(app.repos.runs.latest()?.status).toBe("ok");
  });

  test("day P&L appears on the second run with a later date", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "MSFT", shares: 4 });

    const day1 = makeApp(() => "2026-06-01");
    day1.repos.holdings.upsert(day1.user.id, { symbol: "MSFT", shares: 4 });
    await dailyRun(day1);
    // second run on the same db, later date
    const laterApp: App = { ...day1, now: () => "2026-06-02" };
    const result = await dailyRun(laterApp);
    const user = result.portfolios.find((p) => p.kind === "user")!;
    expect(user.dayPnL).not.toBeNull();
  });

  test("records an error run when a step throws", async () => {
    const broken: App = {
      ...app,
      gateway: {
        ...app.gateway,
        getQuotes: async () => {
          throw new Error("boom");
        },
      },
    };
    await expect(dailyRun(broken)).rejects.toThrow("boom");
    expect(app.repos.runs.latest()?.status).toBe("error");
    expect(app.repos.runs.latest()?.error).toContain("boom");
  });
});
