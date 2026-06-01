import type { DB } from "../connection.ts";
import { Holding, HoldingInput, newId } from "../../domain/index.ts";

type Row = {
  id: string;
  portfolio_id: string;
  symbol: string;
  shares: number;
  cost_basis: number | null;
};

const toDomain = (r: Row): Holding =>
  Holding.parse({
    id: r.id,
    portfolioId: r.portfolio_id,
    symbol: r.symbol,
    shares: r.shares,
    costBasis: r.cost_basis,
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

    /** Add or update a holding by (portfolio, symbol). Returns the stored holding. */
    upsert(portfolioId: string, input: HoldingInput): Holding {
      const valid = HoldingInput.parse(input);
      const costBasis = valid.costBasis ?? null;
      db.query(
        `INSERT INTO holdings (id, portfolio_id, symbol, shares, cost_basis)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (portfolio_id, symbol)
         DO UPDATE SET shares = excluded.shares, cost_basis = excluded.cost_basis`,
      ).run(newId(), portfolioId, valid.symbol, valid.shares, costBasis);
      const row = db
        .query<Row, [string, string]>(
          "SELECT * FROM holdings WHERE portfolio_id = ? AND symbol = ?",
        )
        .get(portfolioId, valid.symbol);
      return toDomain(row!);
    },

    remove(id: string): boolean {
      const changes = db.query("DELETE FROM holdings WHERE id = ?").run(id).changes;
      return changes > 0;
    },
  };
}
export type HoldingsRepo = ReturnType<typeof holdingsRepo>;
