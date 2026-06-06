import { describe, expect, test } from "bun:test";
import { createFakeGateway } from "./index.ts";
import { fakePrice } from "./pricing.ts";

const FIXED = "2026-06-01";
const clock = () => FIXED;

describe("fake pricing", () => {
  test("is deterministic per (symbol, date)", () => {
    expect(fakePrice("AAPL", FIXED)).toBe(fakePrice("AAPL", FIXED));
  });
  test("differs across dates", () => {
    expect(fakePrice("AAPL", "2026-06-01")).not.toBe(fakePrice("AAPL", "2026-06-02"));
  });
  test("produces a sane positive price", () => {
    const p = fakePrice("NVDA", FIXED);
    expect(p).toBeGreaterThan(0);
    expect(p).toBeLessThan(1000);
  });
});

describe("fake gateway market data", () => {
  test("getQuote matches the deterministic price", async () => {
    const gw = createFakeGateway({ now: clock });
    const q = await gw.getQuote("AAPL");
    expect(q.price).toBe(fakePrice("AAPL", FIXED));
  });
  test("getQuote exposes the previous calendar day's close as the day-P&L baseline", async () => {
    const gw = createFakeGateway({ now: clock });
    const q = await gw.getQuote("AAPL");
    expect(q.previousClose).toBe(fakePrice("AAPL", "2026-05-31"));
  });
  test("getBars returns the requested number of days ending today", async () => {
    const gw = createFakeGateway({ now: clock });
    const bars = await gw.getBars("MSFT", 5);
    expect(bars).toHaveLength(5);
    expect(bars[4]!.date).toBe(FIXED);
  });
});

describe("fake gateway market data — extended", () => {
  test("getBars returns the full lookback window of history", async () => {
    const gw = createFakeGateway({ now: clock });
    const bars = await gw.getBars("AAPL", 250);
    expect(bars.length).toBe(250);
    expect(bars[0]!.date < bars[249]!.date).toBe(true);
    expect(bars[249]!.date).toBe(FIXED);
  });

  test("getMovers returns a deterministic candidate set", async () => {
    const gw = createFakeGateway({ now: clock });
    const movers = await gw.getMovers(5);
    expect(movers.length).toBe(5);
    expect(movers.every((m) => typeof m.symbol === "string" && m.changePct != null)).toBe(true);
    const again = await gw.getMovers(5);
    expect(again.map((m) => m.symbol)).toEqual(movers.map((m) => m.symbol));
  });
});

describe("fake gateway brokerage", () => {
  test("buy reduces cash and creates a position", async () => {
    const gw = createFakeGateway({ now: clock, startingCash: 100_000 });
    const order = await gw.placeOrder({ symbol: "AAPL", qty: 10, side: "buy" });
    expect(order.status).toBe("filled");
    const positions = await gw.getPositions();
    expect(positions).toHaveLength(1);
    expect(positions[0]!.shares).toBe(10);
    expect(positions[0]!.previousClose).toBe(fakePrice("AAPL", "2026-05-31"));
    const account = await gw.getAccount();
    const price = fakePrice("AAPL", FIXED);
    expect(account.cash).toBeCloseTo(100_000 - 10 * price, 2);
    // portfolio value conserved (cash spent == position value at same price)
    expect(account.portfolioValue).toBeCloseTo(100_000, 2);
  });

  test("averaged entry across two buys", async () => {
    const gw = createFakeGateway({ now: clock });
    await gw.placeOrder({ symbol: "NVDA", qty: 4, side: "buy" });
    await gw.placeOrder({ symbol: "NVDA", qty: 6, side: "buy" });
    const [pos] = await gw.getPositions();
    expect(pos!.shares).toBe(10);
    expect(pos!.avgEntry).toBeCloseTo(fakePrice("NVDA", FIXED), 2);
  });

  test("closePosition liquidates the holding", async () => {
    const gw = createFakeGateway({ now: clock });
    await gw.placeOrder({ symbol: "TSLA", qty: 3, side: "buy" });
    await gw.closePosition("TSLA");
    expect(await gw.getPositions()).toHaveLength(0);
  });
});
