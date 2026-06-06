# AI Knowledge Platform — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review
**Approach:** A (typed thesis table + graph-native tagging), shipped in three de-risked phases
**Branch:** `feat/intel-platform-phases-3-5`

---

## 1. Problem

The AI produces knowledge in several places, each with a gap — and the new work must stay coherent with the **existing performance-wiki briefing that already drives analysis quality** (`compileWiki()` → injected at `src/llm/prompts.ts:103`).

| Store | Today | Gap |
|-------|-------|-----|
| **Knowledge Library** (`knowledge_sources`) | `GET /knowledge/sources` returns `listSources()` — **everything**, including `self_curated` AI facts (`KnowledgeLibrary.tsx` even badges them `"ai-curated"`). | Must be **user-only**; AI facts leak in. No day-sectioning/tags/search. |
| **Self-curated facts** (`CuratedMemory.tsx`, `curateFacts()`) | Day-sectioned + collapsible. 5 hard gates (citation, ≤140 chars, exact-hash dedup, 3/run, 40/scope) + a soft prompt bar. | **No significance or near-duplicate gate** → "genuinely worth noting" is hoped for, not enforced. Not searchable, not tagged. |
| **Performance wiki / briefing** (`compileWiki()`) | Cohort metrics from **resolved** outcomes + lessons + an **Open Book** that marks live calls to today's price. | The Open Book is **briefing text only — never persisted**; **no daily MFE/MAE or drift tracking**. Performance is assessed only once, at the horizon (`resolveAt`). |
| **AI sector / market thesis** | Ephemeral (`collectAiThesisTickers`), discarded. | Never stored, shown, graph-linked, fed back, or query-reachable. |

## 2. Goal

A neat, dense, **tagged** AI-knowledge store, **separated** from the user library, **day-sectioned / collapsible / searchable**, **outlook-bearing**, with **archive = gone from view**, all **coherent with the performance wiki** (one trusted briefing, one knowledge graph) and exposed through **one canonical tagged-JSON shape** any consumer can use. Plus: the wiki **tracks and assesses its calls daily**, not only at resolution. Fully human-browsable.

## 3. Approach (A) and phasing rationale

Approach A: theses get a typed `ai_theses` table; tags are knowledge-graph nodes + `tagged_with` edges (no parallel table to drift); facts stay in `knowledge_sources`, resurfaced not migrated; **theses and daily tracking flow through the existing `compileWiki()` briefing and the knowledge graph** so the LLM keeps a single, trusted knowledge basis.

The risk is uneven, so we isolate it across three independently shippable phases:

- **Phase 1 — User-only library + quality-gated, tagged AI Library.** No migration. Low risk. Makes the personal library user-only, raises the curation bar so only genuinely-noteworthy facts persist, and gives AI facts a searchable/tag-filterable/archive-hidden home.
- **Phase 2 — Daily performance tracking.** One migration. Persists the (currently ephemeral) Open Book as daily marks with running MFE/MAE/drift, and assesses in-flight calls daily — feeding the **same** briefing the LLM already trusts.
- **Phase 3 — Theses & Market View.** One migration. The LLM authors a cross-cutting outlook each run; it is compiled **into the wiki briefing + graph** (like lessons) and surfaced in a Market View. Builds on P1's tagging + P2's richer daily signal.

P1 and P2 are independent; P3 depends on both. No phase refactors an earlier one — each extends shared pieces (the canonical shape §4, the tag substrate §5, the `compileWiki` briefing).

## 4. The canonical shape (P1 + P3 serialize to this)

One JSON shape for facts and theses — the "ready for many platforms" contract. P1 emits the fact variant; P3 fills thesis fields.

```ts
type AiInsight = {
  id: string;
  kind: "fact" | "thesis";
  level: "fact" | "regime" | "sector" | "theme";
  date: string; createdAt: string;
  subject: string;                 // ticker | sector | theme | "market"
  headline: string;                // fact text  OR  thesis summary
  body: string;                    // ""         OR  thesis prose
  stance: string | null;           // null for facts
  conviction: number | null;       // null for facts
  horizon: string | null;          // null for facts
  significance: number | null;     // facts: model-rated decision value (P1); theses: conviction echo
  tags: { dimension: string; value: string; source: "ai" | "human" }[];
  tickers: string[];
  sources: { title: string; url: string }[];
  status: "active" | "superseded" | "archived";
  provenance: { runId: string | null; reportId: string | null; journalEntryId?: string };
};
```

