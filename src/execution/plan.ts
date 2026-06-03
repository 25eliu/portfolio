import {
  horizonAllowed,
  newId,
  strategyAllowed,
  type Recommendation,
  type RiskPresetConfig,
  type TradeDecision,
} from "../domain/index.ts";

/** A single AI-book position at plan time (market values; cost basis isn't needed for exposure sizing). */
export type PlanPosition = { symbol: string; shares: number; price: number; marketValue: number };

export type JournalLink = { journalEntryId: string | null; forecastId: string | null };

export type PlanInput = {
  recommendations: Recommendation[];
  account: { cash: number; positionsValue: number; positions: PlanPosition[] };
  /** Capital the AI manages (its own book's equity). Total exposure is capped to this. */
  baselineCapital: number;
  /** The active risk preset — governs sizing, count, confidence, reward:risk, horizons, strategies. */
  preset: RiskPresetConfig;
  /** Current/reference price per ticker (held positions fall back to their live price). */
  priceOf: (ticker: string) => number | null;
  /** Duplicate-order guard: already submitted/filled for this ticker today. */
  submittedToday: (ticker: string) => boolean;
  journalLink: (ticker: string) => JournalLink;
  runId: string;
  now: string;
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/** Even a barely-passing idea gets at least this fraction of the per-position cap (no dust-sized fills). */
const SIZE_FLOOR = 0.25;
/** Reward:risk points above the preset's floor at which the RR contribution saturates to full. */
const RR_SPAN = 2.0;

/**
 * Thesis-driven position size as a fraction (SIZE_FLOOR..1) of the per-position cap. Scales with the
 * product of normalized conviction and normalized reward:risk — the two signals the analyzer already
 * emits — so the full cap is reached only by high-conviction, high-payoff ideas while weak-but-passing
 * ideas get the floor. Sizing stays entirely in the deterministic planner; the LLM never sets it.
 */
export function sizeFraction(conviction: number, rr: number, preset: RiskPresetConfig): number {
  const convScore = clamp01((conviction - preset.minConfidence) / (1 - preset.minConfidence));
  const rrScore = clamp01((rr - preset.rewardRiskFloor) / RR_SPAN);
  return SIZE_FLOOR + (1 - SIZE_FLOOR) * convScore * rrScore;
}

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
  const { preset, baselineCapital: baseline } = input;
  const rewardRiskFloor = preset.rewardRiskFloor;
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
    // Risk-preset eligibility (entries only — exits are never gated): horizon + strategy family.
    if (!horizonAllowed(preset, rec.prediction.horizon)) {
      decisions.push(decide(rec, "buy", held(rec.ticker) ? "ADD" : "BUY", 0, price, "skipped", `${rec.prediction.horizon} horizon not eligible for this risk profile`));
      continue;
    }
    if (!strategyAllowed(preset, rec.strategyFamily)) {
      decisions.push(decide(rec, "buy", held(rec.ticker) ? "ADD" : "BUY", 0, price, "skipped", `strategy '${rec.strategyFamily}' not eligible for this risk profile`));
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
    // Thesis-driven target weight: stronger conviction × reward:risk → a bigger slice of the cap.
    const frac = sizeFraction(rec.conviction, rr, preset);
    const targetValue = frac * maxPosValue;
    const pctOfCap = Math.round(frac * 100);
    const pos = bySymbol.get(rec.ticker);
    if (pos) {
      // ADD — top a held name up to its thesis-sized target (only the shortfall, never past the cap).
      const addValue = Math.max(0, targetValue - pos.marketValue);
      const budget = Math.min(cash, exposureRoom, addValue);
      const shares = budget > 0 ? Math.floor(budget / price) : 0;
      if (shares >= 1) {
        decisions.push(decide(rec, "buy", "ADD", shares, price, "proposed", `add (conv ${rec.conviction.toFixed(2)}, RR ${rr.toFixed(2)} → ${pctOfCap}% of cap)`));
        deployedValue += shares * price;
        cash -= shares * price;
      }
      // else already at/above its thesis-sized target → HOLD (no row).
    } else {
      // BUY — open a new position, sized to the thesis (capped at the per-position ceiling).
      if (positionsCount >= preset.maxPositions) {
        decisions.push(decide(rec, "buy", "BUY", 0, price, "skipped", `max positions (${preset.maxPositions}) reached`));
        continue;
      }
      const budget = Math.min(cash, exposureRoom, targetValue);
      const shares = budget > 0 ? Math.floor(budget / price) : 0;
      if (shares >= 1) {
        decisions.push(decide(rec, "buy", "BUY", shares, price, "proposed", `buy (conv ${rec.conviction.toFixed(2)}, RR ${rr.toFixed(2)} → ${pctOfCap}% of cap)`));
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
