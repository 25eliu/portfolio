import { z } from "zod";
import type { Env } from "../../config/env.ts";
import type {
  Account,
  Bar,
  BrokerPosition,
  MarketGateway,
  Mover,
  Order,
  OrderInput,
  Quote,
} from "../types.ts";

/** Zod schemas validating Alpaca responses at the boundary (never trust external data). */
const AccountRes = z.object({
  account_number: z.string(),
  cash: z.coerce.number(),
  portfolio_value: z.coerce.number(),
  buying_power: z.coerce.number(),
});
const PositionRes = z.object({
  symbol: z.string(),
  qty: z.coerce.number(),
  avg_entry_price: z.coerce.number(),
  current_price: z.coerce.number(),
  market_value: z.coerce.number(),
});
const OrderRes = z.object({
  id: z.string(),
  symbol: z.string(),
  qty: z.coerce.number(),
  side: z.enum(["buy", "sell"]),
  status: z.string(),
});
const SnapshotsRes = z.record(
  z.string(),
  z.object({ latestTrade: z.object({ p: z.number() }).optional() }).nullable(),
);
const BarsRes = z.object({
  bars: z
    .array(z.object({ t: z.string(), o: z.number(), h: z.number(), l: z.number(), c: z.number(), v: z.number() }))
    .nullable()
    .default([]),
});
const MoversRes = z.object({
  most_actives: z
    .array(z.object({ symbol: z.string(), volume: z.number(), trade_count: z.number().optional(), percent_change: z.number().optional() }))
    .default([]),
});

export function createAlpacaGateway(env: Env): MarketGateway {
  const authHeaders = {
    "APCA-API-KEY-ID": env.ALPACA_KEY_ID,
    "APCA-API-SECRET-KEY": env.ALPACA_SECRET,
  };

  async function request(base: string, path: string, init?: RequestInit): Promise<unknown> {
    const res = await fetch(`${base}${path}`, {
      ...init,
      headers: { ...authHeaders, "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
    if (!res.ok) {
      throw new Error(`Alpaca ${init?.method ?? "GET"} ${path} → ${res.status}: ${await res.text()}`);
    }
    return res.status === 204 ? null : await res.json();
  }

  const trade = (p: string, init?: RequestInit) => request(env.ALPACA_TRADING_BASE_URL, p, init);

  async function getQuotes(symbols: string[]): Promise<Quote[]> {
    if (symbols.length === 0) return [];
    const qs = encodeURIComponent(symbols.join(","));
    const raw = await request(
      env.ALPACA_DATA_BASE_URL,
      `/v2/stocks/snapshots?symbols=${qs}&feed=iex`,
    );
    const snaps = SnapshotsRes.parse(raw);
    return symbols.map((s) => ({ symbol: s, price: snaps[s]?.latestTrade?.p ?? 0 }));
  }

  return {
    kind: "alpaca",

    async getQuote(symbol: string): Promise<Quote> {
      const [q] = await getQuotes([symbol]);
      return q ?? { symbol, price: 0 };
    },
    getQuotes,
    // lookbackDays is CALENDAR days; Alpaca returns only trading days so the returned bar count is
    // smaller than lookbackDays (roughly 0.69×). Callers needing N trading days should pass ~1.5×N.
    async getBars(symbol: string, lookbackDays: number): Promise<Bar[]> {
      const start = new Date(Date.now() - lookbackDays * 86_400_000).toISOString().slice(0, 10);
      const raw = await request(
        env.ALPACA_DATA_BASE_URL,
        `/v2/stocks/${symbol}/bars?timeframe=1Day&start=${start}&limit=10000&feed=iex&adjustment=split`,
      );
      const parsed = BarsRes.parse(raw);
      return (parsed.bars ?? []).map((b) => ({
        date: b.t.slice(0, 10),
        open: b.o,
        high: b.h,
        low: b.l,
        close: b.c,
        volume: b.v,
      }));
    },
    async getMovers(limit: number): Promise<Mover[]> {
      const raw = await request(
        env.ALPACA_DATA_BASE_URL,
        `/v1beta1/screener/stocks/most-actives?top=${limit}`,
      );
      const actives = MoversRes.parse(raw).most_actives;
      const quotes = await getQuotes(actives.map((a) => a.symbol));
      const priceOf = new Map(quotes.map((q) => [q.symbol, q.price]));
      // most-actives is volume-ranked; percent_change may be absent (then 0), and momentum is
      // refined downstream from computed technicals.
      return actives.map((a) => ({
        symbol: a.symbol,
        price: priceOf.get(a.symbol) ?? 0,
        changePct: a.percent_change ?? 0,
        volume: a.volume,
      }));
    },

    async getAccount(): Promise<Account> {
      const a = AccountRes.parse(await trade("/v2/account"));
      return {
        accountNumber: a.account_number,
        cash: a.cash,
        portfolioValue: a.portfolio_value,
        buyingPower: a.buying_power,
      };
    },
    async getPositions(): Promise<BrokerPosition[]> {
      const raw = z.array(PositionRes).parse(await trade("/v2/positions"));
      return raw.map((p) => ({
        symbol: p.symbol,
        shares: p.qty,
        avgEntry: p.avg_entry_price,
        currentPrice: p.current_price,
        marketValue: p.market_value,
      }));
    },
    async placeOrder(order: OrderInput): Promise<Order> {
      const raw = await trade("/v2/orders", {
        method: "POST",
        body: JSON.stringify({
          symbol: order.symbol,
          qty: order.qty,
          side: order.side,
          type: "market",
          time_in_force: "day",
        }),
      });
      const o = OrderRes.parse(raw);
      return { id: o.id, symbol: o.symbol, qty: o.qty, side: o.side, status: o.status };
    },
    async closePosition(symbol: string): Promise<void> {
      await trade(`/v2/positions/${symbol}`, { method: "DELETE" });
    },
  };
}