## 5. Tagging model (shared substrate, built in Phase 1)

Tags are **knowledge-graph nodes + `tagged_with` edges** — keeping the substrate canonical (the same graph the wiki lessons link into via `linkLessonGraph`). Dimensions:

| Dimension | Node | Edge from insight node |
|-----------|------|------------------------|
| ticker | existing `ticker:NVDA` | `mentions` |
| sector | existing `sector:<slug>` | `tagged_with` |
| theme | existing `theme:<slug>` | `tagged_with` |
| direction | new `tag:direction:bullish` | `tagged_with` |
| horizon | new `tag:horizon:3mo` | `tagged_with` |

Facts use the existing `source:<id>` node (`curate.ts:114`); theses use `thesis:<id>` (P3). Edge `data_json` carries `{ source: "ai" | "human" }` so human edits survive re-tagging. Filtering reads indexed `kg_edges`; a thin **`insightTags` repo** wraps read/write/delete and powers `GET /tags`. *Rejected:* a denormalized `insight_tags` table — duplicates the graph and can drift.

---

## Phase 1 — User-only library + quality-gated, tagged AI Library

**No migration.** Repos, routes, serializer, tag repo, a tighter curation gate (one additive `memorableFacts` field), and frontend.

### 1.1 Make the Knowledge Library user-only
- New `knowledge.listUserSources()` (excludes `self_curated`); `GET /knowledge/sources` uses it. `KnowledgeLibrary.tsx` drops the `self_curated` path — AI facts no longer appear in the personal library. (Regression-tested.)

### 1.2 Raise the self-curation bar to "genuinely worth noting"
Beyond today's 5 gates, add a **significance + structural-category gate** (the only LLM-contract change in P1 — additive, with safe defaults so a malformed value never breaks a recommendation):
```ts
// MemorableFact gains:
significance: z.number().min(0).max(1).default(0).catch(0),   // model-rated decision value
category: z.enum(["moat","secular","management","capital_structure",
                  "regulatory","unit_economics"]).nullable().default(null).catch(null),
```
`curateFacts` then:
- **Significance threshold** — persist only `significance ≥ 0.6` *and* a recognized `category` (the prompt already names exactly these structural categories).
- **Keep top-N by significance** per run (not first-3) so the strongest survive the cap.
- **Near-duplicate guard** — in addition to exact-hash dedup, reject a fact whose normalized-token Jaccard overlap with an existing active fact in scope exceeds a threshold (cheap, no embeddings).
- Prompt update (`src/llm/prompts.ts:156`) asks the model to emit `significance` + `category` and reiterates the durable-only bar.

Result: the self-curated memory holds only durable, citable, distinct, decision-relevant facts.

### 1.3 Tagging
- Add the `insightTags` repo (§5); new node types `tag` (and `thesis`, reserved). Extend `curateFacts` to also tag the ticker's `sector` (from its `belongs_to` edge). Existing facts already have `mentions→ticker`, so they're ticker-filterable with **no backfill**.
- Human edits: `PUT /ai-insights/:kind/:id/tags` `{ add[], remove[] }` writing `source:"human"`.

### 1.4 Canonical serializer + AI Library API
- `serializeInsight()` → `AiInsight` (fact variant), golden-tested.
- New `src/server/routes/aiKnowledge.ts`: `GET /ai-library/days` · `/day/:date` · `/search?q=&dimension=&value=&from=&to=` · `GET /tags` · `PUT /ai-insights/:kind/:id/tags` · `DELETE /ai-insights/:kind/:id` (archive→hidden).
- `search_ai_insights` query-bot tool (facts) with `cite()`.

### 1.5 Frontend
- `CuratedMemory.tsx` → **`AiLibrary.tsx`**: day-sectioned/collapsible + **search bar** + **tag-chip filters**; rows show editable tag chips and the significance/category; **active-only** with a "show archived" toggle; promoted to its own `Section`.
- `client/hooks`: `AiInsight`/`Tag` types; `useAiLibraryDays/Day/Search`, `useTags`, `useEditInsightTags`; `useKnowledgeSources` → curated-excluded list.

**Done =** personal library is user-only; AI memory holds only genuinely-noteworthy, tagged, searchable, archive-hidden facts.

---

## Phase 2 — Daily performance tracking (assess calls every day, not just at resolution)

Persists the ephemeral Open Book and assesses in-flight calls daily, feeding the **same** `compileWiki()` briefing the LLM already trusts.

