import type { App } from "../app.ts";
import type { Order } from "../market/index.ts";

/**
 * One-time seeding of the AI paper account to match My Portfolio's day-zero holdings. After this,
 * both portfolios are simply read + priced; the AI gains its own trading agency in Phase 3.
 * Idempotent: if the broker account already holds positions, seeding is skipped.
 */
export async function seedAiAccount(app: App): Promise<{ seeded: boolean; orders: Order[] }> {
  const existing = await app.gateway.getPositions();
  if (existing.length > 0) return { seeded: false, orders: [] };

  const holdings = app.repos.holdings.listByPortfolio(app.user.id);
  const orders: Order[] = [];
  for (const h of holdings) {
    orders.push(await app.gateway.placeOrder({ symbol: h.symbol, qty: h.shares, side: "buy" }));
  }

  const account = await app.gateway.getAccount();
  app.repos.portfolios.setAlpacaAccount(app.ai.id, account.accountNumber);
  return { seeded: true, orders };
}
