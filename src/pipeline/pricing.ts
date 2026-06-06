import type { App } from "../app.ts";
import type { PortfolioKind, PricedPosition } from "../domain/index.ts";
import type { PricedPortfolio } from "./types.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Contribution-neutral portfolio day P&L: the sum of each position's day move. Because each term is a
 * price move — never a position's full value — adding a holding or depositing cash never reads as a
 * gain. Null when no position has a baseline to compare to.
 */
function sumDayPnL(positions: PricedPosition[]): number | null {
  const withBaseline = positions.filter((p) => p.dayPnL != null);
  if (withBaseline.length === 0) return null;
  return round2(withBaseline.reduce((acc, p) => acc + (p.dayPnL ?? 0), 0));
}

/**
 * Industry-standard "Today's Gain" baseline for one position. A position held from a prior session is
 * marked from the previous market close; a position opened *today* is marked from its own entry price
 * (cost basis) — it never owned the overnight move, so charging it that move would make Day P&L diverge
 * wildly from Total P&L on the day a position is opened. Null when neither baseline is available.
 */
function dayBaseline(acquiredAt: string | null, costBasis: number | null, prevClose: number | null, today: string): number | null {
  if (acquiredAt != null && acquiredAt.slice(0, 10) === today && costBasis != null) return costBasis;
  return prevClose;
}

/**
 * Price a DB-backed book from its `holdings` rows + `portfolios.cash`, marked to fresh quotes. Both
 * portfolios use this: My Portfolio (advisory, user-entered) and the AI's isolated paper book (filled
 * by the execution engine). The market gateway is only a quote source — never the book's balances.
 */
async function priceFromHoldings(app: App, portfolioId: string, kind: PortfolioKind, name: string): Promise<PricedPortfolio> {
  const holdings = app.repos.holdings.listByPortfolio(portfolioId);
  const cash = app.repos.portfolios.get(portfolioId)?.cash ?? 0;
  const quotes = await app.gateway.getQuotes(holdings.map((h) => h.symbol));
  const quoteOf = new Map(quotes.map((q) => [q.symbol, q]));
  const today = app.now().slice(0, 10);

  let positionsValue = 0;
  let costValue = 0;
  let totalPnL = 0;
  const positions: PricedPosition[] = holdings.map((h) => {
    const quote = quoteOf.get(h.symbol);
    const price = quote?.price ?? 0;
    const marketValue = round2(h.shares * price);
    positionsValue += marketValue;
    const positionPnL = h.costBasis != null ? round2((price - h.costBasis) * h.shares) : null;
    if (h.costBasis != null) {
      costValue += h.costBasis * h.shares;
      totalPnL += (price - h.costBasis) * h.shares;
    }
    const prevClose = quote?.previousClose ?? null;
    const baseline = dayBaseline(h.acquiredAt, h.costBasis, prevClose, today);
    const dayPnL = baseline != null ? round2(h.shares * (price - baseline)) : null;
    return {
      symbol: h.symbol,
      shares: h.shares,
      price,
      marketValue,
      dayPnL,
      totalPnL: positionPnL,
      costBasis: h.costBasis,
      acquiredAt: h.acquiredAt,
    };
  });

  const equity = round2(positionsValue + cash);
  return {
    portfolioId,
    kind,
    name,
    positions,
    cash: round2(cash),
    equity,
    costValue: round2(costValue),
    totalPnL: round2(totalPnL),
    dayPnL: sumDayPnL(positions),
  };
}

/** Price My Portfolio from user-entered holdings plus user-entered sitting cash (advisory-only). */
export async function priceUserPortfolio(app: App): Promise<PricedPortfolio> {
  return priceFromHoldings(app, app.user.id, "user", app.user.name);
}

/** Price the AI's isolated paper book from its DB-backed holdings + cash (no live broker account). */
export async function priceAiPortfolio(app: App): Promise<PricedPortfolio> {
  return priceFromHoldings(app, app.ai.id, "ai_shadow", app.ai.name);
}
