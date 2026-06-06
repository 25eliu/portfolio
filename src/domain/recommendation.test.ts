import { describe, expect, test } from "bun:test";
import { MemorableFact, Outlook } from "./recommendation.ts";

describe("MemorableFact significance + category", () => {
  test("parses significance and category", () => {
    const f = MemorableFact.parse({ fact: "NVDA has a CUDA moat", significance: 0.8, category: "moat" });
    expect(f.significance).toBe(0.8);
    expect(f.category).toBe("moat");
  });

  test("defaults are safe when the model omits them", () => {
    const f = MemorableFact.parse({ fact: "x" });
    expect(f.significance).toBe(0);
    expect(f.category).toBeNull();
  });

  test("a malformed significance never throws — falls back to 0", () => {
    const f = MemorableFact.parse({ fact: "x", significance: "high" as unknown as number });
    expect(f.significance).toBe(0);
  });

  test("a malformed category falls back to null", () => {
    const f = MemorableFact.parse({ fact: "x", category: 42 as unknown as string });
    expect(f.category).toBeNull();
  });
});

describe("Outlook contract", () => {
  test("parses a full outlook", () => {
    const o = Outlook.parse({
      regime: { subject: "market", stance: "risk_on", conviction: 0.6, horizon: "1mo", summary: "Constructive", thesis: "Breadth improving." },
      sectors: [{ subject: "Semiconductors", stance: "bullish", conviction: 0.7, horizon: "3mo", summary: "", thesis: "Capex durable.", tickers: ["NVDA"] }],
      themes: [{ subject: "AI infra", stance: "bullish", conviction: 0.65, horizon: "6mo", summary: "", thesis: "Buildout broad." }],
    });
    expect(o.regime?.stance).toBe("risk_on");
    expect(o.sectors[0]!.tickers).toEqual(["NVDA"]);
  });

  test("caps sectors at 8 and themes at 6; tolerates a malformed item array", () => {
    const item = (i: number) => ({ subject: `S${i}`, stance: "bullish", conviction: 0.5, horizon: "3mo", summary: "", thesis: "x" });
    const o = Outlook.parse({ regime: null, sectors: Array.from({ length: 12 }, (_, i) => item(i)), themes: Array.from({ length: 9 }, (_, i) => item(i)) });
    expect(o.sectors.length).toBe(8);
    expect(o.themes.length).toBe(6);
    const bad = Outlook.parse({ regime: null, sectors: "nonsense" as unknown as [], themes: [] });
    expect(bad.sectors).toEqual([]);
  });
});
