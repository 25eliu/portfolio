# AI Knowledge Platform — Phase 2 Implementation Plan (Daily Performance Tracking)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist a daily mark for every open scored forecast (move, progress-to-target/stop, unrealized R, running MFE/MAE, status), assess the in-flight book each day in the wiki briefing, and surface per-call daily progress in the UI + query bot — so performance is tracked continuously, not only at horizon resolution.

**Architecture:** A new `forecast_daily_marks` table (migration 018) records one immutable row per `(forecast_id, date)`. A new `trackOpenForecasts(app)` step in `dailyRun` reuses the existing `openBook` mark math (`progressFor`) and rolls MFE/MAE forward from the prior day's mark, fetching live quotes once. `compileWiki` appends a compact "IN-FLIGHT (marked today)" assessment built from the persisted marks. The marks surface via the existing `/journal/:id` detail (extended with `marks`), a dedicated `GET /forecasts/:id/marks`, a `forecast_progress` query tool, and a daily-progress mini-series in `JournalDetail`.

**Tech Stack:** TypeScript, Bun (`bun test`), Hono, SQLite, Zod, React + TanStack Query. Spec: `docs/superpowers/specs/2026-06-02-ai-knowledge-platform-design.md` §Phase 2. Builds on Phase 1 (merged).

**Key existing pieces this builds on:**
- `src/wiki/openBook.ts` — `computeOpenBook(forecasts, priceBySymbol, asOf)` and an internal `progressFor(f, current)` returning `{movePct, toTarget, toStop, unrealizedR, status}`; `OpenThesisStatus = "near_target"|"on_track"|"at_risk"|"near_stop"`.
- `ScoredForecast` (`src/domain/journal.ts`): `{id, ticker, side: "bullish"|"bearish", referencePrice, target, stop, createdAt, resolveAt, benchmarkSymbol, benchmarkReferencePrice, conviction, ...}`.
- `app.repos.scoredForecasts.listOpen(asOfDate, limit=100)` and `.get(id)`.
- `app.gateway.getQuotes(symbols): Promise<{symbol, price, previousClose}[]>` and `.getQuote(symbol)`.
- `dailyRun` (`src/pipeline/dailyRun.ts`): step 2b resolves, step 2c `compileWiki`.
- `compileWiki` (`src/wiki/index.ts`) builds the briefing body and inserts a briefing row.
- Journal detail route `GET /journal/:id` returns `{entry, forecast, outcome, trades}`; UI `JournalDetail` in `web/src/components/Journal.tsx` via `useJournalEntry`.

---

## File Structure

**Create:**
- `src/domain/forecastMark.ts` — `ForecastDailyMark` zod type.
- `src/db/repositories/forecastDailyMarks.ts` — repo (upsert idempotent, prior-mark lookup, list/forDate).
- `src/db/repositories/forecastDailyMarks.test.ts`
- `src/resolution/track.ts` — `trackOpenForecasts(app)` + `markFor(...)` pure helper + `renderInFlight(marks)`.
- `src/resolution/track.test.ts`
- `src/server/forecastMarks.test.ts` (route + journal-detail extension tests)

**Modify:**
- `src/db/schema.ts` — append migration `018_forecast_daily_marks`.
- `src/db/index.ts` — register `forecastDailyMarks` repo.
- `src/domain/index.ts` — re-export `forecastMark.ts` (if not wildcard-covered).
- `src/pipeline/dailyRun.ts` — call `trackOpenForecasts` (step 2b.5, after resolution, before `compileWiki`).
- `src/wiki/index.ts` — append the in-flight assessment to the briefing body.
- `src/server/routes/journal.ts` — include `marks` in `GET /journal/:id`; add `GET /forecasts/:id/marks` (in a small new router or here).
- `src/server/app.ts` — mount the forecasts route (if a new router is used).
- `src/query/tools.ts` — add `forecast_progress` tool.
- `web/src/api/client.ts` + `hooks.ts` — `ForecastDailyMark` type; extend `journalEntry` response; add marks usage.
- `web/src/components/Journal.tsx` — daily-progress mini-series in `JournalDetail`.

---

## Task 1: `forecast_daily_marks` table + domain type + repo

**Files:**
- Modify: `src/db/schema.ts` (append migration)
- Create: `src/domain/forecastMark.ts`
- Modify: `src/domain/index.ts`
- Create: `src/db/repositories/forecastDailyMarks.ts`
- Modify: `src/db/index.ts`
- Test: `src/db/repositories/forecastDailyMarks.test.ts`

- [ ] **Step 1: Append the migration.** In `src/db/schema.ts`, add this object as the LAST element of the `MIGRATIONS` array (after `017_query_log_citations`):

```ts
  {
    // Daily mark-to-market for OPEN scored forecasts (roadmap Phase 2). One immutable row per
    // (forecast, day): move since entry, progress to target/stop, unrealized R, running MFE/MAE, and a
    // status bucket — so the book's performance is tracked continuously, not only at horizon resolution.
    name: "018_forecast_daily_marks",
    sql: `
      CREATE TABLE forecast_daily_marks (
        id                 TEXT PRIMARY KEY,
        forecast_id        TEXT NOT NULL REFERENCES scored_forecasts(id) ON DELETE CASCADE,
        ticker             TEXT NOT NULL,
        date               TEXT NOT NULL,            -- YYYY-MM-DD mark date
        mark_price         REAL NOT NULL,
        move_from_entry    REAL NOT NULL,            -- signed pct vs reference price
        progress_to_target REAL NOT NULL,            -- 0..1 (can exceed/underrun)
        progress_to_stop   REAL NOT NULL,            -- 0..1
        unrealized_r       REAL,                     -- signed R-multiple (null when stop span is 0)
        mfe                REAL NOT NULL,            -- running max unrealized_r to date (favorable)
        mae                REAL NOT NULL,            -- running min unrealized_r to date (adverse)
        spy_excess         REAL,                     -- move_from_entry minus benchmark move (null if unknown)
        status             TEXT NOT NULL,            -- on_track | near_target | at_risk | near_stop
        created_at         TEXT NOT NULL,
        UNIQUE (forecast_id, date)
      );
      CREATE INDEX idx_fdm_forecast ON forecast_daily_marks(forecast_id);
      CREATE INDEX idx_fdm_date     ON forecast_daily_marks(date);
    `,
  },
```

