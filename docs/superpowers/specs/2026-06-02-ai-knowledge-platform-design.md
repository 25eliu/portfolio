# AI Knowledge Platform — Design Spec

**Date:** 2026-06-02
**Status:** Draft for review
**Approach:** A (typed thesis table + graph tagging)
**Branch:** `feat/intel-platform-phases-3-5`

---

## 1. Problem

The AI produces three kinds of knowledge today, each with a gap:

| Store | Today | Gap |
|-------|-------|-----|
| **Knowledge Library** (`KnowledgeSources`) | Flat list sorted by `updated_at`. `GET /knowledge/sources` returns `listSources()` — **everything**, including `trust_class: "self_curated"` AI facts, which `KnowledgeLibrary.tsx` renders with an `"ai-curated"` badge. | AI facts pollute the user's personal library; no day-sectioning, no tags, no search. |
| **Self-curated facts** (`CuratedMemory.tsx` + `/knowledge/curated`) | Already day-sectioned + collapsible. Created by `curateFacts()` after each run. | Not searchable, not tagged, archive isn't visibly "gone", and it's cramped into a 2-column block beside the personal library. |
| **AI sector/market thesis** | Computed ephemerally each run (`collectAiThesisTickers`) and discarded. A per-report `MarketContext` (SPY trend + macro) exists but is not an outlook. | Sector / theme / market-direction conclusions are **never stored or shown**, and not reachable by the query bot or carried forward into the next run. |

## 2. Goal

A neat, dense, **tagged** AI-knowledge store that is:

- **Separated** — AI-found facts live in a dedicated AI Library, never mixed into the personal Knowledge Library.
- **Day-sectioned, collapsible, searchable** — like the Journal.
- **Outlook-bearing** — the AI's sector / theme / market-regime conclusions are persisted and surfaced in a new **Market View**.
- **Tagged** — every fact and thesis carries tags (sector, ticker, theme, direction, horizon) so the AI retrieves the right context for decisions and query answers, and the human can filter/search.
- **Archive = gone** — archived items disappear from the default view (provenance preserved in the DB).
- **Reachable** — one canonical tagged-JSON shape served over the API, consumable by the analysis pipeline, the query bot, and any future platform.

## 3. Scope (4 pillars) & non-goals

**In scope**

1. **AI Library** — dedicated home for AI facts (split from the personal library); day-sectioned, collapsible, searchable, tag-filterable, archive-hidden.
2. **AI Theses** — new `ai_theses` table (regime / sector / theme) with supersede chains, surfaced in a new **Market View** section.
3. **Tagging** — first-class tags on facts + theses, stored as knowledge-graph edges (`tagged_with`); AI auto-assigns, human can add/remove/override.
4. **Clean API** — one canonical `AiInsight` JSON serializer; new `/ai-library`, `/market-view`, `/tags` routes; new query-bot tools; active theses carried forward into the next run's briefing.

**Non-goals**

- No file export — DB is the single source of truth, exposed via API (decided).
- No change to knowledge ingestion (notes/URLs/uploads) beyond excluding `self_curated` from the personal-library list.
- No re-storage of per-ticker conviction — it stays in the Journal; theses link to it.
- The existing `MarketContextBanner` (SPY trend + macro) stays as-is; the regime thesis references it, not replaces it.

## 4. Outlook levels (confirm)

Original request named *"market direction of sectors, groups of companies."* The quick poll selected **Market regime** only. These three nest naturally, so the design models **all three tiers** — trim later if desired:

- **regime** — `subject = "market"`; stance ∈ {`risk_on`, `neutral`, `risk_off`, `defensive`}.
- **sector** — `subject =` GICS sector; stance ∈ {`bullish`, `neutral`, `bearish`} (reuse `Direction`).
- **theme** — `subject =` AI-named group (e.g. "AI infra capex"); stance ∈ `Direction`.

## 5. Data model

New append-only migration **`018_ai_theses`** (next after `017`). Mirrors `journal_entries` (day-keyed) + the wiki supersede pattern.

```sql
CREATE TABLE ai_theses (
  id            TEXT PRIMARY KEY,
  run_id        TEXT,                       -- provenance (nullable)
  report_id     TEXT,                       -- provenance
  date          TEXT NOT NULL,              -- YYYY-MM-DD (day-section key)
  created_at    TEXT NOT NULL,
  level         TEXT NOT NULL,              -- regime | sector | theme
  subject       TEXT NOT NULL,              -- "market" | sector | theme name
  subject_key   TEXT NOT NULL,              -- normalized (level + slug) — supersede key
  stance        TEXT NOT NULL,              -- risk_on|risk_off|defensive | bullish|bearish|neutral
  conviction    REAL NOT NULL,              -- 0..1
  horizon       TEXT NOT NULL,              -- reuse Horizon enum (1w..1y)
  summary       TEXT NOT NULL DEFAULT '',   -- one-line headline
  thesis        TEXT NOT NULL,              -- dense reasoning prose
  status        TEXT NOT NULL DEFAULT 'active', -- active | superseded | archived
  supersedes_id TEXT,                       -- prior thesis on same subject_key
  data_json     TEXT NOT NULL DEFAULT '{}'  -- {tickers[], sources[], sectorCode, metrics}
);
CREATE INDEX idx_thesis_date    ON ai_theses(date);
CREATE INDEX idx_thesis_level   ON ai_theses(level);
CREATE INDEX idx_thesis_subject ON ai_theses(subject_key);
CREATE INDEX idx_thesis_status  ON ai_theses(status);

-- Full-text search over thesis prose (mirrors knowledge_chunks_fts).
CREATE VIRTUAL TABLE ai_theses_fts USING fts5(thesis_id UNINDEXED, text);
```

