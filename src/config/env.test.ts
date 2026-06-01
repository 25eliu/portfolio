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
});
