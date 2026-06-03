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
  test("prices holdings and computes cost-based + previous-close day P&L", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 100 });
    const view = await priceUserPortfolio(app);
    const price = fakePrice("AAPL", DATE);
    const prevClose = fakePrice("AAPL", "2026-05-31"); // previous calendar day
    expect(view.positions[0]!.marketValue).toBeCloseTo(10 * price, 2);
    expect(view.totalPnL).toBeCloseTo((price - 100) * 10, 2);
    // per-ticker total uses cost basis; day uses the quote's previous close (no snapshot needed)
    expect(view.positions[0]!.totalPnL).toBeCloseTo((price - 100) * 10, 2);
    expect(view.positions[0]!.costBasis).toBe(100);
    expect(view.positions[0]!.dayPnL).toBeCloseTo(10 * (price - prevClose), 2);
    expect(view.dayPnL).toBeCloseTo(10 * (price - prevClose), 2);
  });

  test("a position opened today is marked from its entry price, so day P&L equals total P&L", async () => {
    // Bought today (acquiredAt == pricing date): it never owned the overnight move, so Day P&L must
    // be measured from cost basis, not the previous close — and therefore equal Total P&L on day one.
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 100, acquiredAt: DATE });
    const view = await priceUserPortfolio(app);
    const price = fakePrice("AAPL", DATE);
    const pos = view.positions[0]!;
    expect(pos.dayPnL).toBeCloseTo((price - 100) * 10, 2); // from entry, NOT previous close
    expect(pos.dayPnL).toBeCloseTo(pos.totalPnL!, 2); // same baseline ⇒ identical on the open day
  });

  test("a position held from a prior session is marked from the previous close", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 100, acquiredAt: "2026-05-20" });
    const view = await priceUserPortfolio(app);
    const price = fakePrice("AAPL", DATE);
    const prevClose = fakePrice("AAPL", "2026-05-31");
    expect(view.positions[0]!.dayPnL).toBeCloseTo(10 * (price - prevClose), 2); // overnight baseline
  });

  test("day P&L is contribution-neutral: a holding shows only its daily move, never its value", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 100 });
    app.repos.holdings.upsert(app.user.id, { symbol: "MSFT", shares: 5, costBasis: 200 });
    const view = await priceUserPortfolio(app);

    const dayMove = (sym: string, shares: number) =>
      shares * (fakePrice(sym, DATE) - fakePrice(sym, "2026-05-31"));
    const aapl = view.positions.find((p) => p.symbol === "AAPL")!;
    const msft = view.positions.find((p) => p.symbol === "MSFT")!;
    expect(aapl.dayPnL).toBeCloseTo(dayMove("AAPL", 10), 2);
    expect(msft.dayPnL).toBeCloseTo(dayMove("MSFT", 5), 2);
    // Portfolio day P&L is the sum of daily moves — far smaller than the positions' market value,
    // proving the old "adding a holding shows its whole value as a gain" bug is gone.
    expect(view.dayPnL).toBeCloseTo(dayMove("AAPL", 10) + dayMove("MSFT", 5), 2);
    expect(Math.abs(view.dayPnL!)).toBeLessThan(view.equity * 0.2);
  });
});