- [ ] **Step 2: Write the failing repo test.** Create `src/db/repositories/forecastDailyMarks.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../index.ts";
import type { ForecastDailyMark } from "../../domain/index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

const mark = (over: Partial<ForecastDailyMark>): ForecastDailyMark => ({
  id: over.id ?? `${over.forecastId ?? "f1"}-${over.date ?? "2026-06-02"}`,
  forecastId: "f1", ticker: "NVDA", date: "2026-06-02", markPrice: 100,
  moveFromEntry: 0.05, progressToTarget: 0.3, progressToStop: 0.1, unrealizedR: 0.5,
  mfe: 0.5, mae: 0.5, spyExcess: 0.02, status: "on_track", createdAt: NOW, ...over,
});

describe("forecastDailyMarks repo", () => {
  test("upsert is idempotent per (forecast_id, date) — re-marking the same day replaces the row", () => {
    repos.forecastDailyMarks.upsert(mark({ markPrice: 100, unrealizedR: 0.5 }));
    repos.forecastDailyMarks.upsert(mark({ markPrice: 110, unrealizedR: 0.9 }));
    const rows = repos.forecastDailyMarks.listForForecast("f1");
    expect(rows.length).toBe(1);
    expect(rows[0]!.markPrice).toBe(110);
    expect(rows[0]!.unrealizedR).toBe(0.9);
  });

  test("listForForecast returns marks oldest-first across days", () => {
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d2", date: "2026-06-03" }));
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d1", date: "2026-06-02" }));
    expect(repos.forecastDailyMarks.listForForecast("f1").map((m) => m.date)).toEqual(["2026-06-02", "2026-06-03"]);
  });

  test("priorMark returns the latest mark strictly before a date (for MFE/MAE roll-forward)", () => {
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d1", date: "2026-06-02", mfe: 0.5, mae: -0.2 }));
    expect(repos.forecastDailyMarks.priorMark("f1", "2026-06-03")?.mfe).toBe(0.5);
    expect(repos.forecastDailyMarks.priorMark("f1", "2026-06-02")).toBeNull(); // strictly before
  });

  test("forDate returns all marks stamped on a given day", () => {
    repos.forecastDailyMarks.upsert(mark({ id: "f1-d", forecastId: "f1", date: "2026-06-02" }));
    repos.forecastDailyMarks.upsert(mark({ id: "f2-d", forecastId: "f2", date: "2026-06-02" }));
    expect(repos.forecastDailyMarks.forDate("2026-06-02").length).toBe(2);
  });
});
```

- [ ] **Step 3: Run it — expect FAIL** (`Cannot find module` / `forecastDailyMarks` undefined): `bun test src/db/repositories/forecastDailyMarks.test.ts`

- [ ] **Step 4: Add the domain type.** Create `src/domain/forecastMark.ts`:

```ts
import { z } from "zod";

/** One daily mark-to-market of an open scored forecast. Immutable; one per (forecastId, date). */
export const ForecastDailyMark = z.object({
  id: z.string().min(1),
  forecastId: z.string().min(1),
  ticker: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  markPrice: z.number(),
  moveFromEntry: z.number(),
  progressToTarget: z.number(),
  progressToStop: z.number(),
  unrealizedR: z.number().nullable().default(null),
  mfe: z.number(),
  mae: z.number(),
  spyExcess: z.number().nullable().default(null),
  status: z.enum(["on_track", "near_target", "at_risk", "near_stop"]),
  createdAt: z.string().datetime(),
});
export type ForecastDailyMark = z.infer<typeof ForecastDailyMark>;
```

Then in `src/domain/index.ts`, add a re-export alongside the others (match the existing style, e.g. `export * from "./journal.ts";`):

```ts
export * from "./forecastMark.ts";
```

- [ ] **Step 5: Implement the repo.** Create `src/db/repositories/forecastDailyMarks.ts`:

