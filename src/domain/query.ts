import { z } from "zod";

/**
 * Grounded natural-language query (roadmap Phase 5). A logged Q&A: the user's question, the answer the
 * model produced strictly from read-only data tools, and which tools it called. Audit + future eval.
 */
export const QueryStatus = z.enum(["ok", "error"]);
export type QueryStatus = z.infer<typeof QueryStatus>;

export const QueryLog = z.object({
  id: z.string().min(1),
  question: z.string().min(1),
  answer: z.string(),
  toolsUsed: z.array(z.string()).default([]),
  status: QueryStatus.default("ok"),
  createdAt: z.string().datetime(),
});
export type QueryLog = z.infer<typeof QueryLog>;
