import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";
import { curateFacts } from "../knowledge/curate.ts";

const DATE = "2026-06-02";
let app: App;
let server: ReturnType<typeof createServer>;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE });
  server = createServer(app);
  curateFacts(app, {
    ticker: "NVDA",
    facts: [{ fact: "NVDA CUDA lock-in", citationUrl: "https://x.com/a", scope: "ticker", significance: 0.9, category: "moat" }],
    runId: "r1", reportId: "rep1", journalEntryId: "j1", now: `${DATE}T10:00:00.000Z`,
  });
});
const req = (path: string, init?: RequestInit) => server.fetch(new Request(`http://test/api${path}`, init));

describe("AI Library routes", () => {
  test("GET /ai-library/days returns day buckets with counts", async () => {
    const body = (await (await req("/ai-library/days")).json()) as { days: { date: string; factCount: number }[] };
    expect(body.days).toContainEqual({ date: DATE, factCount: 1 });
  });

  test("GET /ai-library/day/:date returns serialized insights", async () => {
    const body = (await (await req(`/ai-library/day/${DATE}`)).json()) as { facts: { headline: string }[] };
    expect(body.facts[0]!.headline).toBe("NVDA CUDA lock-in");
  });

  test("GET /ai-library/search filters by text and tag", async () => {
    const byText = (await (await req("/ai-library/search?q=cuda")).json()) as { insights: unknown[] };
    expect(byText.insights.length).toBe(1);
    const byTag = (await (await req("/ai-library/search?dimension=ticker&value=NVDA")).json()) as { insights: unknown[] };
    expect(byTag.insights.length).toBe(1);
    const miss = (await (await req("/ai-library/search?q=zzzznope")).json()) as { insights: unknown[] };
    expect(miss.insights.length).toBe(0);
  });

  test("GET /tags returns a taxonomy", async () => {
    const body = (await (await req("/tags")).json()) as { tags: { dimension: string; value: string; count: number }[] };
    expect(body.tags).toContainEqual({ dimension: "ticker", value: "NVDA", count: 1 });
  });

  test("PUT /ai-insights/fact/:id/tags adds a human tag", async () => {
    const id = app.repos.knowledge.listCuratedFacts()[0]!.id;
    const res = await req(`/ai-insights/fact/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ add: [{ dimension: "theme", value: "ai-infra" }], remove: [] }),
    });
    expect(res.status).toBe(200);
    const tags = (await res.json()) as { tags: { dimension: string; value: string; source: string }[] };
    expect(tags.tags).toContainEqual({ dimension: "theme", value: "ai-infra", source: "human" });
  });

  test("DELETE /ai-insights/fact/:id archives it (gone from the library)", async () => {
    const id = app.repos.knowledge.listCuratedFacts()[0]!.id;
    expect((await req(`/ai-insights/fact/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(app.repos.knowledge.listCuratedFacts().length).toBe(0);
  });

  test("search tolerates a non-numeric limit (does not silently drop results)", async () => {
    const body = (await (await req("/ai-library/search?q=cuda&limit=foo")).json()) as { insights: unknown[] };
    expect(body.insights.length).toBe(1);
  });

  test("an unsupported insight kind is rejected with 400", async () => {
    const id = app.repos.knowledge.listCuratedFacts()[0]!.id;
    expect((await req(`/ai-insights/thesis/${id}`, { method: "DELETE" })).status).toBe(400);
    const put = await req(`/ai-insights/thesis/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ add: [], remove: [] }),
    });
    expect(put.status).toBe(400);
  });
});