**Supersede-by-subject.** When a new run emits a thesis for an existing `subject_key`, the prior `active` row is set `status = 'superseded'` and the new row links it via `supersedes_id`. Market View shows the current (active) view; the supersede chain is the "how this view evolved" history. (Same shape as wiki lessons + the `enforceCap` archival in `curate.ts`.)

**Tags — graph-native (Approach A).** Tags are **not** a new parallel table; they are knowledge-graph nodes + `tagged_with` edges, keeping the substrate canonical (no derived duplicate to drift). Dimensions map to node types:

| Dimension | Node | Edge from insight |
|-----------|------|-------------------|
| ticker | existing `ticker:NVDA` | `mentions` |
| sector | existing `sector:<slug>` | `tagged_with` / `belongs_to` |
| theme | existing `theme:<slug>` | `tagged_with` |
| direction | new `tag:direction:bullish` | `tagged_with` |
| horizon | new `tag:horizon:3mo` | `tagged_with` |

Each insight has a graph node: facts already create `source:<id>` (see `curate.ts:114`); theses create `thesis:<id>` (new `kg_nodes.type = 'thesis'`; `tag` is a new node type too — the `type` column is free-text, no constraint change). Edge `data_json` carries `{ source: "ai" | "human" }` so human-added/removed tags are distinguishable. Tag filtering reads the already-indexed `kg_edges` (`idx_kgedge_dst`, `idx_kgedge_rel`); text search uses the FTS tables. A thin `insightTags` repo wraps edge read/write with a typed API.

*Rejected:* a denormalized `insight_tags` table — faster joins but duplicates the graph and can drift; the indexed edge table is fast enough.

## 6. Pipeline — producing theses

The daily LLM run emits a `DailyReport` (per-ticker `recommendations` + `marketContext`). Add a **report-level outlook** the analyzer authors (model-authored, grounded with citations — not a deterministic average of ticker calls):

```ts
// src/domain/recommendation.ts (or new outlook.ts)
const ThesisItem = z.object({
  subject: z.string(),
  stance: z.string(),            // validated per level
  conviction: z.number().min(0).max(1),
  horizon: Horizon,
  summary: z.string(),
  thesis: z.string(),
  tickers: z.array(Symbol).default([]),
  sources: z.array(Source).default([]),
});
const Outlook = z.object({
  regime:  ThesisItem.nullable().default(null),
  sectors: z.array(ThesisItem).default([]).catch([]),   // cap 8
  themes:  z.array(ThesisItem).default([]).catch([]),   // cap 6
});
// DailyReport gains: outlook: Outlook.nullable().default(null)
```

Caps (8 sectors / 6 themes) mirror `MAX_FACTS_PER_RUN` bloat control. Offline/fake source → `outlook = null`.

New **`src/knowledge/curateTheses.ts`** (parallel to `curate.ts`), called right after `persistCuratedFacts` in the run pipeline with run/report provenance:

1. For each thesis item: insert `ai_theses` row + FTS, upsert `thesis:<id>` node, supersede prior active row for the `subject_key`.
2. Auto-tag: `tagged_with` → sector/theme/direction(stance)/horizon nodes; `mentions` → each ticker; `supports`/`cites` → backing source/journal nodes; `supersedes` → prior thesis node.

Also extend **`curateFacts`** to auto-tag facts beyond the existing `source —mentions→ ticker`: add the ticker's `sector` tag (resolved from the ticker's existing `belongs_to` edge when present). Existing facts already carry `mentions→ticker` edges, so they are immediately ticker-filterable with **no backfill**; a sector backfill is optional.

**Carry-forward.** Add `compileOutlookBriefing(app)` returning a compact summary of **active** theses (regime + sector leans, e.g. *"Semis: bullish 0.7 (3mo)"*), injected alongside the existing wiki briefing into the next run's analysis input. This closes the loop — the model sees its own standing outlook instead of recomputing from scratch.

## 7. Canonical API (DB + clean JSON)

One serializer, one shape for facts and theses — the "ready for many platforms" contract:

```ts
type AiInsight = {
  id: string;
  kind: "fact" | "thesis";
  level: "fact" | "regime" | "sector" | "theme";
  date: string; createdAt: string;
  subject: string;                 // ticker | sector | theme | "market"
  headline: string;                // fact text OR thesis summary
  body: string;                    // "" for fact OR thesis prose
  stance: string | null;
  conviction: number | null;
  horizon: string | null;
  tags: { dimension: string; value: string; source: "ai" | "human" }[];
  tickers: string[];
  sources: { title: string; url: string }[];
  status: "active" | "superseded" | "archived";
  provenance: { runId: string | null; reportId: string | null; journalEntryId?: string };
};
```

