import { describe, expect, test } from "bun:test";
import { fallbackLabel, layoutNeighbors, parseNodeId, nodeStyle, relStyle } from "./nodeStyle.ts";

const OPTS = { cx: 440, cy: 280, r1: 200, r2: 130, cap: 16 };

describe("layoutNeighbors", () => {
  test("places exactly N positions when under the cap", () => {
    const { positions, hiddenCount } = layoutNeighbors(6, OPTS);
    expect(positions).toHaveLength(6);
    expect(hiddenCount).toBe(0);
  });

  test("caps the displayed set and reports the remainder (no silent truncation)", () => {
    const { positions, hiddenCount } = layoutNeighbors(40, OPTS);
    expect(positions).toHaveLength(16);
    expect(hiddenCount).toBe(24);
  });

  test("first neighbor sits at the top (-90°)", () => {
    const { positions } = layoutNeighbors(4, OPTS);
    expect(positions[0]!.x).toBeCloseTo(OPTS.cx, 5);
    expect(positions[0]!.y).toBeCloseTo(OPTS.cy - OPTS.r1, 5);
  });

  test("uses a single ring when sparse, two alternating radii when crowded", () => {
    const sparse = layoutNeighbors(8, OPTS);
    const radii = sparse.positions.map((p) => Math.round(Math.hypot(p.x - OPTS.cx, p.y - OPTS.cy)));
    expect(new Set(radii)).toEqual(new Set([OPTS.r1]));

    const crowded = layoutNeighbors(12, OPTS);
    const crowdedRadii = new Set(crowded.positions.map((p) => Math.round(Math.hypot(p.x - OPTS.cx, p.y - OPTS.cy))));
    expect(crowdedRadii.has(OPTS.r1)).toBe(true);
    expect(crowdedRadii.has(OPTS.r2)).toBe(true);
  });

  test("is deterministic (same input → identical positions)", () => {
    expect(layoutNeighbors(9, OPTS)).toEqual(layoutNeighbors(9, OPTS));
  });
});

describe("parseNodeId", () => {
  test("splits type:key slugs", () => {
    expect(parseNodeId("ticker:aapl")).toEqual({ type: "ticker", key: "aapl" });
    expect(parseNodeId("lesson:all_time:overall")).toEqual({ type: "lesson", key: "all_time:overall" });
    expect(parseNodeId("loose")).toEqual({ type: "concept", key: "loose" });
  });
});

describe("style maps", () => {
  test("known types get a color + glyph; unknown falls back gracefully", () => {
    expect(nodeStyle("ticker").color).toBe("#4F8DFD");
    expect(nodeStyle("totally-unknown").glyph).toBe("•");
  });

  test("relationship families drive stroke styling", () => {
    expect(relStyle("derived_from").family).toBe("provenance");
    expect(relStyle("supersedes").dash).toBeDefined(); // conflict edges are dashed
    expect(relStyle("belongs_to").family).toBe("structural");
  });

  test("fallbackLabel renders uuid-ish null nodes as type + short stub, keeps short keys", () => {
    expect(fallbackLabel("source:4b7afc82-44e9-4c2a-9f1a-aaaaaaaaaaaa")).toBe("source 4b7afc…");
    expect(fallbackLabel("forecast:0123456789abcdef0123")).toContain("forecast ");
    expect(fallbackLabel("sector:energy")).toBe("sector energy"); // short, human key kept whole
  });
});
