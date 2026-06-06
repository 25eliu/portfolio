import type { DB } from "../connection.ts";
import { Holding, HoldingInput, Symbol, newId } from "../../domain/index.ts";

type Row = {
  id: string;
  portfolio_id: string;
  symbol: string;
  shares: number;
  cost_basis: number | null;
  acquired_at: string | null;
};

const toDomain = (r: Row): Holding =>
  Holding.parse({
    id: r.id,
    portfolioId: r.portfolio_id,
    symbol: r.symbol,
    shares: r.shares,
    costBasis: r.cost_basis,
    acquiredAt: r.acquired_at ?? null,
  });

export function holdingsRepo(db: DB) {
  return {
    listByPortfolio(portfolioId: string): Holding[] {
      return db
        .query<Row, [string]>("SELECT * FROM holdings WHERE portfolio_id = ? ORDER BY symbol")
        .all(portfolioId)
        .map(toDomain);
    },

    get(id: string): Holding | null {
      const row = db.query<Row, [string]>("SELECT * FROM holdings WHERE id = ?").get(id);
      return row ? toDomain(row) : null;
    },

    /**
     * Add or update a holding by (portfolio, symbol). Returns the stored holding. Editing an existing
     * holding (e.g. changing shares) preserves its original cost basis and buy date via COALESCE —
     * the entry is recorded once, when the position is first added.
     */
    upsert(portfolioId: string, input: HoldingInput): Holding {
      const valid = HoldingInput.parse(input);
      const costBasis = valid.costBasis ?? null;
      const acquiredAt = valid.acquiredAt ?? null;
      db.query(
        `INSERT INTO holdings (id, portfolio_id, symbol, shares, cost_basis, acquired_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (portfolio_id, symbol)
         DO UPDATE SET shares = excluded.shares,
                       cost_basis = COALESCE(holdings.cost_basis, excluded.cost_basis),
                       acquired_at = COALESCE(holdings.acquired_at, excluded.acquired_at)`,
      ).run(newId(), portfolioId, valid.symbol, valid.shares, costBasis, acquiredAt);
      const row = db
        .query<Row, [string, string]>(
          "SELECT * FROM holdings WHERE portfolio_id = ? AND symbol = ?",
        )
        .get(portfolioId, valid.symbol);
      return toDomain(row!);
    },

    /**
     * Set a position's exact shares + cost basis (the AI paper-book write path). Unlike `upsert`,
     * the cost basis is OVERWRITTEN — the AI recomputes a weighted-average basis on every ADD, so it
     * must not be COALESCE-preserved. The original buy date is kept across re-sizes via COALESCE.
     */
    setPosition(portfolioId: string, symbol: string, shares: number, costBasis: number, acquiredAt: string): Holding {
      const sym = Symbol.parse(symbol);
      db.query(
        `INSERT INTO holdings (id, portfolio_id, symbol, shares, cost_basis, acquired_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (portfolio_id, symbol)
         DO UPDATE SET shares = excluded.shares,
                       cost_basis = excluded.cost_basis,
                       acquired_at = COALESCE(holdings.acquired_at, excluded.acquired_at)`,
      ).run(newId(), portfolioId, sym, shares, costBasis, acquiredAt);
      const row = db
        .query<Row, [string, string]>("SELECT * FROM holdings WHERE portfolio_id = ? AND symbol = ?")
        .get(portfolioId, sym);
      return toDomain(row!);
    },

    /** Backfill the cost basis + buy date for a legacy holding that has none. No-op once set. */
    recordEntry(id: string, costBasis: number, acquiredAt: string): boolean {
      const changes = db
        .query("UPDATE holdings SET cost_basis = ?, acquired_at = ? WHERE id = ? AND cost_basis IS NULL")
        .run(costBasis, acquiredAt, id).changes;
      return changes > 0;
    },

    remove(id: string): boolean {
      const changes = db.query("DELETE FROM holdings WHERE id = ?").run(id).changes;
      return changes > 0;
    },
  };
}
export type HoldingsRepo = ReturnType<typeof holdingsRepo>;
