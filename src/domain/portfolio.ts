import { z } from "zod";

/**
 * A portfolio. Modeled generically (per the architecture doc) so additional decision
 * sources — e.g. a future quant "model" portfolio — slot in without schema changes.
 */
export const PortfolioKind = z.enum(["user", "ai_shadow", "model"]);
export type PortfolioKind = z.infer<typeof PortfolioKind>;

export const DecisionSource = z.enum(["manual", "llm", "quant_model"]);
export type DecisionSource = z.infer<typeof DecisionSource>;

export const Portfolio = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  kind: PortfolioKind,
  decisionSource: DecisionSource,
  /** Alpaca account number, when this portfolio is backed by a brokerage account. */
  alpacaAccount: z.string().nullable().default(null),
  /** Uninvested ("sitting") cash. For My Portfolio this is user-entered buying power. */
  cash: z.number().nonnegative().default(0),
  createdAt: z.string().datetime(),
});
export type Portfolio = z.infer<typeof Portfolio>;
