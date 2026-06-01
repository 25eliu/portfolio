import { Database } from "bun:sqlite";
import { MIGRATIONS } from "./schema.ts";

export type DB = Database;

/** Open (and create if needed) a SQLite database with sane pragmas, then migrate it. */
export function openDb(path: string): DB {
  const db = new Database(path, { create: true });
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");
  migrate(db);
  return db;
}

/** Open an in-memory database (used by tests). */
export function openMemoryDb(): DB {
  return openDb(":memory:");
}

/** Apply any unapplied migration steps. Idempotent and safe to call on every boot. */
export function migrate(db: DB): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL);`,
  );
  const applied = new Set(
    db
      .query<{ name: string }, []>("SELECT name FROM _migrations")
      .all()
      .map((r) => r.name),
  );
  const insert = db.query("INSERT INTO _migrations (name, applied_at) VALUES (?, ?)");
  const tx = db.transaction((step: { name: string; sql: string }) => {
    db.exec(step.sql);
    insert.run(step.name, new Date().toISOString());
  });
  for (const step of MIGRATIONS) {
    if (!applied.has(step.name)) tx(step);
  }
}
