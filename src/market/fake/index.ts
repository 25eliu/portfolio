import { newId, today } from "../../domain/ids.ts";
import type {
  Account,
  Bar,
  Broker,
  BrokerPosition,
  MarketGateway,
  Order,
  OrderInput,
  Quote,
} from "../types.ts";
import { fakePrice } from "./pricing.ts";

export type FakeGatewayOptions = {
  startingCash?: number;
  /** Injectable clock for deterministic tests (returns YYYY-MM-DD). */
  now?: () => string;
  accountNumber?: string;
};

type Lot = { shares: number; avgEntry: number };

/**
 * In-memory, deterministic implementation of the market + broker gateway. Used by every
 * pipeline/integration test and as an offline fallback (MARKET_ADAPTER=fake). State mutation is
 * encapsulated here, modeling an external brokerage; domain values handed out stay immutable.
 */
export function createFakeGateway(opts: FakeGatewayOptions = {}): MarketGateway {
  const now = opts.now ?? (() => today());
  const accountNumber = opts.accountNumber ?? "FAKE-PAPER-0001";
  let cash = opts.startingCash ?? 100_000;
  const positions = new Map<string, Lot>();

  const priceNow = (symbol: string) => fakePrice(symbol, now());

  const positionList = (): BrokerPosition[] =>
    [...positions.entries()].map(([symbol, lot]) => {
      const currentPrice = priceNow(symbol);
      return {
        symbol,
        shares: lot.shares,
        avgEntry: lot.avgEntry,
        currentPrice,
        marketValue: Math.round(lot.shares * currentPrice * 100) / 100,
      };
    });

  const marketData = {
    async getQuote(symbol: string): Promise<Quote> {
      return { symbol, price: priceNow(symbol) };
    },
    async getQuotes(symbols: string[]): Promise<Quote[]> {
      return symbols.map((s) => ({ symbol: s, price: priceNow(s) }));
    },
    async getBars(symbol: string, days: number): Promise<Bar[]> {
      const out: Bar[] = [];
      const end = new Date(`${now()}T00:00:00Z`);
      for (let i = days - 1; i >= 0; i--) {
        const d = new Date(end);
        d.setUTCDate(d.getUTCDate() - i);
        const date = d.toISOString().slice(0, 10);
        const close = fakePrice(symbol, date);
        out.push({ date, open: close, high: close, low: close, close, volume: 1_000_000 });
      }
      return out;
    },
  };

  const broker: Broker = {
    async getAccount(): Promise<Account> {
      const positionsValue = positionList().reduce((sum, p) => sum + p.marketValue, 0);
      return {
        accountNumber,
        cash: Math.round(cash * 100) / 100,
        portfolioValue: Math.round((cash + positionsValue) * 100) / 100,
        buyingPower: Math.round(cash * 100) / 100,
      };
    },
    async getPositions(): Promise<BrokerPosition[]> {
      return positionList();
    },
    async placeOrder(order: OrderInput): Promise<Order> {
      const price = priceNow(order.symbol);
      const existing = positions.get(order.symbol);
      if (order.side === "buy") {
        cash -= order.qty * price;
        const shares = (existing?.shares ?? 0) + order.qty;
        const avgEntry =
          existing && existing.shares > 0
            ? (existing.avgEntry * existing.shares + price * order.qty) / shares
            : price;
        positions.set(order.symbol, { shares, avgEntry });
      } else {
        const shares = (existing?.shares ?? 0) - order.qty;
        cash += order.qty * price;
        if (shares <= 0) positions.delete(order.symbol);
        else positions.set(order.symbol, { shares, avgEntry: existing?.avgEntry ?? price });
      }
      return {
        id: newId(),
        symbol: order.symbol,
        qty: order.qty,
        side: order.side,
        status: "filled",
      };
    },
    async closePosition(symbol: string): Promise<void> {
      const lot = positions.get(symbol);
      if (lot) await broker.placeOrder({ symbol, qty: lot.shares, side: "sell" });
    },
  };

  return { kind: "fake", ...marketData, ...broker };
}
