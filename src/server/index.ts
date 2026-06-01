/** Boot the HTTP API against the real (env-selected) application context. */
import { createApp } from "../app.ts";
import { env } from "../config/env.ts";
import { createServer } from "./app.ts";

const app = createApp();
const server = createServer(app);
const port = env().PORT;

Bun.serve({ port, fetch: server.fetch });
console.log(
  `→ Portfolio API on http://localhost:${port}  (adapter: ${app.gateway.kind}, db: ${app.env.DATABASE_PATH})`,
);
