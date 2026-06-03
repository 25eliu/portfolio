import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { curateFacts } from "./curate.ts";
import { serializeFact } from "./serialize.ts";

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
