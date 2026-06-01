import type { DB } from "../connection.ts";
import { WatchlistInput, WatchlistItem, newId } from "../../domain/index.ts";

type Row = { id: string; symbol: string; note: string | null };
const toDomain = (r: Row): WatchlistItem => WatchlistItem.parse({ id: r.id, symbol: r.symbol, note: r.note });

export function watchlistRepo(db: DB) {
  return {
    list(): WatchlistItem[] {
      return db.query<Row, []>("SELECT * FROM watchlist ORDER BY symbol").all().map(toDomain);
    },
    add(input: WatchlistInput): WatchlistItem {
      const valid = WatchlistInput.parse(input);
      db.query(
        `INSERT INTO watchlist (id, symbol, note) VALUES (?, ?, ?)
         ON CONFLICT (symbol) DO UPDATE SET note = excluded.note`,
      ).run(newId(), valid.symbol, valid.note ?? null);
      return toDomain(db.query<Row, [string]>("SELECT * FROM watchlist WHERE symbol = ?").get(valid.symbol)!);
    },
    remove(id: string): boolean {
      return db.query("DELETE FROM watchlist WHERE id = ?").run(id).changes > 0;
    },
  };
}
export type WatchlistRepo = ReturnType<typeof watchlistRepo>;
