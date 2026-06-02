import { describe, expect, test } from "bun:test";
import { loadEnv } from "./env.ts";

describe("loadEnv", () => {
  test("defaults to the fake adapter with no credentials", () => {
    const e = loadEnv({});
    expect(e.MARKET_ADAPTER).toBe("fake");
    expect(e.PORT).toBe(8787);
    expect(e.ALPACA_PAPER).toBe(true);
  });

  test("coerces PORT and parses ALPACA_PAPER", () => {
    const e = loadEnv({ PORT: "9000", ALPACA_PAPER: "false", MARKET_ADAPTER: "fake" });
    expect(e.PORT).toBe(9000);
    expect(e.ALPACA_PAPER).toBe(false);
  });

  test("rejects an invalid adapter name", () => {
    expect(() => loadEnv({ MARKET_ADAPTER: "etrade" })).toThrow(/Invalid environment/);
  });

  test("requires Alpaca credentials when adapter=alpaca", () => {
    expect(() => loadEnv({ MARKET_ADAPTER: "alpaca" })).toThrow(/requires ALPACA_KEY_ID/);
  });

  test("refuses alpaca adapter unless paper trading", () => {
    expect(() =>
      loadEnv({
        MARKET_ADAPTER: "alpaca",
        ALPACA_KEY_ID: "k",
        ALPACA_SECRET: "s",
        ALPACA_PAPER: "false",
      }),
    ).toThrow(/paper-only/);
  });

  test("accepts a valid alpaca configuration", () => {
    const e = loadEnv({ MARKET_ADAPTER: "alpaca", ALPACA_KEY_ID: "k", ALPACA_SECRET: "s" });
    expect(e.MARKET_ADAPTER).toBe("alpaca");
    expect(e.ALPACA_KEY_ID).toBe("k");
  });

  test("defaults the Phase 2 analysis knobs", () => {
    const e = loadEnv({});
    expect(e.GEMINI_MODEL).toBe("gemini-3.1-pro-preview");
    expect(e.GEMINI_THINKING_LEVEL).toBe("medium");
    expect(e.LLM_CONCURRENCY).toBe(4);
    expect(e.MAX_SCAN_CANDIDATES).toBe(8);
    expect(e.MAX_THEMATIC_CANDIDATES).toBe(5);
    expect(e.MAX_WATCH_SURFACED).toBe(6);
    expect(e.GEMINI_API_KEY).toBe("");
    expect(e.FMP_API_KEY).toBe("");
  });

  test("coerces LLM_CONCURRENCY, MAX_SCAN_CANDIDATES, and MAX_WATCH_SURFACED", () => {
    const e = loadEnv({ LLM_CONCURRENCY: "8", MAX_SCAN_CANDIDATES: "12", MAX_WATCH_SURFACED: "3" });
    expect(e.LLM_CONCURRENCY).toBe(8);
    expect(e.MAX_SCAN_CANDIDATES).toBe(12);
    expect(e.MAX_WATCH_SURFACED).toBe(3);
  });

  test("rejects an invalid thinking level", () => {
    expect(() => loadEnv({ GEMINI_THINKING_LEVEL: "ultra" })).toThrow(/Invalid environment/);
  });
});
