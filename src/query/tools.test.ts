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
