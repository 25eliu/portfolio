import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { App } from "../../app.ts";
import { startQuery, queryBus } from "../../query/index.ts";
import { mentionableTickers, parseMentions } from "../../query/tickers.ts";
import type { QueryEvent } from "../../query/bus.ts";

const AskBody = z.object({
  question: z.string().min(1).max(2000),
  tickers: z.array(z.string().min(1).max(10)).max(20).optional(),
});

/** Grounded NL query: ask a question, stream the grounded answer (mirrors the run fire-and-stream flow). */
export function queryRoutes(app: App): Hono {
  const r = new Hono();

  // Fire-and-stream: start the answer loop in the background, return its queryId; the client opens the
  // stream to watch tool calls + answer tokens.
  r.post("/", async (c) => {
    const body = AskBody.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    // Union client-sent @-mentions with a server-side re-parse of the question (authoritative), so
    // focus-scoping holds even if the client misses one.
    const focusTickers = [...new Set([...(body.data.tickers ?? []), ...parseMentions(body.data.question)].map((t) => t.toUpperCase()))];
    return c.json(startQuery(app, body.data.question, { focusTickers }));
  });

  // The mentionable universe for the `@`-autocomplete: the owner's holdings, the AI book, and watchlist.
  r.get("/tickers", (c) => c.json({ tickers: mentionableTickers(app) }));

  r.get("/log", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);
    return c.json({ queries: app.repos.queryLog.listRecent({ limit }) });
  });

  r.get("/:id/stream", (c) => {
    const queryId = c.req.param("id");
    c.header("X-Accel-Buffering", "no");
    c.header("Cache-Control", "no-cache");
    return streamSSE(c, async (stream) => {
      const queue: QueryEvent[] = [];
      let aborted = false;
      // Subscribe unconditionally (with buffered replay) — no "unknown id" gate, so a stream opened a
      // beat before the first publish still receives every event.
      const unsub = queryBus.subscribe(queryId, (evt) => queue.push(evt));
      stream.onAbort(() => {
        aborted = true;
        unsub();
      });
      let idle = 0;
      try {
        while (!aborted) {
          if (queue.length > 0) {
            idle = 0;
            const evt = queue.shift()!;
            await stream.writeSSE({ data: JSON.stringify(evt) });
            if (evt.type === "done" || evt.type === "error") break;
          } else {
            await stream.sleep(200);
            // Give up if nothing ever arrives (e.g. unknown id): ~30s of silence.
            if (++idle >= 150) {
              await stream.writeSSE({ data: JSON.stringify({ type: "error", message: "query timed out", seq: 0 }) });
              break;
            }
          }
        }
      } finally {
        unsub();
      }
    });
  });

  return r;
}
