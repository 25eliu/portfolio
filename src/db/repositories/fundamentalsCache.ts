import type { DB } from "../connection.ts";
import { Fundamentals } from "../../domain/index.ts";

type Row = { payload: string };

export function fundamentalsCacheRepo(db: DB) {
  return {
    get(symbol: string, date: string): Fundamentals | null {
      const row = db
        .query<Row, [string, string]>("SELECT payload FROM fundamentals_cache WHERE symbol = ? AND date = ?")
        .get(symbol, date);
      return row ? Fundamentals.parse(JSON.parse(row.payload)) : null;
    },
    put(symbol: string, date: string, f: Fundamentals): void {
      db.query(
        `INSERT INTO fundamentals_cache (symbol, date, payload) VALUES (?, ?, ?)
         ON CONFLICT (symbol, date) DO UPDATE SET payload = excluded.payload`,
      ).run(symbol, date, JSON.stringify(Fundamentals.parse(f)));
    },
  };
}
export type FundamentalsCacheRepo = ReturnType<typeof fundamentalsCacheRepo>;
