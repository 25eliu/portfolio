import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { persistOutlook } from "./curateTheses.ts";
import { nodeId, type Outlook } from "../domain/index.ts";

let app: App;
const NOW = "2026-06-02T00:00:00.000Z";
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ startingCash: 100_000 }), now: () => "2026-06-02", queryModel: null });
});

const outlook = (): Outlook => ({
  regime: { subject: "market", stance: "risk_on", conviction: 0.6, horizon: "1mo", summary: "Constructive", thesis: "Breadth improving.", tickers: [], sources: [] },
  sectors: [{ subject: "Semiconductors", stance: "bullish", conviction: 0.7, horizon: "3mo", summary: "Semis bullish", thesis: "Capex durable.", tickers: ["NVDA"], sources: [{ title: "x", url: "https://x.com" }] }],
  themes: [],
});

const report = { id: "rep1", outlook: outlook() };

describe("persistOutlook", () => {
  test("persists a thesis per item, tags it, cites a resolvable source, and links a graph node", () => {
    const r = persistOutlook(app, report, "run1", NOW);
    expect(r.added).toBe(2); // regime + 1 sector
    const sector = app.repos.aiTheses.currentByLevel("sector")[0]!;
    expect(sector.subject).toBe("Semiconductors");
    const node = nodeId("thesis", sector.id);
    const tags = app.repos.insightTags.tagsFor(node);
    expect(tags).toContainEqual({ dimension: "sector", value: "Semiconductors", source: "ai" });
    expect(tags).toContainEqual({ dimension: "direction", value: "bullish", source: "ai" });
    expect(tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
    const srcId = sector.sources[0]!.sourceId!;
    expect(app.repos.knowledge.getSource(srcId)?.kind).toBe("citation");
    expect(app.repos.knowledge.listUserSources().some((s) => s.id === srcId)).toBe(false);
    expect(sector.freshnessDeadline).not.toBeNull();
  });

  test("re-running supersedes the prior thesis for the same subject (one active per subject)", () => {
    persistOutlook(app, report, "run1", NOW);
    persistOutlook(app, { id: "rep2", outlook: outlook() }, "run2", "2026-06-03T00:00:00.000Z");
    expect(app.repos.aiTheses.currentByLevel("sector").length).toBe(1);
    expect(app.repos.aiTheses.historyForSubject("sector:semiconductors").length).toBe(2);
  });

  test("a null outlook is a no-op", () => {
    expect(persistOutlook(app, { id: "rep3", outlook: null }, "run3", NOW).added).toBe(0);
  });
});
