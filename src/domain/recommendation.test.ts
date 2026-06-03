import { describe, expect, test } from "bun:test";
import { MemorableFact } from "./recommendation.ts";

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
