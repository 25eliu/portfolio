/** Boot the HTTP API against the real (env-selected) application context. */
import { createApp } from "../app.ts";
import { env } from "../config/env.ts";
import { createServer } from "./app.ts";

const app = createApp();
const server = createServer(app);
const port = env().PORT;

// idleTimeout is a safety net; /run is fire-and-poll so requests stay short regardless.
Bun.serve({ port, fetch: server.fetch, idleTimeout: 255 });
console.log(
  `→ Portfolio API on http://localhost:${port}  (adapter: ${app.gateway.kind}, db: ${app.env.DATABASE_PATH})`,
);
