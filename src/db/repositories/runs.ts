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

    latest(): Run | null {
      const row = db.query<Row, []>("SELECT * FROM runs ORDER BY started_at DESC LIMIT 1").get();
      return row ? toDomain(row) : null;
    },
  };
}
export type RunsRepo = ReturnType<typeof runsRepo>;
