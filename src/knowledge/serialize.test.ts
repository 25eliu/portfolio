import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { curateFacts } from "./curate.ts";
import { serializeFact, serializeThesis } from "./serialize.ts";
import type { Thesis } from "../domain/index.ts";

let app: App;
const NOW = "2026-06-02T12:00:00.000Z";
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ startingCash: 100_000 }), now: () => "2026-06-02", queryModel: null });
  curateFacts(app, {
    ticker: "NVDA",
    facts: [{ fact: "NVDA CUDA lock-in", citationUrl: "https://nvidianews.nvidia.com/x", scope: "ticker", significance: 0.88, category: "moat" }],
    runId: "r1", reportId: "rep1", journalEntryId: "j1", now: NOW,
  });
});

describe("serializeFact → AiInsight", () => {
  test("produces the canonical fact shape with tags, ticker, significance, and citation", () => {
    const raw = app.repos.knowledge.listCuratedFacts()[0]!;
    const insight = serializeFact(app, raw);
    expect(insight.kind).toBe("fact");
    expect(insight.level).toBe("fact");
    expect(insight.date).toBe("2026-06-02");
    expect(insight.subject).toBe("NVDA");
    expect(insight.headline).toBe("NVDA CUDA lock-in");
    expect(insight.body).toBe("");
    expect(insight.stance).toBeNull();
    expect(insight.significance).toBe(0.88);
    expect(insight.tickers).toEqual(["NVDA"]);
    expect(insight.tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
    expect(insight.sources).toEqual([{ title: "nvidianews.nvidia.com", url: "https://nvidianews.nvidia.com/x" }]);
    expect(insight.status).toBe("active");
    expect(insight.provenance.runId).toBe("r1");
  });
});

test("serializeThesis → AiInsight (thesis variant)", () => {
  const t: Thesis = {
    id: "t1", runId: "r1", reportId: "rep1", date: "2026-06-02", createdAt: "2026-06-02T00:00:00.000Z",
    level: "sector", subject: "Semiconductors", subjectKey: "sector:semiconductors", stance: "bullish",
    conviction: 0.7, horizon: "3mo", summary: "Semis bullish", thesis: "Capex durable.", status: "active",
    supersedesId: null, freshnessDeadline: null, tickers: ["NVDA"], sources: [{ title: "x", url: "https://x.com", sourceId: "src_1" }],
  };
  const i = serializeThesis(t);
  expect(i.kind).toBe("thesis");
  expect(i.level).toBe("sector");
  expect(i.subject).toBe("Semiconductors");
  expect(i.headline).toBe("Semis bullish");
  expect(i.body).toBe("Capex durable.");
  expect(i.stance).toBe("bullish");
  expect(i.conviction).toBe(0.7);
  expect(i.tickers).toEqual(["NVDA"]);
  expect(i.sources).toEqual([{ title: "x", url: "https://x.com", sourceId: "src_1" }]);
  expect(i.tags).toContainEqual({ dimension: "sector", value: "Semiconductors", source: "ai" });
  expect(i.tags).toContainEqual({ dimension: "direction", value: "bullish", source: "ai" });
  expect(i.tags).toContainEqual({ dimension: "horizon", value: "3mo", source: "ai" });
  expect(i.tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
});

test("serializeThesis normalizes a regime stance into a bullish/bearish direction tag", () => {
  const t = { id: "r1", runId: null, reportId: null, date: "2026-06-02", createdAt: "2026-06-02T00:00:00.000Z", level: "regime", subject: "market", subjectKey: "regime:market", stance: "risk_on", conviction: 0.6, horizon: "1mo", summary: "constructive", thesis: "breadth", status: "active", supersedesId: null, freshnessDeadline: null, tickers: [], sources: [] } as import("../domain/index.ts").Thesis;
  const i = serializeThesis(t);
  expect(i.tags).toContainEqual({ dimension: "direction", value: "bullish", source: "ai" });
});