### 2.1 Data — migration `018_forecast_daily_marks`
```sql
CREATE TABLE forecast_daily_marks (
  id              TEXT PRIMARY KEY,
  forecast_id     TEXT NOT NULL REFERENCES scored_forecasts(id) ON DELETE CASCADE,
  ticker          TEXT NOT NULL,
  date            TEXT NOT NULL,            -- YYYY-MM-DD mark date
  mark_price      REAL NOT NULL,
  move_from_entry REAL NOT NULL,            -- pct since reference/entry
  progress_to_target REAL,                  -- 0..1
  progress_to_stop   REAL,                  -- 0..1
  unrealized_r    REAL,                     -- (mark-entry)/(entry-stop), signed
  mfe             REAL NOT NULL,            -- running max favorable excursion to date
  mae             REAL NOT NULL,            -- running max adverse excursion to date
  spy_excess      REAL,                     -- excess vs benchmark since entry
  status          TEXT NOT NULL,            -- on_track | near_target | at_risk | near_stop
  created_at      TEXT NOT NULL,
  UNIQUE (forecast_id, date)
);
CREATE INDEX idx_fdm_forecast ON forecast_daily_marks(forecast_id);
CREATE INDEX idx_fdm_date     ON forecast_daily_marks(date);
```

### 2.2 Daily job
- New `src/resolution/track.ts` `trackOpenForecasts(app)`, called in `dailyRun()` right after pricing / before `compileWiki()` (it reuses `computeOpenBook` math + `getQuotes`). For each `listOpen()` forecast it upserts today's mark and **rolls MFE/MAE forward** (max of prior mark and today's excursion). Idempotent per `(forecast_id, date)`.
- Marks are immutable history; resolution at horizon stays authoritative (bar-based) and can cross-check against accumulated MFE/MAE.

### 2.3 Feed the wiki / briefing (alignment)
- The Open Book section of the briefing now reads **persisted marks** (today + trajectory) instead of recomputing from scratch — same render, now historized.
- Add an **In-Flight assessment** computed from the latest marks per run: counts of on_track/at_risk/near_stop, mean unrealized R, share positive vs SPY. Append it to the `compileWiki()` briefing body (a small "IN-FLIGHT (marked today)" block) and persist it with the briefing — so the LLM sees "how are my open calls actually tracking" daily, not just resolved history.

### 2.4 Surfacing
- Journal entry detail gains a **daily-progress mini-series** (move-from-entry / MFE / MAE over days) from `forecast_daily_marks`.
- New tools/route: `GET /forecasts/:id/marks`; query-bot tool `forecast_progress({ ticker })` for "how is my NVDA call doing day-to-day".

**Done =** every open call is marked and assessed daily, persisted and historized, and the daily assessment is part of the trusted briefing.

---

## Phase 3 — Theses & Market View

The LLM authors a cross-cutting outlook each run; it is compiled **into the wiki briefing + knowledge graph** and surfaced in a Market View. Builds on P1 tagging + P2 daily signal.

### 3.1 Data — migration `019_ai_theses`
```sql
CREATE TABLE ai_theses (
  id            TEXT PRIMARY KEY,
  run_id        TEXT, report_id TEXT,
  date          TEXT NOT NULL,              -- day-section key
  created_at    TEXT NOT NULL,
  level         TEXT NOT NULL,              -- regime | sector | theme
  subject       TEXT NOT NULL,              -- "market" | sector | theme
  subject_key   TEXT NOT NULL,              -- normalized (level+slug) — supersede key
  stance        TEXT NOT NULL,              -- risk_on|neutral|risk_off|defensive | bullish|bearish|neutral
  conviction    REAL NOT NULL,
  horizon       TEXT NOT NULL,
  summary       TEXT NOT NULL DEFAULT '',
  thesis        TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active', -- active | superseded | archived
  supersedes_id TEXT,
  data_json     TEXT NOT NULL DEFAULT '{}'  -- {tickers[], sources[], metrics}
);
CREATE INDEX idx_thesis_date ON ai_theses(date);
CREATE INDEX idx_thesis_subject ON ai_theses(subject_key);
CREATE INDEX idx_thesis_status ON ai_theses(status);
CREATE VIRTUAL TABLE ai_theses_fts USING fts5(thesis_id UNINDEXED, text);
```
**Supersede-by-subject:** a new thesis for an existing `subject_key` flips the prior `active` row to `superseded` and links via `supersedes_id` (mirrors wiki-lesson supersede + `enforceCap`).

