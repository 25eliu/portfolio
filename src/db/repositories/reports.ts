import type { DB } from "../connection.ts";
import { DailyReport } from "../../domain/index.ts";

type Row = {
  id: string;
  date: string;
  generated_at: string;
  source: string;
  recommendations_json: string;
  market_context_json: string | null;
};

const toDomain = (r: Row): DailyReport =>
  DailyReport.parse({
    id: r.id,
    date: r.date,
    generatedAt: r.generated_at,
    source: r.source,
    recommendations: JSON.parse(r.recommendations_json),
    marketContext: r.market_context_json ? JSON.parse(r.market_context_json) : null,
  });

/** Parse a row, tolerating legacy/incompatible reports written under an older schema. */
const safeToDomain = (r: Row): DailyReport | null => {
  try {
    return toDomain(r);
  } catch (err) {
    console.warn(`[reports] skipping unreadable report ${r.id} (${r.date}): ${err instanceof Error ? err.message.split("\n")[0] : err}`);
    return null;
  }
};

export function reportsRepo(db: DB) {
  return {
    insert(report: DailyReport): DailyReport {
      const valid = DailyReport.parse(report);
      db.query(
        `INSERT INTO reports (id, date, generated_at, source, recommendations_json, market_context_json)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        valid.id,
        valid.date,
        valid.generatedAt,
        valid.source,
        JSON.stringify(valid.recommendations),
        JSON.stringify(valid.marketContext ?? null),
      );
      return valid;
    },

    latest(): DailyReport | null {
      // Return the most recent report that still parses; skip legacy rows from an older schema.
      const rows = db
        .query<Row, []>("SELECT * FROM reports ORDER BY generated_at DESC LIMIT 20")
        .all();
      for (const row of rows) {
        const parsed = safeToDomain(row);
        if (parsed) return parsed;
      }
      return null;
    },
  };
}
export type ReportsRepo = ReturnType<typeof reportsRepo>;
