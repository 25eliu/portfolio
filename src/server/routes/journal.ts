import { Hono } from "hono";
import type { App } from "../../app.ts";

/** Read-only access to the typed journal: list entries (optionally by ticker) and fetch one with its
 *  scored forecast. The dashboard renders journal records directly — never from LLM recall. */
export function journalRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/", (c) => {
    const ticker = c.req.query("ticker")?.toUpperCase();
    const date = c.req.query("date");
    const limit = Math.min(Number(c.req.query("limit") ?? 100) || 100, 500);
    const offset = Math.max(Number(c.req.query("offset") ?? 0) || 0, 0);
    // The day view (date, no ticker) is deduped to the latest call per ticker; the ticker-history view
    // and the generic list keep every entry.
    const entries =
      date && !ticker
        ? app.repos.journalEntries.listDay(date)
        : app.repos.journalEntries.list({ ticker, date, limit, offset });
    return c.json({ entries });
  });

  // Day summaries for the day-grouped journal view.
  r.get("/days", (c) => c.json({ days: app.repos.journalEntries.listDays() }));

  r.get("/:id", (c) => {
    const entry = app.repos.journalEntries.get(c.req.param("id"));
    if (!entry) return c.json({ error: "not found" }, 404);
    const forecast = app.repos.scoredForecasts.getByJournalEntry(entry.id);
    const outcome = forecast ? app.repos.forecastOutcomes.getByForecast(forecast.id) : null;
    const trades = app.repos.tradeDecisions.byJournalEntry(entry.id);
    return c.json({ entry, forecast, outcome, trades });
  });

  return r;
}
