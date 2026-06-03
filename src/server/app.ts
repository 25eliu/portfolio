import { Hono } from "hono";
import { cors } from "hono/cors";
import type { App } from "../app.ts";
import { holdingsRoutes } from "./routes/holdings.ts";
import { portfolioRoutes } from "./routes/portfolios.ts";
import { runRoutes } from "./routes/run.ts";
import { riskRoutes } from "./routes/risk.ts";
import { scheduleRoutes } from "./routes/schedule.ts";
import { watchlistRoutes } from "./routes/watchlist.ts";
import { journalRoutes } from "./routes/journal.ts";
import { knowledgeRoutes } from "./routes/knowledge.ts";
import { aiKnowledgeRoutes } from "./routes/aiKnowledge.ts";
import { graphRoutes } from "./routes/graph.ts";
import { wikiRoutes } from "./routes/wiki.ts";
import { executionRoutes } from "./routes/execution.ts";
import { queryRoutes } from "./routes/query.ts";

/** Build the HTTP API over an application context (injectable for tests). */
export function createServer(app: App): Hono {
  const api = new Hono();
  api.use("*", cors());

  api.get("/health", (c) => c.json({ ok: true, adapter: app.gateway.kind }));
  api.route("/holdings", holdingsRoutes(app));
  api.route("/portfolios", portfolioRoutes(app));
  api.route("/risk", riskRoutes(app));
  api.route("/schedule", scheduleRoutes(app));
  api.route("/watchlist", watchlistRoutes(app));
  api.route("/journal", journalRoutes(app));
  api.route("/knowledge", knowledgeRoutes(app));
  api.route("/", aiKnowledgeRoutes(app)); // /ai-library, /tags, /ai-insights
  api.route("/graph", graphRoutes(app));
  api.route("/wiki", wikiRoutes(app));
  api.route("/query", queryRoutes(app));
  api.route("/", executionRoutes(app)); // /trades
  api.route("/", runRoutes(app)); // /run, /status, /recommendations, /snapshots

  api.onError((err, c) => {
    console.error("API error:", err);
    return c.json({ error: err instanceof Error ? err.message : "internal error" }, 500);
  });

  const root = new Hono();
  root.route("/api", api);
  return root;
}
