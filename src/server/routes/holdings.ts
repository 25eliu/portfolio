import { Hono } from "hono";
import type { App } from "../../app.ts";
import { HoldingInput } from "../../domain/index.ts";

/** Ticker-manager CRUD for My Portfolio (the "mirror my real account" feature). */
export function holdingsRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json(app.repos.holdings.listByPortfolio(app.user.id)));

  r.post("/", async (c) => {
    const parsed = HoldingInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    return c.json(app.repos.holdings.upsert(app.user.id, parsed.data), 201);
  });

  r.delete("/:id", (c) => {
    const ok = app.repos.holdings.remove(c.req.param("id"));
    return c.json({ ok }, ok ? 200 : 404);
  });

  return r;
}
