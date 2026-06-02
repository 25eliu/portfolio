import type { DB } from "../connection.ts";
import { ScoredForecast } from "../../domain/index.ts";

type Row = {
  id: string;
  journal_entry_id: string;
  ticker: string;
  side: string;
  strategy_family: string;
  signals_json: string;
  created_at: string;
  as_of_timestamp: string;
  market_session: string;
  quote_timestamp: string | null;
  price_feed: string;
  reference_price: number;
  entry: number | null;
  target: number;
  stop: number;
  horizon_trading_sessions: number;
  resolve_at: string;
  conviction: number;
  benchmark_symbol: string;
  benchmark_reference_price: number | null;
  resolution_policy_version: string;
  market_context_id: string | null;
  cited_source_ids_json: string;
  retrieved_chunk_ids_json: string;
};

const toDomain = (r: Row): ScoredForecast =>
  ScoredForecast.parse({
    id: r.id,
    journalEntryId: r.journal_entry_id,
    ticker: r.ticker,
    side: r.side,
    strategyFamily: r.strategy_family,
    signals: JSON.parse(r.signals_json),
    createdAt: r.created_at,
    asOfTimestamp: r.as_of_timestamp,
    marketSession: r.market_session,
    quoteTimestamp: r.quote_timestamp,
    priceFeed: r.price_feed,
    referencePrice: r.reference_price,
    entry: r.entry,
    target: r.target,
    stop: r.stop,
    horizonTradingSessions: r.horizon_trading_sessions,
    resolveAt: r.resolve_at,
    conviction: r.conviction,
    benchmarkSymbol: r.benchmark_symbol,
    benchmarkReferencePrice: r.benchmark_reference_price,
    resolutionPolicyVersion: r.resolution_policy_version,
    marketContextId: r.market_context_id,
    citedSourceIds: JSON.parse(r.cited_source_ids_json),
    retrievedChunkIds: JSON.parse(r.retrieved_chunk_ids_json),
  });

const safeToDomain = (r: Row): ScoredForecast | null => {
  try {
    return toDomain(r);
  } catch (err) {
    console.warn(
      `[forecasts] skipping unreadable forecast ${r.id} (${r.ticker}): ${err instanceof Error ? err.message.split("\n")[0] : err}`,
    );
    return null;
  }
};

export function scoredForecastsRepo(db: DB) {
  const insertStmt = db.query(
    `INSERT INTO scored_forecasts
       (id, journal_entry_id, ticker, side, strategy_family, signals_json, created_at,
        as_of_timestamp, market_session, quote_timestamp, price_feed, reference_price, entry,
        target, stop, horizon_trading_sessions, resolve_at, conviction, benchmark_symbol,
        benchmark_reference_price, resolution_policy_version, market_context_id,
        cited_source_ids_json, retrieved_chunk_ids_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const runInsert = (f: ScoredForecast): void => {
    const v = ScoredForecast.parse(f);
    insertStmt.run(
      v.id,
      v.journalEntryId,
      v.ticker,
      v.side,
      v.strategyFamily,
      JSON.stringify(v.signals),
      v.createdAt,
      v.asOfTimestamp,
      v.marketSession,
      v.quoteTimestamp,
      v.priceFeed,
      v.referencePrice,
      v.entry,
      v.target,
      v.stop,
      v.horizonTradingSessions,
      v.resolveAt,
      v.conviction,
      v.benchmarkSymbol,
      v.benchmarkReferencePrice,
      v.resolutionPolicyVersion,
      v.marketContextId,
      JSON.stringify(v.citedSourceIds),
      JSON.stringify(v.retrievedChunkIds),
    );
  };

  return {
    insert(f: ScoredForecast): ScoredForecast {
      const v = ScoredForecast.parse(f);
      runInsert(v);
      return v;
    },

    insertMany(forecasts: ScoredForecast[]): void {
      const valid = forecasts.map((f) => ScoredForecast.parse(f));
      db.transaction(() => valid.forEach(runInsert))();
    },

    get(id: string): ScoredForecast | null {
      const row = db.query<Row, [string]>("SELECT * FROM scored_forecasts WHERE id = ?").get(id);
      return row ? safeToDomain(row) : null;
    },

    getByJournalEntry(journalEntryId: string): ScoredForecast | null {
      const row = db
        .query<Row, [string]>("SELECT * FROM scored_forecasts WHERE journal_entry_id = ?")
        .get(journalEntryId);
      return row ? safeToDomain(row) : null;
    },

    /** Forecasts whose horizon has elapsed (resolve_at ≤ asOfDate) and that have no outcome yet. */
    listDueForResolution(asOfDate: string): ScoredForecast[] {
      const rows = db
        .query<Row, [string]>(
          `SELECT * FROM scored_forecasts
           WHERE resolve_at <= ?
             AND id NOT IN (SELECT forecast_id FROM forecast_outcomes)
           ORDER BY resolve_at`,
        )
        .all(asOfDate);
      return rows.map(safeToDomain).filter((f): f is ScoredForecast => f !== null);
    },

    /** Active theses: forecasts whose horizon has NOT elapsed (resolve_at > asOf) and have no outcome. */
    listOpen(asOfDate: string, limit = 100): ScoredForecast[] {
      const rows = db
        .query<Row, [string, number]>(
          `SELECT * FROM scored_forecasts
           WHERE resolve_at > ?
             AND id NOT IN (SELECT forecast_id FROM forecast_outcomes)
           ORDER BY created_at DESC
           LIMIT ?`,
        )
        .all(asOfDate, limit);
      return rows.map(safeToDomain).filter((f): f is ScoredForecast => f !== null);
    },

    listAll(opts: { limit?: number; offset?: number } = {}): ScoredForecast[] {
      const rows = db
        .query<Row, [number, number]>(
          "SELECT * FROM scored_forecasts ORDER BY created_at DESC LIMIT ? OFFSET ?",
        )
        .all(opts.limit ?? 100, opts.offset ?? 0);
      return rows.map(safeToDomain).filter((f): f is ScoredForecast => f !== null);
    },
  };
}
export type ScoredForecastsRepo = ReturnType<typeof scoredForecastsRepo>;
