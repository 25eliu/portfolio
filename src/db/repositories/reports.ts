import type { DB } from "../connection.ts";
import { DailyReport } from "../../domain/index.ts";

type Row = {
  id: string;
  date: string;
  generated_at: string;
  source: string;
  recommendations_json: string;
};

const toDomain = (r: Row): DailyReport =>
  DailyReport.parse({
    id: r.id,
    date: r.date,
    generatedAt: r.generated_at,
    source: r.source,
    recommendations: JSON.parse(r.recommendations_json),
  });

export function reportsRepo(db: DB) {
  return {
    insert(report: DailyReport): DailyReport {
      const valid = DailyReport.parse(report);
      db.query(
        `INSERT INTO reports (id, date, generated_at, source, recommendations_json)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        valid.id,
        valid.date,
        valid.generatedAt,
        valid.source,
        JSON.stringify(valid.recommendations),
      );
      return valid;
    },

    latest(): DailyReport | null {
      const row = db
        .query<Row, []>("SELECT * FROM reports ORDER BY generated_at DESC LIMIT 1")
        .get();
      return row ? toDomain(row) : null;
    },
  };
}
export type ReportsRepo = ReturnType<typeof reportsRepo>;
