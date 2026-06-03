import { Hono } from "hono";
import type { App } from "../../app.ts";
import { thesisSubjectKey } from "../../domain/index.ts";
import { serializeThesis } from "../../knowledge/serialize.ts";

/** Market View: the AI's current outlook (regime + sector/theme leans) + day history + per-subject evolution. */
export function marketViewRoutes(app: App): Hono {
  const r = new Hono();

  r.get("/current", (c) => {
    const active = app.repos.aiTheses.listActive().map(serializeThesis);
    return c.json({
      regime: active.find((t) => t.level === "regime") ?? null,
      sectors: active.filter((t) => t.level === "sector"),
      themes: active.filter((t) => t.level === "theme"),
    });
  });

  r.get("/days", (c) => c.json({ days: app.repos.aiTheses.listDays() }));
  r.get("/day/:date", (c) => c.json({ theses: app.repos.aiTheses.listDay(c.req.param("date")).map(serializeThesis) }));
  r.get("/subject/:level/:subject", (c) => {
    const key = thesisSubjectKey(c.req.param("level"), c.req.param("subject"));
    return c.json({ history: app.repos.aiTheses.historyForSubject(key).map(serializeThesis) });
  });

  return r;
}
