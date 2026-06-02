import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { priceAiPortfolio, priceUserPortfolio, seedAiAccount } from "../../pipeline/index.ts";

const CashInput = z.object({ cash: z.number().nonnegative() });

/** Dual-view portfolio state + AI account seeding. */
export function portfolioRoutes(app: App): Hono {
  const r = new Hono();

  // Live-priced dual view for the side-by-side panels.
  r.get("/", async (c) => {
    const [user, ai] = await Promise.all([priceUserPortfolio(app), priceAiPortfolio(app)]);
    return c.json({ user, ai });
  });

  // Set My Portfolio's sitting cash (buying power the AI must respect).
  r.put("/cash", async (c) => {
    const parsed = CashInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    app.repos.portfolios.setCash(app.user.id, parsed.data.cash);
    return c.json({ cash: parsed.data.cash });
  });

  // One-time seeding of the AI paper account to match My Portfolio.
  r.post("/ai/seed", async (c) => c.json(await seedAiAccount(app)));

  return r;
}
