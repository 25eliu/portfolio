import type { DB } from "../connection.ts";
import { TradeDecision } from "../../domain/index.ts";

type Row = {
  id: string;
  run_id: string | null;
  journal_entry_id: string | null;
  forecast_id: string | null;
  ticker: string;
  side: string;
  action: string;
  qty: number;
  intended_price: number;
  notional: number;
  status: string;
  reason: string | null;
  broker_order_id: string | null;
  created_at: string;
  submitted_at: string | null;
};

const toDomain = (r: Row): TradeDecision =>
  TradeDecision.parse({
    id: r.id,
    runId: r.run_id,
    journalEntryId: r.journal_entry_id,
    forecastId: r.forecast_id,
    ticker: r.ticker,
    side: r.side,
    action: r.action,
    qty: r.qty,
    intendedPrice: r.intended_price,
    notional: r.notional,
    status: r.status,
    reason: r.reason,
    brokerOrderId: r.broker_order_id,
    createdAt: r.created_at,
    submittedAt: r.submitted_at,
  });

/** Auditable AI paper-trade log. Decisions are immutable once written, except a status/order-id update
 *  when an order is actually submitted/filled/failed. */
export function tradeDecisionsRepo(db: DB) {
  const insertStmt = db.query(
    `INSERT INTO trade_decisions
       (id, run_id, journal_entry_id, forecast_id, ticker, side, action, qty, intended_price,
        notional, status, reason, broker_order_id, created_at, submitted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );

  const runInsert = (d: TradeDecision): void => {
    const v = TradeDecision.parse(d);
    insertStmt.run(
      v.id, v.runId, v.journalEntryId, v.forecastId, v.ticker, v.side, v.action, v.qty, v.intendedPrice,
      v.notional, v.status, v.reason, v.brokerOrderId, v.createdAt, v.submittedAt,
    );
  };

  return {
    insert(d: TradeDecision): TradeDecision {
      const v = TradeDecision.parse(d);
      runInsert(v);
      return v;
    },

    insertMany(decisions: TradeDecision[]): void {
      const valid = decisions.map((d) => TradeDecision.parse(d));
      db.transaction(() => valid.forEach(runInsert))();
    },

    /** Update an already-recorded decision once it is acted on (submitted → filled/failed). */
    updateStatus(id: string, status: TradeDecision["status"], patch: { brokerOrderId?: string | null; reason?: string | null; submittedAt?: string | null } = {}): void {
      db.query(
        `UPDATE trade_decisions SET status = ?, broker_order_id = COALESCE(?, broker_order_id),
           reason = COALESCE(?, reason), submitted_at = COALESCE(?, submitted_at) WHERE id = ?`,
      ).run(status, patch.brokerOrderId ?? null, patch.reason ?? null, patch.submittedAt ?? null, id);
    },

    listRecent(opts: { limit?: number } = {}): TradeDecision[] {
      return db
        .query<Row, [number]>("SELECT * FROM trade_decisions ORDER BY created_at DESC LIMIT ?")
        .all(opts.limit ?? 100)
        .map(toDomain);
    },

    byRun(runId: string): TradeDecision[] {
      return db.query<Row, [string]>("SELECT * FROM trade_decisions WHERE run_id = ? ORDER BY created_at").all(runId).map(toDomain);
    },

    byJournalEntry(journalEntryId: string): TradeDecision[] {
      return db
        .query<Row, [string]>("SELECT * FROM trade_decisions WHERE journal_entry_id = ? ORDER BY created_at")
        .all(journalEntryId)
        .map(toDomain);
    },

    /** Whether an order for this ticker was already submitted/filled on `date` (duplicate-order guard). */
    submittedOn(ticker: string, date: string): boolean {
      const row = db
        .query<{ n: number }, [string, string]>(
          `SELECT COUNT(*) AS n FROM trade_decisions
            WHERE ticker = ? AND substr(created_at, 1, 10) = ? AND status IN ('submitted','filled')`,
        )
        .get(ticker, date);
      return (row?.n ?? 0) > 0;
    },
  };
}
export type TradeDecisionsRepo = ReturnType<typeof tradeDecisionsRepo>;
