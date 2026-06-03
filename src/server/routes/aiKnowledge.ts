import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { nodeId } from "../../domain/index.ts";
import { serializeFact, serializeThesis } from "../../knowledge/serialize.ts";
import type { TagDimension } from "../../db/repositories/insightTags.ts";

const Dimension = z.enum(["ticker", "sector", "theme", "direction", "horizon"]);
const TagEdit = z.object({
  add: z.array(z.object({ dimension: Dimension, value: z.string().min(1) })).default([]),
  remove: z.array(z.object({ dimension: Dimension, value: z.string().min(1) })).default([]),
});

/** The AI's own knowledge: searchable, tagged, day-sectioned, archive-hidden. Facts only in Phase 1;
 *  theses (Phase 3) extend the same serializer + routes. Mounted at "/" so paths are absolute. */
export function aiKnowledgeRoutes(app: App): Hono {
  const r = new Hono();

  // All active self-curated facts + active theses, serialized to the canonical shape.
  const allInsights = () => [
    ...app.repos.knowledge.listCuratedFacts().map((f) => serializeFact(app, f)),
    ...app.repos.aiTheses.listActive().map(serializeThesis),
  ];

  r.get("/ai-library/days", (c) => {
    const counts = new Map<string, { factCount: number; thesisCount: number }>();
    const bump = (date: string, key: "factCount" | "thesisCount") => {
      const e = counts.get(date) ?? { factCount: 0, thesisCount: 0 };
      counts.set(date, { ...e, [key]: e[key] + 1 }); // immutable: replace, don't mutate in place
    };
    for (const f of app.repos.knowledge.listCuratedFacts()) bump(f.createdAt.slice(0, 10), "factCount");
    for (const t of app.repos.aiTheses.listActive()) bump(t.date, "thesisCount");
    return c.json({ days: [...counts.entries()].map(([date, c2]) => ({ date, ...c2 })) });
  });

  r.get("/ai-library/day/:date", (c) => {
    const date = c.req.param("date");
    return c.json({ date, facts: allInsights().filter((i) => i.date === date) });
  });

  r.get("/ai-library/search", (c) => {
    const q = c.req.query("q")?.trim().toLowerCase();
    const dimension = c.req.query("dimension") as TagDimension | undefined;
    const value = c.req.query("value");
    const limit = Math.max(1, Number.parseInt(c.req.query("limit") ?? "50", 10) || 50);
    let insights = allInsights();
    if (q) insights = insights.filter((i) => i.headline.toLowerCase().includes(q));
    if (dimension && value) insights = insights.filter((i) => i.tags.some((t) => t.dimension === dimension && t.value === value));
    return c.json({ insights: insights.slice(0, limit) });
  });

  r.get("/tags", (c) => c.json({ tags: app.repos.insightTags.taxonomy() }));

  r.put("/ai-insights/:kind/:id/tags", async (c) => {
    if (c.req.param("kind") !== "fact") return c.json({ error: "unsupported kind" }, 400);
    const id = c.req.param("id");
    const node = nodeId("source", id); // Phase 1: only fact insights, backed by source nodes
    const body = TagEdit.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const now = new Date().toISOString();
    for (const t of body.data.remove) app.repos.insightTags.removeTag(node, t.dimension, t.value);
    for (const t of body.data.add) app.repos.insightTags.addTag(node, { ...t, source: "human" }, now);
    return c.json({ tags: app.repos.insightTags.tagsFor(node) });
  });

  // Archive (provenance preserved; chunks deactivated) — the fact disappears from the library.
  r.delete("/ai-insights/:kind/:id", (c) => {
    if (c.req.param("kind") !== "fact") return c.json({ error: "unsupported kind" }, 400);
    const id = c.req.param("id");
    const updated = app.repos.knowledge.updateSource(id, { status: "archived" }, new Date().toISOString());
    if (!updated) return c.json({ error: "not found" }, 404);
    app.repos.knowledge.deactivateChunksForSource(id);
    return c.json({ ok: true, archived: id });
  });

  return r;
}
