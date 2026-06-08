import { Hono } from "hono";
import type { App } from "../../app.ts";
import type { KgNodeType } from "../../domain/index.ts";

/** Read-only knowledge-graph queries: list nodes by type, and fetch a node with its neighbors. */
export function graphRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/nodes", (c) => {
    const type = c.req.query("type") as KgNodeType | undefined;
    return c.json({ nodes: app.repos.graph.listNodes({ type }) });
  });

  // Cross-type search across the whole graph, ranked by match quality then connectedness (degree).
  r.get("/search", (c) => {
    const q = c.req.query("q") ?? "";
    const n = Number(c.req.query("limit"));
    const limit = Number.isFinite(n) && n > 0 ? Math.min(n, 50) : 20;
    return c.json({ nodes: app.repos.graph.searchNodes(q, limit) });
  });

  // The node id is a slug like "ticker:AAPL" — accept the rest of the path so the colon survives.
  r.get("/node/:id{.+}", (c) => {
    const id = c.req.param("id");
    const node = app.repos.graph.getNode(id);
    if (!node) return c.json({ error: "not found" }, 404);
    return c.json({ node, neighbors: app.repos.graph.neighbors(id, { direction: "both" }) });
  });

  return r;
}
