import type { DB } from "../connection.ts";
import { Briefing, WikiLesson, WikiMetric, type LessonState } from "../../domain/index.ts";
import type { ResolvedRow } from "../../wiki/metrics.ts";

export function wikiRepo(db: DB) {
  return {
    /**
     * Resolved forecasts flattened for cohort math (forecast joined with its outcome). The optional
     * `sectorOf` resolver maps a ticker to its GICS sector (from the knowledge graph) so the sector
     * cohort can power graph-propagated calibration; omitted ⇒ sector is null (no sector cohort).
     */
    resolvedRows(sectorOf?: (ticker: string) => string | null): ResolvedRow[] {
      type Row = {
        forecast_id: string; ticker: string; side: string; strategy_family: string; horizon_trading_sessions: number;
        conviction: number; created_at: string; outcome: string; terminal_return: number;
        spy_excess_return: number | null; forecast_r: number | null;
      };
      return db
        .query<Row, []>(
          `SELECT f.id AS forecast_id, f.ticker, f.side, f.strategy_family, f.horizon_trading_sessions,
                  f.conviction, f.created_at, o.outcome, o.terminal_return, o.spy_excess_return, o.forecast_r
             FROM scored_forecasts f
             JOIN forecast_outcomes o ON o.forecast_id = f.id`,
        )
        .all()
        .map((r) => ({
          forecastId: r.forecast_id,
          side: r.side as ResolvedRow["side"],
          strategyFamily: r.strategy_family,
          sector: sectorOf ? sectorOf(r.ticker) : null,
          horizonSessions: r.horizon_trading_sessions,
          conviction: r.conviction,
          createdAt: r.created_at,
          outcome: r.outcome as ResolvedRow["outcome"],
          terminalReturn: r.terminal_return,
          spyExcessReturn: r.spy_excess_return,
          forecastR: r.forecast_r,
        }));
    },

    countResolved(): number {
      return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM forecast_outcomes").get()?.n ?? 0;
    },
    countScored(): number {
      return db.query<{ n: number }, []>("SELECT COUNT(*) AS n FROM scored_forecasts").get()?.n ?? 0;
    },

    // ---- metrics ---------------------------------------------------------
    upsertMetric(m: WikiMetric): WikiMetric {
      const v = WikiMetric.parse(m);
      db.query(
        `INSERT INTO wiki_metrics
           (id, cohort_kind, cohort_key, window, n, hit_rate, avg_conviction, expectancy_r, avg_terminal_return,
            avg_spy_excess, brier, coverage, sample_forecast_ids_json, computed_at, resolution_policy_version)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           n=excluded.n, hit_rate=excluded.hit_rate, avg_conviction=excluded.avg_conviction,
           expectancy_r=excluded.expectancy_r,
           avg_terminal_return=excluded.avg_terminal_return, avg_spy_excess=excluded.avg_spy_excess,
           brier=excluded.brier, coverage=excluded.coverage,
           sample_forecast_ids_json=excluded.sample_forecast_ids_json, computed_at=excluded.computed_at,
           resolution_policy_version=excluded.resolution_policy_version`,
      ).run(
        v.id, v.cohortKind, v.cohortKey, v.window, v.n, v.hitRate, v.avgConviction, v.expectancyR, v.avgTerminalReturn,
        v.avgSpyExcess, v.brier, v.coverage, JSON.stringify(v.sampleForecastIds), v.computedAt, v.resolutionPolicyVersion,
      );
      return v;
    },

    listMetrics(opts: { window?: string } = {}): WikiMetric[] {
      type Row = {
        id: string; cohort_kind: string; cohort_key: string; window: string; n: number;
        hit_rate: number | null; avg_conviction: number | null; expectancy_r: number | null;
        avg_terminal_return: number | null; avg_spy_excess: number | null; brier: number | null;
        coverage: number | null; sample_forecast_ids_json: string; computed_at: string; resolution_policy_version: string;
      };
      const rows = opts.window
        ? db.query<Row, [string]>("SELECT * FROM wiki_metrics WHERE window = ? ORDER BY cohort_kind, cohort_key").all(opts.window)
        : db.query<Row, []>("SELECT * FROM wiki_metrics ORDER BY window, cohort_kind, cohort_key").all();
      return rows.map((r) =>
        WikiMetric.parse({
          id: r.id, cohortKind: r.cohort_kind, cohortKey: r.cohort_key, window: r.window, n: r.n,
          hitRate: r.hit_rate, avgConviction: r.avg_conviction, expectancyR: r.expectancy_r,
          avgTerminalReturn: r.avg_terminal_return, avgSpyExcess: r.avg_spy_excess, brier: r.brier, coverage: r.coverage,
          sampleForecastIds: JSON.parse(r.sample_forecast_ids_json), computedAt: r.computed_at,
          resolutionPolicyVersion: r.resolution_policy_version,
        }),
      );
    },

    // ---- lessons ---------------------------------------------------------
    upsertLesson(l: WikiLesson): WikiLesson {
      const v = WikiLesson.parse(l);
      const existing = this.getLesson(v.id);
      const createdAt = existing?.createdAt ?? v.createdAt;
      db.query(
        `INSERT INTO wiki_lessons
           (id, title, body, state, cohort_kind, cohort_key, window, n, date_window_start, date_window_end,
            source_forecast_ids_json, freshness_deadline, metrics_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           title=excluded.title, body=excluded.body, state=excluded.state, n=excluded.n,
           date_window_start=excluded.date_window_start, date_window_end=excluded.date_window_end,
           source_forecast_ids_json=excluded.source_forecast_ids_json, freshness_deadline=excluded.freshness_deadline,
           metrics_json=excluded.metrics_json, updated_at=excluded.updated_at`,
      ).run(
        v.id, v.title, v.body, v.state, v.cohortKind, v.cohortKey, v.window, v.n, v.dateWindowStart, v.dateWindowEnd,
        JSON.stringify(v.sourceForecastIds), v.freshnessDeadline, JSON.stringify(v.metrics), createdAt, v.updatedAt,
      );
      return { ...v, createdAt };
    },

    getLesson(id: string): WikiLesson | null {
      type Row = {
        id: string; title: string; body: string; state: string; cohort_kind: string; cohort_key: string;
        window: string; n: number; date_window_start: string | null; date_window_end: string | null;
        source_forecast_ids_json: string; freshness_deadline: string | null; metrics_json: string;
        created_at: string; updated_at: string;
      };
      const r = db.query<Row, [string]>("SELECT * FROM wiki_lessons WHERE id = ?").get(id);
      if (!r) return null;
      return WikiLesson.parse({
        id: r.id, title: r.title, body: r.body, state: r.state, cohortKind: r.cohort_kind, cohortKey: r.cohort_key,
        window: r.window, n: r.n, dateWindowStart: r.date_window_start, dateWindowEnd: r.date_window_end,
        sourceForecastIds: JSON.parse(r.source_forecast_ids_json), freshnessDeadline: r.freshness_deadline,
        metrics: JSON.parse(r.metrics_json), createdAt: r.created_at, updatedAt: r.updated_at,
      });
    },

    listLessons(opts: { states?: LessonState[] } = {}): WikiLesson[] {
      const all = db.query<{ id: string }, []>("SELECT id FROM wiki_lessons ORDER BY updated_at DESC").all();
      const lessons = all.map((r) => this.getLesson(r.id)!).filter(Boolean);
      return opts.states ? lessons.filter((l) => opts.states!.includes(l.state)) : lessons;
    },

    // ---- briefings -------------------------------------------------------
    insertBriefing(b: Briefing): Briefing {
      const v = Briefing.parse(b);
      db.query(
        `INSERT INTO briefings (id, date, body, included_lesson_ids_json, included_metric_ids_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(v.id, v.date, v.body, JSON.stringify(v.includedLessonIds), JSON.stringify(v.includedMetricIds), v.createdAt);
      return v;
    },

    latestBriefing(): Briefing | null {
      type Row = { id: string; date: string; body: string; included_lesson_ids_json: string; included_metric_ids_json: string; created_at: string };
      const r = db.query<Row, []>("SELECT * FROM briefings ORDER BY created_at DESC LIMIT 1").get();
      if (!r) return null;
      return Briefing.parse({
        id: r.id, date: r.date, body: r.body,
        includedLessonIds: JSON.parse(r.included_lesson_ids_json),
        includedMetricIds: JSON.parse(r.included_metric_ids_json),
        createdAt: r.created_at,
      });
    },
  };
}
export type WikiRepo = ReturnType<typeof wikiRepo>;
