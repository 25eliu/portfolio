import { describe, expect, test } from "bun:test";
import type { WikiMetric } from "../domain/index.ts";
import { deriveLesson, generateLessons, stateForN } from "./lessons.ts";
import { lintLesson } from "./lint.ts";
import { compileBriefing } from "./compile.ts";

function metric(over: Partial<WikiMetric>): WikiMetric {
  return {
    id: "all_time:overall", cohortKind: "overall", cohortKey: "overall", window: "all_time",
    n: 10, hitRate: 0.6, avgConviction: 0.65, expectancyR: 0.4, avgTerminalReturn: 0.05, avgSpyExcess: 0.02, brier: 0.2,
    coverage: 1, sampleForecastIds: Array.from({ length: 10 }, (_, i) => `f${i}`),
    computedAt: "2026-06-30T00:00:00.000Z", resolutionPolicyVersion: "v1", ...over,
  };
}

describe("stateForN", () => {
  test("thresholds: <5 draft, 5-19 provisional, >=20 active", () => {
    expect(stateForN(4)).toBe("draft");
    expect(stateForN(5)).toBe("provisional");
    expect(stateForN(19)).toBe("provisional");
    expect(stateForN(20)).toBe("active");
  });
});

describe("deriveLesson", () => {
  test("prose cites sample size and is gated by n", () => {
    const lesson = deriveLesson(metric({ n: 25 }), { now: "2026-06-30T00:00:00.000Z" });
    expect(lesson.state).toBe("active");
    expect(lesson.body).toContain("n=25");
    expect(lesson.sourceForecastIds.length).toBeGreaterThan(0);
    expect(lesson.freshnessDeadline).not.toBeNull();
  });
});

describe("generateLessons", () => {
  test("only emits lessons at or above the provisional floor", () => {
    const metrics = [metric({ id: "a", n: 3 }), metric({ id: "b", n: 7 })];
    const lessons = generateLessons(metrics, { now: "2026-06-30T00:00:00.000Z" });
    expect(lessons.map((l) => l.id)).toEqual(["b"]);
  });
});

describe("lintLesson", () => {
  test("passes a well-formed lesson", () => {
    expect(lintLesson(deriveLesson(metric({ n: 10 }), { now: "2026-06-30T00:00:00.000Z" })).ok).toBe(true);
  });
  test("rejects a lesson with no evidence ids", () => {
    const bad = deriveLesson(metric({ n: 10, sampleForecastIds: [] }), { now: "2026-06-30T00:00:00.000Z" });
    const res = lintLesson(bad);
    expect(res.ok).toBe(false);
    expect(res.issues.join(" ")).toContain("evidence");
  });
});

describe("compileBriefing", () => {
  test("compact table: header once, overall ranked first, one row per cohort", () => {
    const active = deriveLesson(metric({ id: "all_time:overall", n: 30 }), { now: "2026-06-30T00:00:00.000Z" });
    const prov = deriveLesson(metric({ id: "all_time:side:bullish", cohortKey: "side:bullish", cohortKind: "side", n: 6, sampleForecastIds: ["x1", "x2", "x3", "x4", "x5", "x6"] }), { now: "2026-06-30T00:00:00.000Z" });
    const { body, lessonIds } = compileBriefing([prov, active], { date: "2026-06-30" });
    expect(lessonIds[0]).toBe("all_time:overall"); // overall cohort ranked first
    expect(body).toContain("PERFORMANCE WIKI");
    expect(body).toContain("cohort | n | hit% | expR | conv% | vsSPY% | Brier"); // metric names stated once
    expect(body).toContain("overall | 30 |"); // dense row, no per-line scaffold
    expect(body).toContain("bullish | 6 |");
    // the metric scaffold prose appears zero times (table, not sentences)
    expect(body).not.toContain("target was reached before");
  });

  test("drops confidence-bucket cohorts from the briefing", () => {
    const overall = deriveLesson(metric({ id: "all_time:overall", n: 30 }), { now: "2026-06-30T00:00:00.000Z" });
    const bucket = deriveLesson(
      metric({ id: "all_time:confidence_bucket:0.6-0.8", cohortKey: "confidence_bucket:0.6-0.8", cohortKind: "confidence_bucket", n: 12, sampleForecastIds: Array.from({ length: 12 }, (_, i) => `b${i}`) }),
      { now: "2026-06-30T00:00:00.000Z" },
    );
    const { lessonIds } = compileBriefing([overall, bucket], { date: "2026-06-30" });
    expect(lessonIds).toContain("all_time:overall");
    expect(lessonIds).not.toContain("all_time:confidence_bucket:0.6-0.8");
  });

  test("empty when nothing is active/provisional", () => {
    expect(compileBriefing([], { date: "2026-06-30" }).body).toBe("");
  });
});