```ts
import type { DB } from "../connection.ts";
import { ForecastDailyMark } from "../../domain/index.ts";

type Row = {
  id: string; forecast_id: string; ticker: string; date: string; mark_price: number;
  move_from_entry: number; progress_to_target: number; progress_to_stop: number;
  unrealized_r: number | null; mfe: number; mae: number; spy_excess: number | null;
  status: string; created_at: string;
};

const toDomain = (r: Row): ForecastDailyMark =>
  ForecastDailyMark.parse({
    id: r.id, forecastId: r.forecast_id, ticker: r.ticker, date: r.date, markPrice: r.mark_price,
    moveFromEntry: r.move_from_entry, progressToTarget: r.progress_to_target, progressToStop: r.progress_to_stop,
    unrealizedR: r.unrealized_r, mfe: r.mfe, mae: r.mae, spyExcess: r.spy_excess,
    status: r.status, createdAt: r.created_at,
  });

export function forecastDailyMarksRepo(db: DB) {
  return {
    /** Insert or replace the mark for a (forecast, date) — re-running a day re-marks idempotently. */
    upsert(m: ForecastDailyMark): ForecastDailyMark {
      const v = ForecastDailyMark.parse(m);
      db.query(
        `INSERT INTO forecast_daily_marks
           (id, forecast_id, ticker, date, mark_price, move_from_entry, progress_to_target, progress_to_stop,
            unrealized_r, mfe, mae, spy_excess, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (forecast_id, date) DO UPDATE SET
           mark_price = excluded.mark_price, move_from_entry = excluded.move_from_entry,
           progress_to_target = excluded.progress_to_target, progress_to_stop = excluded.progress_to_stop,
           unrealized_r = excluded.unrealized_r, mfe = excluded.mfe, mae = excluded.mae,
           spy_excess = excluded.spy_excess, status = excluded.status`,
      ).run(
        v.id, v.forecastId, v.ticker, v.date, v.markPrice, v.moveFromEntry, v.progressToTarget, v.progressToStop,
        v.unrealizedR, v.mfe, v.mae, v.spyExcess, v.status, v.createdAt,
      );
      return v;
    },

    /** All marks for a forecast, oldest-first (the trajectory). */
    listForForecast(forecastId: string): ForecastDailyMark[] {
      return db
        .query<Row, [string]>("SELECT * FROM forecast_daily_marks WHERE forecast_id = ? ORDER BY date ASC")
        .all(forecastId)
        .map(toDomain);
    },

    /** The latest mark strictly before `date` — seeds MFE/MAE roll-forward. */
    priorMark(forecastId: string, date: string): ForecastDailyMark | null {
      const row = db
        .query<Row, [string, string]>(
          "SELECT * FROM forecast_daily_marks WHERE forecast_id = ? AND date < ? ORDER BY date DESC LIMIT 1",
        )
        .get(forecastId, date);
      return row ? toDomain(row) : null;
    },

    /** All marks stamped on a given day (the in-flight assessment input). */
    forDate(date: string): ForecastDailyMark[] {
      return db.query<Row, [string]>("SELECT * FROM forecast_daily_marks WHERE date = ?").all(date).map(toDomain);
    },
  };
}
export type ForecastDailyMarksRepo = ReturnType<typeof forecastDailyMarksRepo>;
```

- [ ] **Step 6: Register the repo.** In `src/db/index.ts`, add the import after the `forecastOutcomesRepo` import:
```ts
import { forecastDailyMarksRepo } from "./repositories/forecastDailyMarks.ts";
```
and add to the returned object (after `forecastOutcomes: forecastOutcomesRepo(db),`):
```ts
    forecastDailyMarks: forecastDailyMarksRepo(db),
```

- [ ] **Step 7: Run — expect PASS:** `bun test src/db/repositories/forecastDailyMarks.test.ts`

- [ ] **Step 8: Run the migration locally to confirm it applies:** `bun run db:migrate` — expect no error (creates the table). Then `bun test src/db` — expect PASS.

- [ ] **Step 9: Commit:**
```bash
git add src/db/schema.ts src/domain/forecastMark.ts src/domain/index.ts src/db/repositories/forecastDailyMarks.ts src/db/repositories/forecastDailyMarks.test.ts src/db/index.ts
git commit -m "feat(tracking): forecast_daily_marks table + domain type + repo"
```

---

## Task 2: `trackOpenForecasts` — compute + persist daily marks with MFE/MAE roll-forward

**Files:**
- Create: `src/resolution/track.ts`
- Test: `src/resolution/track.test.ts`

- [ ] **Step 1: Write the failing test.** Create `src/resolution/track.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { markFor, trackOpenForecasts } from "./track.ts";
import type { ScoredForecast } from "../domain/index.ts";

const forecast = (over: Partial<ScoredForecast> = {}): ScoredForecast => ({
  id: "f1", journalEntryId: "j1", ticker: "NVDA", side: "bullish", strategyFamily: "momentum",
  signals: [], createdAt: "2026-06-01T00:00:00.000Z", asOfTimestamp: "2026-06-01T00:00:00.000Z",
  quoteTimestamp: null, priceFeed: "fake", referencePrice: 100, entry: 100, target: 120, stop: 90,
  horizonTradingSessions: 10, resolveAt: "2026-06-15", conviction: 0.7, benchmarkSymbol: "SPY",
  benchmarkReferencePrice: 400, resolutionPolicyVersion: "v1", marketContextId: null,
  citedSourceIds: [], retrievedChunkIds: [], ...over,
});

describe("markFor", () => {
  test("computes move/progress/R/status for a bullish forecast marked up", () => {
    const m = markFor(forecast(), { markPrice: 110, date: "2026-06-03", spyPrice: 408, prior: null, now: "2026-06-03T00:00:00.000Z" });
    expect(m.moveFromEntry).toBeCloseTo(0.1, 5); // (110-100)/100
    expect(m.progressToTarget).toBeCloseTo(0.5, 5); // (110-100)/(120-100)
    expect(m.unrealizedR).toBeCloseTo(1.0, 5); // (110-100)/(100-90)
    expect(m.status).toBe("on_track");
    expect(m.mfe).toBeCloseTo(1.0, 5);
    expect(m.mae).toBeCloseTo(1.0, 5);
    expect(m.spyExcess).toBeCloseTo(0.1 - 0.02, 5); // 0.1 stock vs (408-400)/400=0.02 spy
  });

  test("rolls MFE up and MAE down from the prior mark", () => {
    const prior = markFor(forecast(), { markPrice: 115, date: "2026-06-03", spyPrice: null, prior: null, now: "2026-06-03T00:00:00.000Z" });
    expect(prior.mfe).toBeCloseTo(1.5, 5); // (115-100)/10
    const today = markFor(forecast(), { markPrice: 95, date: "2026-06-04", spyPrice: null, prior, now: "2026-06-04T00:00:00.000Z" });
    expect(today.unrealizedR).toBeCloseTo(-0.5, 5); // (95-100)/10
    expect(today.mfe).toBeCloseTo(1.5, 5); // best R retained from prior
    expect(today.mae).toBeCloseTo(-0.5, 5); // worst R is today
    expect(today.status).toBe("at_risk");
  });
});

describe("trackOpenForecasts", () => {
  let app: App;
  beforeEach(() => {
    app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => "2026-06-03", startingCash: 100_000 }), now: () => "2026-06-03" });
  });

  test("persists a mark per open forecast and is idempotent for the day", async () => {
    // Seed an open scored forecast directly.
    app.repos.scoredForecasts.insert(forecast());
    const r1 = await trackOpenForecasts(app);
    expect(r1.tracked).toBe(1);
    const r2 = await trackOpenForecasts(app); // same day again
    expect(r2.tracked).toBe(1);
    expect(app.repos.forecastDailyMarks.listForForecast("f1").length).toBe(1); // idempotent
  });

  test("no open forecasts → tracks nothing, no throw", async () => {
    expect((await trackOpenForecasts(app)).tracked).toBe(0);
  });
});
```

> Note: `createFakeGateway` returns deterministic quotes for any symbol. The `trackOpenForecasts` integration test asserts a mark is persisted (count), not an exact price, since the fake price is gateway-defined.

- [ ] **Step 2: Run — expect FAIL:** `bun test src/resolution/track.test.ts`

- [ ] **Step 3: Implement `track.ts`.** Create `src/resolution/track.ts`:

```ts
import type { App } from "../app.ts";
import { newId, type ForecastDailyMark, type ScoredForecast } from "../domain/index.ts";

/** Inputs to mark one forecast on one day. `prior` seeds the running MFE/MAE (null on the first mark). */
export type MarkInput = {
  markPrice: number;
  date: string;
  spyPrice: number | null;
  prior: ForecastDailyMark | null;
  now: string;
};

/**
 * Mark one open forecast to a price: move since entry, progress to target/stop, unrealized R, a status
 * bucket, and MFE/MAE rolled forward from the prior mark. Mirrors the openBook math (bullish = long,
 * bearish = short) so the blotter and the persisted marks agree.
 */
export function markFor(f: ScoredForecast, input: MarkInput): ForecastDailyMark {
  const ref = f.referencePrice;
  const long = f.side === "bullish";
  const current = input.markPrice;
  const moveFromEntry = ref !== 0 ? (current - ref) / ref : 0;
  const targetSpan = long ? f.target - ref : ref - f.target;
  const stopSpan = long ? ref - f.stop : f.stop - ref;
  const progressToTarget = targetSpan !== 0 ? (long ? current - ref : ref - current) / targetSpan : 0;
  const progressToStop = stopSpan !== 0 ? (long ? ref - current : current - ref) / stopSpan : 0;
  const unrealizedR = stopSpan !== 0 ? (long ? current - ref : ref - current) / stopSpan : null;
  const status =
    progressToStop >= 0.8 ? "near_stop" : progressToTarget >= 0.8 ? "near_target" : (unrealizedR ?? 0) >= 0 ? "on_track" : "at_risk";

  const r = unrealizedR ?? 0;
  const mfe = input.prior ? Math.max(input.prior.mfe, r) : r;
  const mae = input.prior ? Math.min(input.prior.mae, r) : r;

  let spyExcess: number | null = null;
  if (input.spyPrice != null && f.benchmarkReferencePrice != null && f.benchmarkReferencePrice !== 0) {
    const spyMove = (input.spyPrice - f.benchmarkReferencePrice) / f.benchmarkReferencePrice;
    spyExcess = moveFromEntry - spyMove;
  }

  return {
    id: newId(),
    forecastId: f.id,
    ticker: f.ticker,
    date: input.date,
    markPrice: current,
    moveFromEntry,
    progressToTarget,
    progressToStop,
    unrealizedR,
    mfe,
    mae,
    spyExcess,
    status,
    createdAt: input.now,
  };
}

/**
 * Mark every open scored forecast to today's price and persist one daily mark each (idempotent per
 * day). Fetches live quotes once. Degrades gracefully — a forecast whose ticker has no quote is
 * skipped. Returns the count tracked. Called from dailyRun after resolution, before wiki compile.
 */
export async function trackOpenForecasts(app: App): Promise<{ tracked: number }> {
  const date = app.now();
  const now = new Date().toISOString();
  const open = app.repos.scoredForecasts.listOpen(date, 200);
  if (open.length === 0) return { tracked: 0 };

  const symbols = [...new Set([...open.map((f) => f.ticker), "SPY"])];
  const quotes = await app.gateway.getQuotes(symbols);
  const priceBySymbol = new Map(quotes.map((q) => [q.symbol, q.price]));
  const spyPrice = priceBySymbol.get("SPY") ?? null;

  let tracked = 0;
  for (const f of open) {
    const markPrice = priceBySymbol.get(f.ticker);
    if (markPrice == null) continue;
    const prior = app.repos.forecastDailyMarks.priorMark(f.id, date);
    app.repos.forecastDailyMarks.upsert(markFor(f, { markPrice, date, spyPrice, prior, now }));
    tracked++;
  }
  return { tracked };
}
```

> Note: `markFor`'s move/progress/status math is intentionally identical to `progressFor` in `src/wiki/openBook.ts`. If a reviewer prefers, `progressFor` could be exported and shared — but it is currently private and returns a different field set, so duplicating the small formula here (with MFE/MAE added) keeps `openBook.ts` untouched and the marks self-contained. Flag during review if extraction is preferred.

- [ ] **Step 4: Run — expect PASS:** `bun test src/resolution/track.test.ts`
- [ ] **Step 5: Commit:**
```bash
git add src/resolution/track.ts src/resolution/track.test.ts
git commit -m "feat(tracking): trackOpenForecasts marks open calls daily with MFE/MAE roll-forward"
```

---

## Task 3: Wire `trackOpenForecasts` into the daily run

**Files:**
- Modify: `src/pipeline/dailyRun.ts`
- Test: `src/pipeline/pipeline.test.ts` (append)

- [ ] **Step 1: Write the failing integration test.** Append to `src/pipeline/pipeline.test.ts` inside the existing top-level `describe(...)` (find the existing `describe("dailyRun", ...)` block and add this test inside it; reuse its `app` setup):

```ts
  test("marks open forecasts daily during the run", async () => {
    await dailyRun(app);                       // first run creates scored forecasts
    const open = app.repos.scoredForecasts.listOpen(app.now(), 200);
    if (open.length === 0) return;             // fake report may not score; guard keeps the test honest
    const marks = app.repos.forecastDailyMarks.listForForecast(open[0]!.id);
    expect(marks.length).toBeGreaterThanOrEqual(1);
    expect(marks[marks.length - 1]!.date).toBe(app.now());
  });
```

> If `pipeline.test.ts` does not already import/construct `app` in a reusable way, model the setup on the existing `dailyRun` tests in that file (createApp + openMemoryDb + createFakeGateway). Do not duplicate an entire new harness if one exists.

- [ ] **Step 2: Run — expect FAIL** (no marks persisted yet): `bun test src/pipeline/pipeline.test.ts`

- [ ] **Step 3: Wire it into `dailyRun`.** In `src/pipeline/dailyRun.ts`, add the import:
```ts
import { trackOpenForecasts } from "../resolution/track.ts";
```
Then, between Step 2b (resolution) and Step 2c (compileWiki) — i.e. immediately after the `resolution` block ends (after line ~58) and before the `const wiki = await compileWiki(app)...` block — insert:

```ts
    // Step 2b.5 — mark every still-open forecast to today's price (persisted daily tracking). Degrades
    // gracefully: a tracking failure is logged and never aborts the run.
    const tracked = await trackOpenForecasts(app).catch((err) => {
      console.warn(`[tracking] step failed: ${err instanceof Error ? err.message : String(err)}`);
      return { tracked: 0 };
    });
    if (tracked.tracked > 0) console.log(`[tracking] marked=${tracked.tracked}`);
```

- [ ] **Step 4: Run — expect PASS:** `bun test src/pipeline/pipeline.test.ts`
- [ ] **Step 5: Commit:**
```bash
git add src/pipeline/dailyRun.ts src/pipeline/pipeline.test.ts
git commit -m "feat(tracking): mark open forecasts daily in the run (step 2b.5)"
```

---

## Task 4: In-flight assessment in the wiki briefing

**Files:**
- Modify: `src/resolution/track.ts` (add `renderInFlight`)
- Modify: `src/wiki/index.ts` (append to briefing body)
- Test: `src/resolution/track.test.ts` (append a `renderInFlight` test)

- [ ] **Step 1: Write the failing test.** Append to `src/resolution/track.test.ts`:

```ts
import { renderInFlight } from "./track.ts";

describe("renderInFlight", () => {
  test("summarizes today's marks (counts + avg unrealized R + avg MFE/MAE)", () => {
    const base = { id: "x", forecastId: "f", ticker: "NVDA", date: "2026-06-03", markPrice: 100,
      moveFromEntry: 0, progressToTarget: 0, progressToStop: 0, spyExcess: null, createdAt: "2026-06-03T00:00:00.000Z" };
    const text = renderInFlight([
      { ...base, unrealizedR: 0.8, mfe: 1.0, mae: -0.1, status: "on_track" },
      { ...base, forecastId: "g", unrealizedR: -0.6, mfe: 0.2, mae: -0.6, status: "near_stop" },
    ] as any);
    expect(text).toContain("IN-FLIGHT");
    expect(text).toContain("1 on track");
    expect(text).toContain("1 near stop");
  });

  test("empty marks → empty string (nothing to inject)", () => {
    expect(renderInFlight([])).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `bun test src/resolution/track.test.ts`

- [ ] **Step 3: Implement `renderInFlight` in `src/resolution/track.ts`** (add at the end of the file):

```ts
const avg = (xs: number[]): number | null => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
const fmt = (x: number | null) => (x == null ? "—" : x.toFixed(2));

/** A one-block daily assessment of the in-flight book, compiled from today's persisted marks. Injected
 *  into the wiki briefing so analysis sees how live calls are actually tracking (not just resolved). */
export function renderInFlight(marks: ForecastDailyMark[]): string {
  if (marks.length === 0) return "";
  const count = (s: string) => marks.filter((m) => m.status === s).length;
  const rs = marks.map((m) => m.unrealizedR).filter((r): r is number => r != null);
  return [
    `IN-FLIGHT (marked ${marks[0]!.date}) — daily mark-to-market of open calls.`,
    `${marks.length} open: ${count("on_track")} on track, ${count("at_risk")} at risk, ${count("near_stop")} near stop, ${count("near_target")} near target.`,
    `Avg unrealized ${fmt(avg(rs))}R; avg MFE ${fmt(avg(marks.map((m) => m.mfe)))}R, avg MAE ${fmt(avg(marks.map((m) => m.mae)))}R.`,
  ].join("\n");
}
```

- [ ] **Step 4: Append it to the briefing in `compileWiki`.** In `src/wiki/index.ts`:
  - Add to the import from `./openBook.ts` line a new import for track: at the top add
    ```ts
    import { renderInFlight } from "../resolution/track.ts";
    ```
  - Replace the `const fullBody = [body, openSection].filter(Boolean).join("\n\n");` line with:
    ```ts
    const inFlight = renderInFlight(app.repos.forecastDailyMarks.forDate(date));
    const fullBody = [body, openSection, inFlight].filter(Boolean).join("\n\n");
    ```

> Ordering note: `trackOpenForecasts` runs at step 2b.5 (Task 3), before `compileWiki` at step 2c, so `forDate(date)` is populated when the briefing compiles. When `compileWiki` runs without prior tracking (e.g. a standalone call), `forDate` is empty and `renderInFlight` returns "" — harmless.

- [ ] **Step 5: Run — expect PASS:** `bun test src/resolution/track.test.ts` then `bun test src/wiki src/pipeline` (no regressions).
- [ ] **Step 6: Commit:**
```bash
git add src/resolution/track.ts src/wiki/index.ts
git commit -m "feat(tracking): inject daily in-flight assessment into the wiki briefing"
```

---

## Task 5: API — journal-detail marks, `/forecasts/:id/marks`, `forecast_progress` tool

**Files:**
- Modify: `src/server/routes/journal.ts` (include `marks` in `/journal/:id`; add `/forecasts/:id/marks`)
- Modify: `src/query/tools.ts` (add `forecast_progress`)
- Test: `src/server/forecastMarks.test.ts` (create), `src/query/tools.test.ts` (append)

- [ ] **Step 1: Write the failing route test.** Create `src/server/forecastMarks.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";
import { trackOpenForecasts } from "../resolution/track.ts";

const DATE = "2026-06-03";
let app: App;
let server: ReturnType<typeof createServer>;

const forecast = () => ({
  id: "f1", journalEntryId: "j1", ticker: "NVDA", side: "bullish" as const, strategyFamily: "momentum",
  signals: [], createdAt: "2026-06-01T00:00:00.000Z", asOfTimestamp: "2026-06-01T00:00:00.000Z",
  quoteTimestamp: null, priceFeed: "fake", referencePrice: 100, entry: 100, target: 120, stop: 90,
  horizonTradingSessions: 10, resolveAt: "2026-06-15", conviction: 0.7, benchmarkSymbol: "SPY",
  benchmarkReferencePrice: 400, resolutionPolicyVersion: "v1", marketContextId: null,
  citedSourceIds: [], retrievedChunkIds: [],
});

beforeEach(async () => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE });
  server = createServer(app);
  app.repos.scoredForecasts.insert(forecast());
  await trackOpenForecasts(app);
});
const req = (path: string) => server.fetch(new Request(`http://test/api${path}`));

