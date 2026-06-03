import { Hono } from "hono";
import type { App } from "../../app.ts";
import { assessInFlight } from "../../resolution/track.ts";

/** Read-only performance-wiki views: active briefing, lessons, and calibration metrics. */
export function wikiRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/briefing", (c) => c.json({ briefing: app.repos.wiki.latestBriefing() }));

  r.get("/lessons", (c) => {
    const all = c.req.query("all") === "true";
    const states = all ? undefined : (["active", "provisional"] as const);
    return c.json({ lessons: app.repos.wiki.listLessons(states ? { states: [...states] } : {}) });
  });

  // Single lesson detail — backs the click-through from a grounded-query "Wiki lesson" source card.
  r.get("/lessons/:id", (c) => {
    const lesson = app.repos.wiki.getLesson(c.req.param("id"));
    if (!lesson) return c.json({ error: "not found" }, 404);
    return c.json({ lesson });
  });

  r.get("/metrics", (c) => {
    const window = c.req.query("window");
    return c.json({ metrics: app.repos.wiki.listMetrics(window ? { window } : {}) });
  });

  // In-flight book: today's daily marks assessed (the human view of "are my live calls tracking?").
  // Calls are ordered attention-first (near_stop/at_risk before near_target/on_track), mirroring the
  // briefing's open-book blotter, so the most-at-risk calls surface at the top of the API + UI.
  const STATUS_RANK: Record<string, number> = { near_stop: 0, at_risk: 1, near_target: 2, on_track: 3 };
  r.get("/in-flight", (c) => {
    const marks = app.repos.forecastDailyMarks.forDate(app.now());
    const calls = marks
      .map((m) => {
        const f = app.repos.scoredForecasts.get(m.forecastId);
        return {
          forecastId: m.forecastId, ticker: m.ticker, side: f?.side ?? null, resolveBy: f?.resolveAt ?? null,
          movePct: m.moveFromEntry, unrealizedR: m.unrealizedR, mfe: m.mfe, mae: m.mae, status: m.status,
        };
      })
      .sort(
        (a, b) =>
          (STATUS_RANK[a.status] ?? 9) - (STATUS_RANK[b.status] ?? 9) || (a.unrealizedR ?? 0) - (b.unrealizedR ?? 0),
      );
    return c.json({ assessment: assessInFlight(marks), calls });
  });

  // Per-call daily trajectory — backs the wiki drill-down sparkline.
  r.get("/forecasts/:id/marks", (c) =>
    c.json({ marks: app.repos.forecastDailyMarks.listForForecast(c.req.param("id")) }),
  );

  return r;
}
