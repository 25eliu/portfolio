import type { App } from "../app.ts";
import { edgeId, ProposedEdge, type KgNodeType, type LibrarianNode } from "../domain/index.ts";

export type { LibrarianNode } from "../domain/index.ts";

/**
 * The LLM "graph librarian" — periodic, additive knowledge-graph maintenance. It enriches the *web of
 * concepts* (themes, sectors, lessons, strategies, theses) with associative edges code can't infer
 * (`related_to`, `contradicts`), while staying strictly out of the computed metrics/calibration layer.
 *
 * Division of labor (see architecture §5b): deterministic code owns ground-truth memberships and the
 * scoreboard; the librarian only adds typed, gated, source-tagged associations between EXISTING nodes —
 * never creating nodes, never touching forecasts/outcomes/metrics, never pruning. Fully reversible
 * (every edge carries `data.source = "librarian"`).
 */

/** Concept node types the librarian reasons over — the idea web, not raw data/forecast rows. */
const CONCEPT_TYPES: KgNodeType[] = ["theme", "sector", "strategy_family", "lesson", "thesis"];
const PER_TYPE_CAP = 12;
const MAX_NODES = 40;
const MAX_NEW_EDGES = 12;
/** `contradicts` is only meaningful between evaluative nodes (a lesson/thesis can conflict with another). */
const CONTRADICTS_TYPES = new Set(["lesson", "thesis"]);

/** The deterministic node set offered to the librarian (most-recently-updated concepts, capped). */
export function selectLibrarianNodes(app: App): LibrarianNode[] {
  const out: LibrarianNode[] = [];
  for (const type of CONCEPT_TYPES) {
    for (const n of app.repos.graph.listNodes({ type, limit: PER_TYPE_CAP })) {
      out.push({ id: n.id, type: n.type, label: n.label, summary: n.summary ?? "" });
    }
  }
  return out.slice(0, MAX_NODES);
}

export type LibrarianResult = { added: number; rejected: number };

/**
 * Gate + persist proposed edges. Rejects anything that would connect a non-existent node, self-loop, or
 * use `contradicts` between non-evaluative nodes; normalizes symmetric pairs so A↔B is stored once;
 * caps per run. Edges are tagged `source: "librarian"` so they're auditable and reversible. Pure w.r.t.
 * the metrics layer — it only writes `related_to`/`contradicts` edges between concept nodes.
 */
export function applyProposedEdges(app: App, proposals: readonly unknown[], nodes: LibrarianNode[], now: string): LibrarianResult {
  const typeById = new Map(nodes.map((n) => [n.id, n.type]));
  const allowed = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  let added = 0, rejected = 0;

  for (const raw of proposals) {
    if (added >= MAX_NEW_EDGES) { rejected++; continue; }
    const parsed = ProposedEdge.safeParse(raw);
    if (!parsed.success) { rejected++; continue; }
    const { rel, rationale } = parsed.data;
    // Normalize symmetric endpoints so A→B and B→A collapse to one canonical edge.
    const [src, dst] = parsed.data.srcId < parsed.data.dstId ? [parsed.data.srcId, parsed.data.dstId] : [parsed.data.dstId, parsed.data.srcId];

    if (src === dst || !allowed.has(src) || !allowed.has(dst)) { rejected++; continue; }
    if (rel === "contradicts" && !(CONTRADICTS_TYPES.has(typeById.get(src)!) && CONTRADICTS_TYPES.has(typeById.get(dst)!))) { rejected++; continue; }

    const id = edgeId(src, rel, dst);
    if (seen.has(id)) { rejected++; continue; } // duplicate within this batch
    seen.add(id);

    app.repos.graph.upsertEdge({ id, srcId: src, dstId: dst, rel, weight: 1, data: { source: "librarian", rationale }, createdAt: now });
    added++;
  }
  return { added, rejected };
}

/** Orchestrate one librarian pass: gather concept nodes → ask the analyzer → gate + persist. Non-fatal. */
export async function runGraphLibrarian(app: App, now: string): Promise<LibrarianResult & { skipped?: string }> {
  if (!app.analyzer) return { added: 0, rejected: 0, skipped: "no analyzer" };
  const nodes = selectLibrarianNodes(app);
  if (nodes.length < 3) return { added: 0, rejected: 0, skipped: "too few concept nodes" };
  const proposals = await app.analyzer.proposeGraphEdges(nodes).catch(() => [] as ProposedEdge[]);
  return applyProposedEdges(app, proposals, nodes, now);
}
