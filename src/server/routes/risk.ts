import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { RiskPreset } from "../../domain/index.ts";

const Body = z.object({ preset: RiskPreset, portfolio: z.enum(["user", "ai"]).default("user") });

/** Risk-tolerance presets, one per portfolio: the user's advisory book and the AI's paper book. The
 *  AI's preset governs its execution planner (sizing, horizons, strategy eligibility). */
export function riskRoutes(app: App): Hono {
  const r = new Hono();

  // Both profiles. `risk` (the user's) is kept as a top-level field for backward compatibility.
  r.get("/", (c) =>
    c.json({ risk: app.repos.risk.get(app.user.id), user: app.repos.risk.get(app.user.id), ai: app.repos.risk.get(app.ai.id) }),
  );

  r.put("/", async (c) => {
    const parsed = Body.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    const portfolioId = parsed.data.portfolio === "ai" ? app.ai.id : app.user.id;
    return c.json(app.repos.risk.set(portfolioId, parsed.data.preset));
  });

  return r;
}
