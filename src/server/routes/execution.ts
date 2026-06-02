import { Hono } from "hono";
import type { App } from "../../app.ts";

/** AI paper-execution: the auditable trade log. The AI trades automatically — nothing to configure. */
export function executionRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/trades", (c) => {
    const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
    return c.json({ trades: app.repos.tradeDecisions.listRecent({ limit }) });
  });

  return r;
}
