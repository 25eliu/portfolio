import type { App } from "../app.ts";
import type { Holding, TradeDecision } from "../domain/index.ts";

const round2 = (n: number) => Math.round(n * 100) / 100;

export type LedgerSummary = { filled: number; skipped: number; cashAfter: number };

/**
 * Apply a run's planned decisions to the AI's isolated DB-backed paper book — the simulated "fill".
 * Deterministic: each order fills in full at its intended price (no slippage), debiting/crediting AI
 * cash and writing the AI's `holdings` rows. Long-only, so SELL/TRIM only ever reduce a held position.
 *
 * Runs in a single transaction: either the whole batch lands or none of it does, so the book is never
 * left half-updated. Only `proposed` decisions with qty > 0 are acted on; the planner's `skipped` rows
 * are left untouched. A BUY/ADD that can't be fully funded is CLAMPED to the affordable share count
 * (keeping the book fully invested); if nothing is affordable the decision flips to `skipped`.
 */
export function applyFills(app: App, decisions: TradeDecision[], opts: { acquiredAt: string; now: string }): LedgerSummary {
  const aiId = app.ai.id;

  return app.db.transaction((): LedgerSummary => {
    let cash = app.repos.portfolios.get(aiId)?.cash ?? 0;
    const bySymbol = new Map<string, Holding>(
      app.repos.holdings.listByPortfolio(aiId).map((h) => [h.symbol, h]),
    );
    let filled = 0;
    let skipped = 0;

    for (const d of decisions) {
      if (d.status !== "proposed" || d.qty <= 0) continue;
      const price = d.intendedPrice;
      const held = bySymbol.get(d.ticker);

      if (d.side === "buy") {
        // BUY (open) or ADD (grow). Clamp to what the cash on hand can fund.
        const affordable = price > 0 ? Math.floor(cash / price) : 0;
        const qty = Math.min(d.qty, affordable);
        if (qty < 1) {
          app.repos.tradeDecisions.updateStatus(d.id, "skipped", { reason: "insufficient cash to fund the fill" });
          skipped++;
          continue;
        }
        cash -= qty * price;
        if (held) {
          // Weighted-average cost basis across the existing position and the added shares.
          const oldBasis = held.costBasis ?? price;
          const newShares = held.shares + qty;
          const newBasis = round2((held.shares * oldBasis + qty * price) / newShares);
          const next = app.repos.holdings.setPosition(aiId, d.ticker, newShares, newBasis, opts.acquiredAt);
          bySymbol.set(d.ticker, next);
        } else {
          const next = app.repos.holdings.setPosition(aiId, d.ticker, qty, price, opts.acquiredAt);
          bySymbol.set(d.ticker, next);
        }
        const clamped = qty < d.qty;
        app.repos.tradeDecisions.updateStatus(d.id, "filled", {
          submittedAt: opts.now,
          reason: clamped ? `${d.reason ?? "buy"} — clamped to ${qty} (cash-limited)` : null,
        });
        filled++;
      } else {
        // SELL (full exit) or TRIM (partial). Never sell more than is held.
        if (!held) {
          app.repos.tradeDecisions.updateStatus(d.id, "skipped", { reason: "no position to sell" });
          skipped++;
          continue;
        }
        const qty = Math.min(d.qty, held.shares);
        cash += qty * price;
        const remaining = held.shares - qty;
        if (remaining <= 0) {
          app.repos.holdings.remove(held.id);
          bySymbol.delete(d.ticker);
        } else {
          // Basis per share is unchanged on a partial sell.
          const next = app.repos.holdings.setPosition(aiId, d.ticker, remaining, held.costBasis ?? price, held.acquiredAt ?? opts.acquiredAt);
          bySymbol.set(d.ticker, next);
        }
        app.repos.tradeDecisions.updateStatus(d.id, "filled", { submittedAt: opts.now });
        filled++;
      }
    }

    cash = round2(cash);
    app.repos.portfolios.setCash(aiId, cash);
    return { filled, skipped, cashAfter: cash };
  })();
}
