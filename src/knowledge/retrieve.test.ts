import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { edgeId, nodeId } from "../domain/index.ts";
import { ingestSource } from "./ingest.ts";
import { buildFtsQuery, renderEvidenceBlock, retrieveEvidence } from "./retrieve.ts";

function makeApp(): App {
  return createApp({ db: openMemoryDb(), gateway: createFakeGateway(), now: () => "2026-06-01" });
}

let app: App;
beforeEach(() => {
  app = makeApp();
});

describe("buildFtsQuery", () => {
  test("sanitizes, dedupes, and ORs phrases; drops empties", () => {
    expect(buildFtsQuery(["NVDA", "ai infra!", "", ":::", "NVDA"])).toBe('"NVDA" OR "ai infra"');
  });
});

describe("graph-aware retrieval", () => {
  test("surfaces a graph-linked source even when the chunk has no literal ticker text", async () => {
    // A global note about a theme, never naming NVDA. Lexical ticker match alone would miss it.
    const text = "The datacenter buildout is accelerating across the major hyperscalers this cycle.";
    const { source } = await ingestSource(app, { kind: "note", title: "datacenter", text, scope: "global", useInAnalysis: true });

    // Baseline: bare-ticker retrieval finds nothing.
    expect(retrieveEvidence(app, "NVDA")).toHaveLength(0);

    // Link the source to the ticker in the graph (as the pipeline does on evidence use).
    const tkr = nodeId("ticker", "NVDA");
    const src = nodeId("source", source.id);
    const now = new Date().toISOString();
    app.repos.graph.upsertNode({ id: tkr, type: "ticker", label: "NVDA", summary: "", data: {}, status: "active", createdAt: now, updatedAt: now });
    app.repos.graph.upsertEdge({ id: edgeId(src, "mentions", tkr), srcId: src, dstId: tkr, rel: "mentions", weight: 1, data: {}, createdAt: now });

    const evidence = retrieveEvidence(app, "NVDA");
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence[0]!.sourceId).toBe(source.id);
  });

  test("extraTerms broaden lexical recall", async () => {
    const text = "A classic momentum setup forming as price clears resistance on rising volume.";
    await ingestSource(app, { kind: "note", title: "setup", text, scope: "global", useInAnalysis: true });
    expect(retrieveEvidence(app, "XYZ")).toHaveLength(0); // ticker not present
    expect(retrieveEvidence(app, "XYZ", { extraTerms: ["momentum"] }).length).toBeGreaterThan(0);
  });
});

describe("renderEvidenceBlock", () => {
  test("omits the chunk UUID from the prompt header but the excerpt retains chunkId", async () => {
    const { source } = await ingestSource(app, {
      kind: "note", title: "AAPL note", text: "AAPL services revenue keeps compounding nicely over time.",
      scope: "ticker", scopeTicker: "AAPL", useInAnalysis: true,
    });
    const excerpts = retrieveEvidence(app, "AAPL");
    expect(excerpts.length).toBeGreaterThan(0);
    expect(excerpts[0]!.chunkId).toBeTruthy(); // chunkId still on the object (persisted for provenance)
    const block = renderEvidenceBlock(excerpts);
    expect(block).toContain("untrusted_user_evidence");
    expect(block).toContain('"AAPL note"');
    expect(block).not.toContain(excerpts[0]!.chunkId); // ...but not rendered into the prompt
    expect(source.id).toBeTruthy();
  });
});
