import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories, type Repositories } from "./index.ts";
import { newId } from "../domain/index.ts";

function seedUserPortfolio(repos: Repositories): string {
  const id = newId();
  repos.portfolios.insert({
    id,
    name: "My Portfolio",
    kind: "user",
    decisionSource: "manual",
    alpacaAccount: null,
    cash: 0,
    createdAt: new Date().toISOString(),
  });
  return id;
}

let repos: Repositories;
beforeEach(() => {
  repos = repositories(openMemoryDb());
});

describe("portfolios + holdings", () => {
  test("insert and fetch a portfolio by kind", () => {
    const id = seedUserPortfolio(repos);
    expect(repos.portfolios.getByKind("user")?.id).toBe(id);
    expect(repos.portfolios.list()).toHaveLength(1);
  });

  test("upsert holding is idempotent by symbol", () => {
    const pid = seedUserPortfolio(repos);
    repos.holdings.upsert(pid, { symbol: "AAPL", shares: 5 });
    repos.holdings.upsert(pid, { symbol: "AAPL", shares: 9, costBasis: 180 });
    const holdings = repos.holdings.listByPortfolio(pid);
    expect(holdings).toHaveLength(1);
    expect(holdings[0]!.shares).toBe(9);
    expect(holdings[0]!.costBasis).toBe(180);
  });

  test("remove holding", () => {
    const pid = seedUserPortfolio(repos);
    const h = repos.holdings.upsert(pid, { symbol: "NVDA", shares: 1 });
    expect(repos.holdings.remove(h.id)).toBe(true);
    expect(repos.holdings.listByPortfolio(pid)).toHaveLength(0);
  });

  test("rejects an invalid symbol at the repo boundary", () => {
    const pid = seedUserPortfolio(repos);
    expect(() => repos.holdings.upsert(pid, { symbol: "AAPL", shares: -1 } as never)).toThrow();
  });
});

describe("snapshots + market snapshots", () => {
  test("snapshots ordered by date, latest works", () => {
    const pid = seedUserPortfolio(repos);
    repos.snapshots.upsert({
      id: newId(),
      portfolioId: pid,
      date: "2026-05-30",
      totalValue: 1000,
      cash: 100,
      positions: [],
    });
    repos.snapshots.upsert({
      id: newId(),
      portfolioId: pid,
      date: "2026-06-01",
      totalValue: 1100,
      cash: 100,
      positions: [
        { symbol: "AAPL", shares: 5, price: 200, marketValue: 1000, dayPnL: null, totalPnL: null, costBasis: null, acquiredAt: null },
      ],
    });
    const all = repos.snapshots.listByPortfolio(pid);
    expect(all.map((s) => s.date)).toEqual(["2026-05-30", "2026-06-01"]);
    expect(repos.snapshots.latestByPortfolio(pid)?.totalValue).toBe(1100);
  });

  test("snapshot upsert replaces same portfolio+date", () => {
    const pid = seedUserPortfolio(repos);
    const base = { id: newId(), portfolioId: pid, date: "2026-06-01", cash: 0, positions: [] };
    repos.snapshots.upsert({ ...base, totalValue: 500 });
    repos.snapshots.upsert({ ...base, id: newId(), totalValue: 700 });
    const all = repos.snapshots.listByPortfolio(pid);
    expect(all).toHaveLength(1);
    expect(all[0]!.totalValue).toBe(700);
  });

  test("market snapshot upsert", () => {
    repos.marketSnapshots.upsert("2026-06-01", 540.2);
    repos.marketSnapshots.upsert("2026-06-01", 541.0);
    const list = repos.marketSnapshots.list();
    expect(list).toHaveLength(1);
    expect(list[0]!.spyClose).toBe(541.0);
  });
});

describe("reports", () => {
  test("latest returns the most recent report", () => {
    repos.reports.insert({
      id: newId(),
      date: "2026-06-01",
      generatedAt: "2026-06-01T20:00:00.000Z",
      source: "fake",
      recommendations: [],
      marketContext: null,
    });
    expect(repos.reports.latest()?.date).toBe("2026-06-01");
  });

  test("round-trips marketContext", () => {
    repos.reports.insert({
      id: newId(),
      date: "2026-06-02",
      generatedAt: "2026-06-02T20:00:00.000Z",
      source: "llm",
      recommendations: [],
      marketContext: {
        date: "2026-06-02",
        spyTrend: "up",
        spyPctFromSma200: 3.2,
        macroSummary: "risk-on",
        sources: [{ title: "X", url: "https://example.com" }],
        macro: null,
      },
    });
    const latest = repos.reports.latest();
    expect(latest?.marketContext?.spyTrend).toBe("up");
    expect(latest?.marketContext?.macroSummary).toBe("risk-on");
    expect(latest?.marketContext?.sources).toHaveLength(1);
  });

  test("latest() skips legacy/unreadable reports and returns the newest valid one", () => {
    const db = openMemoryDb();
    const r = repositories(db);
    r.reports.insert({
      id: newId(),
      date: "2026-06-01",
      generatedAt: "2026-06-01T00:00:00.000Z",
      source: "llm",
      recommendations: [],
      marketContext: null,
    });
    // A NEWER legacy row from the old schema (technicals.macd used to be a string).
    db.query(
      `INSERT INTO reports (id, date, generated_at, source, recommendations_json, market_context_json)
       VALUES (?, ?, ?, ?, ?, NULL)`,
    ).run(
      "legacy1",
      "2026-07-01",
      "2026-07-01T00:00:00.000Z",
      "fake",
      JSON.stringify([
        { ticker: "AAPL", action: "BUY", conviction: 0.5, horizon: "5d", strategyFamily: "x", thesis: "t", signals: [], technicals: { macd: "bullish_cross" } },
      ]),
    );
    expect(r.reports.latest()?.date).toBe("2026-06-01");
  });
});

describe("runs", () => {
  test("start then finish updates status", () => {
    const id = repos.runs.start();
    expect(repos.runs.latest()?.status).toBe("running");
    repos.runs.finish(id, "ok");
    const latest = repos.runs.latest();
    expect(latest?.status).toBe("ok");
    expect(latest?.finishedAt).not.toBeNull();
  });

  test("abandonRunning clears stale running rows (so a new run isn't blocked)", () => {
    repos.runs.start();
    repos.runs.start(); // two leftover "running" rows from killed processes
    expect(repos.runs.abandonRunning()).toBe(2);
    expect(repos.runs.latest()?.status).toBe("error");
    expect(repos.runs.latest()?.error).toContain("abandoned");
    expect(repos.runs.abandonRunning()).toBe(0); // nothing left to clear
  });
});

describe("risk profiles", () => {
  test("set then get a preset", () => {
    const pid = seedUserPortfolio(repos);
    repos.risk.set(pid, "aggressive");
    expect(repos.risk.get(pid)?.preset).toBe("aggressive");
    repos.risk.set(pid, "conservative");
    expect(repos.risk.get(pid)?.preset).toBe("conservative");
  });
});
