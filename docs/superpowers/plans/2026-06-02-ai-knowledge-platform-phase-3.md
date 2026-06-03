# AI Knowledge Platform — Phase 3 Implementation Plan (Theses & Market View)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The AI authors a cross-cutting **outlook** each run (market regime + sector leans + named themes), persists each as a tagged, graph-linked **thesis** with a supersede chain, compiles the current outlook **into the wiki briefing**, and surfaces it in a new **Market View** (and the AI Library + query bot) — so the AI's sector/market conclusions are stored, shown, reachable, and fed back instead of recomputed and discarded.

**Architecture:** A report-level synthesis step `buildOutlook` (mirrors `buildMarketContext`) calls a new `Analyzer.synthesizeOutlook` (research → structured call, like `discoverOpportunities`) to produce an `Outlook` attached to the `DailyReport`. `curateTheses` (parallel to `curateFacts`) persists each outlook item into a new `ai_theses` table (migration 019) + FTS, supersedes the prior active thesis for the same subject, and links it into the knowledge graph (`thesis:<id>` node + `tagged_with`/`mentions`/`supersedes` edges + auto-tags via `insightTags`). The same canonical `AiInsight` serializer gains a `serializeThesis` variant, so `/ai-library` and `search_ai_insights` include theses. `compileWiki` appends an OUTLOOK section to the briefing. A `MarketView.tsx` section renders the current regime/sectors/themes with per-subject history.

**Tech Stack:** TypeScript, Bun (`bun test`), Hono, SQLite + FTS5, Zod, `@google/genai`, React + TanStack Query, Tailwind. Spec: `docs/superpowers/specs/2026-06-02-ai-knowledge-platform-design.md` §Phase 3. Builds on Phases 1–2 (merged).

**Key existing pieces (from exploration):**
- `Analyzer` interface (`src/llm/analyze.ts:17`): `{ kind, analyzeTicker, marketMacro, discoverOpportunities }`. `createMockAnalyzer()` (`:35`) is the offline/test analyzer.
- Gemini structured-output pattern (`src/llm/gemini.ts`): private `research(prompt, sink)` (grounded search → `{text, sources}`) + `structure(contents, {name}, declaration, sink)` (forced function-call → `args`). `discoverOpportunities` (`:185`) shows the two-stage pattern; schemas live in `src/llm/schema.ts` as genai `FunctionDeclaration`s (`Type.OBJECT`…).
- `buildMarketContext` (`src/analysis/marketContext.ts:7`) — the report-level analog to mirror. Report assembled in `src/pipeline/llmReport.ts:210`; `DailyReport` (`src/domain/recommendation.ts:97`) currently `{id,date,generatedAt,source,recommendations,marketContext}`. `generateFakeReport` (`src/pipeline/fakeReport.ts:84`).
- `curateFacts`/`persistCuratedFacts` (`src/knowledge/curate.ts`) — the persistence+graph+tag+cap pattern to mirror. `linkLessonGraph` (`src/wiki/index.ts:20`) — the graph-link + supersede pattern.
- `AiInsight` + `serializeFact` (`src/knowledge/serialize.ts`). `insightTags.addTag(node, {dimension,value,source}, now)` (dimensions ticker/sector/theme/direction/horizon).
- `KgNodeType` (`src/domain/graph.ts:13`) — needs `"thesis"` added; `supersedes`/`tagged_with`/`mentions`/`belongs_to` rels already exist.
- Routers mounted in `src/server/app.ts:23-34`. Query tools in `src/query/tools.ts` (`QueryTool` shape, `obj/S/str/cap` helpers). App sections in `web/src/App.tsx` (index 0–9; insert "Market view" after "Daily recommendations"). `MarketContextBanner.tsx` is the regime-banner style to echo.

---

## File Structure

**Create:**
- `src/domain/thesis.ts` — `Thesis` (persisted) + `ThesisItem`/`Outlook` (LLM contract) zod types.
- `src/db/repositories/aiTheses.ts` (+ `.test.ts`) — the theses repo (insert+FTS, supersede, days/day, current/history, search).
- `src/llm/outlookSchema.ts` OR add to `src/llm/schema.ts` — `outlookFunctionDeclaration`.
- `src/analysis/outlook.ts` (+ `.test.ts`) — `buildOutlook(analyzer, ctx, recs, sink)`.
- `src/knowledge/curateTheses.ts` (+ `.test.ts`) — `persistOutlook(app, report, runId, now)`.
- `src/server/routes/marketView.ts` (+ `src/server/marketView.test.ts`).
- `web/src/components/MarketView.tsx`.

**Modify:**
- `src/db/schema.ts` — migration `019_ai_theses` (+ `ai_theses_fts`).
- `src/db/index.ts` — register `aiTheses` repo.
- `src/domain/index.ts` — re-export `thesis.ts`.
- `src/domain/graph.ts` — add `"thesis"` to `KgNodeType`.
- `src/domain/recommendation.ts` — `DailyReport` gains `outlook`.
- `src/llm/analyze.ts` — `Analyzer.synthesizeOutlook` + mock impl.
- `src/llm/gemini.ts` — gemini `synthesizeOutlook`.
- `src/llm/prompts.ts` — outlook research+structure prompts.
- `src/pipeline/llmReport.ts` — build + attach outlook; `src/pipeline/fakeReport.ts` — deterministic fake outlook.
- `src/pipeline/dailyRun.ts` — call `persistOutlook` after `persistCuratedFacts`.
- `src/knowledge/serialize.ts` — `serializeThesis`.
- `src/server/routes/aiKnowledge.ts` — include theses in `/ai-library/*` + search.
- `src/wiki/index.ts` — append OUTLOOK section to the briefing.
- `src/query/tools.ts` — `market_view` + `sector_outlook` tools; `search_ai_insights` includes theses.
- `src/server/app.ts` — mount market-view router.
- `web/src/api/client.ts` + `hooks.ts` — market-view + thesis types/methods/hooks.
- `web/src/App.tsx` — "Market view" section.

**Stance vocabulary (confirmed in spec §4):** regime stance ∈ `{risk_on, neutral, risk_off, defensive}`; sector/theme stance ∈ `{bullish, bearish, neutral}`. Caps: ≤8 sectors, ≤6 themes per run.

---

## Task 1: `ai_theses` table + FTS + domain + repo

**Files:** Modify `src/db/schema.ts`, `src/domain/index.ts`, `src/db/index.ts`; Create `src/domain/thesis.ts`, `src/db/repositories/aiTheses.ts`, `src/db/repositories/aiTheses.test.ts`.

- [ ] **Step 1: Append migration `019_ai_theses`** as the LAST element of `MIGRATIONS` in `src/db/schema.ts`:

```ts
  {
    // AI outlook theses (roadmap Phase 3). Each run the analyzer authors a cross-cutting outlook —
    // market regime + sector leans + named themes — persisted here as superseding theses, FTS-searchable,
    // and graph-linked. The CURRENT view per subject is status='active'; prior views chain via supersedes_id.
    name: "019_ai_theses",
    sql: `
      CREATE TABLE ai_theses (
        id            TEXT PRIMARY KEY,
        run_id        TEXT,
        report_id     TEXT,
        date          TEXT NOT NULL,
        created_at    TEXT NOT NULL,
        level         TEXT NOT NULL,              -- regime | sector | theme
        subject       TEXT NOT NULL,              -- "market" | sector name | theme name
        subject_key   TEXT NOT NULL,              -- normalized "<level>:<slug>" (supersede key)
        stance        TEXT NOT NULL,              -- risk_on|neutral|risk_off|defensive | bullish|bearish|neutral
        conviction    REAL NOT NULL,
        horizon       TEXT NOT NULL,
        summary       TEXT NOT NULL DEFAULT '',
        thesis        TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'active', -- active | superseded | expired | archived
        supersedes_id TEXT,
        freshness_deadline TEXT,                   -- date past which an un-reaffirmed active thesis expires
        data_json     TEXT NOT NULL DEFAULT '{}', -- { tickers[], sources[{title,url,sourceId?}] }
        UNIQUE (id)
      );
      CREATE INDEX idx_thesis_date    ON ai_theses(date);
      CREATE INDEX idx_thesis_subject ON ai_theses(subject_key);
      CREATE INDEX idx_thesis_status  ON ai_theses(status);

      CREATE VIRTUAL TABLE ai_theses_fts USING fts5(thesis_id UNINDEXED, text);
    `,
  },
```

