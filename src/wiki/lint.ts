import { PROVISIONAL_MIN_N, type WikiLesson } from "../domain/index.ts";

export type LintResult = { ok: boolean; issues: string[] };

/**
 * Lesson linter (roadmap §9): reject anything not safe to publish into the briefing — missing sample
 * size, missing evidence, prose that omits its own n, or a missing core statistic. Linting is what
 * keeps the wiki honest: a lesson that can't cite its evidence never reaches the prompt.
 */
export function lintLesson(lesson: WikiLesson): LintResult {
  const issues: string[] = [];
  if (lesson.n < PROVISIONAL_MIN_N) issues.push(`sample too small (n=${lesson.n} < ${PROVISIONAL_MIN_N})`);
  if (lesson.sourceForecastIds.length === 0) issues.push("no source forecast ids (missing evidence)");
  if (lesson.sourceForecastIds.length !== lesson.n) issues.push("evidence count does not match sample size");
  if (!/n=\d+/.test(lesson.body)) issues.push("prose omits its sample size");
  if (lesson.metrics.hitRate == null) issues.push("missing hit-rate statistic");
  if (!lesson.body.trim()) issues.push("empty body");
  return { ok: issues.length === 0, issues };
}
