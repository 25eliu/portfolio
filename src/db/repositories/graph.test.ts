import { beforeEach, describe, expect, test } from "bun:test";
import { repositories } from "../index.ts";
import { openMemoryDb } from "../index.ts";
import type { KgEdge, KgNode } from "../../domain/index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

function node(id: string, type: KgNode["type"], label: string, summary = ""): KgNode {
  return { id, type, label, summary, data: {}, status: "active", createdAt: NOW, updatedAt: NOW };
}
function edge(srcId: string, dstId: string): KgEdge {
  return { id: `${srcId}|related_to|${dstId}`, srcId, dstId, rel: "related_to", weight: 1, data: {}, createdAt: NOW };
}

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

describe("graph.searchNodes", () => {
  test("matches label, summary, and id case-insensitively, across types", () => {
    repos.graph.upsertNode(node("ticker:aapl", "ticker", "AAPL"));
    repos.graph.upsertNode(node("theme:ai-datacenter", "theme", "AI Datacenter"));
    repos.graph.upsertNode(node("sector:tech", "sector", "Technology", "covers Apple and peers"));

    // label match (case-insensitive)
    expect(repos.graph.searchNodes("aapl").map((n) => n.id)).toContain("ticker:aapl");
    // summary match
    expect(repos.graph.searchNodes("apple").map((n) => n.id)).toContain("sector:tech");
    // id/slug match
    expect(repos.graph.searchNodes("datacenter").map((n) => n.id)).toContain("theme:ai-datacenter");
  });

  test("ranks exact label, then prefix, then substring", () => {
    repos.graph.upsertNode(node("concept:ai", "concept", "AI"));
    repos.graph.upsertNode(node("theme:ai-datacenter", "theme", "AI Datacenter"));
    repos.graph.upsertNode(node("lesson:retail-ai", "lesson", "Retail uses AI"));
    const order = repos.graph.searchNodes("ai").map((n) => n.id);
    expect(order[0]).toBe("concept:ai"); // exact label "AI"
    expect(order.indexOf("theme:ai-datacenter")).toBeLessThan(order.indexOf("lesson:retail-ai")); // prefix before substring
  });

  test("breaks ties by degree — better-connected nodes first", () => {
    repos.graph.upsertNode(node("theme:alpha-one", "theme", "Alpha One"));
    repos.graph.upsertNode(node("theme:alpha-two", "theme", "Alpha Two"));
    repos.graph.upsertNode(node("ticker:x", "ticker", "X"));
    repos.graph.upsertNode(node("ticker:y", "ticker", "Y"));
    // alpha-two has two edges; alpha-one has none.
    repos.graph.upsertEdge(edge("theme:alpha-two", "ticker:x"));
    repos.graph.upsertEdge(edge("ticker:y", "theme:alpha-two"));
    const order = repos.graph.searchNodes("alpha").map((n) => n.id);
    expect(order.indexOf("theme:alpha-two")).toBeLessThan(order.indexOf("theme:alpha-one"));
  });

  test("respects the limit and ignores empty/whitespace queries", () => {
    for (let i = 0; i < 5; i++) repos.graph.upsertNode(node(`theme:beta-${i}`, "theme", `Beta ${i}`));
    expect(repos.graph.searchNodes("beta", 3)).toHaveLength(3);
    expect(repos.graph.searchNodes("")).toEqual([]);
    expect(repos.graph.searchNodes("   ")).toEqual([]);
  });

  test("treats LIKE wildcards as literals", () => {
    repos.graph.upsertNode(node("theme:plain", "theme", "Plain"));
    repos.graph.upsertNode(node("theme:percent", "theme", "100% margin"));
    // '%' must match literally, not as a wildcard (which would also return "Plain").
    const ids = repos.graph.searchNodes("100%").map((n) => n.id);
    expect(ids).toContain("theme:percent");
    expect(ids).not.toContain("theme:plain");
  });
});
