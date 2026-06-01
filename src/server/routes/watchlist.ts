import { Hono } from "hono";
import type { App } from "../../app.ts";
import { WatchlistInput } from "../../domain/index.ts";

export function watchlistRoutes(app: App): Hono {
  const r = new Hono();
  r.get("/", (c) => c.json(app.repos.watchlist.list()));
  r.post("/", async (c) => {
    const parsed = WatchlistInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    return c.json(app.repos.watchlist.add(parsed.data), 201);
  });
  r.delete("/:id", (c) => {
    const ok = app.repos.watchlist.remove(c.req.param("id"));
    return c.json({ ok }, ok ? 200 : 404);
  });
  return r;
}
