import type { DB } from "../connection.ts";
import { JournalEntry } from "../../domain/index.ts";

type Row = {
  id: string;
  report_id: string;
  run_id: string | null;
  date: string;
  created_at: string;
  ticker: string;
  held: number;
  action: string;
  conviction: number;
  strategy_family: string;
  recommendation_json: string;
  market_context_id: string | null;
  scored: number;
};

const toDomain = (r: Row): JournalEntry =>
  JournalEntry.parse({
    id: r.id,
    reportId: r.report_id,
    runId: r.run_id,
    date: r.date,
    createdAt: r.created_at,
    ticker: r.ticker,
    held: r.held === 1,
    action: r.action,
    conviction: r.conviction,
    strategyFamily: r.strategy_family,
    recommendation: JSON.parse(r.recommendation_json),
    marketContextId: r.market_context_id,
    scored: r.scored === 1,
  });

/** Parse a row, tolerating legacy/incompatible entries written under an older schema. */
const safeToDomain = (r: Row): JournalEntry | null => {
  try {
    return toDomain(r);
  } catch (err) {
    console.warn(
      `[journal] skipping unreadable entry ${r.id} (${r.ticker} ${r.date}): ${err instanceof Error ? err.message.split("\n")[0] : err}`,
    );
    return null;
  }
};

export function journalEntriesRepo(db: DB) {
  const insertStmt = db.query(
    `INSERT INTO journal_entries
       (id, report_id, run_id, date, created_at, ticker, held, action, conviction,
        strategy_family, recommendation_json, market_context_id, scored)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const runInsert = (e: JournalEntry): void => {
    const valid = JournalEntry.parse(e);
    insertStmt.run(
      valid.id,
      valid.reportId,
      valid.runId,
      valid.date,
      valid.createdAt,
      valid.ticker,
      valid.held ? 1 : 0,
      valid.action,
      valid.conviction,
      valid.strategyFamily,
      JSON.stringify(valid.recommendation),
      valid.marketContextId,
      valid.scored ? 1 : 0,
    );
  };

  return {
    insert(e: JournalEntry): JournalEntry {
      const valid = JournalEntry.parse(e);
      runInsert(valid);
      return valid;
    },

    /** Insert many entries atomically (one transaction per run). */
    insertMany(entries: JournalEntry[]): void {
      const valid = entries.map((e) => JournalEntry.parse(e));
      db.transaction(() => valid.forEach(runInsert))();
    },

    list(opts: { ticker?: string; date?: string; limit?: number; offset?: number } = {}): JournalEntry[] {
      const limit = opts.limit ?? 100;
      const offset = opts.offset ?? 0;
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (opts.ticker) (where.push("ticker = ?"), params.push(opts.ticker));
      if (opts.date) (where.push("date = ?"), params.push(opts.date));
      const clause = where.length ? `WHERE ${where.join(" AND ")} ` : "";
      const rows = db
        .query<Row, (string | number)[]>(
          `SELECT * FROM journal_entries ${clause}ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        )
        .all(...params, limit, offset);
      return rows.map(safeToDomain).filter((e): e is JournalEntry => e !== null);
    },

    /**
     * Day summaries for the day-grouped view: one row per date, newest first. Counts are by DISTINCT
     * ticker — multiple analysis runs on the same day re-journal the same names, but the day view shows
     * the latest call per ticker (see `listDay`), so the counts must match that deduped set.
     */
    listDays(): { date: string; count: number; scored: number }[] {
      return db
        .query<{ date: string; count: number; scored: number }, []>(
          `SELECT date,
                  COUNT(DISTINCT ticker) AS count,
                  COUNT(DISTINCT CASE WHEN scored = 1 THEN ticker END) AS scored
             FROM journal_entries GROUP BY date ORDER BY date DESC`,
        )
        .all();
    },

    /**
     * One row per ticker for a given day — the LATEST run's call for each name. The journal keeps every
     * run's entry for audit (and the per-ticker history view), but the day view collapses same-day
     * re-runs to the most recent call so a day isn't cluttered with repeats of the same ticker.
     */
    listDay(date: string): JournalEntry[] {
      const rows = db
        .query<Row, [string]>(
          `SELECT je.* FROM journal_entries je
            WHERE je.date = ?
              AND je.created_at = (
                SELECT MAX(je2.created_at) FROM journal_entries je2
                 WHERE je2.date = je.date AND je2.ticker = je.ticker
              )
            ORDER BY je.created_at DESC, je.ticker`,
        )
        .all(date);
      return rows.map(safeToDomain).filter((e): e is JournalEntry => e !== null);
    },

    get(id: string): JournalEntry | null {
      const row = db.query<Row, [string]>("SELECT * FROM journal_entries WHERE id = ?").get(id);
      return row ? safeToDomain(row) : null;
    },

    /** Distinct tickers the system rated BUY/ADD/WATCH on/after `sinceDate` — the AI's recent
     *  buy-interest, carried forward into its hunting universe. Newest call first, capped to `limit`. */
    recentActionableTickers(sinceDate: string, limit = 50): string[] {
      const rows = db
        .query<{ ticker: string }, [string, number]>(
          `SELECT ticker, MAX(created_at) AS mc FROM journal_entries
            WHERE date >= ? AND action IN ('BUY','ADD','WATCH')
            GROUP BY ticker ORDER BY mc DESC LIMIT ?`,
        )
        .all(sinceDate, limit);
      return rows.map((r) => r.ticker);
    },

    /** The most recent journal entry for a ticker strictly before `beforeDate` — the AI's prior call,
     *  fed back into analysis for day-to-day continuity. Null when there is no earlier entry. */
    latestPriorForTicker(ticker: string, beforeDate: string): JournalEntry | null {
      const row = db
        .query<Row, [string, string]>(
          `SELECT * FROM journal_entries WHERE ticker = ? AND date < ? ORDER BY created_at DESC LIMIT 1`,
        )
        .get(ticker, beforeDate);
      return row ? safeToDomain(row) : null;
    },
  };
}
export type JournalEntriesRepo = ReturnType<typeof journalEntriesRepo>;
