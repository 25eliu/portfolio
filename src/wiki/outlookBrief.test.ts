import { describe, expect, test } from "bun:test";
import { renderOutlook } from "./outlookBrief.ts";
import type { Thesis } from "../domain/index.ts";

const t = (over: Partial<Thesis>): Thesis => ({
  id: "x", runId: null, reportId: null, date: "2026-06-02", createdAt: "2026-06-02T00:00:00.000Z",
  level: "sector", subject: "Semis", subjectKey: "sector:semis", stance: "bullish", conviction: 0.7,
  horizon: "3mo", summary: "", thesis: "t", status: "active", supersedesId: null, freshnessDeadline: null,
  tickers: [], sources: [], ...over,
});

describe("renderOutlook", () => {
  test("renders regime + sector/theme leans", () => {
    const text = renderOutlook([
      t({ level: "regime", subject: "market", stance: "risk_on" }),
      t({ level: "sector", subject: "Semiconductors", stance: "bullish", conviction: 0.7 }),
      t({ level: "theme", subject: "AI infra", stance: "bullish", conviction: 0.6 }),
    ]);
    expect(text).toContain("OUTLOOK");
    expect(text).toContain("Regime: risk_on");
    expect(text).toContain("Semiconductors");
  });

  test("empty → empty string", () => {
    expect(renderOutlook([])).toBe("");
  });
});
