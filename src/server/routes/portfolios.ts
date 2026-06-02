import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { priceAiPortfolio, priceUserPortfolio } from "../../pipeline/index.ts";
import { backfillUntrackedEntries } from "../../pipeline/backfill.ts";

const CashInput = z.object({ cash: z.number().nonnegative() });

/** Dual-view portfolio state. */
export function portfolioRoutes(app: App): Hono {
  const r = new Hono();

  // Live-priced dual view for the side-by-side panels. Backfill any untracked holdings first so
  // existing positions show a real cost basis (and Total P&L) on the next load, no run required.
  r.get("/", async (c) => {
    await backfillUntrackedEntries(app).catch((err) =>
      console.warn(`[backfill] failed: ${err instanceof Error ? err.message : String(err)}`),
    );
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

  return r;
}
