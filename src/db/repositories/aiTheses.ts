import type { DB } from "../connection.ts";
import { Thesis } from "../../domain/index.ts";

type Row = {
  id: string; run_id: string | null; report_id: string | null; date: string; created_at: string;
  level: string; subject: string; subject_key: string; stance: string; conviction: number;
  horizon: string; summary: string; thesis: string; status: string; supersedes_id: string | null;
  freshness_deadline: string | null; data_json: string;
};

const toDomain = (r: Row): Thesis => {
  const data = JSON.parse(r.data_json) as { tickers?: string[]; sources?: { title: string; url: string; sourceId?: string }[] };
  return Thesis.parse({
    id: r.id, runId: r.run_id, reportId: r.report_id, date: r.date, createdAt: r.created_at,
    level: r.level, subject: r.subject, subjectKey: r.subject_key, stance: r.stance, conviction: r.conviction,
    horizon: r.horizon, summary: r.summary, thesis: r.thesis, status: r.status, supersedesId: r.supersedes_id,
    freshnessDeadline: r.freshness_deadline, tickers: data.tickers ?? [], sources: data.sources ?? [],
  });
};

export function aiThesesRepo(db: DB) {
  return {
    insert(t: Thesis): Thesis {
      const v = Thesis.parse(t);
      db.query(
        `INSERT INTO ai_theses
           (id, run_id, report_id, date, created_at, level, subject, subject_key, stance, conviction,
            horizon, summary, thesis, status, supersedes_id, freshness_deadline, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        v.id, v.runId, v.reportId, v.date, v.createdAt, v.level, v.subject, v.subjectKey, v.stance, v.conviction,
        v.horizon, v.summary, v.thesis, v.status, v.supersedesId, v.freshnessDeadline,
        JSON.stringify({ tickers: v.tickers, sources: v.sources }),
      );
      db.query("INSERT INTO ai_theses_fts (thesis_id, text) VALUES (?, ?)").run(v.id, `${v.summary} ${v.thesis}`);
      return v;
    },

    /** Expire active theses whose freshness deadline has passed. Returns the ids expired. */
    expireStale(asOfDate: string): string[] {
      const ids = db
        .query<{ id: string }, [string]>(
          "SELECT id FROM ai_theses WHERE status = 'active' AND freshness_deadline IS NOT NULL AND freshness_deadline < ?",
        )
        .all(asOfDate)
        .map((r) => r.id);
      for (const id of ids) db.query("UPDATE ai_theses SET status = 'expired' WHERE id = ?").run(id);
      return ids;
    },

    /** Flip every currently-active thesis for a subject_key to 'superseded'. Returns the ids flipped. */
    supersedePriorActive(subjectKey: string, now: string): string[] {
      const ids = db
        .query<{ id: string }, [string]>("SELECT id FROM ai_theses WHERE subject_key = ? AND status = 'active'")
        .all(subjectKey)
        .map((r) => r.id);
      for (const id of ids) db.query("UPDATE ai_theses SET status = 'superseded' WHERE id = ?").run(id);
      void now;
      return ids;
    },

    get(id: string): Thesis | null {
      const row = db.query<Row, [string]>("SELECT * FROM ai_theses WHERE id = ?").get(id);
      return row ? toDomain(row) : null;
    },

    currentByLevel(level: string): Thesis[] {
      return db.query<Row, [string]>("SELECT * FROM ai_theses WHERE level = ? AND status = 'active' ORDER BY created_at DESC").all(level).map(toDomain);
    },

    listActive(): Thesis[] {
      return db.query<Row, []>("SELECT * FROM ai_theses WHERE status = 'active' ORDER BY created_at DESC").all().map(toDomain);
    },

    listDays(): { date: string; count: number }[] {
      return db.query<{ date: string; count: number }, []>("SELECT date, COUNT(*) AS count FROM ai_theses GROUP BY date ORDER BY date DESC").all();
    },

    listDay(date: string): Thesis[] {
      return db.query<Row, [string]>("SELECT * FROM ai_theses WHERE date = ? ORDER BY created_at DESC").all(date).map(toDomain);
    },

    historyForSubject(subjectKey: string): Thesis[] {
      return db.query<Row, [string]>("SELECT * FROM ai_theses WHERE subject_key = ? ORDER BY created_at DESC, rowid DESC").all(subjectKey).map(toDomain);
    },

    search(query: string, limit = 20): Thesis[] {
      if (!query.trim()) return [];
      return db
        .query<Row, [string, number]>(
          `SELECT t.* FROM ai_theses_fts f JOIN ai_theses t ON t.id = f.thesis_id
            WHERE ai_theses_fts MATCH ? AND t.status = 'active' ORDER BY bm25(ai_theses_fts) LIMIT ?`,
        )
        .all(query, limit)
        .map(toDomain);
    },
  };
}
export type AiThesesRepo = ReturnType<typeof aiThesesRepo>;
