import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { RiskPreset } from "../../domain/index.ts";

const Body = z.object({ preset: RiskPreset });

/** Risk-tolerance toggle. Stored only in this slice (does not yet affect the pipeline). */
export function riskRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json({ risk: app.repos.risk.get(app.user.id) }));

  r.put("/", async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    return c.json(app.repos.risk.set(app.user.id, parsed.data.preset));
  });

  return r;
}
