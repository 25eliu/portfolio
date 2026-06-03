import type { DB } from "../connection.ts";
import { nodeId, edgeId, type KgRelation } from "../../domain/index.ts";

/** The tag dimensions an AI insight can carry. */
export type TagDimension = "ticker" | "sector" | "theme" | "direction" | "horizon";
export type InsightTag = { dimension: TagDimension; value: string; source: "ai" | "human" };

/** Each dimension's graph edge relation (ticker reuses `mentions`; the rest use `tagged_with`). */
const REL_BY_DIM: Record<TagDimension, KgRelation> = {
  ticker: "mentions",
  sector: "tagged_with",
  theme: "tagged_with",
  direction: "tagged_with",
  horizon: "tagged_with",
};

/** The canonical graph node a (dimension,value) tag points at. ticker/sector/theme reuse existing
 *  node types; direction/horizon are dedicated `tag:` nodes. */
function tagTarget(dim: TagDimension, value: string): { id: string; type: string; label: string } {
  if (dim === "ticker") return { id: nodeId("ticker", value), type: "ticker", label: value.toUpperCase() };
  if (dim === "sector") return { id: nodeId("sector", value), type: "sector", label: value };
  if (dim === "theme") return { id: nodeId("theme", value), type: "theme", label: value };
  return { id: nodeId("tag", `${dim}-${value}`), type: "tag", label: `${dim}:${value}` };
}

export function insightTagsRepo(db: DB) {
  return {
    /** Tag an insight node (`source:<id>` for facts). Idempotent per (insight, dimension, value);
     *  the latest call's `source` wins (ai → human override). */
    addTag(insightNodeId: string, tag: InsightTag, now: string): void {
      const t = tagTarget(tag.dimension, tag.value);
      const rel = REL_BY_DIM[tag.dimension];
      db.query(
        `INSERT INTO kg_nodes (id, type, label, summary, data_json, status, created_at, updated_at)
         VALUES (?, ?, ?, '', '{}', 'active', ?, ?)
         ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(t.id, t.type, t.label, now, now);
      db.query(
        `INSERT INTO kg_edges (id, src_id, dst_id, rel, weight, data_json, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (src_id, rel, dst_id) DO UPDATE SET data_json = excluded.data_json`,
      ).run(
        edgeId(insightNodeId, rel, t.id),
        insightNodeId,
        t.id,
        rel,
        JSON.stringify({ dimension: tag.dimension, value: tag.value, source: tag.source }),
        now,
      );
    },

    removeTag(insightNodeId: string, dimension: TagDimension, value: string): void {
      const t = tagTarget(dimension, value);
      db.query("DELETE FROM kg_edges WHERE id = ?").run(edgeId(insightNodeId, REL_BY_DIM[dimension], t.id));
    },

    tagsFor(insightNodeId: string): InsightTag[] {
      const rows = db
        .query<{ data_json: string }, [string]>(
          "SELECT data_json FROM kg_edges WHERE src_id = ? AND rel IN ('tagged_with','mentions')",
        )
        .all(insightNodeId);
      const out: InsightTag[] = [];
      for (const r of rows) {
        const d = JSON.parse(r.data_json) as Partial<InsightTag>;
        if (d && d.dimension && d.value) out.push({ dimension: d.dimension, value: d.value, source: d.source ?? "ai" });
      }
      return out;
    },

    insightNodeIdsForTag(dimension: TagDimension, value: string): string[] {
      const t = tagTarget(dimension, value);
      return db
        .query<{ src_id: string }, [string]>("SELECT src_id FROM kg_edges WHERE dst_id = ?")
        .all(t.id)
        .map((r) => r.src_id);
    },

    taxonomy(): { dimension: TagDimension; value: string; count: number }[] {
      const rows = db
        .query<{ data_json: string }, []>(
          "SELECT data_json FROM kg_edges WHERE rel IN ('tagged_with','mentions') AND data_json LIKE '%dimension%'",
        )
        .all();
      const m = new Map<string, { dimension: TagDimension; value: string; count: number }>();
      for (const r of rows) {
        const d = JSON.parse(r.data_json) as Partial<InsightTag>;
        if (!d?.dimension || !d.value) continue;
        const key = `${d.dimension}:${d.value}`;
        const e = m.get(key);
        if (e) e.count++;
        else m.set(key, { dimension: d.dimension, value: d.value, count: 1 });
      }
      return [...m.values()].sort((a, b) => b.count - a.count);
    },
  };
}
export type InsightTagsRepo = ReturnType<typeof insightTagsRepo>;
