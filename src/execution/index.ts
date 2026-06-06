import type { App } from "../app.ts";
import { RISK_PRESETS, type DailyReport, type RiskPreset } from "../domain/index.ts";
import type { PricedPortfolio } from "../pipeline/types.ts";
import { regimeFromContext, regimeSizingMultiplier } from "../analysis/regime.ts";
import { planTrades, type JournalLink } from "./plan.ts";
import { applyFills } from "./ledger.ts";

export { planTrades } from "./plan.ts";


export type ExecutionContext = {
  ai: PricedPortfolio;
  referencePrices: Map<string, number>;
  journalLink: Map<string, JournalLink>;
};

export type ExecutionSummary = { proposed: number; filled: number; skipped: number };

/**
 * Translate the run's recommendations into the AI's own paper-book trades and fill them against its
 * isolated DB-backed ledger. Always on: every run, the AI sizes against its CURRENT equity (a
 * compounding cap — never the user's portfolio) and the deterministic planner turns holder-neutral
 * theses into sized orders. Every decision is recorded with an auditable reason; eligible ones fill
 * immediately at their reference price. No seeding, no toggle, no live broker — a pure paper ledger.
 */
export async function executeAiTrades(
  app: App,
  report: DailyReport,
  runId: string,
  ctx: ExecutionContext,
): Promise<ExecutionSummary> {
  const date = app.now();
  // Stamp decisions with the run's LOGICAL date so the duplicate-order guard (which keys on app.now())
  // matches regardless of wall-clock — critical when the clock is pinned (tests, catch-up runs).
  const now = `${date}T00:00:00.000Z`;

  // Size against the AI's own current equity — it compounds as the book grows, never mirrors the user.
  const baselineCapital = ctx.ai.equity;

  const presetName: RiskPreset = app.repos.risk.get(app.ai.id)?.preset ?? "balanced";
  const preset = RISK_PRESETS[presetName];

  // Regime-aware sizing: a risk-off tape (from SPY trend + VIX + the synthesized outlook) shrinks every
  // new entry. Exits are never gated by it.
  const regime = regimeFromContext(report.marketContext, report.outlook?.regime?.stance ?? null);
  const regimeMultiplier = regimeSizingMultiplier(regime);

  const priceOf = (ticker: string): number | null => {
    const ref = ctx.referencePrices.get(ticker);
    if (ref != null) return ref;
    const pos = ctx.ai.positions.find((p) => p.symbol === ticker);
    return pos ? pos.price : null;
  };

  const decisions = planTrades({
    recommendations: report.recommendations,
    account: {
      cash: ctx.ai.cash,
      positionsValue: ctx.ai.equity - ctx.ai.cash,
      positions: ctx.ai.positions.map((p) => ({ symbol: p.symbol, shares: p.shares, price: p.price, marketValue: p.marketValue })),
    },
    baselineCapital,
    preset,
    regimeMultiplier,
    priceOf,
    submittedToday: (t) => app.repos.tradeDecisions.submittedOn(t, date),
    journalLink: (t) => ctx.journalLink.get(t) ?? { journalEntryId: null, forecastId: null },
    runId,
    now,
  });

  app.repos.tradeDecisions.insertMany(decisions);

  const proposed = decisions.filter((d) => d.status === "proposed").length;
  // Fill the proposed orders against the AI's paper ledger (transactional; may clamp/skip on cash).
  const ledger = applyFills(app, decisions, { acquiredAt: date, now });
  const plannerSkipped = decisions.filter((d) => d.status === "skipped").length;

  return { proposed, filled: ledger.filled, skipped: plannerSkipped + ledger.skipped };
}
