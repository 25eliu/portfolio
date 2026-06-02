import type { DB } from "../connection.ts";
import { KgEdge, KgNode, type KgNeighbor, type KgNodeType, type KgRelation } from "../../domain/index.ts";

type NodeRow = {
  id: string;
  type: string;
  label: string;
  summary: string;
  data_json: string;
  status: string;
  created_at: string;
  updated_at: string;
};
type EdgeRow = {
  id: string;
  src_id: string;
  dst_id: string;
  rel: string;
  weight: number;
  data_json: string;
  created_at: string;
};

const nodeToDomain = (r: NodeRow): KgNode =>
  KgNode.parse({
    id: r.id,
    type: r.type,
    label: r.label,
    summary: r.summary,
    data: JSON.parse(r.data_json),
    status: r.status,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

const edgeToDomain = (r: EdgeRow): KgEdge =>
  KgEdge.parse({
    id: r.id,
    srcId: r.src_id,
    dstId: r.dst_id,
    rel: r.rel,
    weight: r.weight,
    data: JSON.parse(r.data_json),
    createdAt: r.created_at,
  });

/**
 * Knowledge-graph access. Nodes dedupe by their stable slug id; edges dedupe by (src, rel, dst), so
 * re-asserting the same fact is idempotent. Traversal is bidirectional (neighbors out, backlinks in),
 * which is what makes the knowledge queryable from any entity.
 */
export function graphRepo(db: DB) {
  const upsertNodeStmt = db.query(
    `INSERT INTO kg_nodes (id, type, label, summary, data_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (id) DO UPDATE SET
       label = excluded.label,
       summary = CASE WHEN excluded.summary <> '' THEN excluded.summary ELSE kg_nodes.summary END,
       data_json = excluded.data_json,
       status = excluded.status,
       updated_at = excluded.updated_at`,
  );
  const upsertEdgeStmt = db.query(
    `INSERT INTO kg_edges (id, src_id, dst_id, rel, weight, data_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (src_id, rel, dst_id) DO UPDATE SET
       weight = excluded.weight,
       data_json = excluded.data_json`,
  );

  function getNode(id: string): KgNode | null {
    const row = db.query<NodeRow, [string]>("SELECT * FROM kg_nodes WHERE id = ?").get(id);
    return row ? nodeToDomain(row) : null;
  }

  return {
    upsertNode(node: KgNode): KgNode {
      const v = KgNode.parse(node);
      upsertNodeStmt.run(v.id, v.type, v.label, v.summary, JSON.stringify(v.data), v.status, v.createdAt, v.updatedAt);
      return v;
    },

    upsertEdge(edge: KgEdge): KgEdge {
      const v = KgEdge.parse(edge);
      upsertEdgeStmt.run(v.id, v.srcId, v.dstId, v.rel, v.weight, JSON.stringify(v.data), v.createdAt);
      return v;
    },

    getNode,

    listNodes(opts: { type?: KgNodeType; limit?: number } = {}): KgNode[] {
      const rows = opts.type
        ? db
            .query<NodeRow, [string, number]>("SELECT * FROM kg_nodes WHERE type = ? ORDER BY updated_at DESC LIMIT ?")
            .all(opts.type, opts.limit ?? 200)
        : db
            .query<NodeRow, [number]>("SELECT * FROM kg_nodes ORDER BY updated_at DESC LIMIT ?")
            .all(opts.limit ?? 200);
      return rows.map(nodeToDomain);
    },

    /** Edges touching `id`, with the node on the far end resolved (null if it has no canonical node). */
    neighbors(
      id: string,
      opts: { rel?: KgRelation; direction?: "out" | "in" | "both"; limit?: number } = {},
    ): KgNeighbor[] {
      const direction = opts.direction ?? "both";
      const limit = opts.limit ?? 100;
      const out: KgNeighbor[] = [];
      const relClause = opts.rel ? " AND rel = ?" : "";

      if (direction === "out" || direction === "both") {
        const params = opts.rel ? [id, opts.rel, limit] : [id, limit];
        const rows = db
          .query<EdgeRow, (string | number)[]>(`SELECT * FROM kg_edges WHERE src_id = ?${relClause} LIMIT ?`)
          .all(...params);
        for (const r of rows) out.push({ edge: edgeToDomain(r), node: getNode(r.dst_id), direction: "out" });
      }
      if (direction === "in" || direction === "both") {
        const params = opts.rel ? [id, opts.rel, limit] : [id, limit];
        const rows = db
          .query<EdgeRow, (string | number)[]>(`SELECT * FROM kg_edges WHERE dst_id = ?${relClause} LIMIT ?`)
          .all(...params);
        for (const r of rows) out.push({ edge: edgeToDomain(r), node: getNode(r.src_id), direction: "in" });
      }
      return out;
    },

    backlinks(id: string, rel?: KgRelation): KgNeighbor[] {
      return this.neighbors(id, { rel, direction: "in" });
    },
  };
}
export type GraphRepo = ReturnType<typeof graphRepo>;
