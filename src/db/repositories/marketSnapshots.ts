import type { DB } from "../connection.ts";
import { MarketSnapshot } from "../../domain/index.ts";

type Row = { date: string; spy_close: number };

const toDomain = (r: Row): MarketSnapshot =>
  MarketSnapshot.parse({ date: r.date, spyClose: r.spy_close });

export function marketSnapshotsRepo(db: DB) {
  return {
    upsert(date: string, spyClose: number): MarketSnapshot {
      const valid = MarketSnapshot.parse({ date, spyClose });
      db.query(
        `INSERT INTO market_snapshots (date, spy_close) VALUES (?, ?)
         ON CONFLICT (date) DO UPDATE SET spy_close = excluded.spy_close`,
      ).run(valid.date, valid.spyClose);
      return valid;
    },

    list(): MarketSnapshot[] {
      return db
        .query<Row, []>("SELECT * FROM market_snapshots ORDER BY date")
        .all()
        .map(toDomain);
    },
  };
}
export type MarketSnapshotsRepo = ReturnType<typeof marketSnapshotsRepo>;
