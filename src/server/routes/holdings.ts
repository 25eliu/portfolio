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
    // "When I add the stock, that's when I bought it": capture the current price as cost basis
    // (unless the user supplied one) and stamp today as the buy date.
    const costBasis = parsed.data.costBasis ?? (await app.gateway.getQuote(parsed.data.symbol)).price;
    const input = { ...parsed.data, costBasis, acquiredAt: app.now() };
    return c.json(app.repos.holdings.upsert(app.user.id, input), 201);
  });

  r.delete("/:id", (c) => {
    const ok = app.repos.holdings.remove(c.req.param("id"));
    return c.json({ ok }, ok ? 200 : 404);
  });

  return r;
}
