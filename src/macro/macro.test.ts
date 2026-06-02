import { describe, expect, test } from "bun:test";
import { createFakeMacro } from "./fake/index.ts";

describe("fake macro", () => {
  test("returns a complete macro snapshot", async () => {
    const m = await createFakeMacro().get();
    expect(m.vix).toBeGreaterThan(0);
    expect(m.tenYearYield).not.toBeNull();
  });
});
