import { describe, expect, test } from "bun:test";
import { normalizeAction } from "./normalize.ts";

describe("normalizeAction", () => {
  test("held tickers only ever yield held verbs", () => {
    expect(normalizeAction("BUY", true)).toBe("ADD");
    expect(normalizeAction("WATCH", true)).toBe("HOLD");
    expect(normalizeAction("PASS", true)).toBe("HOLD");
    expect(normalizeAction("SELL", true)).toBe("SELL");
    expect(normalizeAction("TRIM", true)).toBe("TRIM");
    expect(normalizeAction("garbage", true)).toBe("HOLD");
  });
  test("candidates only ever yield candidate verbs", () => {
    expect(normalizeAction("ADD", false)).toBe("BUY");
    expect(normalizeAction("HOLD", false)).toBe("PASS");
    expect(normalizeAction("TRIM", false)).toBe("PASS");
    expect(normalizeAction("SELL", false)).toBe("PASS");
    expect(normalizeAction("WATCH", false)).toBe("WATCH");
    expect(normalizeAction("BUY", false)).toBe("BUY");
  });
});
