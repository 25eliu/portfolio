import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";

const DATE = "2026-06-02";
let app: App;
let server: ReturnType<typeof createServer>;
const seed = (over: Record<string, unknown> = {}) =>
  app.repos.aiTheses.insert({
    id: "t1", runId: "r1", reportId: "rep1", date: DATE, createdAt: `${DATE}T00:00:00.000Z`,
    level: "sector", subject: "Semiconductors", subjectKey: "sector:semiconductors", stance: "bullish",
    conviction: 0.7, horizon: "3mo", summary: "Semis bullish", thesis: "Capex durable.", status: "active",
    supersedesId: null, freshnessDeadline: null, tickers: ["NVDA"], sources: [], ...over,
  } as Parameters<typeof app.repos.aiTheses.insert>[0]);

beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE });
  server = createServer(app);
});
const req = (path: string) => server.fetch(new Request(`http://test/api${path}`));

describe("market view API", () => {
  test("GET /market-view/current returns regime + sectors + themes", async () => {
    seed({ id: "r", level: "regime", subject: "market", subjectKey: "regime:market", stance: "risk_on" });
    seed({ id: "s" });
    const body = (await (await req("/market-view/current")).json()) as { regime: unknown; sectors: { subject: string }[]; themes: unknown[] };
    expect(body.regime).not.toBeNull();
    expect(body.sectors[0]!.subject).toBe("Semiconductors");
  });

  test("GET /market-view/subject/:level/:subject returns the supersede history", async () => {
    seed({ id: "s1" });
    app.repos.aiTheses.supersedePriorActive("sector:semiconductors");
    seed({ id: "s2", supersedesId: "s1" });
    const body = (await (await req("/market-view/subject/sector/Semiconductors")).json()) as { history: { id: string }[] };
    expect(body.history.map((h) => h.id)).toEqual(["s2", "s1"]);
  });
});
