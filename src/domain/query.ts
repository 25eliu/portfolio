import { z } from "zod";

/**
 * Grounded natural-language query (roadmap Phase 5). A logged Q&A: the user's question, the answer the
 * model produced strictly from read-only data tools, and which tools it called. Audit + future eval.
 */
export const QueryStatus = z.enum(["ok", "error"]);
export type QueryStatus = z.infer<typeof QueryStatus>;

/**
 * A structured source the grounded answer drew on — surfaced to the UI so the owner can see exactly
 * what evidence backed the answer. Derived (UI-only) from a tool's result by its `cite()`; never sent
 * back to the model, so it costs no extra tokens. `kind` groups cards (research / wiki / journal …).
 */
export const Citation = z.object({
  kind: z.enum(["knowledge", "lesson", "journal", "trade", "forecast", "outcome"]),
  title: z.string().min(1),
  ticker: z.string().optional(),
  detail: z.string().optional(),
  date: z.string().optional(),
  trust: z.string().optional(),
  sourceId: z.string().optional(),
  excerpt: z.string().optional(),
});
export type Citation = z.infer<typeof Citation>;

export const QueryLog = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  toolsUsed: z.array(z.string()).default([]),
  citations: z.array(Citation).default([]),
  status: QueryStatus.default("ok"),
  createdAt: z.string().datetime(),
});
export type QueryLog = z.infer<typeof QueryLog>;
