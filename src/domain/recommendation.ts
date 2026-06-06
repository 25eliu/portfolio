import { z } from "zod";
import { Symbol } from "./holding.ts";
import { Technicals } from "./technicals.ts";
import { Fundamentals } from "./fundamentals.ts";
import { MarketContext, Source } from "./marketContext.ts";
import { ScreenType } from "./scan.ts";

export const Action = z.enum(["ADD", "TRIM", "HOLD", "SELL", "BUY", "WATCH", "PASS"]);
export type Action = z.infer<typeof Action>;

export const Horizon = z.enum(["1d", "1w", "1mo", "3mo", "6mo", "1y"]);
export type Horizon = z.infer<typeof Horizon>;

export const Direction = z.enum(["bullish", "bearish", "neutral"]);
export type Direction = z.infer<typeof Direction>;

export const Prediction = z.object({
  direction: Direction,
  horizon: Horizon,
  entry: z.number().nullable().default(null),
  target: z.number().nullable().default(null),
  stop: z.number().nullable().default(null),
  expectedReturnPct: z.number().nullable().default(null),
  rMultiple: z.number().nullable().default(null),
  trigger: z.string().nullable().default(null),
  actionIfTriggered: z.string().nullable().default(null),
  invalidation: z.string(),
  rationale: z.string(),
});
export type Prediction = z.infer<typeof Prediction>;

export const Catalyst = z.object({
  kind: z.string(),
  summary: z.string(),
  sentiment: z.number().min(-1).max(1),
});
export type Catalyst = z.infer<typeof Catalyst>;

/**
 * A durable, structural fact the analyzer chose to remember from its own research — distilled to one
 * claim with the citation it came from. Persisted into the self-curated knowledge library so future
 * runs retrieve it as evidence (the platform's self-updating factual memory). Kept deliberately
 * permissive (no max length here) so a slightly-long fact never fails the whole recommendation parse;
 * the relevance bar (≤140 chars, durable-only) is enforced in the prompt and trimmed at persistence.
 */
export const FactCategory = z.enum([
  "moat", "secular", "management", "capital_structure", "regulatory", "unit_economics",
]);
export type FactCategory = z.infer<typeof FactCategory>;

export const MemorableFact = z.object({
  fact: z.string().min(1),
  citationUrl: z.string().nullable().default(null),
  scope: z.enum(["ticker", "global"]).default("ticker"),
  /** Model-rated decision value (0..1). Facts below the curation threshold are dropped. */
  significance: z.number().min(0).max(1).default(0).catch(0),
  /** Structural category; used for curation filtering and tagged retrieval. */
  category: FactCategory.nullable().default(null).catch(null),
});
export type MemorableFact = z.infer<typeof MemorableFact>;

/**
 * The bull/bear deliberation the analyzer runs BEFORE committing to a verdict (Decision Engine v2,
 * the +1 structured stage between research and structure). Persisted on the recommendation so the
 * reasoning is auditable and the explainability UI can render the argued cases — not ephemeral.
 */
export const Deliberation = z.object({
  bullCase: z.string().default(""),
  bearCase: z.string().default(""),
  keyUncertainties: z.array(z.string()).default([]),
  /** Specific, testable evidence that would falsify the thesis (disconfirmer-seeking, not narrative). */
  disconfirmers: z.array(z.string()).default([]),
  baseRateNote: z.string().nullable().default(null),
  /** When a prior thesis existed and the stance flipped, the justification for the reversal. */
  reversalCheck: z.string().nullable().default(null),
  provisionalStance: Direction.catch("neutral"),
  provisionalConviction: z.number().min(0).max(1).catch(0.5),
});
export type Deliberation = z.infer<typeof Deliberation>;

/** One cohort's contribution to the calibration blend — the traceable chain the next plan visualizes. */
export const CalibrationAdjustment = z.object({
  cohortKind: z.string(),
  cohortKey: z.string(),
  /** Resolved, non-ambiguous sample size in this cohort (drives the shrinkage weight). */
  n: z.number().nonnegative(),
  /** o_c = avgConviction − hitRate (+ small negative-expectancy term); positive ⇒ historically overconfident. */
  overconfidence: z.number(),
  /** Normalized share of the blend this cohort earned (shrinkage × graph proximity), 0..1. */
  weight: z.number(),
});
export type CalibrationAdjustment = z.infer<typeof CalibrationAdjustment>;

