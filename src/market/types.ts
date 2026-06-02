/**
 * Narrow interfaces for market data + brokerage. The rest of the app depends only on these,
 * never on a concrete adapter, so the fake adapter (tests/offline) and the Alpaca adapter
 * (real paper account) are fully interchangeable.
 */

export type Quote = { symbol: string; price: number; previousClose: number | null };

export type Bar = {
  date: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type BrokerPosition = {
  symbol: string;
  shares: number;
  avgEntry: number;
  currentPrice: number;
  marketValue: number;
  /** Previous trading day's close per share — the day-P&L baseline. Null when unavailable. */
  previousClose: number | null;
};

export type Account = {
  accountNumber: string;
  cash: number;
  portfolioValue: number;
  buyingPower: number;
};

export type OrderSide = "buy" | "sell";

export type OrderInput = {
  symbol: string;
  qty: number;
  side: OrderSide;
};

export type Order = {
  id: string;
  symbol: string;
  qty: number;
  side: OrderSide;
  status: string;
};

export type Mover = { symbol: string; price: number; changePct: number; volume: number };

export interface MarketData {
  getQuote(symbol: string): Promise<Quote>;
  getQuotes(symbols: string[]): Promise<Quote[]>;
  getBars(symbol: string, lookbackDays: number): Promise<Bar[]>;
  getMovers(limit: number): Promise<Mover[]>;
}

export interface Broker {
  getAccount(): Promise<Account>;
  getPositions(): Promise<BrokerPosition[]>;
  placeOrder(order: OrderInput): Promise<Order>;
  closePosition(symbol: string): Promise<void>;
}

/** Combined gateway used by the pipeline (pricing + brokerage in one dependency). */
export interface MarketGateway extends MarketData, Broker {
  readonly kind: "fake" | "alpaca";
}