### 3.2 LLM contract (the isolated risk)
```ts
const ThesisItem = z.object({ subject: z.string(), stance: z.string(),
  conviction: z.number().min(0).max(1), horizon: Horizon,
  summary: z.string(), thesis: z.string(),
  tickers: z.array(Symbol).default([]), sources: z.array(Source).default([]) });
const Outlook = z.object({ regime: ThesisItem.nullable().default(null),
  sectors: z.array(ThesisItem).default([]).catch([]),  // cap 8
  themes:  z.array(ThesisItem).default([]).catch([]) });// cap 6
// DailyReport gains: outlook: Outlook.nullable().default(null)
```
Model-authored, citation-grounded. The prompt that elicits it is shown the current Open-Book/in-flight assessment (P2) and active theses, so the outlook is consistent with how its calls are actually tracking.

### 3.3 Persist + integrate with the wiki (alignment, not a bolt-on)
- New `src/knowledge/curateTheses.ts` (parallel to `curate.ts`), called after `persistCuratedFacts`: insert row + FTS, upsert `thesis:<id>` node, auto-tag (sector/theme/direction/horizon + `mentions` tickers), link evidence (`supports`/`cites`/`derived_from` → sources, journal entries, and the P2 marks), supersede prior subject.
- **Briefing integration:** extend `compileWiki()` to append an **OUTLOOK** section (current active regime + sector/theme leans) to the one briefing body, and graph-link theses exactly as `linkLessonGraph` does for lessons. This replaces the earlier "separate `compileOutlookBriefing` injection" idea — there remains a single trusted briefing.

### 3.4 API + query tools + UI
- `serializeInsight()` fills thesis fields; `search_ai_insights` includes theses.
- `GET /market-view/current` · `/days` · `/day/:date` · `/subject/:level/:subject` (history); tools `market_view`, `sector_outlook({ sector })`.
- **`MarketView.tsx`** (own `Section`, after "Daily recommendations"): regime banner, sector leans (color by stance, conviction bar, expand → thesis + tickers + sources + the open calls backing it), themes, day-sectioned history + per-subject evolution. `AiLibrary` day groups also show theses.
- Existing `MarketContextBanner` stays; the regime thesis references it.

**Done =** the AI's sector/theme/regime view is stored, tagged, graph-linked, compiled into the trusted briefing, query-reachable, and human-browsable.

---

## 6. Testing (TDD, 80%+, per phase)

- **P1:** `listUserSources` excludes `self_curated` (regression); significance/category gate + near-dup guard + top-N-by-significance in `curateFacts`; `insightTags` edge read/write/delete; sector auto-tag; `serializeInsight` golden (fact); `/ai-library/*`, `/tags`, tag-edit, archive-hides (`server.test.ts`); `search_ai_insights` + `cite()` (`tools.test.ts`); `AiLibrary` render.
- **P2:** `trackOpenForecasts` upsert + idempotent per day + MFE/MAE roll-forward + status thresholds; `forecast_daily_marks` repo; briefing In-Flight block; `/forecasts/:id/marks` + `forecast_progress` tool; Journal mini-series render.
- **P3:** `Outlook`/`ThesisItem` parse + caps (8/6) + stance-per-level; `curateTheses` persist + FTS + node/edges + tags + supersede + provenance; `ai_theses` repo days/current/history; `compileWiki` OUTLOOK section + graph links; `serializeInsight` golden (thesis); `/market-view/*`; `market_view`/`sector_outlook`; `MarketView` render.

## 7. Migration / rollout

- P1: **no migration**. P2: `018_forecast_daily_marks`. P3: `019_ai_theses` (+ FTS). All append-only; shipped migrations untouched; no backfill (marks/theses accrue from the next run). `kg_nodes.type` gains `tag`, `thesis` (free-text column).
- Keep `architecture-and-roadmap.md` updated in the same change (architecture-doc convention).

## 8. Open decisions (confirm at review)

1. **Phasing** — P1 (library) → P2 (daily tracking) → P3 (theses), each shipped standalone? → recommended.
2. **Significance gate** — threshold `≥0.6` + required structural `category` for a fact to persist? → recommended.
3. **Daily tracking scope** — mark only the AI's **open scored forecasts** each day (recommended), or every analyzed ticker even when no call was made?
4. **Outlook** — model-authored (spec'd) vs deterministic aggregate; stance vocab `{risk_on,neutral,risk_off,defensive}` (regime) + `Direction` (sector/theme); caps 8/6; ship all three tiers vs regime-only.
5. **Market View placement** — own `Section` after "Daily recommendations".
