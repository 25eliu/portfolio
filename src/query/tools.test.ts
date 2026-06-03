import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { AI_STARTING_CASH } from "../domain/index.ts";
import { QUERY_TOOLS, QUERY_TOOLS_BY_NAME } from "./tools.ts";

const tool = (name: string) => QUERY_TOOLS_BY_NAME.get(name)!;

let app: App;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ startingCash: 100_000 }), now: () => "2026-06-02", queryModel: null });
});

describe("query tools registry", () => {
  test("every tool has a name, description, and an OBJECT parameter schema", () => {
    expect(QUERY_TOOLS.length).toBeGreaterThan(5);
    for (const t of QUERY_TOOLS) {
      expect(t.name).toBeTruthy();
      expect(t.description.length).toBeGreaterThan(10);
      expect((t.parameters as { type?: string }).type).toBe("OBJECT");
    }
  });

  test("portfolio_state reports both books; the AI starts at its $100k baseline", async () => {
    const state = (await tool("portfolio_state").run(app, {})) as { user: { equity: number }; ai: { equity: number; cash: number } };
    expect(state.ai.cash).toBe(AI_STARTING_CASH);
    expect(state.ai.equity).toBe(AI_STARTING_CASH); // flat: all cash
    expect(state.user).toBeDefined();
  });

  test("read tools return empty/grounded shapes on a fresh DB (no fabrication)", async () => {
    expect(await tool("cohort_metrics").run(app, {})).toEqual([]);
    expect(await tool("list_open_forecasts").run(app, {})).toEqual([]);
    expect(await tool("list_outcomes").run(app, {})).toEqual([]);
    expect(await tool("trade_decisions").run(app, {})).toEqual([]);
    expect((await tool("knowledge_search").run(app, { query: "anything" })) as { excerpts: unknown[] }).toEqual({ excerpts: [] });
  });

  test("graph_neighbors normalizes a bare ticker to a node id", async () => {
    const res = (await tool("graph_neighbors").run(app, { entity: "AAPL" })) as { node: { id: string } };
    expect(res.node.id).toBe("ticker:aapl");
  });
});

describe("query tool citations (cite)", () => {
  test("knowledge_search maps each excerpt to a knowledge source card carrying the focus ticker + source id", () => {
    const t = tool("knowledge_search");
    const result = { excerpts: [{ sourceId: "src1", title: "AI chips note", trust: "private_note", date: "2026-05-30", text: "datacenter demand…" }] };
    const cites = t.cite!({ query: "chips", ticker: "nvda" }, result);
    expect(cites).toEqual([
      { kind: "knowledge", title: "AI chips note", ticker: "NVDA", trust: "private_note", date: "2026-05-30", excerpt: "datacenter demand…", sourceId: "src1" },
    ]);
  });

  test("journal_calls caps source cards at 6 and carries the entry id + thesis for click-through", () => {
    const t = tool("journal_calls");
    const rows = Array.from({ length: 9 }, (_, i) => ({ id: `j${i}`, date: "2026-06-01", ticker: `T${i}`, action: "BUY", conviction: 0.7, thesis: `thesis ${i}` }));
    const cites = t.cite!({}, rows);
    expect(cites).toHaveLength(6);
    expect(cites[0]).toMatchObject({ kind: "journal", ticker: "T0", excerpt: "thesis 0", detail: "conviction 0.7", sourceId: "j0" });
  });

  test("list_lessons keeps the lesson id for citing while summarizing the body in the model payload", () => {
    const t = tool("list_lessons");
    const cites = t.cite!({}, [{ id: "all_time:overall", title: "Momentum wins", state: "active", n: 22 }]);
    expect(cites).toEqual([{ kind: "lesson", title: "Momentum wins", sourceId: "all_time:overall", detail: "active · n=22" }]);
  });

  test("data-only tools expose no cite() (they stay as tool badges, not source cards)", () => {
    expect(tool("portfolio_state").cite).toBeUndefined();
    expect(tool("trade_decisions").cite).toBeUndefined();
  });

  test("search_ai_insights returns the AI's curated facts by text and tag, with citations", async () => {
    const { curateFacts } = await import("../knowledge/curate.ts");
    curateFacts(app, {
      ticker: "NVDA",
      facts: [{ fact: "NVDA CUDA lock-in is a durable moat", citationUrl: "https://x.com/a", scope: "ticker", significance: 0.9, category: "moat" }],
      runId: "r1", reportId: "rep1", journalEntryId: "j1", now: "2026-06-02T10:00:00.000Z",
    });
    const t = tool("search_ai_insights");
    const res = (await t.run(app, { query: "cuda" })) as { insights: { headline: string }[] };
    expect(res.insights[0]!.headline).toContain("CUDA");
    const cites = t.cite!({ query: "cuda" }, res);
    expect(cites[0]!.title).toBe("x.com");
    const factId = app.repos.knowledge.listCuratedFacts()[0]!.id;
    expect(cites[0]!.sourceId).toBe(factId);
  });
});
