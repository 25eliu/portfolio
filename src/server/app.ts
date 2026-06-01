import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "../app.ts";
import { holdingsRoutes } from "./routes/holdings.ts";
import { portfolioRoutes } from "./routes/portfolios.ts";
import { runRoutes } from "./routes/run.ts";
import { riskRoutes } from "./routes/risk.ts";
import { watchlistRoutes } from "./routes/watchlist.ts";

/** Build the HTTP API over an application context (injectable for tests). */
export function createServer(app: App): Hono {
  const api = new Hono();
  api.use("*", cors());

  api.get("/health", (c) => c.json({ ok: true, adapter: app.gateway.kind }));
  api.route("/holdings", holdingsRoutes(app));
  api.route("/portfolios", portfolioRoutes(app));
  api.route("/risk", riskRoutes(app));
  api.route("/watchlist", watchlistRoutes(app));
  api.route("/", runRoutes(app)); // /run, /status, /recommendations, /snapshots

  api.onError((err, c) => {
    console.error("API error:", err);
    return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  });

  const root = new Hono();
  root.route("/api", api);
  return root;
}
