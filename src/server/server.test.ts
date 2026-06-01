import { beforeEach, describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";

const DATE = "2026-06-01";

let app: App;
let server: Hono;

beforeEach(() => {
  app = createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }),
    now: () => DATE,
  });
  server = createServer(app);
});

const req = (path: string, init?: RequestInit) =>
  server.fetch(new Request(`http://test${path}`, init));

describe("health", () => {
  test("reports the active adapter", async () => {
    const res = await req("/api/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, adapter: "fake" });
  });
});

describe("holdings CRUD", () => {
  test("add, list, delete", async () => {
    const add = await req("/api/holdings", {
      method: "POST",
      body: JSON.stringify({ symbol: "aapl", shares: 5, costBasis: 150 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(add.status).toBe(201);
    const created = (await add.json()) as { id: string; symbol: string };
    expect(created.symbol).toBe("AAPL"); // normalized

    const list = (await (await req("/api/holdings")).json()) as unknown[];
    expect(list).toHaveLength(1);

    const del = await req(`/api/holdings/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect((await (await req("/api/holdings")).json()) as unknown[]).toHaveLength(0);
  });

  test("rejects invalid input with 400", async () => {
    const res = await req("/api/holdings", {
      method: "POST",
      body: JSON.stringify({ symbol: "AAPL", shares: -3 }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("404 when deleting a missing holding", async () => {
    const res = await req("/api/holdings/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("seed + run + state", () => {
  test("full flow: add → seed → run → snapshots + recommendations", async () => {
    await req("/api/holdings", {
      method: "POST",
      body: JSON.stringify({ symbol: "AAPL", shares: 10, costBasis: 150 }),
      headers: { "Content-Type": "application/json" },
    });

    const seed = (await (await req("/api/portfolios/ai/seed", { method: "POST" })).json()) as {
      seeded: boolean;
    };
    expect(seed.seeded).toBe(true);

    const portfolios = (await (await req("/api/portfolios")).json()) as {
      user: { equity: number; positions: unknown[] };
      ai: { positions: unknown[] };
    };
    expect(portfolios.user.positions).toHaveLength(1);
    expect(portfolios.ai.positions).toHaveLength(1);

    const run = (await (await req("/api/run", { method: "POST" })).json()) as { status: string };
    expect(run.status).toBe("ok");

    const snaps = (await (await req("/api/snapshots")).json()) as {
      user: unknown[];
      ai: unknown[];
      spy: unknown[];
    };
    expect(snaps.user).toHaveLength(1);
    expect(snaps.ai).toHaveLength(1);
    expect(snaps.spy).toHaveLength(1);

    const recs = (await (await req("/api/recommendations")).json()) as {
      report: { recommendations: unknown[] } | null;
    };
    expect(recs.report?.recommendations.length).toBeGreaterThan(0);

    const status = (await (await req("/api/status")).json()) as { lastRun: { status: string } };
    expect(status.lastRun.status).toBe("ok");
  });
});

describe("watchlist", () => {
  test("add, list, delete", async () => {
    const add = await req("/api/watchlist", {
      method: "POST", body: JSON.stringify({ symbol: "tsla" }), headers: { "Content-Type": "application/json" },
    });
    expect(add.status).toBe(201);
    const created = (await add.json()) as { id: string; symbol: string };
    expect(created.symbol).toBe("TSLA");
    expect(((await (await req("/api/watchlist")).json()) as unknown[]).length).toBe(1);
    const del = await req(`/api/watchlist/${created.id}`, { method: "DELETE" });
    expect(del.status).toBe(200);
  });

  test("rejects invalid input with 400", async () => {
    const res = await req("/api/watchlist", {
      method: "POST",
      body: JSON.stringify({ symbol: "1NV@LID" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });

  test("404 when deleting a missing watchlist item", async () => {
    const res = await req("/api/watchlist/nope", { method: "DELETE" });
    expect(res.status).toBe(404);
  });
});

describe("risk", () => {
  test("put then get a preset", async () => {
    const put = await req("/api/risk", {
      method: "PUT",
      body: JSON.stringify({ preset: "aggressive" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(put.status).toBe(200);
    const got = (await (await req("/api/risk")).json()) as { risk: { preset: string } };
    expect(got.risk.preset).toBe("aggressive");
  });

  test("rejects an unknown preset", async () => {
    const res = await req("/api/risk", {
      method: "PUT",
      body: JSON.stringify({ preset: "yolo" }),
      headers: { "Content-Type": "application/json" },
    });
    expect(res.status).toBe(400);
  });
});
