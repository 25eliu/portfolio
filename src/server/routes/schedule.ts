import { Hono } from "hono";
import type { App } from "../../app.ts";
import { Schedule } from "../../domain/index.ts";

/** Automatic-run schedule: the time of day the in-process scheduler fires the daily run. */
export function scheduleRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/", (c) => c.json({ schedule: app.repos.schedule.get() }));

  r.put("/", async (c) => {
    const parsed = Schedule.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.flatten() }, 400);
    return c.json(app.repos.schedule.set(parsed.data));
  });

  return r;
}
