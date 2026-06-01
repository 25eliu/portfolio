import type { DB } from "../connection.ts";
import { Snapshot } from "../../domain/index.ts";

type Row = {
  id: string;
  portfolio_id: string;
  date: string;
  total_value: number;
  cash: number;
  positions_json: string;
};

const toDomain = (r: Row): Snapshot =>
  Snapshot.parse({
    id: r.id,
    portfolioId: r.portfolio_id,
    date: r.date,
    totalValue: r.total_value,
    cash: r.cash,
    positions: JSON.parse(r.positions_json),
  });

export function snapshotsRepo(db: DB) {
  return {
    /** Insert (or replace for the same portfolio+date) a dated valuation. */
    upsert(s: Snapshot): Snapshot {
      const valid = Snapshot.parse(s);
      db.query(
        `INSERT INTO snapshots (id, portfolio_id, date, total_value, cash, positions_json)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (portfolio_id, date)
         DO UPDATE SET total_value = excluded.total_value, cash = excluded.cash,
                       positions_json = excluded.positions_json`,
      ).run(
        valid.id,
        valid.portfolioId,
        valid.date,
        valid.totalValue,
        valid.cash,
        JSON.stringify(valid.positions),
      );
      return valid;
    },

    listByPortfolio(portfolioId: string): Snapshot[] {
      return db
        .query<Row, [string]>("SELECT * FROM snapshots WHERE portfolio_id = ? ORDER BY date")
        .all(portfolioId)
        .map(toDomain);
    },

    latestByPortfolio(portfolioId: string): Snapshot | null {
      const row = db
        .query<Row, [string]>(
          "SELECT * FROM snapshots WHERE portfolio_id = ? ORDER BY date DESC LIMIT 1",
        )
        .get(portfolioId);
      return row ? toDomain(row) : null;
    },

    /** Most recent snapshot strictly before `date` (used to compute day P&L). */
    latestBefore(portfolioId: string, date: string): Snapshot | null {
      const row = db
        .query<Row, [string, string]>(
          "SELECT * FROM snapshots WHERE portfolio_id = ? AND date < ? ORDER BY date DESC LIMIT 1",
        )
        .get(portfolioId, date);
      return row ? toDomain(row) : null;
    },
  };
}
export type SnapshotsRepo = ReturnType<typeof snapshotsRepo>;
