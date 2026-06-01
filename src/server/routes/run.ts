import { Hono } from "hono";
import type { App } from "../../app.ts";
import { dailyRun } from "../../pipeline/index.ts";

/** Manual trigger for the daily pipeline + last-run status + the latest report + equity series. */
export function runRoutes(app: App): Hono {
  const r = new Hono();

  // Fire-and-poll: a real LLM run takes minutes, far longer than any HTTP idle timeout. Start it in
  // the background (it records itself in the runs table + writes the report on completion) and return
  // immediately; the client polls GET /status until the run leaves the "running" state.
  r.post("/run", (c) => {
    if (app.repos.runs.latest()?.status === "running") {
      return c.json({ status: "already_running" });
    }
    void dailyRun(app).catch((err) =>
      console.error("dailyRun failed:", err instanceof Error ? err.message : err),
    );
    return c.json({ status: "started" });
  });

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