- [ ] **Step 2: Write the failing repo test** — create `src/db/repositories/aiTheses.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../index.ts";
import type { Thesis } from "../../domain/index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

const thesis = (over: Partial<Thesis>): Thesis => ({
  id: over.id ?? "t1", runId: "r1", reportId: "rep1", date: "2026-06-02", createdAt: NOW,
  level: "sector", subject: "Semiconductors", subjectKey: "sector:semiconductors",
  stance: "bullish", conviction: 0.7, horizon: "3mo", summary: "Semis bullish",
  thesis: "Data-center capex is durable.", status: "active", supersedesId: null,
  freshnessDeadline: null, tickers: ["NVDA"], sources: [{ title: "x", url: "https://x.com" }], ...over,
});

describe("aiTheses repo", () => {
  test("insert persists a row and indexes its prose for FTS search", () => {
    repos.aiTheses.insert(thesis({ id: "t1", thesis: "Data-center capex is durable and broad." }));
    expect(repos.aiTheses.get("t1")?.subject).toBe("Semiconductors");
    expect(repos.aiTheses.search("capex").map((t) => t.id)).toContain("t1");
  });

  test("supersedePriorActive flips the prior active thesis for a subject_key to superseded", () => {
    repos.aiTheses.insert(thesis({ id: "t1" }));
    const superseded = repos.aiTheses.supersedePriorActive("sector:semiconductors", NOW);
    expect(superseded).toEqual(["t1"]);
    expect(repos.aiTheses.get("t1")?.status).toBe("superseded");
  });

  test("currentByLevel returns only active theses of a level", () => {
    repos.aiTheses.insert(thesis({ id: "t1", level: "sector", subjectKey: "sector:semis" }));
    repos.aiTheses.insert(thesis({ id: "t2", level: "regime", subject: "market", subjectKey: "regime:market", stance: "risk_on" }));
    expect(repos.aiTheses.currentByLevel("regime").map((t) => t.id)).toEqual(["t2"]);
  });

  test("listDays + listDay group by day; historyForSubject returns the supersede chain newest-first", () => {
    repos.aiTheses.insert(thesis({ id: "t1", date: "2026-06-02" }));
    repos.aiTheses.supersedePriorActive("sector:semiconductors", NOW);
    repos.aiTheses.insert(thesis({ id: "t2", date: "2026-06-03", supersedesId: "t1" }));
    expect(repos.aiTheses.listDays().map((d) => d.date)).toEqual(["2026-06-03", "2026-06-02"]);
    expect(repos.aiTheses.listDay("2026-06-03").map((t) => t.id)).toEqual(["t2"]);
    expect(repos.aiTheses.historyForSubject("sector:semiconductors").map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  test("expireStale flips active theses past their freshness deadline to expired; fresh ones stay active", () => {
    repos.aiTheses.insert(thesis({ id: "stale", subjectKey: "sector:a", freshnessDeadline: "2026-06-01" }));
    repos.aiTheses.insert(thesis({ id: "fresh", subjectKey: "sector:b", freshnessDeadline: "2026-12-01" }));
    repos.aiTheses.insert(thesis({ id: "nodeadline", subjectKey: "sector:c", freshnessDeadline: null }));
    expect(repos.aiTheses.expireStale("2026-06-02")).toEqual(["stale"]);
    expect(repos.aiTheses.get("stale")?.status).toBe("expired");
    expect(repos.aiTheses.get("fresh")?.status).toBe("active");
    expect(repos.aiTheses.get("nodeadline")?.status).toBe("active"); // null deadline never auto-expires
    expect(repos.aiTheses.listActive().map((t) => t.id).sort()).toEqual(["fresh", "nodeadline"]);
  });
});
```

- [ ] **Step 3: Run — expect FAIL:** `bun test src/db/repositories/aiTheses.test.ts`

- [ ] **Step 4: Add the domain type** — create `src/domain/thesis.ts`:

```ts
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

/** Grace window (days) a dropped thesis lingers before expiring, by horizon. Re-affirmation resets it. */
export const THESIS_FRESHNESS_DAYS: Record<string, number> = { "1d": 2, "1w": 10, "1mo": 35, "3mo": 100, "6mo": 195, "1y": 380 };

/** Add `days` to a YYYY-MM-DD date, returning YYYY-MM-DD (UTC). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Normalize a (level, subject) into the stable supersede key "<level>:<slug>". */
export function thesisSubjectKey(level: string, subject: string): string {
  const slug = subject.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${level}:${slug}`;
}
```

Add to `src/domain/index.ts`: `export * from "./thesis.ts";`

- [ ] **Step 5: Implement the repo** — create `src/db/repositories/aiTheses.ts`:

```ts
import type { DB } from "../connection.ts";
import { Thesis } from "../../domain/index.ts";

type Row = {
  id: string; run_id: string | null; report_id: string | null; date: string; created_at: string;
  level: string; subject: string; subject_key: string; stance: string; conviction: number;
  horizon: string; summary: string; thesis: string; status: string; supersedes_id: string | null;
  freshness_deadline: string | null; data_json: string;
};

const toDomain = (r: Row): Thesis => {
  const data = JSON.parse(r.data_json) as { tickers?: string[]; sources?: { title: string; url: string; sourceId?: string }[] };
  return Thesis.parse({
    id: r.id, runId: r.run_id, reportId: r.report_id, date: r.date, createdAt: r.created_at,
    level: r.level, subject: r.subject, subjectKey: r.subject_key, stance: r.stance, conviction: r.conviction,
    horizon: r.horizon, summary: r.summary, thesis: r.thesis, status: r.status, supersedesId: r.supersedes_id,
    freshnessDeadline: r.freshness_deadline, tickers: data.tickers ?? [], sources: data.sources ?? [],
  });
};

