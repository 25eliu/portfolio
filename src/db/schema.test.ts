import { describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "./index.ts";
import { MIGRATIONS } from "./schema.ts";
import { newId } from "../domain/index.ts";

describe("migration 016_reset_ai_book", () => {
  test("wipes stale AI holdings/snapshots/trade_decisions and funds cash to 100k", () => {
    const db = openMemoryDb(); // all migrations applied; tables exist, no portfolios yet
    const repos = repositories(db);

    const aiId = newId();
    repos.portfolios.insert({ id: aiId, name: "AI Portfolio", kind: "ai_shadow", decisionSource: "llm", alpacaAccount: null, cash: 0, createdAt: "2026-05-01T00:00:00.000Z" });
    repos.holdings.setPosition(aiId, "AAPL", 10, 100, "2026-05-01");
    repos.snapshots.upsert({ id: newId(), portfolioId: aiId, date: "2026-05-01", totalValue: 1000, cash: 0, positions: [] });
    repos.tradeDecisions.insert({ id: newId(), runId: null, journalEntryId: null, forecastId: null, ticker: "AAPL", side: "buy", action: "BUY", qty: 10, intendedPrice: 100, notional: 1000, status: "filled", reason: null, brokerOrderId: null, createdAt: "2026-05-01T00:00:00.000Z", submittedAt: null });

    const step = MIGRATIONS.find((m) => m.name === "016_reset_ai_book");
    expect(step).toBeDefined();
    db.exec(step!.sql);

    expect(repos.portfolios.get(aiId)?.cash).toBe(100000);
    expect(repos.holdings.listByPortfolio(aiId)).toHaveLength(0);
    expect(repos.snapshots.listByPortfolio(aiId)).toHaveLength(0);
    expect(repos.tradeDecisions.listRecent()).toHaveLength(0);
  });
});
