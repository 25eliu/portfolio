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

  test("includes ai_thesis at lowest precedence; higher sources override the tag", () => {
    const u = buildUniverse({
      held: ["AAPL"],
      watchlist: [],
      scan: [{ symbol: "TSLA", screen: "value", reason: "y", sources: [] }],
      aiHeld: ["NVDA"],
      aiThesis: ["NVDA", "AAPL", "TSLA", "SOFI"],
    });
    expect(u.symbols.sort()).toEqual(["AAPL", "NVDA", "SOFI", "TSLA"]);
    expect(u.bySymbol.get("SOFI")?.source).toBe("ai_thesis"); // only a thesis name
    expect(u.bySymbol.get("NVDA")?.source).toBe("ai_held");   // ai_held overrides ai_thesis
    expect(u.bySymbol.get("TSLA")?.source).toBe("scan");      // scan overrides ai_thesis
    expect(u.bySymbol.get("AAPL")?.source).toBe("held");      // held overrides ai_thesis
  });

  test("every user-held name is always scanned daily, even amid a large AI universe", () => {
    const u = buildUniverse({
      held: ["AAPL", "MSFT", "GOOG"],
      watchlist: [],
      scan: Array.from({ length: 20 }, (_, i) => ({ symbol: `S${i}`, screen: "momentum" as const, reason: "x", sources: [] })),
      aiHeld: ["NVDA"],
      aiThesis: Array.from({ length: 15 }, (_, i) => `T${i}`),
    });
    for (const h of ["AAPL", "MSFT", "GOOG"]) {
      expect(u.bySymbol.get(h)?.source).toBe("held"); // user portfolio always present, tagged held
    }
  });
});