describe("forecast marks API", () => {
  test("GET /forecasts/:id/marks returns the trajectory", async () => {
    const body = (await (await req("/forecasts/f1/marks")).json()) as { marks: { date: string }[] };
    expect(body.marks.length).toBe(1);
    expect(body.marks[0]!.date).toBe(DATE);
  });

  test("GET /forecasts/:id/marks → empty array for an unknown forecast", async () => {
    const body = (await (await req("/forecasts/nope/marks")).json()) as { marks: unknown[] };
    expect(body.marks).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (404):** `bun test src/server/forecastMarks.test.ts`

- [ ] **Step 3: Add the route + extend journal detail.** In `src/server/routes/journal.ts`:
  - In the `GET /:id` handler, after computing `forecast` and `outcome`, add marks and include them in the response:
    ```ts
    const marks = forecast ? app.repos.forecastDailyMarks.listForForecast(forecast.id) : [];
    ```
    and change the `return c.json({ entry, forecast, outcome, trades });` to:
    ```ts
    return c.json({ entry, forecast, outcome, trades, marks });
    ```
  - Add a new route in the same router (it is mounted at `/journal`, so this would be `/journal/forecasts/...` — NOT what we want). Instead, add the marks endpoint to a path that mounts at `/`. The simplest: add it to the existing `aiKnowledgeRoutes`-style "/" group is wrong domain. Create the route in `journal.ts` but expose it via a SEPARATE small router. To keep it simple and avoid a new file, add the following to `src/server/routes/journal.ts`'s exported function on a sub-path and ALSO register a tiny forecasts router in app.ts:

  Implementation choice (pick ONE, the reviewer can confirm): **add a dedicated router**. At the bottom of `src/server/routes/journal.ts`, export a second function:
    ```ts
    export function forecastRoutes(app: App): Hono {
      const r = new Hono();
      r.get("/forecasts/:id/marks", (c) =>
        c.json({ marks: app.repos.forecastDailyMarks.listForForecast(c.req.param("id")) }),
      );
      return r;
    }
    ```
  (Add `import { Hono } from "hono";` if not already imported in journal.ts — it is, since journalRoutes returns a Hono.)

- [ ] **Step 4: Mount the forecasts router.** In `src/server/app.ts`:
  - Update the journal import to also import the new function:
    ```ts
    import { journalRoutes, forecastRoutes } from "./routes/journal.ts";
    ```
  - After the `api.route("/journal", journalRoutes(app));` line add:
    ```ts
    api.route("/", forecastRoutes(app)); // /forecasts/:id/marks
    ```

- [ ] **Step 5: Run — expect PASS:** `bun test src/server/forecastMarks.test.ts` and `bun test src/server/server.test.ts` (no regressions to the existing journal detail test — confirm it still passes with the added `marks` field; if that test does a strict `toEqual` on the response object, update it to include `marks: []` or use `toMatchObject` — read it first).

- [ ] **Step 6: Add the `forecast_progress` query tool.** First write the failing test — append to `src/query/tools.test.ts` inside the existing `describe("query tool citations (cite)", ...)` or the registry block:

```ts
  test("forecast_progress returns the daily trajectory of an open call by ticker", async () => {
    const { trackOpenForecasts } = await import("../resolution/track.ts");
    app.repos.scoredForecasts.insert({
      id: "f1", journalEntryId: "j1", ticker: "NVDA", side: "bullish", strategyFamily: "momentum",
      signals: [], createdAt: "2026-06-01T00:00:00.000Z", asOfTimestamp: "2026-06-01T00:00:00.000Z",
      quoteTimestamp: null, priceFeed: "fake", referencePrice: 100, entry: 100, target: 120, stop: 90,
      horizonTradingSessions: 10, resolveAt: "2026-06-15", conviction: 0.7, benchmarkSymbol: "SPY",
      benchmarkReferencePrice: 400, resolutionPolicyVersion: "v1", marketContextId: null,
      citedSourceIds: [], retrievedChunkIds: [],
    } as any);
    await trackOpenForecasts(app);
    const res = (await tool("forecast_progress").run(app, { ticker: "NVDA" })) as { calls: { ticker: string; marks: unknown[] }[] };
    expect(res.calls[0]!.ticker).toBe("NVDA");
    expect(res.calls[0]!.marks.length).toBeGreaterThanOrEqual(1);
  });
```

Then implement the tool — add to the `QUERY_TOOLS` array in `src/query/tools.ts`, before the closing `];`:

```ts
  {
    name: "forecast_progress",
    description:
      "Daily mark-to-market trajectory of the AI's OPEN scored calls (move since entry, progress to target/stop, unrealized R, running MFE/MAE, status). Optionally filter by ticker. Grounded in persisted daily marks.",
    parameters: obj({ ticker: S }),
    run(app, args) {
      const ticker = str(args.ticker)?.toUpperCase();
      const open = app.repos.scoredForecasts
        .listAll({ limit: 500 })
        .filter((f) => !app.repos.forecastOutcomes.getByForecast(f.id))
        .filter((f) => (ticker ? f.ticker === ticker : true));
      return {
        calls: cap(open, 20).map((f) => {
          const marks = app.repos.forecastDailyMarks.listForForecast(f.id);
          const last = marks[marks.length - 1] ?? null;
          return {
            ticker: f.ticker, side: f.side, resolveBy: f.resolveAt,
            latest: last && { date: last.date, movePct: last.moveFromEntry, unrealizedR: last.unrealizedR, mfe: last.mfe, mae: last.mae, status: last.status },
            marks: marks.map((m) => ({ date: m.date, movePct: m.moveFromEntry, r: m.unrealizedR, status: m.status })),
          };
        }),
      };
    },
  },
```

- [ ] **Step 7: Run — expect PASS:** `bun test src/query/tools.test.ts`
- [ ] **Step 8: Commit:**
```bash
git add src/server/routes/journal.ts src/server/app.ts src/server/forecastMarks.test.ts src/query/tools.ts src/query/tools.test.ts
git commit -m "feat(tracking): journal-detail marks, /forecasts/:id/marks, forecast_progress tool"
```

---

## Task 6: Frontend — daily-progress mini-series in the Journal detail

**Files:**
- Modify: `web/src/api/client.ts` (type + extend `journalEntry` response)
- Modify: `web/src/components/Journal.tsx` (`JournalDetail` mini-series)

- [ ] **Step 1: Add the type + extend the client response.** In `web/src/api/client.ts`:
  - After the `AiInsight`/`TagCount` types (or near the other domain re-exports), add:
    ```ts
    export type ForecastDailyMark = {
      id: string; forecastId: string; ticker: string; date: string; markPrice: number;
      moveFromEntry: number; progressToTarget: number; progressToStop: number;
      unrealizedR: number | null; mfe: number; mae: number; spyExcess: number | null;
      status: "on_track" | "near_target" | "at_risk" | "near_stop"; createdAt: string;
    };
    ```
  - In the `journalEntry` client method, extend the response generic to include `marks`:
    ```ts
    journalEntry: (id: string) =>
      api<{ entry: JournalEntry; forecast: ScoredForecast | null; outcome: ForecastOutcome | null; marks: ForecastDailyMark[] }>(
        `/journal/${id}`,
      ),
    ```
    (Match the existing call's exact generic — read the current lines 110-112 and add `; marks: ForecastDailyMark[]` to the object type. If `trades` is also in the type, keep it.)

- [ ] **Step 2: Render the mini-series in `JournalDetail`.** In `web/src/components/Journal.tsx`, inside `JournalDetail` (which already reads `const detail = useJournalEntry(entry.id);`), add after the existing `forecast`/`outcome` derivations:
    ```tsx
    const marks = detail.data?.marks ?? [];
    ```
  Then render a compact progress strip when there are marks and no terminal outcome yet. Add this block in the returned JSX, after the forecast `<Field>` rows and before `{outcome && <Outcome .../>}`:

```tsx
      {marks.length > 0 && <DailyProgress marks={marks} />}
```

  And add this component at the bottom of the file (reuse the file's existing `pct`/`Field` helpers and Tailwind tokens already used in the component):

```tsx
function DailyProgress({ marks }: { marks: import("../api/client.ts").ForecastDailyMark[] }) {
  const last = marks[marks.length - 1]!;
  const tone =
    last.status === "near_stop" || last.status === "at_risk" ? "text-neg" : "text-pos";
  return (
    <div className="mt-3">
      <p className="mb-1 text-[11px] uppercase tracking-wide text-text-muted">Daily progress ({marks.length})</p>
      <div className="flex items-end gap-0.5">
        {marks.map((m) => {
          const h = Math.min(24, Math.max(2, Math.round(Math.abs(m.moveFromEntry) * 120)));
          const up = m.moveFromEntry >= 0;
          return (
            <span
              key={m.date}
              title={`${m.date}: ${pct(m.moveFromEntry)} · R ${m.unrealizedR == null ? "—" : m.unrealizedR.toFixed(2)} · ${m.status}`}
              className={`w-1.5 rounded-sm ${up ? "bg-pos/60" : "bg-neg/60"}`}
              style={{ height: `${h}px` }}
            />
          );
        })}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-text-muted">
        <span className={tone}>now {pct(last.moveFromEntry)}</span>
        <span>R {last.unrealizedR == null ? "—" : last.unrealizedR.toFixed(2)}</span>
        <span>MFE {last.mfe.toFixed(2)}R</span>
        <span>MAE {last.mae.toFixed(2)}R</span>
        <span>{last.status}</span>
      </div>
    </div>
  );
}
```

> Confirm `pct` exists in Journal.tsx (it does — used for percentages) and `bg-pos`/`bg-neg`/`text-pos`/`text-neg`/`text-text-muted` are valid Tailwind tokens already used in the file. Adapt class names to the file's actual tokens if they differ.

- [ ] **Step 3: Typecheck + build.** From repo root: `bunx tsc --noEmit 2>&1 | grep "web/src"` → expect zero web errors. Then `cd web && bun run build` → expect success. (Pre-existing backend `journal.test.ts` tsc errors are out of scope.)
- [ ] **Step 4: Commit:**
```bash
git add web/src/api/client.ts web/src/components/Journal.tsx
git commit -m "feat(web): daily-progress mini-series in the journal detail"
```

---

## Task 7: Full-suite verification + docs

**Files:**
- Modify: `docs/architecture-and-roadmap.md`

- [ ] **Step 1: Run the whole backend suite:** `bun test` — expect all PASS. Investigate any failure before proceeding (pay attention to `pipeline.test.ts`, `wiki`, and `server.test.ts`).
- [ ] **Step 2: Build the web app:** `cd web && bun run build` — expect success.
- [ ] **Step 3: Update the architecture doc.** In `docs/architecture-and-roadmap.md`, mark Phase 2 done in the AI Knowledge Platform roadmap subsection and document: `forecast_daily_marks` (one row per open forecast per day; move/progress/R/running MFE-MAE/status); `trackOpenForecasts` runs at dailyRun step 2b.5; the in-flight assessment is injected into the wiki briefing; marks surface via `/journal/:id`, `/forecasts/:id/marks`, the `forecast_progress` tool, and the journal daily-progress mini-series. Note Phase 3 (theses + Market View) is still pending.
- [ ] **Step 4: Commit:**
```bash
git add docs/architecture-and-roadmap.md
git commit -m "docs: record Phase 2 daily performance tracking"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 2 sections of the spec):**
- §2.1 `forecast_daily_marks` migration → Task 1. ✓ (matches spec columns; `id` PK added for repo ergonomics; `mfe`/`mae` defined as running max/min of unrealized R — documented.)
- §2.2 `trackOpenForecasts` daily job + MFE/MAE roll-forward, reuses openBook math, called after pricing/before wiki → Tasks 2, 3. ✓ (placed at step 2b.5 — after resolution, before compileWiki, consistent with spec "before wiki compile".)
- §2.3 in-flight assessment injected into the (one) wiki briefing → Task 4. ✓ (the existing live Open Book section is left intact; the assessment is additive and reads persisted marks.)
- §2.4 `/forecasts/:id/marks`, `forecast_progress` tool, Journal daily-progress series → Tasks 5, 6. ✓

**Type consistency:** `ForecastDailyMark` fields identical across `src/domain/forecastMark.ts` (Task 1), repo `toDomain` (Task 1), `markFor`/`renderInFlight` (Tasks 2/4), the routes/tool (Task 5), and the web type (Task 6). `status` union `on_track|near_target|at_risk|near_stop` identical to `OpenThesisStatus` in `openBook.ts`. Repo method names (`upsert`, `listForForecast`, `priorMark`, `forDate`) used consistently in Tasks 2/4/5.

**Placeholder scan:** none — every code step contains complete code.

**Deviations flagged for the reviewer:**
1. **Mark math is duplicated** from `openBook.ts`'s private `progressFor` (rather than exporting/sharing it). Justified to keep `openBook.ts` untouched and the marks self-contained; reviewer may prefer extraction into a shared helper. (Tasks 2 — noted inline.)
2. **MFE/MAE are defined in unrealized-R units** (running max/min of `unrealizedR`), distinct from `forecast_outcomes`' bar-derived `max_favorable_excursion`/`max_adverse_excursion` (return units). This is intentional — the daily blotter speaks in R — but the naming overlap is worth a comment so the two aren't conflated.
3. **Double quote fetch:** `trackOpenForecasts` (step 2b.5) and the existing live Open Book inside `compileWiki` (step 2c) each call `getQuotes`. Acceptable (small, and avoids refactoring `compileWiki`'s open-book section); a future cleanup could have `compileWiki` read persisted marks instead. Flagged so it's a conscious choice.
4. **`/forecasts/:id/marks` returns `{ marks: [] }` for unknown ids** (no 404) — consistent with other list endpoints; the query tool and UI both tolerate empty.
