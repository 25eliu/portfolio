import { z } from "zod";

/** A symbol is uppercased, 1–10 chars, letters/dots only (e.g. AAPL, BRK.B). */
export const Symbol = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z][A-Z.]{0,9}$/, "must be a valid ticker symbol (e.g. AAPL)");
export type Symbol = z.infer<typeof Symbol>;

/** A position the user holds (advisory-only for My Portfolio). */
export const Holding = z.object({
  id: z.string().min(1),
  portfolioId: z.string().min(1),
  symbol: Symbol,
  shares: z.number().positive(),
  costBasis: z.number().positive().nullable().default(null),
});
export type Holding = z.infer<typeof Holding>;

/** Shape accepted from the API/UI when adding or editing a holding. */
export const HoldingInput = z.object({
  symbol: Symbol,
  shares: z.number().positive(),
  costBasis: z.number().positive().nullable().optional(),
});
export type HoldingInput = z.infer<typeof HoldingInput>;
