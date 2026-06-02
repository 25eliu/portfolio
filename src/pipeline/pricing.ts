import type { App } from "../app.ts";
import type { PricedPosition } from "../domain/index.ts";
import type { PricedPortfolio } from "./types.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

function dayPnL(app: App, portfolioId: string, equity: number): number | null {
  const prev = app.repos.snapshots.latestBefore(portfolioId, app.now());
  return prev ? round2(equity - prev.totalValue) : null;
}

/** Price My Portfolio from user-entered holdings plus user-entered sitting cash (advisory-only). */
export async function priceUserPortfolio(app: App): Promise<PricedPortfolio> {
  const holdings = app.repos.holdings.listByPortfolio(app.user.id);
  const cash = app.repos.portfolios.get(app.user.id)?.cash ?? 0;
  const quotes = await app.gateway.getQuotes(holdings.map((h) => h.symbol));
  const priceOf = new Map(quotes.map((q) => [q.symbol, q.price]));

  let positionsValue = 0;
  let costValue = 0;
  let totalPnL = 0;
  const positions: PricedPosition[] = holdings.map((h) => {
    const price = priceOf.get(h.symbol) ?? 0;
    const marketValue = round2(h.shares * price);
    positionsValue += marketValue;
    if (h.costBasis != null) {
      costValue += h.costBasis * h.shares;
      totalPnL += (price - h.costBasis) * h.shares;
    }
    return { symbol: h.symbol, shares: h.shares, price, marketValue };
  });

  const equity = round2(positionsValue + cash);
  return {
    portfolioId: app.user.id,
    kind: "user",
    name: app.user.name,
    positions,
    cash: round2(cash),
    equity,
    costValue: round2(costValue),
    totalPnL: round2(totalPnL),
    dayPnL: dayPnL(app, app.user.id, equity),
  };
}

/** Price the AI Portfolio from the live Alpaca paper account (positions + cash). */
export async function priceAiPortfolio(app: App): Promise<PricedPortfolio> {
  const [account, brokerPositions] = await Promise.all([
    app.gateway.getAccount(),
    app.gateway.getPositions(),
  ]);

  let costValue = 0;
  let totalPnL = 0;
  let positionsValue = 0;
  const positions: PricedPosition[] = brokerPositions.map((p) => {
    costValue += p.avgEntry * p.shares;
    totalPnL += (p.currentPrice - p.avgEntry) * p.shares;
    positionsValue += p.marketValue;
    return { symbol: p.symbol, shares: p.shares, price: p.currentPrice, marketValue: p.marketValue };
  });

  const equity = round2(account.cash + positionsValue);
  return {
    portfolioId: app.ai.id,
    kind: "ai_shadow",
    name: app.ai.name,
    positions,
    cash: round2(account.cash),
    equity,
    costValue: round2(costValue),
    totalPnL: round2(totalPnL),
    dayPnL: dayPnL(app, app.ai.id, equity),
  };
}
