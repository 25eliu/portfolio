import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { App } from "../../app.ts";
import { startRunGuarded } from "../../pipeline/startRun.ts";
import { runBus, type RunEvent } from "../../pipeline/events.ts";

/** Manual trigger + live event stream + status + the latest report + equity series. */
export function runRoutes(app: App): Hono {
  const r = new Hono();

  // Fire-and-stream: start the run in the background (it publishes progress events to the run bus) and
  // return its runId immediately. The client opens GET /run/:runId/stream to watch it live.
  r.post("/run", (c) => c.json(startRunGuarded(app)));

  // Server-Sent Events: replay this run's buffered events, then stream live ones until it finishes.
  r.get("/run/:runId/stream", (c) => {
    const runId = c.req.param("runId");
    c.header("X-Accel-Buffering", "no"); // disable proxy buffering (Vite/nginx)
    c.header("Cache-Control", "no-cache");
    return streamSSE(c, async (stream) => {
      const queue: RunEvent[] = [];
      let aborted = false;
      const unsub = runBus.subscribe(runId, (evt) => queue.push(evt));
      stream.onAbort(() => {
        aborted = true;
        unsub();
      });

      // Unknown / never-started run → tell the client to close.
      if (!runBus.hasBuffer(runId)) {
        await stream.writeSSE({ data: JSON.stringify({ type: "run:done", runId, seq: 0 }) });
        unsub();
        return;
      }

      let idle = 0;
      try {
        while (!aborted) {
          if (queue.length > 0) {
            idle = 0;
            const evt = queue.shift()!;
            await stream.writeSSE({ data: JSON.stringify(evt) });
            if (evt.type === "run:done" || evt.type === "run:error") break;
          } else {
            await stream.sleep(200);
            if (++idle >= 75) {
              idle = 0;
              await stream.writeSSE({ data: JSON.stringify({ type: "heartbeat", seq: 0 }) });
            }
          }
        }
      } finally {
        unsub();
      }
    });
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