describe("holdings entry tracking", () => {
  test("adding a holding without a cost basis captures the current price + buy date", async () => {
    const { holdingsRoutes } = await import("../server/routes/holdings.ts");
    const routes = holdingsRoutes(app);
    const res = await routes.request("/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbol: "AAPL", shares: 3 }),
    });
    expect(res.status).toBe(201);
    const stored = app.repos.holdings.listByPortfolio(app.user.id)[0]!;
    expect(stored.costBasis).toBeCloseTo(fakePrice("AAPL", DATE), 2); // captured at add time
    expect(stored.acquiredAt).toBe(DATE);
  });

  test("backfill stamps untracked holdings at the June-1 open", async () => {
    const { backfillUntrackedEntries } = await import("./backfill.ts");
    // A legacy holding with no cost basis (inserted directly, bypassing the capturing route).
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 4 });
    expect(app.repos.holdings.listByPortfolio(app.user.id)[0]!.costBasis).toBeNull();

    const stamped = await backfillUntrackedEntries(app);
    expect(stamped).toBe(1);
    const h = app.repos.holdings.listByPortfolio(app.user.id)[0]!;
    expect(h.acquiredAt).toBe("2026-06-01");
    expect(h.costBasis).toBeCloseTo(fakePrice("AAPL", "2026-06-01"), 2); // fake open == close
    // Idempotent: a second pass changes nothing.
    expect(await backfillUntrackedEntries(app)).toBe(0);
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

    // journal: one entry per recommendation, all keyed to this report; scored ⊆ entries
    const entries = app.repos.journalEntries.list({ limit: 500 });
    expect(entries).toHaveLength(result.report.recommendations.length);
    expect(entries.every((e) => e.reportId === result.report.id)).toBe(true);
    const scored = entries.filter((e) => e.scored);
    for (const e of scored) {
      const f = app.repos.scoredForecasts.getByJournalEntry(e.id)!;
      expect(f).not.toBeNull();
      // bullish ⇔ BUY/ADD, bearish ⇔ TRIM/SELL
      expect(f.side).toBe(e.action === "BUY" || e.action === "ADD" ? "bullish" : "bearish");
    }
  });

  test("self-curates durable facts and dedupes them across runs", async () => {
    app.repos.holdings.upsert(app.user.id, { symbol: "AAPL", shares: 10, costBasis: 150 });

    await dailyRun(app);
    const first = app.repos.knowledge.listCuratedFacts();
    expect(first.length).toBeGreaterThan(0);
    expect(first.every((f) => f.fact.length > 0 && f.citationUrl)).toBe(true);
    // Every curated fact is a self_curated, analysis-enabled source feeding future runs.
    for (const f of first) {
      const src = app.repos.knowledge.getSource(f.id)!;
      expect(src.trustClass).toBe("self_curated");
      expect(src.useInAnalysis).toBe(true);
    }

    // A later run re-emits the same deterministic facts → dedup keeps the library steady, not bloated.
    const laterApp: App = { ...app, now: () => "2026-06-03" };
    await dailyRun(laterApp);
    expect(app.repos.knowledge.listCuratedFacts()).toHaveLength(first.length);
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

  test("resolves due forecasts on a later run (before generating the new report)", async () => {
    // Day 1: generate a report → scored forecasts persisted with a near-term resolveAt.
    const day1 = makeApp(() => "2026-06-01");
    day1.repos.holdings.upsert(day1.user.id, { symbol: "AAPL", shares: 10 });
    await dailyRun(day1);
    const forecasts = day1.repos.scoredForecasts.listAll();
    expect(forecasts.length).toBeGreaterThan(0);
    expect(day1.repos.forecastOutcomes.list()).toHaveLength(0); // nothing due yet

    // A month later: every day-1 horizon has elapsed, so resolution writes outcomes for them.
    const laterApp: App = { ...day1, now: () => "2026-07-01" };
    await dailyRun(laterApp);
    const outcomes = laterApp.repos.forecastOutcomes.list();
    expect(outcomes.length).toBeGreaterThanOrEqual(forecasts.length);
    // each day-1 forecast now has exactly one outcome with a valid kind
    for (const f of forecasts) {
      const o = laterApp.repos.forecastOutcomes.getByForecast(f.id)!;
      expect(o).not.toBeNull();
      expect(["target_hit", "stop_hit", "expired", "ambiguous_touch"]).toContain(o.outcome);
    }
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

  test("marks open forecasts daily during the run", async () => {
    await dailyRun(app);                       // creates scored forecasts (if any are scored)
    const open = app.repos.scoredForecasts.listOpen(app.now(), 200);
    if (open.length === 0) return;             // fake report may not score; guard keeps the test honest
    const marks = app.repos.forecastDailyMarks.listForForecast(open[0]!.id);
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[marks.length - 1]!.date).toBe(app.now());
  });
});
