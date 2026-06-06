import type { DB } from "../connection.ts";
import { ForecastOutcome } from "../../domain/index.ts";

type Row = {
  id: string;
  forecast_id: string;
  outcome: string;
  resolved_at: string;
  resolution_date: string;
  ticker: string;
  entry_price: number;
  exit_price: number;
  terminal_return: number;
  spy_excess_return: number | null;
  max_favorable_excursion: number;
  max_adverse_excursion: number;
  forecast_r: number | null;
  bars_provider: string;
  adjustment_policy_version: string;
  resolution_policy_version: string;
  warnings_json: string;
};

const toDomain = (r: Row): ForecastOutcome =>
  ForecastOutcome.parse({
    id: r.id,
    forecastId: r.forecast_id,
    outcome: r.outcome,
    resolvedAt: r.resolved_at,
    resolutionDate: r.resolution_date,
    ticker: r.ticker,
    entryPrice: r.entry_price,
    exitPrice: r.exit_price,
    terminalReturn: r.terminal_return,
    spyExcessReturn: r.spy_excess_return,
    maxFavorableExcursion: r.max_favorable_excursion,
    maxAdverseExcursion: r.max_adverse_excursion,
    forecastR: r.forecast_r,
    barsProvider: r.bars_provider,
    adjustmentPolicyVersion: r.adjustment_policy_version,
    resolutionPolicyVersion: r.resolution_policy_version,
    warnings: JSON.parse(r.warnings_json),
  });

/** Resolved forecast outcomes — one immutable row per scored forecast. The ticker is denormalized for
 *  convenient cohort queries (Phase 4) even though the row is keyed by forecast_id. */
export function forecastOutcomesRepo(db: DB) {
  const insertStmt = db.query(
    `INSERT INTO forecast_outcomes
       (id, forecast_id, ticker, outcome, resolved_at, resolution_date, entry_price, exit_price,
        terminal_return, spy_excess_return, max_favorable_excursion, max_adverse_excursion,
        forecast_r, bars_provider, adjustment_policy_version, resolution_policy_version, warnings_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  return {
    insert(o: ForecastOutcome): ForecastOutcome {
      const v = ForecastOutcome.parse(o);
      insertStmt.run(
        v.id,
        v.forecastId,
        v.ticker,
        v.outcome,
        v.resolvedAt,
        v.resolutionDate,
        v.entryPrice,
        v.exitPrice,
        v.terminalReturn,
        v.spyExcessReturn,
        v.maxFavorableExcursion,
        v.maxAdverseExcursion,
        v.forecastR,
        v.barsProvider,
        v.adjustmentPolicyVersion,
        v.resolutionPolicyVersion,
        JSON.stringify(v.warnings),
      );
      return v;
    },

    getByForecast(forecastId: string): ForecastOutcome | null {
      const row = db
        .query<Row, [string]>("SELECT * FROM forecast_outcomes WHERE forecast_id = ?")
        .get(forecastId);
      return row ? toDomain(row) : null;
    },

    list(opts: { limit?: number; offset?: number } = {}): ForecastOutcome[] {
      return db
        .query<Row, [number, number]>(
          "SELECT * FROM forecast_outcomes ORDER BY resolution_date DESC LIMIT ? OFFSET ?",
        )
        .all(opts.limit ?? 200, opts.offset ?? 0)
        .map(toDomain);
    },
  };
}
export type ForecastOutcomesRepo = ReturnType<typeof forecastOutcomesRepo>;