/**
 * Deterministic, graph-propagated conviction calibration (empirical-Bayes shrinkage along the ticker's
 * sector/strategy/overall cohorts). DAMPEN-ONLY: factor ≤ 1, clamped to a gentle floor so it nudges
 * sizing rather than dominating. Never mutates stated `conviction` — the planner sizes off
 * `calibratedConviction` while the wiki keeps measuring stated-vs-realized (the loop must not self-eat).
 */
export const Calibration = z.object({
  /** Combined dampening multiplier applied to stated conviction (overconfidence blend × regime). */
  factor: z.number(),
  /** Regime component of the factor (≤1 in risk_off), broken out for transparency. */
  regimeFactor: z.number().default(1),
  reason: z.string().default(""),
  adjustments: z.array(CalibrationAdjustment).default([]),
});
export type Calibration = z.infer<typeof Calibration>;

/** One model-authored outlook item (regime/sector/theme). Stance is validated per-level at persist time. */
export const ThesisItem = z.object({
  subject: z.string().min(1),
  stance: z.string().min(1),
  conviction: z.number().min(0).max(1).catch(0.5),
  horizon: Horizon.catch("3mo"),
  summary: z.string().default(""),
  thesis: z.string().min(1),
  tickers: z.array(z.string()).default([]),
  sources: z.array(Source).default([]),
});
export type ThesisItem = z.infer<typeof ThesisItem>;

/** The full cross-cutting outlook the analyzer authors each run. Caps keep the library dense. */
export const Outlook = z.object({
  regime: ThesisItem.nullable().default(null).catch(null),
  sectors: z.array(ThesisItem).catch([]).transform((xs) => xs.slice(0, 8)),
  themes: z.array(ThesisItem).catch([]).transform((xs) => xs.slice(0, 6)),
});
export type Outlook = z.infer<typeof Outlook>;

/**
 * One recommendation card. This shape is the contract both the Gemini analyzer and deterministic
 * offline fallback satisfy so the UI receives the same validated structure in either mode.
 */
export const Recommendation = z.object({
  ticker: Symbol,
  /** Whether the portfolio currently holds this ticker (drives the position-aware verb set). */
  held: z.boolean(),
  action: Action,
  conviction: z.number().min(0).max(1),
  strategyFamily: z.string(),
  thesis: z.string(),
  signals: z.array(z.string()),
  /** Forward-looking, structured prediction backing the recommendation. */
  prediction: Prediction,
  /**
   * The bull/bear deliberation that preceded this verdict (Decision Engine v2). Null on legacy entries
   * and whenever the analyzer skips it; default-safe so older journal JSON still parses.
   */
  deliberation: Deliberation.nullable().default(null).catch(null),
  /**
   * Planner-facing conviction after deterministic graph-shrinkage calibration. Null ⇒ uncalibrated, fall
   * back to stated `conviction`. The stated value above is NEVER overwritten (calibration is additive memory).
   */
  calibratedConviction: z.number().min(0).max(1).nullable().default(null),
  /** Auditable record of what the calibration blend did (per-cohort chain + final factor). */
  calibration: Calibration.nullable().default(null).catch(null),
  technicals: Technicals,
  /** Fundamental snapshot used in the analysis (null until the LLM/FMP step populates it). */
  fundamentals: Fundamentals.nullable().default(null),
  /** Analyst price-target upside vs latest price, as a percentage (null when unavailable). */
  priceTargetUpside: z.number().nullable().default(null),
  /** Grounding citations backing the recommendation. */
  sources: z.array(Source).default([]),
  /** Originating opportunity screen for scan candidates (null for held/watchlist). */
  screen: ScreenType.nullable().default(null),
  catalyst: Catalyst.nullable().default(null),
  briefingNote: z.string().nullable().default(null),
  /**
   * Durable facts the analyzer chose to add to its long-term memory this run. Non-critical: a malformed
   * facts array falls back to [] so it never breaks the recommendation. Persisted as self_curated
   * knowledge sources by the curation step (deduped against what the system already knows).
   */
  memorableFacts: z.array(MemorableFact).default([]).catch([]),
});
export type Recommendation = z.infer<typeof Recommendation>;

/** The full structured daily report assembled by a dailyRun. */
export const DailyReport = z.object({
  id: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  generatedAt: z.string().datetime(),
  source: z.enum(["fake", "llm"]),
  recommendations: z.array(Recommendation),
  /** Daily market regime context (null until the LLM step builds it). */
  marketContext: MarketContext.nullable().default(null),
  /** Cross-cutting AI outlook (regime + sector/theme leans). Null until the LLM synth step builds it. */
  outlook: Outlook.nullable().default(null),
});
export type DailyReport = z.infer<typeof DailyReport>;
