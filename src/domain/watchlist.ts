import { z } from "zod";
import { Symbol } from "./holding.ts";

export const WatchlistItem = z.object({
  id: z.string().min(1),
  symbol: Symbol,
  note: z.string().nullable().default(null),
});
export type WatchlistItem = z.infer<typeof WatchlistItem>;

export const WatchlistInput = z.object({ symbol: Symbol, note: z.string().nullable().optional() });
export type WatchlistInput = z.infer<typeof WatchlistInput>;
