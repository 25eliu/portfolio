import { z } from "zod";

/**
 * Knowledge graph primitives — the connective substrate shared by the research library and the
 * performance wiki. Inspired by an LLM-maintainable knowledge graph / wiki: atomic canonical nodes
 * with stable, human-readable slug ids, joined by typed, deduplicated, bidirectionally-queryable
 * edges. Concrete records (chunks, forecasts, outcomes) live in their own relational tables; the graph
 * holds the canonical *concepts* (tickers, themes, strategies, lessons, metrics, cohorts) and the
 * relationships between everything — so the knowledge is well-connected, traversable, and compilable
 * into compact context an LLM can read and iterate on.
 */

export const KgNodeType = z.enum([
  "ticker",
  "sector",
  "theme",
  "catalyst",
  "concept",
  "strategy_family",
  "signal",
  "source",
  "lesson",
  "metric",
  "cohort",
  "tag",
  "thesis",
]);
export type KgNodeType = z.infer<typeof KgNodeType>;

export const KgRelation = z.enum([
  "tagged_with", // source/recommendation → ticker/theme it concerns
  "mentions", // chunk/source → entity it references
  "cites", // recommendation → evidence chunk used
  "derived_from", // lesson/metric → forecast/outcome it was computed from
  "supports", // lesson → ticker/strategy it informs
  "contradicts", // lesson → lesson it conflicts with
  "belongs_to", // ticker → sector/theme
  "supersedes", // lesson → prior lesson it replaces
  "in_cohort", // forecast/outcome → cohort it belongs to
  "related_to", // generic association
]);
export type KgRelation = z.infer<typeof KgRelation>;

export const KgNode = z.object({
  /** Stable slug id, e.g. "ticker:AAPL", "theme:ai-datacenter", "lesson:momentum-breakout-q2". */
  id: z.string().min(1),
  type: KgNodeType,
  label: z.string(),
  /** Compact, canonical, LLM-facing summary (deduplicated — one concept, one node). */
  summary: z.string().default(""),
  data: z.record(z.string(), z.unknown()).default({}),
  status: z.enum(["active", "archived"]).default("active"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KgNode = z.infer<typeof KgNode>;

export const KgEdge = z.object({
  id: z.string().min(1),
  srcId: z.string().min(1),
  dstId: z.string().min(1),
  rel: KgRelation,
  weight: z.number().default(1),
  data: z.record(z.string(), z.unknown()).default({}),
  createdAt: z.string().datetime(),
});
export type KgEdge = z.infer<typeof KgEdge>;

/** A node plus the edge that reached it — the unit returned by neighbor/backlink traversals. */
export const KgNeighbor = z.object({
  edge: KgEdge,
  node: KgNode.nullable(), // null when the edge points at a relational id with no canonical node
  direction: z.enum(["out", "in"]),
});
export type KgNeighbor = z.infer<typeof KgNeighbor>;

/** Build a stable node slug from a type and a natural key (lowercased, kebab-cased). */
export function nodeId(type: KgNodeType, key: string): string {
  const slug = key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `${type}:${slug}`;
}

/** Build a stable edge slug so re-asserting the same relation is idempotent (dedup by id). */
export function edgeId(srcId: string, rel: KgRelation, dstId: string): string {
  return `${srcId}|${rel}|${dstId}`;
}
