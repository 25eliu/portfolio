import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { ingestSource, refreshSource, type IngestInput } from "../../knowledge/ingest.ts";

const Scope = z.enum(["global", "ticker"]);
const NoteBody = z.object({
  title: z.string().min(1),
  text: z.string().min(1),
  scope: Scope.default("global"),
  scopeTicker: z.string().optional(),
  useInAnalysis: z.boolean().optional(),
});
const UrlBody = z.object({
  url: z.string().url(),
  title: z.string().optional(),
  scope: Scope.default("global"),
  scopeTicker: z.string().optional(),
});
const UpdateBody = z.object({
  title: z.string().optional(),
  scope: Scope.optional(),
  scopeTicker: z.string().nullable().optional(),
  useInAnalysis: z.boolean().optional(),
  status: z.enum(["active", "quarantined", "archived"]).optional(),
});

/** Research knowledge library: ingest notes/URLs/uploads, manage sources, refresh, archive. */
export function knowledgeRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/sources", (c) => c.json({ sources: app.repos.knowledge.listSources() }));

  // Self-curated factual memory, grouped by the day it was learned (newest day first) — mirrors the
  // journal's day-grouped shape so the UI can show "what the system learned each day".
  r.get("/curated", (c) => {
    const facts = app.repos.knowledge.listCuratedFacts();
    const byDay = new Map<string, typeof facts>();
    for (const f of facts) {
      const day = f.createdAt.slice(0, 10);
      const bucket = byDay.get(day);
      if (bucket) bucket.push(f);
      else byDay.set(day, [f]);
    }
    return c.json({ days: [...byDay.entries()].map(([date, items]) => ({ date, facts: items })) });
  });

  r.get("/sources/:id", (c) => {
    const source = app.repos.knowledge.getSource(c.req.param("id"));
    if (!source) return c.json({ error: "not found" }, 404);
    return c.json({
      source,
      versions: app.repos.knowledge.versionsBySource(source.id),
      activeChunks: app.repos.knowledge.countActiveChunks(source.id),
    });
  });

  r.post("/sources/note", async (c) => {
    const body = NoteBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const input: IngestInput = { kind: "note", ...body.data };
    const result = await ingestSource(app, input);
    return c.json(result, 201);
  });

  r.post("/sources/url", async (c) => {
    const body = UrlBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const result = await ingestSource(app, { kind: "url", ...body.data });
    return c.json(result, 201);
  });

  r.post("/sources/upload", async (c) => {
    const form = await c.req.formData().catch(() => null);
    const file = form?.get("file");
    if (!(file instanceof File)) return c.json({ error: "expected a 'file' field" }, 400);
    const scope = Scope.catch("global").parse(form?.get("scope"));
    const scopeTicker = (form?.get("scopeTicker") as string | null) ?? undefined;
    const title = (form?.get("title") as string | null) || file.name;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const result = await ingestSource(app, {
      kind: "upload",
      title,
      filename: file.name,
      mime: file.type || "application/octet-stream",
      bytes,
      scope,
      scopeTicker,
    });
    return c.json(result, 201);
  });

  r.put("/sources/:id", async (c) => {
    const body = UpdateBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const updated = app.repos.knowledge.updateSource(c.req.param("id"), body.data, new Date().toISOString());
    if (!updated) return c.json({ error: "not found" }, 404);
    return c.json(updated);
  });

  r.post("/sources/:id/refresh", async (c) => {
    const result = await refreshSource(app, c.req.param("id"));
    if (!result) return c.json({ error: "not found or not a URL source" }, 404);
    return c.json(result);
  });

  // Delete archives (status=archived + chunks deactivated): provenance for past recommendations survives.
  r.delete("/sources/:id", (c) => {
    const id = c.req.param("id");
    const updated = app.repos.knowledge.updateSource(id, { status: "archived" }, new Date().toISOString());
    if (!updated) return c.json({ error: "not found" }, 404);
    app.repos.knowledge.deactivateChunksForSource(id);
    return c.json({ ok: true, archived: id });
  });

  return r;
}