export function aiThesesRepo(db: DB) {
  return {
    insert(t: Thesis): Thesis {
      const v = Thesis.parse(t);
      db.query(
        `INSERT INTO ai_theses
           (id, run_id, report_id, date, created_at, level, subject, subject_key, stance, conviction,
            horizon, summary, thesis, status, supersedes_id, freshness_deadline, data_json)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        v.id, v.runId, v.reportId, v.date, v.createdAt, v.level, v.subject, v.subjectKey, v.stance, v.conviction,
        v.horizon, v.summary, v.thesis, v.status, v.supersedesId, v.freshnessDeadline,
        JSON.stringify({ tickers: v.tickers, sources: v.sources }),
      );
      db.query("INSERT INTO ai_theses_fts (thesis_id, text) VALUES (?, ?)").run(v.id, `${v.summary} ${v.thesis}`);
      return v;
    },

    /** Expire active theses whose freshness deadline has passed (the AI stopped re-affirming the view).
     *  Returns the ids expired. Status flips active → expired; superseded/history rows are untouched. */
    expireStale(asOfDate: string): string[] {
      const ids = db
        .query<{ id: string }, [string]>(
          "SELECT id FROM ai_theses WHERE status = 'active' AND freshness_deadline IS NOT NULL AND freshness_deadline < ?",
        )
        .all(asOfDate)
        .map((r) => r.id);
      for (const id of ids) db.query("UPDATE ai_theses SET status = 'expired' WHERE id = ?").run(id);
      return ids;
    },

    /** Flip every currently-active thesis for a subject_key to 'superseded'. Returns the ids flipped. */
    supersedePriorActive(subjectKey: string, now: string): string[] {
      const ids = db
        .query<{ id: string }, [string]>("SELECT id FROM ai_theses WHERE subject_key = ? AND status = 'active'")
        .all(subjectKey)
        .map((r) => r.id);
      for (const id of ids) db.query("UPDATE ai_theses SET status = 'superseded' WHERE id = ?").run(id);
      void now; // status flip is timeless; kept for signature symmetry with other repos
      return ids;
    },

    get(id: string): Thesis | null {
      const row = db.query<Row, [string]>("SELECT * FROM ai_theses WHERE id = ?").get(id);
      return row ? toDomain(row) : null;
    },

    /** Active theses of a level (regime|sector|theme), newest first. */
    currentByLevel(level: string): Thesis[] {
      return db
        .query<Row, [string]>("SELECT * FROM ai_theses WHERE level = ? AND status = 'active' ORDER BY created_at DESC")
        .all(level)
        .map(toDomain);
    },

    /** All currently-active theses (the live outlook), newest first. */
    listActive(): Thesis[] {
      return db.query<Row, []>("SELECT * FROM ai_theses WHERE status = 'active' ORDER BY created_at DESC").all().map(toDomain);
    },

    listDays(): { date: string; count: number }[] {
      return db
        .query<{ date: string; count: number }, []>(
          "SELECT date, COUNT(*) AS count FROM ai_theses GROUP BY date ORDER BY date DESC",
        )
        .all();
    },

    listDay(date: string): Thesis[] {
      return db.query<Row, [string]>("SELECT * FROM ai_theses WHERE date = ? ORDER BY created_at DESC").all(date).map(toDomain);
    },

    /** The supersede chain for a subject (all statuses), newest first — "how this view evolved". */
    historyForSubject(subjectKey: string): Thesis[] {
      return db
        .query<Row, [string]>("SELECT * FROM ai_theses WHERE subject_key = ? ORDER BY created_at DESC")
        .all(subjectKey)
        .map(toDomain);
    },

    /** FTS over thesis prose; returns active theses ranked by relevance. */
    search(query: string, limit = 20): Thesis[] {
      if (!query.trim()) return [];
      return db
        .query<Row, [string, number]>(
          `SELECT t.* FROM ai_theses_fts f
             JOIN ai_theses t ON t.id = f.thesis_id
            WHERE ai_theses_fts MATCH ? AND t.status = 'active'
            ORDER BY bm25(ai_theses_fts) LIMIT ?`,
        )
        .all(query, limit)
        .map(toDomain);
    },
  };
}
export type AiThesesRepo = ReturnType<typeof aiThesesRepo>;
```

- [ ] **Step 6: Register the repo** in `src/db/index.ts` — import `aiThesesRepo` and add `aiTheses: aiThesesRepo(db),` to `repositories()`.

- [ ] **Step 7: Run — expect PASS:** `bun test src/db/repositories/aiTheses.test.ts`. Then `bun run db:migrate` (no error) + `bun test src/db`.
- [ ] **Step 8: Commit:**
```bash
git add src/db/schema.ts src/domain/thesis.ts src/domain/index.ts src/db/repositories/aiTheses.ts src/db/repositories/aiTheses.test.ts src/db/index.ts
git commit -m "feat(theses): ai_theses table + FTS + domain + repo (supersede/days/history/search)"
```

---

## Task 2: Outlook LLM contract — domain + genai schema + DailyReport

**Files:** Modify `src/domain/thesis.ts`, `src/domain/recommendation.ts`, `src/llm/schema.ts`; Test `src/domain/thesis.test.ts`.

- [ ] **Step 1: Write the failing test** — create `src/domain/thesis.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { Outlook } from "./thesis.ts";

describe("Outlook contract", () => {
  test("parses a full outlook", () => {
    const o = Outlook.parse({
      regime: { subject: "market", stance: "risk_on", conviction: 0.6, horizon: "1mo", summary: "Constructive", thesis: "Breadth improving." },
      sectors: [{ subject: "Semiconductors", stance: "bullish", conviction: 0.7, horizon: "3mo", summary: "", thesis: "Capex durable.", tickers: ["NVDA"] }],
      themes: [{ subject: "AI infra", stance: "bullish", conviction: 0.65, horizon: "6mo", summary: "", thesis: "Buildout broad." }],
    });
    expect(o.regime?.stance).toBe("risk_on");
    expect(o.sectors[0]!.tickers).toEqual(["NVDA"]);
  });

  test("caps sectors at 8 and themes at 6; tolerates a malformed item array", () => {
    const o = Outlook.parse({ regime: null, sectors: Array.from({ length: 12 }, (_, i) => ({ subject: `S${i}`, stance: "bullish", conviction: 0.5, horizon: "3mo", summary: "", thesis: "x" })), themes: [] });
    expect(o.sectors.length).toBe(8);
    const bad = Outlook.parse({ regime: null, sectors: "nonsense" as unknown as [], themes: [] });
    expect(bad.sectors).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `bun test src/domain/thesis.test.ts`

- [ ] **Step 3: Add `ThesisItem` + `Outlook` to `src/domain/thesis.ts`** (append):

```ts
import { Horizon } from "./recommendation.ts";
import { Source } from "./marketContext.ts";

/** One model-authored outlook item (regime/sector/theme). Stance is validated per-level at persist time. */
export const ThesisItem = z.object({
  subject: z.string().min(1),
  stance: z.string().min(1),
  conviction: z.number().min(0).max(1).catch(0.5),
  horizon: Horizon.catch("3mo"),
  summary: z.string().default(""),
  thesis: z.string().min(1),
  tickers: z.array(z.string()).default([]),
  sources: z.array(Source).default([]),
});
export type ThesisItem = z.infer<typeof ThesisItem>;

/** The full cross-cutting outlook the analyzer authors each run. Caps keep the library dense. */
export const Outlook = z.object({
  regime: ThesisItem.nullable().default(null).catch(null),
  sectors: z.array(ThesisItem).catch([]).transform((xs) => xs.slice(0, 8)),
  themes: z.array(ThesisItem).catch([]).transform((xs) => xs.slice(0, 6)),
});
export type Outlook = z.infer<typeof Outlook>;
```

(Verify `Horizon` is exported from `recommendation.ts` — it is (`export const Horizon = z.enum([...])`). `Source` is exported from `marketContext.ts`.)

- [ ] **Step 4: Add `outlook` to `DailyReport`** in `src/domain/recommendation.ts`. Add an import at the top: `import { Outlook } from "./thesis.ts";` — BUT that risks a circular import (`thesis.ts` imports `Horizon`/`Source` from recommendation/marketContext). To avoid the cycle, declare the field with a lazy/duck type: in `DailyReport`, add:
```ts
  /** Cross-cutting AI outlook (regime + sector/theme leans). Null until the LLM synth step builds it. */
  outlook: z.lazy(() => OutlookRef).nullable().default(null),
```
and at the top of `recommendation.ts` add `import { Outlook as OutlookRef } from "./thesis.ts";`. If the circular import causes a runtime issue (undefined at module init), instead move `Horizon` and `Source` into a tiny shared module they both import, OR define `Outlook` inline in `recommendation.ts` and have `thesis.ts` re-export it. **Recommended:** define `ThesisItem`/`Outlook` in `recommendation.ts` (which already owns `Horizon`) and re-export them from `thesis.ts` (`export { ThesisItem, Outlook } from "./recommendation.ts";`). Pick the no-cycle option and note which you chose.

- [ ] **Step 5: Add the genai schema** — in `src/llm/schema.ts`, add and export `outlookFunctionDeclaration`:

```ts
const thesisItemSchema = {
  type: Type.OBJECT,
  properties: {
    subject: { type: Type.STRING },
    stance: { type: Type.STRING },
    conviction: { type: Type.NUMBER, description: "0..1" },
    horizon: { type: Type.STRING, enum: ["1d", "1w", "1mo", "3mo", "6mo", "1y"] },
    summary: { type: Type.STRING, description: "one-line headline" },
    thesis: { type: Type.STRING, description: "dense reasoning, 1-3 sentences" },
    tickers: { type: Type.ARRAY, items: { type: Type.STRING } },
  },
  required: ["subject", "stance", "conviction", "horizon", "thesis"],
};

export const outlookFunctionDeclaration: FunctionDeclaration = {
  name: "submit_outlook",
  description: "Return the cross-cutting market outlook: regime + sector leans + named themes.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      regime: { ...thesisItemSchema, nullable: true, description: "subject='market'; stance risk_on|neutral|risk_off|defensive" },
      sectors: { type: Type.ARRAY, items: thesisItemSchema, description: "≤8 GICS sectors; stance bullish|bearish|neutral" },
      themes: { type: Type.ARRAY, items: thesisItemSchema, description: "≤6 named cross-cutting themes; stance bullish|bearish|neutral" },
    },
    required: ["sectors", "themes"],
  },
};
```

- [ ] **Step 6: Run — expect PASS:** `bun test src/domain` and `bun test src/llm` (no regressions).
- [ ] **Step 7: Commit:**
```bash
git add src/domain/thesis.ts src/domain/recommendation.ts src/llm/schema.ts src/domain/thesis.test.ts
git commit -m "feat(theses): Outlook LLM contract (domain + genai schema) on DailyReport"
```

---

## Task 3: `Analyzer.synthesizeOutlook` — interface + mock + gemini

**Files:** Modify `src/llm/analyze.ts`, `src/llm/gemini.ts`, `src/llm/prompts.ts`; Test `src/llm/llm.test.ts` (append).

- [ ] **Step 1: Write the failing test** — append to `src/llm/llm.test.ts` (it already constructs a mock analyzer `a` and a `ctx`; reuse them):

```ts
  test("synthesizeOutlook returns a schema-valid Outlook", async () => {
    const a = createMockAnalyzer();
    const ctx = await buildMarketContext(createFakeGateway({ startingCash: 100_000 }), a, "2026-06-02", createFakeMacro());
    const outlook = await a.synthesizeOutlook(ctx, []);
    expect(outlook.sectors.length).toBeGreaterThanOrEqual(1);
    expect(["risk_on", "neutral", "risk_off", "defensive"]).toContain(outlook.regime?.stance ?? "neutral");
  });
```
(Match the imports/helpers the file already uses — `createMockAnalyzer`, `buildMarketContext`, `createFakeGateway`, `createFakeMacro`. Read the top of `llm.test.ts` and reuse its existing setup; adapt the call if its mock/ctx are built differently.)

- [ ] **Step 2: Run — expect FAIL:** `bun test src/llm/llm.test.ts`

- [ ] **Step 3: Extend the `Analyzer` interface** in `src/llm/analyze.ts` (add after `discoverOpportunities`):

```ts
  /**
   * Cross-cutting outlook synthesis (Phase 3): given the market context and this run's recommendations,
   * author a regime call + sector leans + named themes. Never fatal — returns an empty outlook on failure.
   */
  synthesizeOutlook(ctx: MarketContext, recs: Recommendation[], sink?: StreamSink): Promise<Outlook>;
```
Add `Outlook` (and `Recommendation` if not already) to the imports from `../domain/index.ts`.

- [ ] **Step 4: Add the mock impl** in `createMockAnalyzer()` (after `discoverOpportunities`):

```ts
    async synthesizeOutlook(_ctx, _recs, sink): Promise<Outlook> {
      sink?.({ kind: "text", text: "synthesizing outlook…" });
      return {
        regime: { subject: "market", stance: "risk_on", conviction: 0.55, horizon: "1mo", summary: "mock constructive", thesis: "mock regime thesis", tickers: [], sources: [] },
        sectors: [{ subject: "Information Technology", stance: "bullish", conviction: 0.6, horizon: "3mo", summary: "mock", thesis: "mock sector thesis", tickers: ["NVDA"], sources: [] }],
        themes: [{ subject: "AI infrastructure", stance: "bullish", conviction: 0.6, horizon: "6mo", summary: "mock", thesis: "mock theme thesis", tickers: [], sources: [] }],
      };
    },
```

- [ ] **Step 5: Add the outlook prompts** in `src/llm/prompts.ts`:

```ts
export function buildOutlookResearchPrompt(date: string, macroSummary: string, recLines: string[]): string {
  return [
    `Today is ${date}. Synthesize a cross-cutting US-equity OUTLOOK for a trader.`,
    `Market context: ${macroSummary || "(none)"}.`,
    recLines.length ? `This run's calls:\n${recLines.join("\n")}` : `(no individual calls this run)`,
    `Use Google Search to ground a market-regime read, the most attractive/unattractive SECTORS, and 1-6 named cross-cutting THEMES. Cite sources.`,
  ].join("\n");
}

export function buildOutlookStructurePrompt(date: string, research: string): string {
  return [
    `From the research below, return the structured outlook for ${date} via submit_outlook.`,
    `regime.subject MUST be "market"; regime.stance one of risk_on|neutral|risk_off|defensive.`,
    `sectors: up to 8 GICS sectors; themes: up to 6; each with stance bullish|bearish|neutral, conviction 0..1, horizon, a one-line summary, a 1-3 sentence thesis, and any tickers.`,
    `Only include a sector/theme with a genuine lean — omit filler.`,
    ``,
    research,
  ].join("\n");
}
```

- [ ] **Step 6: Add the gemini impl** in `src/llm/gemini.ts` (mirror `discoverOpportunities`; import the new prompts + `outlookFunctionDeclaration` + `Outlook`):

```ts
    async synthesizeOutlook(ctx: MarketContext, recs: Recommendation[], sink?: StreamSink): Promise<Outlook> {
      try {
        sink?.({ kind: "stage", stage: "research" });
        const recLines = recs.slice(0, 40).map((r) => `  ${r.ticker}: ${r.action} (${r.prediction.direction}, conv ${r.conviction.toFixed(2)})`);
        const { text, sources } = await research(buildOutlookResearchPrompt(ctx.date, ctx.macroSummary, recLines), sink);
        sink?.({ kind: "stage", stage: "structure" });
        const args = await structure(buildOutlookStructurePrompt(ctx.date, text), { name: "submit_outlook" }, outlookFunctionDeclaration, sink);
        const parsed = Outlook.safeParse(args ?? {});
        if (!parsed.success) return { regime: null, sectors: [], themes: [] };
        // Attach the research sources to any item that didn't carry its own.
        const withSrc = (it: typeof parsed.data.sectors[number]) => ({ ...it, sources: it.sources.length ? it.sources : sources });
        return {
          regime: parsed.data.regime ? withSrc(parsed.data.regime) : null,
          sectors: parsed.data.sectors.map(withSrc),
          themes: parsed.data.themes.map(withSrc),
        };
      } catch (err) {
        console.warn(`[outlook] failed: ${err instanceof Error ? err.message : String(err)}`);
        return { regime: null, sectors: [], themes: [] };
      }
    },
```

- [ ] **Step 7: Run — expect PASS:** `bun test src/llm`
- [ ] **Step 8: Commit:**
```bash
git add src/llm/analyze.ts src/llm/gemini.ts src/llm/prompts.ts src/llm/llm.test.ts
git commit -m "feat(theses): Analyzer.synthesizeOutlook (mock + gemini research→structure)"
```

---

## Task 4: `buildOutlook` + attach to the report (llm + fake)

**Files:** Create `src/analysis/outlook.ts`, `src/analysis/outlook.test.ts`; Modify `src/pipeline/llmReport.ts`, `src/pipeline/fakeReport.ts`.

- [ ] **Step 1: Write the failing test** — create `src/analysis/outlook.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { buildOutlook } from "./outlook.ts";
import { createMockAnalyzer } from "../llm/analyze.ts";
import { MarketContext } from "../domain/index.ts";

const ctx = MarketContext.parse({ date: "2026-06-02", spyTrend: "up", spyPctFromSma200: 3, macroSummary: "ok", sources: [], macro: null });

describe("buildOutlook", () => {
  test("returns the analyzer's outlook", async () => {
    const o = await buildOutlook(createMockAnalyzer(), ctx, []);
    expect(o.sectors.length).toBeGreaterThanOrEqual(1);
  });

  test("degrades to an empty outlook if the analyzer throws", async () => {
    const broken = { ...createMockAnalyzer(), synthesizeOutlook: () => Promise.reject(new Error("boom")) } as ReturnType<typeof createMockAnalyzer>;
    const o = await buildOutlook(broken, ctx, []);
    expect(o).toEqual({ regime: null, sectors: [], themes: [] });
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `bun test src/analysis/outlook.test.ts`

- [ ] **Step 3: Implement** — create `src/analysis/outlook.ts`:

```ts
import type { Analyzer, StreamSink } from "../llm/analyze.ts";
import type { MarketContext, Outlook, Recommendation } from "../domain/index.ts";

/** Report-level outlook synthesis (mirrors buildMarketContext). Never fatal — empty outlook on failure. */
export async function buildOutlook(
  analyzer: Analyzer,
  ctx: MarketContext,
  recs: Recommendation[],
  sink?: StreamSink,
): Promise<Outlook> {
  return analyzer.synthesizeOutlook(ctx, recs, sink).catch(() => ({ regime: null, sectors: [], themes: [] }));
}
```

- [ ] **Step 4: Wire into `generateLlmReport`** (`src/pipeline/llmReport.ts`). After `const analyzed = results.filter(...)` and before building `report`, add:
```ts
  emit({ type: "phase", phase: "context", label: "Synthesizing outlook" });
  const outlook = await buildOutlook(analyzer, ctx, analyzed, contextSink);
```
and add `outlook` to the report literal:
```ts
  const report: DailyReport = { id: newId(), date, generatedAt: new Date().toISOString(), source: "llm", recommendations, marketContext: ctx, outlook };
```
Add `import { buildOutlook } from "../analysis/outlook.ts";`.

- [ ] **Step 5: Fake outlook** in `src/pipeline/fakeReport.ts` — add `outlook: null` to the returned `DailyReport` literal (the fake/offline path doesn't synthesize; `null` is valid and the curate step will no-op). (If you prefer a deterministic demo outlook for the fake path, return a small static `Outlook` instead — optional; `null` is simplest and matches `marketContext: null`.)

- [ ] **Step 6: Run — expect PASS:** `bun test src/analysis/outlook.test.ts` and `bun test src/pipeline` (no regressions).
- [ ] **Step 7: Commit:**
```bash
git add src/analysis/outlook.ts src/analysis/outlook.test.ts src/pipeline/llmReport.ts src/pipeline/fakeReport.ts
git commit -m "feat(theses): buildOutlook report-level synthesis attached to DailyReport"
```

---

## Task 5: `curateTheses` — persist + supersede + tag + cite + graph link; expiry; wire into dailyRun

**Files:** Modify `src/domain/graph.ts`, `src/domain/knowledge.ts`, `src/db/repositories/knowledge.ts`; Create `src/knowledge/curateTheses.ts`, `src/knowledge/curateTheses.test.ts`; Modify `src/pipeline/dailyRun.ts`.

- [ ] **Step 0a: Add `"thesis"` to `KgNodeType`** in `src/domain/graph.ts` (after `"tag"`).

- [ ] **Step 0b: Add `"citation"` to `SourceKind`** in `src/domain/knowledge.ts`:
```ts
export const SourceKind = z.enum(["upload", "url", "note", "fact", "citation"]);
```
(`citation` = an AI-origin reference behind a thesis: resolvable in the source dialog, but excluded from the personal library by the `kind IN ('note','url','upload')` allowlist, from AI facts by the `self_curated` filter, and from analysis retrieval by `use_in_analysis = 0`.)

- [ ] **Step 0c: Add `findOrCreateCitationSource` to the knowledge repo** (`src/db/repositories/knowledge.ts`), after `listCuratedFacts` (reuses the repo's own `insertSource`; `newId` is already imported in domain — import it here too if absent):
```ts
    /** Resolve a thesis citation URL to a stable knowledge_sources id (deduped by origin URL). Creates a
     *  lightweight `citation` source (no chunks; not analysis-injected) so thesis citations RESOLVE in the
     *  source dialog and graph, without polluting the personal library or the analysis retrieval set. */
    findOrCreateCitationSource(url: string, title: string, now: string): string {
      const existing = db
        .query<{ id: string }, [string]>("SELECT id FROM knowledge_sources WHERE kind = 'citation' AND origin = ? LIMIT 1")
        .get(url);
      if (existing) return existing.id;
      const id = newId();
      this.insertSource({
        id, kind: "citation", title: title?.trim() || url, trustClass: "public_url",
        scope: "global", scopeTicker: null, useInAnalysis: false, status: "active", origin: url,
        createdAt: now, updatedAt: now,
      });
      return id;
    },
```
Add a regression test (in `src/db/repositories/knowledge.test.ts`): a `citation` source is excluded from `listUserSources()` and from `listCuratedFacts()`, but `getSource(id)` returns it. And confirm `newId` is imported at the top of `knowledge.ts` (`import { newId } from "../../domain/index.ts";`) — add if missing.

- [ ] **Step 2: Write the failing test** — create `src/knowledge/curateTheses.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { persistOutlook } from "./curateTheses.ts";
import { nodeId, type Outlook } from "../domain/index.ts";

let app: App;
const NOW = "2026-06-02T00:00:00.000Z";
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ startingCash: 100_000 }), now: () => "2026-06-02", queryModel: null });
});

const outlook = (): Outlook => ({
  regime: { subject: "market", stance: "risk_on", conviction: 0.6, horizon: "1mo", summary: "Constructive", thesis: "Breadth improving.", tickers: [], sources: [] },
  sectors: [{ subject: "Semiconductors", stance: "bullish", conviction: 0.7, horizon: "3mo", summary: "Semis bullish", thesis: "Capex durable.", tickers: ["NVDA"], sources: [{ title: "x", url: "https://x.com" }] }],
  themes: [],
});

const report = { id: "rep1", outlook: outlook() };

describe("persistOutlook", () => {
  test("persists a thesis per item, tags it, and links a graph node", () => {
    const r = persistOutlook(app, report, "run1", NOW);
    expect(r.added).toBe(2); // regime + 1 sector
    const sector = app.repos.aiTheses.currentByLevel("sector")[0]!;
    expect(sector.subject).toBe("Semiconductors");
    // graph node + sector/direction tags present
    const node = nodeId("thesis", sector.id);
    const tags = app.repos.insightTags.tagsFor(node);
    expect(tags).toContainEqual({ dimension: "sector", value: "Semiconductors", source: "ai" });
    expect(tags).toContainEqual({ dimension: "direction", value: "bullish", source: "ai" });
    expect(tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
    // citation persisted as a resolvable knowledge_source (excluded from the personal library) + carried sourceId
    const srcId = sector.sources[0]!.sourceId!;
    expect(app.repos.knowledge.getSource(srcId)?.kind).toBe("citation");
    expect(app.repos.knowledge.listUserSources().some((s) => s.id === srcId)).toBe(false);
    expect(sector.freshnessDeadline).not.toBeNull(); // dropped views age out at their horizon grace
  });

  test("re-running supersedes the prior thesis for the same subject (one active per subject)", () => {
    persistOutlook(app, report, "run1", NOW);
    persistOutlook(app, { id: "rep2", outlook: outlook() }, "run2", "2026-06-03T00:00:00.000Z");
    const sectors = app.repos.aiTheses.currentByLevel("sector");
    expect(sectors.length).toBe(1); // prior superseded
    expect(app.repos.aiTheses.historyForSubject("sector:semiconductors").length).toBe(2);
  });

  test("a null outlook is a no-op", () => {
    expect(persistOutlook(app, { id: "rep3", outlook: null }, "run3", NOW).added).toBe(0);
  });
});
```

- [ ] **Step 3: Run — expect FAIL:** `bun test src/knowledge/curateTheses.test.ts`

- [ ] **Step 4: Implement** — create `src/knowledge/curateTheses.ts`:

```ts
import type { App } from "../app.ts";
import { newId, nodeId, edgeId, thesisSubjectKey, addDays, THESIS_FRESHNESS_DAYS, type Outlook, type ThesisItem } from "../domain/index.ts";

/** Regime stance → a coarse direction tag for filtering (risk_on→bullish, risk_off/defensive→bearish). */
function stanceDirection(stance: string): "bullish" | "bearish" | "neutral" {
  if (stance === "bullish" || stance === "risk_on") return "bullish";
  if (stance === "bearish" || stance === "risk_off" || stance === "defensive") return "bearish";
  return "neutral";
}

type OutlookReport = { id: string; outlook: Outlook | null };

/**
 * Persist a run's outlook as superseding theses: one ai_theses row per item (regime + sectors + themes),
 * the prior active thesis for each subject flipped to superseded, a thesis:<id> graph node, auto-tags
 * (sector/theme/direction/horizon + ticker mentions), and evidence/supersede edges. Mirrors curateFacts.
 */
export function persistOutlook(app: App, report: OutlookReport, runId: string | null, now: string): { added: number } {
  const o = report.outlook;
  if (!o) return { added: 0 };
  const date = now.slice(0, 10);
  let added = 0;

  const items: { level: "regime" | "sector" | "theme"; item: ThesisItem }[] = [
    ...(o.regime ? [{ level: "regime" as const, item: o.regime }] : []),
    ...o.sectors.map((item) => ({ level: "sector" as const, item })),
    ...o.themes.map((item) => ({ level: "theme" as const, item })),
  ];

  for (const { level, item } of items) {
    const subjectKey = thesisSubjectKey(level, item.subject);
    const prior = app.repos.aiTheses.supersedePriorActive(subjectKey, now);
    const id = newId();
    // Persist each citation URL as a resolvable knowledge_source (deduped) and carry its id on the thesis.
    const citedSources = item.sources.map((s) => ({
      title: s.title, url: s.url, sourceId: app.repos.knowledge.findOrCreateCitationSource(s.url, s.title, now),
    }));
    app.repos.aiTheses.insert({
      id, runId, reportId: report.id, date, createdAt: now,
      level, subject: item.subject, subjectKey, stance: item.stance, conviction: item.conviction,
      horizon: item.horizon, summary: item.summary, thesis: item.thesis, status: "active",
      supersedesId: prior[0] ?? null,
      // A held view is superseded+refreshed every run; a dropped view ages out at its horizon grace.
      freshnessDeadline: addDays(date, THESIS_FRESHNESS_DAYS[item.horizon] ?? 35),
      tickers: item.tickers, sources: citedSources,
    });

    // Graph: canonical thesis node carrying run provenance.
    const thesisNode = nodeId("thesis", id);
    app.repos.graph.upsertNode({
      id: thesisNode, type: "thesis", label: item.summary || item.subject, summary: item.thesis,
      data: { level, subject: item.subject, stance: item.stance, conviction: item.conviction, runId, reportId: report.id },
      status: "active", createdAt: now, updatedAt: now,
    });
    // Auto-tags: level dimension (sector/theme) + direction + horizon + ticker mentions.
    if (level === "sector") app.repos.insightTags.addTag(thesisNode, { dimension: "sector", value: item.subject, source: "ai" }, now);
    if (level === "theme") app.repos.insightTags.addTag(thesisNode, { dimension: "theme", value: item.subject, source: "ai" }, now);
    app.repos.insightTags.addTag(thesisNode, { dimension: "direction", value: stanceDirection(item.stance), source: "ai" }, now);
    app.repos.insightTags.addTag(thesisNode, { dimension: "horizon", value: item.horizon, source: "ai" }, now);
    for (const t of item.tickers) app.repos.insightTags.addTag(thesisNode, { dimension: "ticker", value: t, source: "ai" }, now);
    // Supersede edge to the prior thesis node (the chain, mirrored in the graph).
    if (prior[0]) {
      const priorNode = nodeId("thesis", prior[0]);
      app.repos.graph.upsertEdge({ id: edgeId(thesisNode, "supersedes", priorNode), srcId: thesisNode, dstId: priorNode, rel: "supersedes", weight: 1, data: {}, createdAt: now });
    }
    // Cites edges to the (resolvable) citation source nodes — thesis provenance in the graph.
    for (const s of citedSources) {
      const srcNode = nodeId("source", s.sourceId);
      app.repos.graph.upsertEdge({ id: edgeId(thesisNode, "cites", srcNode), srcId: thesisNode, dstId: srcNode, rel: "cites", weight: 1, data: {}, createdAt: now });
    }
    added++;
  }
  return { added };
}
```

- [ ] **Step 5: Wire into `dailyRun`** (`src/pipeline/dailyRun.ts`). Two insertions:

  **(a) Expire stale theses BEFORE `compileWiki`** (so the briefing OUTLOOK + Market View "current" only show still-justified views). Add immediately after the Step 2b.5 tracking block and before the Step 2c `compileWiki` block:
```ts
    // Step 2b.6 — expire theses the model has stopped re-affirming (past their freshness deadline), so
    // the wiki outlook reflects only currently-held views. Idempotent + date-only; degrades gracefully.
    try {
      const expired = app.repos.aiTheses.expireStale(date);
      if (expired.length > 0) console.log(`[theses] expired=${expired.length}`);
    } catch (err) {
      console.warn(`[theses] expiry failed: ${err instanceof Error ? err.message : String(err)}`);
    }
```
(`date` is already `app.now()` in scope.)

  **(b) Persist this run's outlook AFTER the Step 4b curate block** (step 4c):
```ts
    // Step 4c — persist the run's outlook as superseding, tagged, cited, graph-linked theses. Graceful.
    try {
      const theses = persistOutlook(app, report, runId, new Date().toISOString());
      if (theses.added > 0) console.log(`[theses] added=${theses.added}`);
    } catch (err) {
      console.warn(`[theses] step failed: ${err instanceof Error ? err.message : String(err)}`);
    }
```
Add `import { persistOutlook } from "../knowledge/curateTheses.ts";`. (`report` is in scope from Step 3 of the run.) Ordering note: expiry (2b.6) runs before the briefing (2c); the freshly-persisted outlook (4c) is read by the NEXT run's briefing — same carry-forward model as the rest of the pipeline.

- [ ] **Step 6: Run — expect PASS:** `bun test src/knowledge/curateTheses.test.ts` and `bun test src/pipeline src/knowledge`.
- [ ] **Step 7: Commit:**
```bash
git add src/domain/graph.ts src/domain/knowledge.ts src/db/repositories/knowledge.ts src/db/repositories/knowledge.test.ts src/knowledge/curateTheses.ts src/knowledge/curateTheses.test.ts src/pipeline/dailyRun.ts
git commit -m "feat(theses): persistOutlook — supersede + tag + cite (resolvable sources) + graph-link; expiry; wire into dailyRun"
```

---

## Task 6: `serializeThesis` + theses in the AI Library

**Files:** Modify `src/knowledge/serialize.ts`, `src/server/routes/aiKnowledge.ts`; Test `src/knowledge/serialize.test.ts` (append), `src/server/aiKnowledge.test.ts` (append).

- [ ] **Step 1: Write the failing serializer test** — append to `src/knowledge/serialize.test.ts`:

```ts
import { serializeThesis } from "./serialize.ts";
import type { Thesis } from "../domain/index.ts";

test("serializeThesis → AiInsight (thesis variant)", () => {
  const t: Thesis = {
    id: "t1", runId: "r1", reportId: "rep1", date: "2026-06-02", createdAt: "2026-06-02T00:00:00.000Z",
    level: "sector", subject: "Semiconductors", subjectKey: "sector:semiconductors", stance: "bullish",
    conviction: 0.7, horizon: "3mo", summary: "Semis bullish", thesis: "Capex durable.", status: "active",
    supersedesId: null, tickers: ["NVDA"], sources: [{ title: "x", url: "https://x.com" }],
  };
  const i = serializeThesis(t);
  expect(i.kind).toBe("thesis");
  expect(i.level).toBe("sector");
  expect(i.subject).toBe("Semiconductors");
  expect(i.headline).toBe("Semis bullish");
  expect(i.body).toBe("Capex durable.");
  expect(i.stance).toBe("bullish");
  expect(i.conviction).toBe(0.7);
  expect(i.tickers).toEqual(["NVDA"]);
  expect(i.sources).toEqual([{ title: "x", url: "https://x.com" }]);
});
```

- [ ] **Step 2: Run — expect FAIL:** `bun test src/knowledge/serialize.test.ts`

- [ ] **Step 3a: Extend the `AiInsight` type** in `src/knowledge/serialize.ts` (Phase 1 type) so thesis citations resolve and expired theses serialize:
  - `sources` entries gain an optional `sourceId`: change `sources: { title: string; url: string }[];` → `sources: { title: string; url: string; sourceId?: string }[];`
  - `status` gains `"expired"`: change `status: "active" | "superseded" | "archived";` → `status: "active" | "superseded" | "expired" | "archived";`
  (Backward-compatible: `serializeFact` simply omits `sourceId` and its `cite()` keeps using the fact's own id.)

- [ ] **Step 3b: Implement `serializeThesis`** in `src/knowledge/serialize.ts`:

```ts
import type { Thesis } from "../domain/index.ts";

/** Serialize a persisted Thesis to the canonical AiInsight (thesis variant). Pure — no DB. Citations
 *  carry their resolved knowledge_sources id so the source dialog opens them. */
export function serializeThesis(t: Thesis): AiInsight {
  return {
    id: t.id,
    kind: "thesis",
    level: t.level,
    date: t.date,
    createdAt: t.createdAt,
    subject: t.subject,
    headline: t.summary || t.subject,
    body: t.thesis,
    stance: t.stance,
    conviction: t.conviction,
    horizon: t.horizon,
    significance: null,
    tags: [
      ...(t.level === "sector" ? [{ dimension: "sector", value: t.subject, source: "ai" as const }] : []),
      ...(t.level === "theme" ? [{ dimension: "theme", value: t.subject, source: "ai" as const }] : []),
      { dimension: "direction", value: t.stance, source: "ai" as const },
      { dimension: "horizon", value: t.horizon, source: "ai" as const },
      ...t.tickers.map((v) => ({ dimension: "ticker", value: v, source: "ai" as const })),
    ],
    tickers: t.tickers,
    sources: t.sources,
    status: t.status,
    provenance: { runId: t.runId, reportId: t.reportId },
  };
}
```
(The `InsightTag` `dimension` field is typed `string` in `AiInsight.tags` — confirm; if it's the `TagDimension` union, the literal strings above satisfy it. `serializeThesis` derives tags from the thesis fields rather than re-reading the graph, so it stays pure and DB-free.)

- [ ] **Step 4: Include theses in the AI Library routes** (`src/server/routes/aiKnowledge.ts`). Change `allFacts()` to an `allInsights()` that merges facts + active theses:
```ts
  const allInsights = () => [
    ...app.repos.knowledge.listCuratedFacts().map((f) => serializeFact(app, f)),
    ...app.repos.aiTheses.listActive().map(serializeThesis),
  ];
```
Use `allInsights()` in `/ai-library/day/:date` and `/ai-library/search` (replace `allFacts()`); and in `/ai-library/days`, count theses per day too:
```ts
  r.get("/ai-library/days", (c) => {
    const counts = new Map<string, { factCount: number; thesisCount: number }>();
    const bump = (date: string, key: "factCount" | "thesisCount") => {
      const e = counts.get(date) ?? { factCount: 0, thesisCount: 0 };
      e[key]++; counts.set(date, e);
    };
    for (const f of app.repos.knowledge.listCuratedFacts()) bump(f.createdAt.slice(0, 10), "factCount");
    for (const t of app.repos.aiTheses.listActive()) bump(t.date, "thesisCount");
    return c.json({ days: [...counts.entries()].map(([date, c2]) => ({ date, ...c2 })) });
  });
```
Add `import { serializeThesis } from "../../knowledge/serialize.ts";` (alongside the existing `serializeFact` import). Note the DELETE/tag-edit routes are still keyed to `kind === "fact"` (theses archive is Phase-3-out-of-scope; leave the `:kind` guard returning 400 for non-fact, which is correct).

- [ ] **Step 5: Add the route test** — append to `src/server/aiKnowledge.test.ts` a test that seeds a thesis (via `app.repos.aiTheses.insert(...)`) and asserts it appears in `/ai-library/day/:date` and `/ai-library/search?q=...&dimension=sector&value=...`. (Model the thesis object on the Task 1 test's `thesis()` factory.)

- [ ] **Step 6: Run — expect PASS:** `bun test src/knowledge/serialize.test.ts src/server/aiKnowledge.test.ts`
- [ ] **Step 7: Commit:**
```bash
git add src/knowledge/serialize.ts src/server/routes/aiKnowledge.ts src/knowledge/serialize.test.ts src/server/aiKnowledge.test.ts
git commit -m "feat(theses): serializeThesis + theses surfaced in the AI Library"
```

---

## Task 7: OUTLOOK section in the wiki briefing

**Files:** Create `src/wiki/outlookBrief.ts` (+ `.test.ts`); Modify `src/wiki/index.ts`.

- [ ] **Step 1: Write the failing test** — create `src/wiki/outlookBrief.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { renderOutlook } from "./outlookBrief.ts";
import type { Thesis } from "../domain/index.ts";

const t = (over: Partial<Thesis>): Thesis => ({
  id: "x", runId: null, reportId: null, date: "2026-06-02", createdAt: "2026-06-02T00:00:00.000Z",
  level: "sector", subject: "Semis", subjectKey: "sector:semis", stance: "bullish", conviction: 0.7,
  horizon: "3mo", summary: "", thesis: "t", status: "active", supersedesId: null, tickers: [], sources: [], ...over,
});

describe("renderOutlook", () => {
  test("renders regime + sector/theme leans", () => {
    const text = renderOutlook([
      t({ level: "regime", subject: "market", stance: "risk_on" }),
      t({ level: "sector", subject: "Semiconductors", stance: "bullish", conviction: 0.7 }),
      t({ level: "theme", subject: "AI infra", stance: "bullish", conviction: 0.6 }),
    ]);
    expect(text).toContain("OUTLOOK");
    expect(text).toContain("Regime: risk_on");
    expect(text).toContain("Semiconductors");
  });

  test("empty → empty string", () => {
    expect(renderOutlook([])).toBe("");
  });
});
```

- [ ] **Step 2: Run — expect FAIL:** `bun test src/wiki/outlookBrief.test.ts`

- [ ] **Step 3: Implement** — create `src/wiki/outlookBrief.ts`:

```ts
import type { Thesis } from "../domain/index.ts";

/** Compile the current active outlook into a compact briefing block (the AI's own standing view). */
export function renderOutlook(active: Thesis[]): string {
  if (active.length === 0) return "";
  const regime = active.find((t) => t.level === "regime");
  const sectors = active.filter((t) => t.level === "sector");
  const themes = active.filter((t) => t.level === "theme");
  const lean = (t: Thesis) => `${t.subject} ${t.stance} ${t.conviction.toFixed(2)} (${t.horizon})`;
  return [
    `OUTLOOK (the system's current standing view — trusted, self-authored).`,
    regime ? `Regime: ${regime.stance} ${regime.conviction.toFixed(2)} — ${regime.summary || regime.thesis}` : null,
    sectors.length ? `Sectors: ${sectors.map(lean).join("; ")}` : null,
    themes.length ? `Themes: ${themes.map(lean).join("; ")}` : null,
  ].filter(Boolean).join("\n");
}
```

- [ ] **Step 4: Append to the briefing in `compileWiki`** (`src/wiki/index.ts`). Add `import { renderOutlook } from "./outlookBrief.ts";`. Where `fullBody` is assembled (currently `[body, openSection, inFlight]`), add the outlook:
```ts
    const outlook = renderOutlook(app.repos.aiTheses.listActive());
    const fullBody = [body, openSection, inFlight, outlook].filter(Boolean).join("\n\n");
```

- [ ] **Step 5: Run — expect PASS:** `bun test src/wiki`
- [ ] **Step 6: Commit:**
```bash
git add src/wiki/outlookBrief.ts src/wiki/outlookBrief.test.ts src/wiki/index.ts
git commit -m "feat(theses): inject the current outlook into the wiki briefing"
```

---

## Task 8: Market View API + query tools

**Files:** Create `src/server/routes/marketView.ts`, `src/server/marketView.test.ts`; Modify `src/server/app.ts`, `src/query/tools.ts`, `src/query/tools.test.ts`.

- [ ] **Step 1: Write the failing route test** — create `src/server/marketView.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";

const DATE = "2026-06-02";
let app: App;
let server: ReturnType<typeof createServer>;
const seed = (over: Record<string, unknown> = {}) =>
  app.repos.aiTheses.insert({
    id: "t1", runId: "r1", reportId: "rep1", date: DATE, createdAt: `${DATE}T00:00:00.000Z`,
    level: "sector", subject: "Semiconductors", subjectKey: "sector:semiconductors", stance: "bullish",
    conviction: 0.7, horizon: "3mo", summary: "Semis bullish", thesis: "Capex durable.", status: "active",
    supersedesId: null, tickers: ["NVDA"], sources: [], ...over,
  } as Parameters<typeof app.repos.aiTheses.insert>[0]);

beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE });
  server = createServer(app);
});
const req = (path: string) => server.fetch(new Request(`http://test/api${path}`));

describe("market view API", () => {
  test("GET /market-view/current returns regime + sectors + themes", async () => {
    seed({ id: "r", level: "regime", subject: "market", subjectKey: "regime:market", stance: "risk_on" });
    seed({ id: "s" });
    const body = (await (await req("/market-view/current")).json()) as { regime: unknown; sectors: { subject: string }[]; themes: unknown[] };
    expect(body.regime).not.toBeNull();
    expect(body.sectors[0]!.subject).toBe("Semiconductors");
  });

  test("GET /market-view/subject/:level/:subject returns the supersede history", async () => {
    seed({ id: "s1" });
    app.repos.aiTheses.supersedePriorActive("sector:semiconductors", `${DATE}T01:00:00.000Z`);
    seed({ id: "s2", supersedesId: "s1" });
    const body = (await (await req("/market-view/subject/sector/Semiconductors")).json()) as { history: { id: string }[] };
    expect(body.history.map((h) => h.id)).toEqual(["s2", "s1"]);
  });
});
```

- [ ] **Step 2: Run — expect FAIL (404):** `bun test src/server/marketView.test.ts`

- [ ] **Step 3: Implement** — create `src/server/routes/marketView.ts`:

```ts
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
```

- [ ] **Step 4: Mount it** in `src/server/app.ts`: add `import { marketViewRoutes } from "./routes/marketView.ts";` and `api.route("/market-view", marketViewRoutes(app));` (near the other `api.route` lines).

- [ ] **Step 5: Run — expect PASS:** `bun test src/server/marketView.test.ts` and `bun test src/server/server.test.ts`.

- [ ] **Step 6: Add query tools** — append the failing test to `src/query/tools.test.ts` (seed a thesis + assert `market_view` returns it and `sector_outlook({sector})` returns the subject history; assert `search_ai_insights` now also returns a matching thesis). Then implement in `src/query/tools.ts`, before the closing `];`:

```ts
  {
    name: "market_view",
    description: "The AI's CURRENT outlook: market regime + sector leans + named themes (stored, self-authored — grounded, not recall).",
    parameters: obj(),
    run(app) {
      const active = app.repos.aiTheses.listActive();
      const slim = (t: (typeof active)[number]) => ({ subject: t.subject, stance: t.stance, conviction: t.conviction, horizon: t.horizon, summary: t.summary || t.thesis });
      return {
        regime: active.filter((t) => t.level === "regime").map(slim)[0] ?? null,
        sectors: active.filter((t) => t.level === "sector").map(slim),
        themes: active.filter((t) => t.level === "theme").map(slim),
      };
    },
  },
  {
    name: "sector_outlook",
    description: "The AI's outlook for a specific sector, including how the view has evolved (supersede history).",
    parameters: obj({ sector: S }, ["sector"]),
    run(app, args) {
      const sector = str(args.sector);
      if (!sector) return { history: [] };
      const key = `sector:${sector.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`;
      return { history: cap(app.repos.aiTheses.historyForSubject(key), 10).map((t) => ({ date: t.date, stance: t.stance, conviction: t.conviction, status: t.status, thesis: t.thesis })) };
    },
  },
```
And extend `search_ai_insights.run` to also include theses: append `app.repos.aiTheses.listActive().map(serializeThesis)` to the `insights` array before the q/tag filters (keeps text + tag filtering uniform across facts and theses). Add `import { serializeThesis } from "../knowledge/serialize.ts";`.

Also update `search_ai_insights`'s `cite()` so thesis citations resolve: change `sourceId: i.id` to `sourceId: i.sources[0]!.sourceId ?? i.id`. (For a fact, `sources[0].sourceId` is undefined → falls back to the fact's own source id; for a thesis, it's the resolvable `citation` knowledge_source id created in Task 5.) Add a test asserting a thesis result's citation `sourceId` is the citation source id (resolvable via `/knowledge/sources/:id`), not the thesis id.

- [ ] **Step 7: Run — expect PASS:** `bun test src/query/tools.test.ts`
- [ ] **Step 8: Commit:**
```bash
git add src/server/routes/marketView.ts src/server/app.ts src/server/marketView.test.ts src/query/tools.ts src/query/tools.test.ts
git commit -m "feat(theses): market-view API + market_view/sector_outlook tools; search includes theses"
```

---

## Task 9: Market View frontend section

**Files:** Modify `web/src/api/client.ts`, `web/src/api/hooks.ts`, `web/src/App.tsx`; Create `web/src/components/MarketView.tsx`.

- [ ] **Step 1: Add types + client methods** in `web/src/api/client.ts`. `AiInsight` is already exported (Phase 1). Add:
```ts
export type MarketView = { regime: AiInsight | null; sectors: AiInsight[]; themes: AiInsight[] };
export type MarketViewDay = { date: string; count: number };
```
and methods (near `wikiInFlight`):
```ts
  marketViewCurrent: () => api<MarketView>("/market-view/current"),
  marketViewDays: () => api<{ days: MarketViewDay[] }>("/market-view/days"),
  marketViewDay: (date: string) => api<{ theses: AiInsight[] }>(`/market-view/day/${date}`),
  marketViewSubject: (level: string, subject: string) => api<{ history: AiInsight[] }>(`/market-view/subject/${level}/${encodeURIComponent(subject)}`),
```

- [ ] **Step 2: Add hooks** in `web/src/api/hooks.ts`:
```ts
const marketViewKey = ["marketView"] as const;
export const useMarketViewCurrent = () => useQuery({ queryKey: [...marketViewKey, "current"], queryFn: client.marketViewCurrent });
export const useMarketViewSubject = (level: string | null, subject: string | null) =>
  useQuery({ queryKey: [...marketViewKey, "subject", level, subject], queryFn: () => client.marketViewSubject(level!, subject!), enabled: !!(level && subject) });
```

- [ ] **Step 3: Create `web/src/components/MarketView.tsx`:**

```tsx
import { useState } from "react";
import { ChevronDown } from "lucide-react";
import type { AiInsight } from "../api/client.ts";
import { useMarketViewCurrent, useMarketViewSubject } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

const stanceTone = (s: string | null): "pos" | "neg" | "neutral" =>
  s === "bullish" || s === "risk_on" ? "pos" : s === "bearish" || s === "risk_off" || s === "defensive" ? "neg" : "neutral";

/** The AI's current market outlook: regime banner + sector leans + named themes, each with its evolution. */
export function MarketView() {
  const mv = useMarketViewCurrent();
  if (mv.isLoading) return <Skeleton className="h-40 w-full" />;
  const regime = mv.data?.regime ?? null;
  const sectors = mv.data?.sectors ?? [];
  const themes = mv.data?.themes ?? [];
  if (!regime && sectors.length === 0 && themes.length === 0) {
    return (
      <div className="card p-6">
        <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">
          No outlook yet — the next analysis run will author the AI's market regime, sector leans, and themes here.
        </p>
      </div>
    );
  }
  return (
    <div className="card p-6">
      {regime && (
        <article className="glass mb-4 p-4">
          <div className="mb-1 flex items-center gap-2">
            <span className="eyebrow">Market regime</span>
            <Badge tone={stanceTone(regime.stance)} dot>{regime.stance}</Badge>
            {regime.conviction != null && <span className="text-[11px] text-text-muted">conviction {regime.conviction.toFixed(2)} · {regime.horizon}</span>}
          </div>
          <p className="text-[13px] leading-relaxed text-text-secondary">{regime.body || regime.headline}</p>
        </article>
      )}
      {sectors.length > 0 && <Group title="Sector leans" items={sectors} />}
      {themes.length > 0 && <Group title="Themes" items={themes} />}
    </div>
  );
}

function Group({ title, items }: { title: string; items: AiInsight[] }) {
  return (
    <div className="mb-4">
      <p className="mb-2 text-[11px] uppercase tracking-wide text-text-muted">{title}</p>
      <div className="divide-y divide-hairline">
        {items.map((i) => <Lean key={i.id} insight={i} />)}
      </div>
    </div>
  );
}

function Lean({ insight }: { insight: AiInsight }) {
  const [open, setOpen] = useState(false);
  const history = useMarketViewSubject(open ? insight.level : null, open ? insight.subject : null);
  return (
    <div className="py-2">
      <button onClick={() => setOpen((v) => !v)} className="flex w-full items-center gap-3 text-left">
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        <span className="font-medium text-text">{insight.subject}</span>
        <Badge tone={stanceTone(insight.stance)}>{insight.stance}</Badge>
        {insight.conviction != null && <span className="text-[11px] text-text-muted">{insight.conviction.toFixed(2)} · {insight.horizon}</span>}
        {insight.tickers.length > 0 && <span className="ml-auto text-[10px] text-text-muted">{insight.tickers.join(" · ")}</span>}
      </button>
      {open && (
        <div className="border-l border-hairline pl-3 pt-2">
          <p className="text-[13px] leading-snug text-text-secondary">{insight.body}</p>
          {(history.data?.history ?? []).length > 1 && (
            <div className="mt-2 space-y-1">
              <p className="text-[10px] uppercase tracking-wide text-text-muted">How this view evolved</p>
              {(history.data?.history ?? []).map((h) => (
                <div key={h.id} className="flex items-center gap-2 text-[11px] text-text-muted">
                  <span>{h.date}</span><Badge tone={stanceTone(h.stance)}>{h.stance}</Badge>
                  <span>{h.conviction?.toFixed(2)}</span>
                  {h.status !== "active" && <span className="opacity-60">({h.status})</span>}
                </div>
              ))}
            </div>
          )}
          {insight.sources.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-x-3">
              {insight.sources.slice(0, 5).map((s) => (
                <a key={s.url} href={s.url} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">{s.title}</a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Add the section** in `web/src/App.tsx`. Import `MarketView`, and add a new `<Section title="Market view" index={4}>` AFTER "Daily recommendations" (index 3), bumping the subsequent sections' `index` props by 1 (AI trading→5, Journal→6, Knowledge→7, AI knowledge→8, Wiki→9, Ask→10). (Section `index` only drives the stagger animation delay — duplicates render fine, but bumping keeps the stagger monotonic.)

- [ ] **Step 5: Typecheck + build:** `bunx tsc --noEmit 2>&1 | grep "web/src"` (expect zero) and `bun run build:web` (expect success).
- [ ] **Step 6: Commit:**
```bash
git add web/src/api/client.ts web/src/api/hooks.ts web/src/components/MarketView.tsx web/src/App.tsx
git commit -m "feat(web): Market View section (regime, sector leans, themes, evolution)"
```

---

## Task 10: Full-suite verification + docs

- [ ] **Step 1:** `bun test` — expect all PASS. Investigate any failure (watch `pipeline.test.ts`, `llm`, `wiki`, `server.test.ts`).
- [ ] **Step 2:** `bun run build:web` — expect success.
- [ ] **Step 3:** Update `docs/architecture-and-roadmap.md`: mark Phase 3 done; document `ai_theses` + FTS (+ `freshness_deadline`/`expired`), `synthesizeOutlook`/`buildOutlook` (report-level, attached to DailyReport), `persistOutlook` (supersede + tag + **cite to resolvable `citation` knowledge_sources** + graph-link, dailyRun step 4c), **thesis expiry** (`expireStale`, step 2b.6, horizon-based freshness), the OUTLOOK briefing section, `/market-view/*` + `market_view`/`sector_outlook` tools + theses in `/ai-library`/`search_ai_insights`, and the `MarketView.tsx` section. Note the AI Knowledge Platform is now fully shipped (Phases 1–3).
- [ ] **Step 4: Commit:**
```bash
git add docs/architecture-and-roadmap.md
git commit -m "docs: record Phase 3 theses + Market View"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 3 of the spec):**
- §3.1 `019_ai_theses` table + FTS + supersede-by-subject → Task 1. ✓
- §3.2 LLM `Outlook` contract (model-authored, caps 8/6, stance vocab) → Tasks 2, 3. ✓
- §3.3 `curateTheses` persist + FTS + thesis node + auto-tag + supersede + briefing integration → Tasks 5, 7. ✓ (graph-linked like lessons; carry-forward = the OUTLOOK briefing block read from active theses.) **Refinements:** citations persisted as resolvable `citation` knowledge_sources + `cites` edges (Task 5/6/8); horizon-based freshness + `expireStale` so un-reaffirmed theses expire (Tasks 1/5).
- §3.4 serializer + `/market-view/*` + `market_view`/`sector_outlook` + theses in `search_ai_insights` + `MarketView.tsx` → Tasks 6, 8, 9. ✓

**Type consistency:** `Thesis` fields identical across `src/domain/thesis.ts`, the repo `toDomain` (Task 1), `persistOutlook` (Task 5), `serializeThesis` (Task 6), and the route/tool/test seeds (Tasks 6/8). `Outlook`/`ThesisItem` identical across domain (Task 2), the analyzer + mock (Task 3), `buildOutlook` (Task 4), and `persistOutlook` (Task 5). `serializeThesis` emits the same `AiInsight` shape `serializeFact` does (Phase 1). Stance vocab + caps consistent (regime risk_*; sector/theme Direction; ≤8/≤6).

**Placeholder scan:** none — every code step has complete code.

**Decisions (all five originally-flagged items now resolved in-plan):**
1. **Circular import — RESOLVED (finalized):** define `ThesisItem`/`Outlook` in `recommendation.ts` (which owns `Horizon`) and re-export from `thesis.ts`. No cycle. (Task 2 spells out the no-cycle option; implementer confirms module init.)
2. **`serializeThesis` derives tags from thesis fields** (pure/DB-free; authoritative from the row). Human tag-edits on theses remain out of scope (the `:kind` tag-edit route still 400s for non-fact). Unchanged — acceptable.
3. **Fake/offline path emits `outlook: null`** (no synthesis) — curate no-ops; offline runs accrue no theses. Matches `marketContext: null`. Unchanged — acceptable.
4. **Thesis citations — RESOLVED:** each citation URL is persisted as a resolvable `kind:"citation"` `knowledge_sources` row (deduped by URL; `use_in_analysis:0`; excluded from the personal library + AI facts + analysis retrieval), linked `thesis —cites→ source`, with its id carried on the thesis (`sources[].sourceId`). `serializeThesis` emits it and `search_ai_insights.cite()` uses `sources[0].sourceId ?? id`, so thesis citations open the source dialog like fact citations. (Tasks 5, 6, 8.)
5. **Thesis expiry — RESOLVED:** each thesis gets a horizon-derived `freshness_deadline`; re-affirming a subject supersedes + refreshes it, so a held view never expires, but a view the model stops affirming ages out at its horizon and `expireStale` (dailyRun step 2b.6, before the briefing) flips it to `expired` — dropping it from the briefing OUTLOOK, Market View "current", and AI-Library active list while preserving its supersede history. (Tasks 1, 5.)
