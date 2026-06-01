/** CLI: create/upgrade the SQLite schema. Run with `bun run db:migrate`. */
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "../config/env.ts";
import { openDb } from "./connection.ts";

const path = env().DATABASE_PATH;
if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });

openDb(path);
console.log(`✓ Database migrated at ${path}`);
