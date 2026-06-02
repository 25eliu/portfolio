import { Hono } from "hono";
import type { App } from "../../app.ts";

/** Read-only performance-wiki views: active briefing, lessons, and calibration metrics. */
export function wikiRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/briefing", (c) => c.json({ briefing: app.repos.wiki.latestBriefing() }));

  r.get("/lessons", (c) => {
    const all = c.req.query("all") === "true";
    const states = all ? undefined : (["active", "provisional"] as const);
    return c.json({ lessons: app.repos.wiki.listLessons(states ? { states: [...states] } : {}) });
  });

  r.get("/metrics", (c) => {
    const window = c.req.query("window");
    return c.json({ metrics: app.repos.wiki.listMetrics(window ? { window } : {}) });
  });

  return r;
}
