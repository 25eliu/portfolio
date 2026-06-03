import { z } from "zod";

/** A persisted AI outlook thesis (one row in ai_theses). */
export const Thesis = z.object({
  id: z.string().min(1),
  runId: z.string().nullable().default(null),
  reportId: z.string().nullable().default(null),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  createdAt: z.string().datetime(),
  level: z.enum(["regime", "sector", "theme"]),
  subject: z.string().min(1),
  subjectKey: z.string().min(1),
  stance: z.string().min(1),
  conviction: z.number().min(0).max(1),
  horizon: z.string().min(1),
  summary: z.string().default(""),
  thesis: z.string().min(1),
  status: z.enum(["active", "superseded", "expired", "archived"]).default("active"),
  supersedesId: z.string().nullable().default(null),
  /** Date (YYYY-MM-DD) past which an un-reaffirmed active thesis expires. Null = never auto-expires. */
  freshnessDeadline: z.string().nullable().default(null),
  tickers: z.array(z.string()).default([]),
  /** Citations; `sourceId` is the knowledge_sources id of the persisted citation (set at persist time). */
  sources: z.array(z.object({ title: z.string(), url: z.string(), sourceId: z.string().optional() })).default([]),
});
export type Thesis = z.infer<typeof Thesis>;

/** Normalize a (level, subject) into the stable supersede key "<level>:<slug>". */
export function thesisSubjectKey(level: string, subject: string): string {
  const slug = subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${level}:${slug}`;
}

/** Grace window (days) a dropped thesis lingers before expiring, by horizon. Re-affirmation resets it. */
export const THESIS_FRESHNESS_DAYS: Record<string, number> = { "1d": 2, "1w": 10, "1mo": 35, "3mo": 100, "6mo": 195, "1y": 380 };

/** Add `days` to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
