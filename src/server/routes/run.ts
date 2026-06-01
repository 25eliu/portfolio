import { Hono } from "hono";
import type { App } from "../../app.ts";
import { dailyRun } from "../../pipeline/index.ts";

/** Manual trigger for the daily pipeline + last-run status + the latest report + equity series. */
export function runRoutes(app: App): Hono {
  const r = new Hono();

  r.post("/run", async (c) => c.json(await dailyRun(app)));

  r.get("/status", (c) => c.json({ lastRun: app.repos.runs.latest() }));

  r.get("/recommendations", (c) => c.json({ report: app.repos.reports.latest() }));

  r.get("/snapshots", (c) =>
    c.json({
      user: app.repos.snapshots.listByPortfolio(app.user.id),
      ai: app.repos.snapshots.listByPortfolio(app.ai.id),
      spy: app.repos.marketSnapshots.list(),
    }),
  );

  return r;
}
