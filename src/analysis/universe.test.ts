import { describe, expect, test } from "bun:test";
import { createFakeGateway } from "../market/index.ts";
import { createFakeFundamentals } from "../fundamentals/index.ts";
import { runOpportunityScan } from "./opportunityScan.ts";
import { buildUniverse } from "./universe.ts";

const clock = () => "2026-06-01";

describe("opportunity scan", () => {
  test("produces capped, typed candidates", async () => {
    const gw = createFakeGateway({ now: clock });
    const f = createFakeFundamentals();
    const candidates = await runOpportunityScan(gw, f, 6);
    expect(candidates.length).toBeLessThanOrEqual(6);
    expect(candidates.every((c) => c.symbol && c.screen && c.reason)).toBe(true);
  });
});

describe("buildUniverse", () => {
  test("dedupes held ∪ watchlist ∪ scan and caps scan", () => {
    const u = buildUniverse({
      held: ["AAPL", "NVDA"],
      watchlist: ["NVDA", "MSFT"],
      scan: [{ symbol: "AAPL", screen: "momentum", reason: "x", sources: [] }, { symbol: "TSLA", screen: "value", reason: "y", sources: [] }],
    });
    expect(u.symbols.sort()).toEqual(["AAPL", "MSFT", "NVDA", "TSLA"]);
    expect(u.bySymbol.get("AAPL")?.source).toBe("held"); // held wins over scan
    expect(u.bySymbol.get("TSLA")?.source).toBe("scan");
  });
});
