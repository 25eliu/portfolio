import { describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createFakeFundamentals } from "../fundamentals/index.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import type { KgNodeType } from "../domain/index.ts";
import { applyProposedEdges, runGraphLibrarian, selectLibrarianNodes, type LibrarianNode } from "./librarian.ts";

const NOW = "2026-06-01T00:00:00.000Z";

function makeApp(analyzer: ReturnType<typeof createMockAnalyzer> | null = null): App {
  return createApp({
    db: openMemoryDb(),
    gateway: createFakeGateway({ now: () => "2026-06-01" }),
    fundamentals: createFakeFundamentals(),
    analyzer,
    now: () => "2026-06-01",
  });
}

function seed(app: App, id: string, type: KgNodeType, label = id) {
  app.repos.graph.upsertNode({ id, type, label, summary: "", data: {}, status: "active", createdAt: NOW, updatedAt: NOW });
}

function hasEdge(app: App, a: string, b: string, rel: string): boolean {
  return app.repos.graph
    .neighbors(a, { direction: "both" })
    .some((n) => n.edge.rel === rel && (n.edge.srcId === b || n.edge.dstId === b));
}

const nodes = (app: App): LibrarianNode[] => selectLibrarianNodes(app);

describe("selectLibrarianNodes", () => {
  test("returns concept nodes and excludes raw data nodes (tickers, sources)", () => {
    const app = makeApp();
    seed(app, "theme:ai", "theme");
    seed(app, "sector:tech", "sector");
    seed(app, "lesson:l1", "lesson");
    seed(app, "ticker:nvda", "ticker"); // excluded
    seed(app, "source:s1", "source"); // excluded
    const ids = nodes(app).map((n) => n.id);
    expect(ids).toContain("theme:ai");
    expect(ids).toContain("sector:tech");
    expect(ids).toContain("lesson:l1");
    expect(ids).not.toContain("ticker:nvda");
    expect(ids).not.toContain("source:s1");
  });
});

describe("applyProposedEdges — gating", () => {
  function appWithConcepts() {
    const app = makeApp();
    seed(app, "theme:ai", "theme");
    seed(app, "sector:tech", "sector");
    seed(app, "lesson:a", "lesson");
    seed(app, "lesson:b", "lesson");
    return app;
  }

  test("persists a valid related_to edge between two existing concepts, tagged source=librarian", () => {
    const app = appWithConcepts();
    const r = applyProposedEdges(app, [{ srcId: "theme:ai", rel: "related_to", dstId: "sector:tech", rationale: "AI drives chip demand" }], nodes(app), NOW);
    expect(r.added).toBe(1);
    expect(hasEdge(app, "theme:ai", "sector:tech", "related_to")).toBe(true);
    const edge = app.repos.graph.neighbors("theme:ai", { direction: "both" }).find((n) => n.edge.rel === "related_to")!.edge;
    expect(edge.data.source).toBe("librarian");
  });

  test("rejects an edge to a non-existent node", () => {
    const app = appWithConcepts();
    const r = applyProposedEdges(app, [{ srcId: "theme:ai", rel: "related_to", dstId: "theme:ghost" }], nodes(app), NOW);
    expect(r).toEqual({ added: 0, rejected: 1 });
  });

  test("rejects a self-loop", () => {
    const app = appWithConcepts();
    const r = applyProposedEdges(app, [{ srcId: "theme:ai", rel: "related_to", dstId: "theme:ai" }], nodes(app), NOW);
    expect(r.added).toBe(0);
  });

  test("contradicts only between evaluative nodes: rejected for themes, accepted for lessons", () => {
    const app = appWithConcepts();
    const bad = applyProposedEdges(app, [{ srcId: "theme:ai", rel: "contradicts", dstId: "sector:tech" }], nodes(app), NOW);
    expect(bad.added).toBe(0);
    const good = applyProposedEdges(app, [{ srcId: "lesson:a", rel: "contradicts", dstId: "lesson:b" }], nodes(app), NOW);
    expect(good.added).toBe(1);
    expect(hasEdge(app, "lesson:a", "lesson:b", "contradicts")).toBe(true);
  });

  test("normalizes symmetric pairs so A↔B is stored once", () => {
    const app = appWithConcepts();
    const r = applyProposedEdges(
      app,
      [
        { srcId: "theme:ai", rel: "related_to", dstId: "sector:tech" },
        { srcId: "sector:tech", rel: "related_to", dstId: "theme:ai" }, // same pair, reversed
      ],
      nodes(app),
      NOW,
    );
    expect(r).toEqual({ added: 1, rejected: 1 });
  });

  test("caps the number of new edges per run", () => {
    const app = makeApp();
    for (let i = 0; i < 30; i++) seed(app, `theme:t${i}`, "theme");
    const all = nodes(app);
    // Propose far more distinct edges than the cap allows.
    const proposals = [];
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) proposals.push({ srcId: all[i]!.id, rel: "related_to", dstId: all[j]!.id });
    const r = applyProposedEdges(app, proposals, all, NOW);
    expect(r.added).toBeLessThanOrEqual(12);
  });
});

describe("runGraphLibrarian", () => {
  test("skips when there are too few concept nodes", async () => {
    const app = makeApp(createMockAnalyzer());
    seed(app, "theme:ai", "theme");
    const r = await runGraphLibrarian(app, NOW);
    expect(r.skipped).toBe("too few concept nodes");
  });

  test("skips when there is no analyzer", async () => {
    const app = makeApp(null);
    for (let i = 0; i < 4; i++) seed(app, `theme:t${i}`, "theme");
    const r = await runGraphLibrarian(app, NOW);
    expect(r.skipped).toBe("no analyzer");
  });

  test("with the mock analyzer it gates the proposals and persists what passes", async () => {
    const app = makeApp(createMockAnalyzer());
    for (let i = 0; i < 4; i++) seed(app, `theme:t${i}`, "theme");
    const r = await runGraphLibrarian(app, NOW);
    expect(r.added + r.rejected).toBeGreaterThan(0); // the mock proposed something; gating ran
  });
});