**Routes** (new `src/server/routes/aiKnowledge.ts`; pattern from `routes/knowledge.ts`):

- AI Library: `GET /ai-library/days` · `GET /ai-library/day/:date` · `GET /ai-library/search?q=&dimension=&value=&level=&from=&to=`
- Market View: `GET /market-view/current` · `GET /market-view/days` · `GET /market-view/day/:date` · `GET /market-view/subject/:level/:subject` (supersede history)
- Tags: `GET /tags` (taxonomy + counts) · `PUT /ai-insights/:kind/:id/tags` (`{ add[], remove[] }`, writes `source:"human"`) · `DELETE /ai-insights/:kind/:id` (archive → hidden)
- **Personal library fix:** `GET /knowledge/sources` excludes `self_curated` (new `listUserSources()` / filtered `listSources`). AI facts no longer appear there.

**Query-bot tools** (append to `QUERY_TOOLS` in `src/query/tools.ts`):

- `market_view` → current regime + sector/theme leans (stored outlook).
- `sector_outlook({ sector })` → current + recent thesis history for a sector.
- `search_ai_insights({ q, dimension, value })` → tagged facts + theses, with `cite()` emitting their `sources` as citations.

These let "ask your portfolio" answer *"what's your view on semis / which sectors look strong"* grounded in stored theses — never recall.

## 8. Frontend

1. **`KnowledgeLibrary.tsx`** — shows only user sources (note/url/upload); drop the `self_curated` rendering path (it won't be returned).
2. **`CuratedMemory.tsx` → `AiLibrary.tsx`** — keeps day-sectioned/collapsible; adds a **search bar** + **tag-chip filters** (sector/ticker/theme/direction/horizon); each day now holds **Theses + Facts** (toggle or two sub-lists); rows show editable tag chips (add/remove → `PUT …/tags`); list is active-only with a "show archived" toggle. Promoted to its own `Section` ("AI knowledge library"), separate from the personal library.
3. **`MarketView.tsx`** (new `Section`, placed after "Daily recommendations") — **regime banner** (stance + conviction + horizon + thesis), **sector leans** (color by stance, conviction bar, expand → thesis + tickers + sources), **themes** (named groups), day-sectioned history below, per-subject evolution view, searchable/tag-filterable.
4. **`web/src/api/client.ts` + `hooks.ts`** — add `AiInsight`/`Thesis`/`MarketView`/`Tag` types and hooks (`useAiLibraryDays/Day/Search`, `useMarketViewCurrent/Days/Day`, `useTags`, `useEditInsightTags`); update `useKnowledgeSources` to the curated-excluded list; reuse `useArchiveSource`.

## 9. Testing (TDD, 80%+)

- **Domain:** `Outlook`/`ThesisItem` parse + caps (8/6); stance-per-level + horizon enums.
- **curateTheses:** persists row + FTS + graph node/edges + tags; supersede-by-`subject_key` (old→superseded, new links it); identical-thesis dedup; provenance.
- **curateFacts:** sector auto-tag written; ticker tag present.
- **Repos:** `ai_theses` CRUD, `listDays`/`listDay`, current-by-subject, supersede history; `insightTags` edge read/write; FTS search.
- **Personal library regression:** `listUserSources()` excludes `self_curated` (AI facts absent from `/knowledge/sources`).
- **Serializer:** golden `AiInsight` for a fact and a thesis.
- **Routes:** `/ai-library/*`, `/market-view/*`, `/tags`, tag-edit, archive-hides (pattern from `server.test.ts`).
- **Query tools:** `market_view` / `sector_outlook` / `search_ai_insights` return + `cite()` (pattern from `tools.test.ts`).
- **Carry-forward:** `compileOutlookBriefing` includes active theses.
- **Web:** render tests for `AiLibrary` + `MarketView`.

## 10. Migration / rollout

- `018_ai_theses` creates `ai_theses` + `ai_theses_fts` + indexes. No thesis backfill (theses accrue from the next run).
- Facts already have `mentions→ticker` edges → immediately ticker-filterable; sector backfill optional.
- Append-only; shipped migrations untouched. `kg_nodes.type` gains `thesis`, `tag` (free-text column, no constraint change).
- Keep `architecture-and-roadmap.md` updated in the same change (per `[[architecture-doc]]` convention).

## 11. Open decisions (confirm at review)

1. **Outlook generation:** model-authored (spec'd) vs deterministic aggregate. → recommend model-authored.
2. **Regime stance vocabulary:** `{risk_on, neutral, risk_off, defensive}` for regime, `Direction` for sector/theme. → confirm.
3. **Market View placement:** new `Section` after "Daily recommendations". → confirm.
4. **Caps:** 8 sectors / 6 themes per run. → tune later.
5. **Outlook levels:** ship all three tiers (regime + sector + theme) vs regime-only. → recommend all three.
