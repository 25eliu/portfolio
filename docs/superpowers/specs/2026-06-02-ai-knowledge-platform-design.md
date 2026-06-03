# AI Knowledge Platform — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review
**Approach:** A (typed thesis table + graph-native tagging), shipped in two phases
**Branch:** `feat/intel-platform-phases-3-5`

---

## 1. Problem

The AI produces three kinds of knowledge, each with a gap:

| Store | Today | Gap |
|-------|-------|-----|
| **Knowledge Library** (`knowledge_sources`) | `GET /knowledge/sources` returns `listSources()` — **everything**, including `trust_class: "self_curated"` AI facts, which `KnowledgeLibrary.tsx` even badges `"ai-curated"`. | AI facts pollute the user's personal library; no day-sectioning, tags, or search. |
| **Self-curated facts** (`CuratedMemory.tsx` + `/knowledge/curated`) | Already day-sectioned + collapsible; written by `curateFacts()` each run. | Not searchable, not tagged; archive isn't visibly "gone"; cramped beside the personal library. |
| **AI sector / market thesis** | Computed ephemerally (`collectAiThesisTickers`) and discarded. A per-report `MarketContext` (SPY trend + macro) exists but isn't an outlook. | Sector / theme / regime conclusions are **never stored or shown**, not reachable by the query bot, not carried forward. |

## 2. Goal

A neat, dense, **tagged** AI-knowledge store that is **separated** from the personal library, **day-sectioned / collapsible / searchable**, **outlook-bearing** (sector / theme / regime views persisted and surfaced), with **archive = gone from view** (provenance kept), exposed through **one canonical tagged-JSON shape** any consumer can use (analysis pipeline, query bot, future platforms), and fully **human-browsable**.

## 3. Approach (A) and why it's split into two phases

Approach A: theses get a typed `ai_theses` table; tags are knowledge-graph nodes + `tagged_with` edges (no parallel tag table to drift); facts stay in `knowledge_sources` and are resurfaced, not migrated.

**The risk is not uniform.** Separating the library and tagging is pure plumbing over tables and patterns that already exist. The one genuinely novel, quality-sensitive piece is *getting the LLM to author a good cross-cutting sector/theme/regime outlook every run*. So we isolate that:

- **Phase 1 — Separate & Tag (de-risked core).** No schema migration, no pipeline or LLM changes. Ships standalone value: a clean personal library, a real AI Library with search + tags, archive-hidden, and a canonical API.
- **Phase 2 — Theses & Market View.** Adds the `ai_theses` table, the LLM outlook contract, the synthesis + carry-forward, and the Market View UI. Builds directly on Phase 1's tagging, serializer, and query tool.

Each phase is independently shippable and testable. Phase 2 does not refactor Phase 1; it extends it.

## 4. The canonical shape (both phases serialize to this)

