import type { DB } from "../connection.ts";
import { Portfolio, type PortfolioKind } from "../../domain/index.ts";

type Row = {
  id: string;
  name: string;
  kind: string;
  decision_source: string;
  alpaca_account: string | null;
  created_at: string;
};

const toDomain = (r: Row): Portfolio =>
  Portfolio.parse({
    id: r.id,
    name: r.name,
    kind: r.kind,
    decisionSource: r.decision_source,
    alpacaAccount: r.alpaca_account,
    createdAt: r.created_at,
  });

export function portfoliosRepo(db: DB) {
  return {
    insert(p: Portfolio): Portfolio {
      const valid = Portfolio.parse(p);
      db.query(
        `INSERT INTO portfolios (id, name, kind, decision_source, alpaca_account, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(
        valid.id,
        valid.name,
        valid.kind,
        valid.decisionSource,
        valid.alpacaAccount,
        valid.createdAt,
      );
      return valid;
    },

    get(id: string): Portfolio | null {
      const row = db.query<Row, [string]>("SELECT * FROM portfolios WHERE id = ?").get(id);
      return row ? toDomain(row) : null;
    },

    getByKind(kind: PortfolioKind): Portfolio | null {
      const row = db
        .query<Row, [string]>("SELECT * FROM portfolios WHERE kind = ? LIMIT 1")
        .get(kind);
      return row ? toDomain(row) : null;
    },

    list(): Portfolio[] {
      return db
        .query<Row, []>("SELECT * FROM portfolios ORDER BY created_at")
        .all()
        .map(toDomain);
    },

    setAlpacaAccount(id: string, account: string | null): void {
      db.query("UPDATE portfolios SET alpaca_account = ? WHERE id = ?").run(account, id);
    },
  };
}
export type PortfoliosRepo = ReturnType<typeof portfoliosRepo>;
