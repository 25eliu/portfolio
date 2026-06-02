import type { DB } from "../connection.ts";
import { newId } from "../../domain/index.ts";

export type RunStatus = "running" | "ok" | "error";

export type Run = {
  id: string;
  startedAt: string;
  finishedAt: string | null;
  status: RunStatus;
  error: string | null;
};

type Row = {
  id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  error: string | null;
};

const toDomain = (r: Row): Run => ({
  id: r.id,
  startedAt: r.started_at,
  finishedAt: r.finished_at,
  status: r.status as RunStatus,
  error: r.error,
});

export function runsRepo(db: DB) {
  return {
    /** Record the start of a dailyRun and return its id. */
    start(now: string = new Date().toISOString()): string {
      const id = newId();
      db.query("INSERT INTO runs (id, started_at, finished_at, status, error) VALUES (?, ?, NULL, 'running', NULL)").run(
        id,
        now,
      );
      return id;
    },

    finish(id: string, status: RunStatus, error: string | null = null): void {
      db.query("UPDATE runs SET finished_at = ?, status = ?, error = ? WHERE id = ?").run(
        new Date().toISOString(),
        status,
        error,
        id,
      );
    },

    /**
     * Mark any still-"running" runs as abandoned. Runs live in an in-memory bus tied to the server
     * process, so on a fresh boot no run is actually in flight — a leftover "running" row is stale
     * (the server was killed mid-run) and would otherwise block all new runs via the concurrency
     * guard. Returns the number of runs cleared.
     */
    abandonRunning(): number {
      return db
        .query("UPDATE runs SET finished_at = ?, status = 'error', error = 'abandoned (server restart)' WHERE status = 'running'")
        .run(new Date().toISOString()).changes;
    },

    latest(): Run | null {
      const row = db.query<Row, []>("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1").get();
      return row ? toDomain(row) : null;
    },
  };
}
export type RunsRepo = ReturnType<typeof runsRepo>;
