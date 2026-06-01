import { Hono } from "hono";
import type { App } from "../../app.ts";
import { priceAiPortfolio, priceUserPortfolio, seedAiAccount } from "../../pipeline/index.ts";

/** Dual-view portfolio state + AI account seeding. */
export function portfolioRoutes(app: App): Hono {
  const r = new Hono();

  // Live-priced dual view for the side-by-side panels.
  r.get("/", async (c) => {
    const [user, ai] = await Promise.all([priceUserPortfolio(app), priceAiPortfolio(app)]);
    return c.json({ user, ai });
  });

  // One-time seeding of the AI paper account to match My Portfolio.
  r.post("/ai/seed", async (c) => c.json(await seedAiAccount(app)));

  return r;
}
