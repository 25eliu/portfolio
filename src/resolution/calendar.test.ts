import { describe, expect, test } from "bun:test";
import { addTradingSessions, isTradingDay } from "./calendar.ts";

describe("isTradingDay", () => {
  test("weekdays are trading days, weekends are not", () => {
    expect(isTradingDay("2026-06-01")).toBe(true); // Monday
    expect(isTradingDay("2026-06-05")).toBe(true); // Friday
    expect(isTradingDay("2026-06-06")).toBe(false); // Saturday
    expect(isTradingDay("2026-06-07")).toBe(false); // Sunday
  });
});

describe("addTradingSessions", () => {
  test("steps forward by trading days, skipping weekends", () => {
    expect(addTradingSessions("2026-06-01", 1)).toBe("2026-06-02"); // Mon → Tue
    expect(addTradingSessions("2026-06-05", 1)).toBe("2026-06-08"); // Fri → Mon
    expect(addTradingSessions("2026-06-01", 5)).toBe("2026-06-08"); // Mon → next Mon
  });

  test("clamps sub-one horizons to at least one session", () => {
    expect(addTradingSessions("2026-06-01", 0)).toBe("2026-06-02");
  });
});
