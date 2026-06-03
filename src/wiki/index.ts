import type { App } from "../app.ts";
import { newId, nodeId, edgeId, type WikiLesson } from "../domain/index.ts";
import { RESOLUTION_POLICY_VERSION } from "../resolution/resolve.ts";
import { computeMetrics } from "./metrics.ts";
import { generateLessons } from "./lessons.ts";
import { lintLesson } from "./lint.ts";
import { compileBriefing } from "./compile.ts";
import { computeOpenBook, renderOpenBook } from "./openBook.ts";
import { renderInFlight } from "../resolution/track.ts";

export { computeMetrics } from "./metrics.ts";
export { generateLessons, deriveLesson, cohortLabel } from "./lessons.ts";
export { lintLesson } from "./lint.ts";
export { compileBriefing } from "./compile.ts";
export { computeOpenBook, renderOpenBook } from "./openBook.ts";

const MAX_DERIVED_EDGES = 10;

/** Connect a lesson into the knowledge graph: lesson node + derived_from forecasts + supports cohort. */
function linkLessonGraph(app: App, lesson: WikiLesson, now: string): void {
  const lessonNode = nodeId("lesson", lesson.id);
  app.repos.graph.upsertNode({
    id: lessonNode, type: "lesson", label: lesson.title, summary: lesson.body,
    data: { state: lesson.state, n: lesson.n, window: lesson.window }, status: "active", createdAt: now, updatedAt: now,
  });
  for (const fid of lesson.sourceForecastIds.slice(0, MAX_DERIVED_EDGES)) {
    const f = `forecast:${fid}`;
    app.repos.graph.upsertEdge({ id: edgeId(lessonNode, "derived_from", f), srcId: lessonNode, dstId: f, rel: "derived_from", weight: 1, data: {}, createdAt: now });
  }
  // Connect the lesson to the concept it informs (strategy family / side), creating that node.
  if (lesson.cohortKind === "strategy_family" || lesson.cohortKind === "side") {
    const conceptType = lesson.cohortKind === "strategy_family" ? "strategy_family" : "concept";
    const concept = nodeId(conceptType, lesson.cohortKey.split(":").slice(1).join(":"));
    app.repos.graph.upsertNode({ id: concept, type: conceptType, label: lesson.cohortKey.split(":").slice(1).join(":"), summary: "", data: {}, status: "active", createdAt: now, updatedAt: now });
    app.repos.graph.upsertEdge({ id: edgeId(lessonNode, "supports", concept), srcId: lessonNode, dstId: concept, rel: "supports", weight: 1, data: {}, createdAt: now });
  }
}

/**
 * Compile the performance wiki from resolved outcomes: deterministic cohort metrics → evidence-gated,
 * linted prose lessons → a compact dated briefing → knowledge-graph links. Idempotent: re-running
 * recomputes everything from current data; cohorts that no longer qualify have their lessons expired.
 * Returns the freshly compiled briefing body for immediate injection into this run's analysis.
 */
export async function compileWiki(app: App): Promise<{ metrics: number; lessons: number; briefing: string }> {
  const now = new Date().toISOString();
  const date = app.now();
  const rows = app.repos.wiki.resolvedRows();

  const metrics = computeMetrics(rows, { nowMs: new Date(`${date}T00:00:00.000Z`).getTime(), resolutionPolicyVersion: RESOLUTION_POLICY_VERSION, computedAt: now });
  // True coverage (resolved / scored) belongs to the overall cohort.
  const scored = app.repos.wiki.countScored();
  const resolved = app.repos.wiki.countResolved();
  for (const m of metrics) {
    if (m.cohortKey === "overall") m.coverage = scored > 0 ? resolved / scored : null;
    app.repos.wiki.upsertMetric(m);
  }

  // Generate, lint, and persist lessons; expire any prior lesson the current data no longer supports.
  const linted = generateLessons(metrics, { now }).filter((l) => lintLesson(l).ok);
  const lintedIds = new Set(linted.map((l) => l.id));
  app.db.transaction(() => {
    for (const lesson of linted) {
      app.repos.wiki.upsertLesson(lesson);
      linkLessonGraph(app, lesson, now);
    }
    for (const prior of app.repos.wiki.listLessons({ states: ["active", "provisional", "draft"] })) {
      if (!lintedIds.has(prior.id)) app.repos.wiki.upsertLesson({ ...prior, state: "expired", updatedAt: now });
    }
  })();

  const { body, lessonIds } = compileBriefing(linted, { date });

  // Open book: mark the still-live theses to current price so the briefing also says how the
  // in-flight calls are tracking (quant's blotter), not just how resolved calls calibrated.
  const open = app.repos.scoredForecasts.listOpen(date, 50);
  let openSection = "";
  if (open.length > 0) {
    const symbols = [...new Set(open.map((f) => f.ticker))];
    const quotes = await app.gateway.getQuotes(symbols);
    const priceBySymbol = new Map(quotes.map((q) => [q.symbol, q.price]));
    openSection = renderOpenBook(computeOpenBook(open, priceBySymbol, date), date);
  }
    const inFlight = renderInFlight(app.repos.forecastDailyMarks.forDate(date));
    const fullBody = [body, openSection, inFlight].filter(Boolean).join("\n\n");

  app.repos.wiki.insertBriefing({
    id: newId(), date, body: fullBody,
    includedLessonIds: lessonIds,
    includedMetricIds: metrics.map((m) => m.id),
    createdAt: now,
  });

  return { metrics: metrics.length, lessons: linted.length, briefing: fullBody };
}
