import { describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../db/index.ts";
import { createFakeFundamentals } from "./fake/index.ts";
import { cached } from "./index.ts";
import { Fundamentals } from "../domain/fundamentals.ts";
import { finnhubAnalystRating, finnhubNextEarnings } from "./finnhub/index.ts";
import { loadEnv } from "../config/env.ts";

describe("fake fundamentals", () => {
  test("returns a schema-valid, deterministic object", async () => {
    const f = createFakeFundamentals();
    const a = await f.get("AAPL");
    expect(() => Fundamentals.parse(a)).not.toThrow();
    expect(a.symbol).toBe("AAPL");
    const b = await f.get("AAPL");
    expect(b.peTrailing).toBe(a.peTrailing);
  });
  test("screen returns symbols", async () => {
    const f = createFakeFundamentals();
    expect((await f.screen({ limit: 3 })).length).toBeGreaterThan(0);
  });
});

describe("finnhub helpers — no FINNHUB_API_KEY", () => {
  const env = loadEnv({});

  test("finnhubAnalystRating returns null without a key (no network call)", async () => {
    const result = await finnhubAnalystRating(env, "AAPL");
    expect(result).toBeNull();
  });

  test("finnhubNextEarnings returns null without a key (no network call)", async () => {
    const result = await finnhubNextEarnings(env, "AAPL");
    expect(result).toBeNull();
  });
});

describe("daily cache", () => {
  test("fetches once per (symbol, date), then serves from cache", async () => {
    const repos = repositories(openMemoryDb());
    let calls = 0;
    const source = {
      kind: "fake" as const,
      async get(symbol: string) { calls++; return Fundamentals.parse({ symbol }); },
      async screen() { return []; },
    };
    const c = cached(source, repos, () => "2026-06-01");
    await c.get("AAPL");
    await c.get("AAPL");
    expect(calls).toBe(1);
  });
});
