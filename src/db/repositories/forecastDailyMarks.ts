import type { DB } from "../connection.ts";
import { ForecastDailyMark } from "../../domain/index.ts";

type Row = {
  id: string; forecast_id: string; ticker: string; date: string; mark_price: number;
  move_from_entry: number; progress_to_target: number; progress_to_stop: number;
  unrealized_r: number | null; mfe: number; mae: number; spy_excess: number | null;
  status: string; created_at: string;
};

const toDomain = (r: Row): ForecastDailyMark =>
  ForecastDailyMark.parse({
    id: r.id, forecastId: r.forecast_id, ticker: r.ticker, date: r.date, markPrice: r.mark_price,
    moveFromEntry: r.move_from_entry, progressToTarget: r.progress_to_target, progressToStop: r.progress_to_stop,
    unrealizedR: r.unrealized_r, mfe: r.mfe, mae: r.mae, spyExcess: r.spy_excess,
    status: r.status, createdAt: r.created_at,
  });

export function forecastDailyMarksRepo(db: DB) {
  return {
    upsert(m: ForecastDailyMark): ForecastDailyMark {
      const v = ForecastDailyMark.parse(m);
      db.query(
        `INSERT INTO forecast_daily_marks
           (id, forecast_id, ticker, date, mark_price, move_from_entry, progress_to_target, progress_to_stop,
            unrealized_r, mfe, mae, spy_excess, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (forecast_id, date) DO UPDATE SET
           mark_price = excluded.mark_price, move_from_entry = excluded.move_from_entry,
           progress_to_target = excluded.progress_to_target, progress_to_stop = excluded.progress_to_stop,
           unrealized_r = excluded.unrealized_r, mfe = excluded.mfe, mae = excluded.mae,
           spy_excess = excluded.spy_excess, status = excluded.status`,
      ).run(
        v.id, v.forecastId, v.ticker, v.date, v.markPrice, v.moveFromEntry, v.progressToTarget, v.progressToStop,
        v.unrealizedR, v.mfe, v.mae, v.spyExcess, v.status, v.createdAt,
      );
      return v;
    },

    listForForecast(forecastId: string): ForecastDailyMark[] {
      return db
        .query<Row, [string]>("SELECT * FROM forecast_daily_marks WHERE forecast_id = ? ORDER BY date ASC")
        .all(forecastId)
        .map(toDomain);
    },

    priorMark(forecastId: string, date: string): ForecastDailyMark | null {
      const row = db
        .query<Row, [string, string]>(
          "SELECT * FROM forecast_daily_marks WHERE forecast_id = ? AND date < ? ORDER BY date DESC LIMIT 1",
        )
        .get(forecastId, date);
      return row ? toDomain(row) : null;
    },

    forDate(date: string): ForecastDailyMark[] {
      return db.query<Row, [string]>("SELECT * FROM forecast_daily_marks WHERE date = ?").all(date).map(toDomain);
    },
  };
}
export type ForecastDailyMarksRepo = ReturnType<typeof forecastDailyMarksRepo>;