One JSON shape for facts and theses — the "ready for many platforms" contract. Phase 1 emits the `kind: "fact"` variant; Phase 2 fills in the thesis fields.

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
  tags: { dimension: string; value: string; source: "ai" | "human" }[];
  tickers: string[];
  sources: { title: string; url: string }[];
  status: "active" | "superseded" | "archived";
  provenance: { runId: string | null; reportId: string | null; journalEntryId?: string };
};
```

## 5. Tagging model (shared substrate, built in Phase 1)

Tags are **knowledge-graph nodes + `tagged_with` edges** — keeping the substrate canonical (no derived duplicate). Dimensions map to node types:

| Dimension | Node | Edge from insight node |
|-----------|------|------------------------|
| ticker | existing `ticker:NVDA` | `mentions` |
| sector | existing `sector:<slug>` | `tagged_with` |
| theme | existing `theme:<slug>` | `tagged_with` |
| direction | new `tag:direction:bullish` | `tagged_with` |
| horizon | new `tag:horizon:3mo` | `tagged_with` |

Every insight already has (or gets) a graph node: facts use `source:<id>` (`curate.ts:114`); theses use `thesis:<id>` (Phase 2). Edge `data_json` carries `{ source: "ai" | "human" }` so human edits are distinguishable and survive re-tagging. Filtering reads the already-indexed `kg_edges` (`idx_kgedge_dst`, `idx_kgedge_rel`). A thin **`insightTags` repo** wraps edge read/write/delete with a typed API and powers `GET /tags` (taxonomy + counts).

*Rejected:* a denormalized `insight_tags` table — faster joins but duplicates the graph and can drift; indexed edges are fast enough.

---

## Phase 1 — Separate & Tag the AI Library

**No migration. No pipeline/LLM change.** Touches repos, routes, one new serializer, the tag repo, and the frontend.

### 1.1 Split the libraries
- New `knowledge.listUserSources()` (or `listSources({ excludeTrust: ["self_curated"] })`); `GET /knowledge/sources` uses it. `KnowledgeLibrary.tsx` drops the `self_curated` render path — AI facts no longer appear in the personal library.

### 1.2 Tagging
- Add the `insightTags` repo (§5) over `kg_nodes`/`kg_edges`; new node types `tag` (and `thesis`, reserved for Phase 2) — `kg_nodes.type` is free-text, no schema change.
- Extend `curateFacts` auto-tagging: it already writes `source —mentions→ ticker`; add the ticker's `sector` tag (from the ticker's existing `belongs_to` edge when present). Existing facts already carry `mentions→ticker`, so they are **immediately ticker-filterable with no backfill**; sector backfill optional.
- Human edits: `PUT /ai-insights/:kind/:id/tags` with `{ add[], remove[] }`, writing `source:"human"` edges.

### 1.3 Canonical serializer + AI Library API
- `serializeInsight()` producing `AiInsight` (fact variant) — golden-tested so Phase 2 extends it without breaking consumers.
- Routes (new `src/server/routes/aiKnowledge.ts`, pattern from `routes/knowledge.ts`):
  - `GET /ai-library/days` → `[{ date, factCount }]`
  - `GET /ai-library/day/:date` → `{ date, facts: AiInsight[] }`
  - `GET /ai-library/search?q=&dimension=&value=&from=&to=` (FTS over fact chunks + tag filter)
  - `GET /tags` · `PUT /ai-insights/:kind/:id/tags` · `DELETE /ai-insights/:kind/:id` (archive → hidden)
- `search_ai_insights({ q, dimension, value })` query-bot tool (facts), with `cite()` emitting `sources`.

### 1.4 Frontend
- `CuratedMemory.tsx` → **`AiLibrary.tsx`**: keep day-sectioned/collapsible; add a **search bar** + **tag-chip filters**; rows show editable tag chips; list is **active-only** with a "show archived" toggle. Promote to its own `Section` ("AI knowledge library"), separate from the personal library.
- `web/src/api/{client,hooks}.ts`: `AiInsight`/`Tag` types; `useAiLibraryDays/Day/Search`, `useTags`, `useEditInsightTags`; update `useKnowledgeSources` to the curated-excluded list.

### 1.5 Phase 1 done = 
Personal library is clean; AI facts have a searchable, tag-filterable, archive-hidden home; tags are editable; one canonical API serves them. Nothing in the analysis pipeline changed.

---

## Phase 2 — Theses & Market View

Adds the outlook. The risky part — LLM authoring the outlook — is the only novel logic; everything else reuses Phase 1.

### 2.1 Data — migration `018_ai_theses`
```sql
CREATE TABLE ai_theses (
  id            TEXT PRIMARY KEY,
  run_id        TEXT,
  report_id     TEXT,
  date          TEXT NOT NULL,              -- YYYY-MM-DD (day-section key)
  created_at    TEXT NOT NULL,
  level         TEXT NOT NULL,              -- regime | sector | theme
  subject       TEXT NOT NULL,              -- "market" | sector | theme name
  subject_key   TEXT NOT NULL,              -- normalized (level+slug) — supersede key
  stance        TEXT NOT NULL,              -- risk_on|neutral|risk_off|defensive | bullish|bearish|neutral
  conviction    REAL NOT NULL,              -- 0..1
  horizon       TEXT NOT NULL,              -- reuse Horizon enum
  summary       TEXT NOT NULL DEFAULT '',   -- one-line headline
  thesis        TEXT NOT NULL,              -- dense reasoning prose
  status        TEXT NOT NULL DEFAULT 'active', -- active | superseded | archived
  supersedes_id TEXT,
  data_json     TEXT NOT NULL DEFAULT '{}'  -- {tickers[], sources[], sectorCode, metrics}
);
CREATE INDEX idx_thesis_date    ON ai_theses(date);
CREATE INDEX idx_thesis_level   ON ai_theses(level);
CREATE INDEX idx_thesis_subject ON ai_theses(subject_key);
CREATE INDEX idx_thesis_status  ON ai_theses(status);
CREATE VIRTUAL TABLE ai_theses_fts USING fts5(thesis_id UNINDEXED, text);
```
**Supersede-by-subject:** a new thesis for an existing `subject_key` flips the prior `active` row to `superseded` and links it via `supersedes_id`. Market View shows the active view; the chain is the "how this evolved" history. (Mirrors wiki-lesson supersede + `curate.ts` `enforceCap`.)

### 2.2 LLM contract (the risk — isolated here)
```ts
const ThesisItem = z.object({
  subject: z.string(), stance: z.string(),
  conviction: z.number().min(0).max(1), horizon: Horizon,
  summary: z.string(), thesis: z.string(),
  tickers: z.array(Symbol).default([]), sources: z.array(Source).default([]),
});
const Outlook = z.object({
  regime:  ThesisItem.nullable().default(null),
  sectors: z.array(ThesisItem).default([]).catch([]),  // cap 8
  themes:  z.array(ThesisItem).default([]).catch([]),   // cap 6
});
// DailyReport gains: outlook: Outlook.nullable().default(null)   (null offline/fake)
```
Model-authored, grounded with citations — not a deterministic average. Caps mirror `MAX_FACTS_PER_RUN` bloat control.

### 2.3 Persist + carry-forward
- New `src/knowledge/curateTheses.ts` (parallel to `curate.ts`), called right after `persistCuratedFacts` with run/report provenance: insert row + FTS, upsert `thesis:<id>` node, auto-tag (sector/theme/direction(stance)/horizon + `mentions` tickers + `supports/cites` evidence), supersede prior subject.
- `compileOutlookBriefing(app)` → compact summary of **active** theses (e.g. *"Semis: bullish 0.7 (3mo)"*), injected alongside the wiki briefing into the next run — the model sees its own standing view instead of recomputing.

### 2.4 API + query tools (extend Phase 1)
- `serializeInsight()` now fills thesis fields; `search_ai_insights` includes theses.
- `GET /market-view/current` · `/days` · `/day/:date` · `/subject/:level/:subject` (supersede history).
- Query tools: `market_view`, `sector_outlook({ sector })`.

### 2.5 Frontend
- **`MarketView.tsx`** (new `Section`, after "Daily recommendations"): regime banner (stance + conviction + horizon + thesis), sector leans (color by stance, conviction bar, expand → thesis + tickers + sources), themes, day-sectioned history + per-subject evolution. Searchable/tag-filterable via Phase 1 components.
- `AiLibrary.tsx` day groups now also show theses; `client/hooks` gain `Thesis`/`MarketView` types + `useMarketViewCurrent/Days/Day`.
- Existing `MarketContextBanner` stays in recommendations; the regime thesis references it, not replaces it.

---

## 6. Testing (TDD, 80%+, per phase)

**Phase 1:** `listUserSources` excludes `self_curated` (regression: AI facts absent from `/knowledge/sources`); `insightTags` edge read/write/delete; `curateFacts` sector auto-tag; `serializeInsight` golden (fact); routes `/ai-library/*`, `/tags`, tag-edit, archive-hides (`server.test.ts` pattern); `search_ai_insights` + `cite()` (`tools.test.ts` pattern); `AiLibrary` render test.

**Phase 2:** `Outlook`/`ThesisItem` parse + caps (8/6) + stance-per-level/horizon enums; `curateTheses` persists row + FTS + node/edges + tags + supersede-by-`subject_key` + dedup + provenance; `ai_theses` repo `listDays/listDay`/current-by-subject/history; `serializeInsight` golden (thesis); `/market-view/*` routes; `market_view`/`sector_outlook` tools; `compileOutlookBriefing` includes active theses; `MarketView` render test.

## 7. Migration / rollout

- Phase 1: **no migration**. Phase 2: `018_ai_theses` (+ `ai_theses_fts` + indexes), append-only; shipped migrations untouched; no thesis backfill (accrues from next run). `kg_nodes.type` gains `tag`, `thesis` (free-text column).
- Keep `architecture-and-roadmap.md` updated in the same change (per the architecture-doc convention).

## 8. Open decisions (confirm at review)

1. **Phasing** — ship Phase 1 (separate + tag) standalone, then Phase 2 (theses + Market View)? → recommended.
2. **Outlook generation** — model-authored (spec'd) vs deterministic aggregate.
3. **Regime stance vocabulary** — `{risk_on, neutral, risk_off, defensive}` for regime; `Direction` for sector/theme.
4. **Market View placement** — own `Section` after "Daily recommendations".
5. **Outlook tiers** — ship all three (regime + sector + theme) vs regime-only; caps 8 sectors / 6 themes.
