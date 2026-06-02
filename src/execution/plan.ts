import { newId, type Recommendation, type TradeDecision } from "../domain/index.ts";

/** A single AI-book position at plan time (market values; cost basis isn't needed for exposure sizing). */
export type PlanPosition = { symbol: string; shares: number; price: number; marketValue: number };

export type JournalLink = { journalEntryId: string | null; forecastId: string | null };

export type PlanInput = {
  recommendations: Recommendation[];
  account: { cash: number; positionsValue: number; positions: PlanPosition[] };
  /** Capital the AI manages, matched to the user's total equity. Total exposure is capped to this. */
  baselineCapital: number;
  preset: { maxPositionPct: number; maxPositions: number; minConfidence: number };
  /** Minimum reward:risk for a new BUY/ADD (target/stop derived). */
  rewardRiskFloor: number;
  /** Current/reference price per ticker (held positions fall back to their live price). */
  priceOf: (ticker: string) => number | null;
  /** Duplicate-order guard: already submitted/filled for this ticker today. */
  submittedToday: (ticker: string) => boolean;
  journalLink: (ticker: string) => JournalLink;
  runId: string;
  now: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Reward:risk for a long entry from the plan's target/stop; null when not computable. */
function rewardRisk(rec: Recommendation, entry: number): number | null {
  const { target, stop } = rec.prediction;
  if (target == null || stop == null) return null;
  const risk = entry - stop;
  const reward = target - entry;
  if (risk <= 0 || reward <= 0) return null;
  return reward / risk;
}

/**
 * Deterministically translate holder-neutral theses into the AI's paper-book trades. The LLM never
 * decides size or eligibility here — only direction/conviction/target/stop feed in; every quantity and
 * guard is computed. Long-only: SELL only exits owned positions. Total market exposure is capped to the
 * user-matched `baselineCapital`, so the paper account's extra cash is never deployed.
 *
 * Pass order: exits/trims first (free up capital + slots), then entries by conviction (best ideas get
 * the remaining cash). Returns `proposed`/`skipped` decisions — submission is the orchestrator's job.
 */
export function planTrades(input: PlanInput): TradeDecision[] {
  const { preset, baselineCapital: baseline, rewardRiskFloor } = input;
  const maxPosValue = (preset.maxPositionPct / 100) * baseline;
  const bySymbol = new Map(input.account.positions.map((p) => [p.symbol, p]));

  let deployedValue = input.account.positionsValue;
  let cash = input.account.cash;
  let positionsCount = input.account.positions.length;
  const decisions: TradeDecision[] = [];

  const base = (rec: Recommendation) => {
    const link = input.journalLink(rec.ticker);
    return { id: newId(), runId: input.runId, journalEntryId: link.journalEntryId, forecastId: link.forecastId, ticker: rec.ticker, createdAt: input.now, submittedAt: null, brokerOrderId: null };
  };
  const decide = (rec: Recommendation, side: "buy" | "sell", action: TradeDecision["action"], qty: number, price: number, status: TradeDecision["status"], reason: string): TradeDecision =>
    ({ ...base(rec), side, action, qty, intendedPrice: round2(price), notional: round2(qty * price), status, reason });

  // Split by current direction; held vs flat.
  const held = (t: string) => bySymbol.has(t);
  const exits = input.recommendations.filter((r) => held(r.ticker) && (r.prediction.direction === "bearish" || r.prediction.direction === "neutral"));
  const entries = input.recommendations
    .filter((r) => r.prediction.direction === "bullish" && r.conviction >= preset.minConfidence)
    .sort((a, b) => b.conviction - a.conviction);

  // ---- Pass 1: exits & trims on held positions (always permitted; not cash-gated) ----
  for (const rec of exits) {
    const pos = bySymbol.get(rec.ticker)!;
    const price = input.priceOf(rec.ticker) ?? pos.price;
    if (input.submittedToday(rec.ticker)) {
      decisions.push(decide(rec, "sell", rec.prediction.direction === "bearish" ? "SELL" : "TRIM", 0, price, "skipped", "already traded today"));
      continue;
    }
    if (rec.prediction.direction === "bearish") {
      // Full exit — long-only thesis turned negative.
      decisions.push(decide(rec, "sell", "SELL", pos.shares, price, "proposed", `thesis bearish (conv ${rec.conviction.toFixed(2)})`));
      deployedValue -= pos.marketValue;
      cash += pos.shares * price;
      positionsCount -= 1;
    } else if (pos.marketValue > maxPosValue + price) {
      // Neutral but overweight — trim back to the position cap.
      const sellShares = Math.floor((pos.marketValue - maxPosValue) / price);
      if (sellShares >= 1) {
        decisions.push(decide(rec, "sell", "TRIM", sellShares, price, "proposed", `trim to ${preset.maxPositionPct}% cap`));
        deployedValue -= sellShares * price;
        cash += sellShares * price;
      }
    }
    // else neutral & within cap → HOLD (no decision row).
  }

  // ---- Pass 2: entries (BUY new / ADD to held) by conviction, capital- and guard-constrained ----
  for (const rec of entries) {
    const price = input.priceOf(rec.ticker);
    if (price == null || price <= 0) continue; // can't size without a price
    if (input.submittedToday(rec.ticker)) {
      decisions.push(decide(rec, "buy", held(rec.ticker) ? "ADD" : "BUY", 0, price, "skipped", "already traded today"));
      continue;
    }
    const rr = rewardRisk(rec, rec.prediction.entry ?? price);
    if (rr == null) {
      decisions.push(decide(rec, "buy", held(rec.ticker) ? "ADD" : "BUY", 0, price, "skipped", "incomplete plan (no target/stop)"));
      continue;
    }
    if (rr < rewardRiskFloor) {
      decisions.push(decide(rec, "buy", held(rec.ticker) ? "ADD" : "BUY", 0, price, "skipped", `reward:risk ${rr.toFixed(2)} below ${rewardRiskFloor}`));
      continue;
    }

    const exposureRoom = Math.max(0, baseline - deployedValue);
    const pos = bySymbol.get(rec.ticker);
    if (pos) {
      // ADD — grow a held winner up to the per-position cap.
      const posRoom = maxPosValue - pos.marketValue;
      const budget = Math.min(cash, exposureRoom, posRoom);
      const shares = budget > 0 ? Math.floor(budget / price) : 0;
      if (shares >= 1) {
        decisions.push(decide(rec, "buy", "ADD", shares, price, "proposed", `add (conv ${rec.conviction.toFixed(2)}, RR ${rr.toFixed(2)})`));
        deployedValue += shares * price;
        cash -= shares * price;
      }
      // else already at cap / no room → HOLD (no row).
    } else {
      // BUY — open a new position.
      if (positionsCount >= preset.maxPositions) {
        decisions.push(decide(rec, "buy", "BUY", 0, price, "skipped", `max positions (${preset.maxPositions}) reached`));
        continue;
      }
      const budget = Math.min(cash, exposureRoom, maxPosValue);
      const shares = budget > 0 ? Math.floor(budget / price) : 0;
      if (shares >= 1) {
        decisions.push(decide(rec, "buy", "BUY", shares, price, "proposed", `buy (conv ${rec.conviction.toFixed(2)}, RR ${rr.toFixed(2)})`));
        deployedValue += shares * price;
        cash -= shares * price;
        positionsCount += 1;
      } else {
        decisions.push(decide(rec, "buy", "BUY", 0, price, "skipped", "insufficient baseline capital"));
      }
    }
  }

  return decisions;
}
