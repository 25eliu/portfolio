# AI Knowledge Platform — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Knowledge Library user-only, give the AI's self-curated facts a tagged/searchable/archive-hidden home, and raise the curation bar so only genuinely-noteworthy facts persist.

**Architecture:** No DB migration. Facts stay in `knowledge_sources` (`trust_class='self_curated'`); the personal library simply excludes them. Tags are knowledge-graph nodes + `tagged_with`/`mentions` edges (a new `insightTags` repo), the tag triple `{dimension,value,source}` stored in each edge's `data_json`. Significance/category live on the fact's existing `source:<id>` graph node `data`. One `AiInsight` serializer feeds new `/ai-library`, `/tags`, `/ai-insights` routes, a `search_ai_insights` query tool, and the `AiLibrary` React component.

**Tech Stack:** TypeScript, Bun (`bun test`, `bun:test`), Hono (API), SQLite (`db.query(...).run/.get/.all`), Zod, React + TanStack Query, Tailwind. Spec: `docs/superpowers/specs/2026-06-02-ai-knowledge-platform-design.md`.

---

## File Structure

**Create:**
- `src/db/repositories/insightTags.ts` — graph-native tag read/write (the only new repo).
- `src/db/repositories/insightTags.test.ts`
- `src/knowledge/serialize.ts` — the canonical `AiInsight` serializer (fact variant).
- `src/knowledge/serialize.test.ts`
- `src/server/routes/aiKnowledge.ts` — `/ai-library/*`, `/tags`, `/ai-insights/*`.
- `web/src/components/AiLibrary.tsx` — the AI Library UI (supersedes `CuratedMemory.tsx`).

**Modify:**
- `src/domain/graph.ts` — add `"tag"` to `KgNodeType`.
- `src/domain/recommendation.ts` — add `significance` + `category` to `MemorableFact`.
- `src/llm/prompts.ts:156-166` — ask for significance + category; state the gate.
- `src/knowledge/curate.ts` — significance/category gate, top-N-by-significance, near-duplicate guard, store significance/category on the node, tag via `insightTags`.
- `src/db/repositories/knowledge.ts` — `listUserSources()` + `activeCuratedTextsForScope()`.
- `src/db/index.ts:24-46` — register `insightTags`.
- `src/server/routes/knowledge.ts:32` — `/sources` uses `listUserSources()`.
- `src/server/app.ts:23-34` — mount `aiKnowledgeRoutes`.
- `src/query/tools.ts` — add `search_ai_insights`.
- `web/src/api/client.ts` — `AiInsight`/`InsightTag`/`AiLibraryDay`/`TagCount` types + client methods.
- `web/src/api/hooks.ts` — AI Library hooks.
- `web/src/components/KnowledgeLibrary.tsx:28` — drop the `self_curated` trust label.
- `web/src/App.tsx:194-199` — give `AiLibrary` its own Section.

**Delete (Task 9):** `web/src/components/CuratedMemory.tsx` (replaced by `AiLibrary.tsx`).

---

## Task 1: Knowledge Library is user-only

**Files:**
- Modify: `src/db/repositories/knowledge.ts:73-78`
- Modify: `src/server/routes/knowledge.ts:32`
- Test: `src/db/repositories/knowledge.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/db/repositories/knowledge.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb } from "../index.ts";
import { repositories } from "../index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

function insertSource(id: string, trustClass: string) {
  repos.knowledge.insertSource({
    id, kind: trustClass === "self_curated" ? "fact" : "note", title: `t-${id}`,
    trustClass, scope: "global", scopeTicker: null, useInAnalysis: true,
    status: "active", origin: null, createdAt: NOW, updatedAt: NOW,
  });
}

describe("listUserSources", () => {
  test("excludes self_curated facts (they live in the AI Library)", () => {
    insertSource("u1", "private_note");
    insertSource("a1", "self_curated");
    const user = repos.knowledge.listUserSources();
    expect(user.map((s) => s.id)).toEqual(["u1"]);
    // listSources still returns everything (unchanged behavior)
    expect(repos.knowledge.listSources().length).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/db/repositories/knowledge.test.ts`
Expected: FAIL — `app.repos.knowledge.listUserSources is not a function`.

- [ ] **Step 3: Add `listUserSources` to the repo**

In `src/db/repositories/knowledge.ts`, immediately after the `listSources(...)` method (ends line 78), add:

```ts
    /** User-owned sources only (notes/URLs/uploads). Excludes the AI's self_curated facts,
     *  which live in the AI Library — keeps the personal library uncluttered. */
    listUserSources(opts: { status?: SourceStatus } = {}): KnowledgeSource[] {
      const rows = opts.status
        ? db
            .query<SourceRow, [string]>(
              "SELECT * FROM knowledge_sources WHERE trust_class <> 'self_curated' AND status = ? ORDER BY updated_at DESC",
            )
            .all(opts.status)
        : db
            .query<SourceRow, []>(
              "SELECT * FROM knowledge_sources WHERE trust_class <> 'self_curated' ORDER BY updated_at DESC",
            )
            .all();
      return rows.map(sourceToDomain);
    },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/db/repositories/knowledge.test.ts`
Expected: PASS.

- [ ] **Step 5: Point the route at it**

In `src/server/routes/knowledge.ts`, change line 32 from:

```ts
  r.get("/sources", (c) => c.json({ sources: app.repos.knowledge.listSources() }));
```
to:
```ts
  r.get("/sources", (c) => c.json({ sources: app.repos.knowledge.listUserSources() }));
```

- [ ] **Step 6: Commit**

```bash
git add src/db/repositories/knowledge.ts src/db/repositories/knowledge.test.ts src/server/routes/knowledge.ts
git commit -m "feat(knowledge): personal library excludes self_curated facts (listUserSources)"
```

---

## Task 2: Add significance + category to the MemorableFact contract

**Files:**
- Modify: `src/domain/recommendation.ts:46-51`
- Modify: `src/llm/prompts.ts:156-166`
- Test: `src/domain/recommendation.test.ts` (create if absent)

- [ ] **Step 1: Write the failing test**

Create/append `src/domain/recommendation.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { MemorableFact } from "./recommendation.ts";

describe("MemorableFact significance + category", () => {
  test("parses significance and category", () => {
    const f = MemorableFact.parse({ fact: "NVDA has a CUDA moat", significance: 0.8, category: "moat" });
    expect(f.significance).toBe(0.8);
    expect(f.category).toBe("moat");
  });

  test("defaults are safe when the model omits them", () => {
    const f = MemorableFact.parse({ fact: "x" });
    expect(f.significance).toBe(0);
    expect(f.category).toBeNull();
  });

  test("a malformed significance never throws — falls back to 0", () => {
    const f = MemorableFact.parse({ fact: "x", significance: "high" as unknown as number });
    expect(f.significance).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/domain/recommendation.test.ts`
Expected: FAIL — `expect(f.significance).toBe(0.8)` (received `undefined`).

- [ ] **Step 3: Extend the schema**

In `src/domain/recommendation.ts`, replace the `MemorableFact` object (lines 46-51) with:

```ts
export const FactCategory = z.enum([
  "moat", "secular", "management", "capital_structure", "regulatory", "unit_economics",
]);
export type FactCategory = z.infer<typeof FactCategory>;

export const MemorableFact = z.object({
  fact: z.string().min(1),
  citationUrl: z.string().nullable().default(null),
  scope: z.enum(["ticker", "global"]).default("ticker"),
  /** Model-rated decision value (0..1). Facts below the curation threshold are dropped. */
  significance: z.number().min(0).max(1).default(0).catch(0),
  /** Structural category; a fact with no recognized category is not durable enough to keep. */
  category: FactCategory.nullable().default(null).catch(null),
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/domain/recommendation.test.ts`
Expected: PASS.

- [ ] **Step 5: Update the prompt to ask for significance + category**

In `src/llm/prompts.ts`, replace lines 158-163 (the `Optionally return ...` through `... if you cannot cite it, omit it.` block) with:

```ts
    `Optionally return up to 3 NEW durable facts in memorableFacts. Each fact MUST include:`,
    `  • significance (0..1): its lasting decision value — ONLY facts with significance ≥ 0.6 are kept.`,
    `  • category: one of moat | secular | management | capital_structure | regulatory | unit_economics.`,
    `A durable fact has lasting decision value: competitive moats, secular theses, management track`,
    `record, capital structure, regulatory shifts, structural unit economics. Do NOT add ephemeral`,
    `price moves, daily news, today's quote, or anything already listed above. Each fact ≤140 chars,`,
    `self-contained (name the company/ticker), and MUST cite one of the research source URLs below —`,
    `if you cannot cite it, or it lacks a category, omit it.`,
```

- [ ] **Step 6: Run the full suite (no regressions)**

Run: `bun test src/domain src/llm`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/domain/recommendation.ts src/domain/recommendation.test.ts src/llm/prompts.ts
git commit -m "feat(curate): add significance + structural category to memorableFacts contract"
```

---

## Task 3: Curation quality gate (significance, category, top-N, near-duplicate)

**Files:**
- Modify: `src/knowledge/curate.ts`
- Modify: `src/db/repositories/knowledge.ts` (add `activeCuratedTextsForScope`)
- Test: `src/knowledge/curate.test.ts` (create if absent)

- [ ] **Step 1: Add the scope-texts helper to the knowledge repo**

In `src/db/repositories/knowledge.ts`, right after `hasCuratedFact(...)` (ends line 271), add:

```ts
    /** Active self_curated fact texts in a scope (`scopeTicker` null = global) — the near-duplicate pool. */
    activeCuratedTextsForScope(scopeTicker: string | null): string[] {
      return db
        .query<{ text: string }, [string | null]>(
          `SELECT c.text AS text
             FROM knowledge_chunks c
             JOIN knowledge_sources s ON s.id = c.source_id
            WHERE c.active = 1
              AND s.status = 'active'
              AND s.trust_class = 'self_curated'
              AND s.scope_ticker IS ?`,
        )
        .all(scopeTicker)
        .map((r) => r.text);
    },
```

- [ ] **Step 2: Write the failing test**

Create `src/knowledge/curate.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { curateFacts } from "./curate.ts";
import type { MemorableFact } from "../domain/index.ts";

let app: App;
const NOW = "2026-06-02T00:00:00.000Z";
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ startingCash: 100_000 }), now: () => "2026-06-02", queryModel: null });
});

const fact = (over: Partial<MemorableFact>): MemorableFact => ({
  fact: "default", citationUrl: "https://x.com", scope: "ticker", significance: 0.9, category: "moat", ...over,
});
const run = (facts: MemorableFact[]) =>
  curateFacts(app, { ticker: "NVDA", facts, runId: "r1", reportId: "rep1", journalEntryId: "j1", now: NOW });

describe("curation quality gate", () => {
  test("drops facts below the significance threshold", () => {
    const r = run([fact({ fact: "low conviction note", significance: 0.4 })]);
    expect(r.added).toBe(0);
    expect(app.repos.knowledge.listCuratedFacts().length).toBe(0);
  });

  test("drops facts with no structural category", () => {
    const r = run([fact({ fact: "uncategorized claim", category: null })]);
    expect(r.added).toBe(0);
  });

  test("keeps the highest-significance facts when more than the per-run cap qualify", () => {
    run([
      fact({ fact: "fact A weakest", significance: 0.61 }),
      fact({ fact: "fact B", significance: 0.7 }),
      fact({ fact: "fact C", significance: 0.8 }),
      fact({ fact: "fact D strongest", significance: 0.95 }),
    ]);
    const kept = app.repos.knowledge.listCuratedFacts().map((f) => f.fact);
    expect(kept.length).toBe(3);
    expect(kept).not.toContain("fact A weakest");
    expect(kept).toContain("fact D strongest");
  });

  test("rejects a near-duplicate of an existing fact", () => {
    run([fact({ fact: "NVDA dominates the AI training GPU market" })]);
    const r2 = run([fact({ fact: "NVDA dominates the AI training GPU market today" })]);
    expect(r2.added).toBe(0);
    expect(r2.skipped).toBe(1);
  });

  test("stores significance and category on the fact's graph node", () => {
    run([fact({ fact: "NVDA CUDA lock-in", significance: 0.88, category: "moat" })]);
    const id = app.repos.knowledge.listCuratedFacts()[0]!.id;
    const node = app.repos.graph.getNode(`source:${id.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "")}`);
    expect(node?.data.significance).toBe(0.88);
    expect(node?.data.category).toBe("moat");
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/knowledge/curate.test.ts`
Expected: FAIL — low-significance/uncategorized facts are currently persisted (`r.added` is 1, not 0).

- [ ] **Step 4: Implement the gate in `curate.ts`**

In `src/knowledge/curate.ts`, after the constants block (after line 19) add the gate constants + helpers:

```ts
/** A fact must clear this model-rated decision value to be remembered. */
const MIN_SIGNIFICANCE = 0.6;
/** Reject a new fact whose token overlap with an existing one is at least this (near-duplicate). */
const NEAR_DUP_JACCARD = 0.8;

/** Lowercased word set, used for cheap near-duplicate detection (no embeddings). */
function tokenSet(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9]+/g) ?? []);
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
```

Then replace the `for (const raw of input.facts.slice(0, MAX_FACTS_PER_RUN)) {` loop header (line 62) and its body's dedup section. Replace lines 62-76 (from the `for` through the `hasCuratedFact` skip block) with:

```ts
  // Gate: keep only durable, categorized, sufficiently-significant facts; strongest first; cap per run.
  const qualified = input.facts
    .filter((f) => f.significance >= MIN_SIGNIFICANCE && f.category !== null && normalizeFact(f.fact))
    .sort((a, b) => b.significance - a.significance)
    .slice(0, MAX_FACTS_PER_RUN);
  skipped += input.facts.length - qualified.length;

  // Per-scope near-duplicate pool, seeded from the DB and grown with facts added this run.
  const dupPool = new Map<string | null, Set<string>[]>();
  const poolFor = (scopeTicker: string | null): Set<string>[] => {
    let pool = dupPool.get(scopeTicker);
    if (!pool) {
      pool = app.repos.knowledge.activeCuratedTextsForScope(scopeTicker).map(tokenSet);
      dupPool.set(scopeTicker, pool);
    }
    return pool;
  };

  for (const raw of qualified) {
    const text = normalizeFact(raw.fact);
    const scope = raw.scope === "global" ? "global" : "ticker";
    const scopeTicker = scope === "ticker" ? input.ticker : null;
    const citationUrl = raw.citationUrl && raw.citationUrl.trim() ? raw.citationUrl.trim() : null;
    const hash = sha256(text);

    if (app.repos.knowledge.hasCuratedFact(hash, scopeTicker)) {
      skipped++;
      continue;
    }
    const tokens = tokenSet(text);
    const pool = poolFor(scopeTicker);
    if (pool.some((existing) => jaccard(tokens, existing) >= NEAR_DUP_JACCARD)) {
      skipped++;
      continue;
    }
    pool.push(tokens);
```

Then, in the `app.repos.graph.upsertNode({ ... data: {...} ... })` call for the source node (around line 120), add `significance` and `category` to the `data` object:

```ts
      data: { kind: "fact", trustClass: "self_curated", scope, runId: input.runId, reportId: input.reportId, journalEntryId: input.journalEntryId, citationUrl, significance: raw.significance, category: raw.category },
```

(Leave the existing per-fact insert/version/chunk/ticker-node/edge code below intact; it now runs only for qualified, non-duplicate facts.)

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/knowledge/curate.test.ts`
Expected: PASS.

- [ ] **Step 6: Run the wider suite (no regressions)**

Run: `bun test src/knowledge`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/knowledge/curate.ts src/knowledge/curate.test.ts src/db/repositories/knowledge.ts
git commit -m "feat(curate): significance/category gate, top-N-by-significance, near-duplicate guard"
```

---

## Task 4: Graph-native tagging — `insightTags` repo + auto-tag facts

**Files:**
- Modify: `src/domain/graph.ts:13-25` (add `"tag"` node type)
- Create: `src/db/repositories/insightTags.ts`
- Create: `src/db/repositories/insightTags.test.ts`
- Modify: `src/db/index.ts:15-46` (register repo)
- Modify: `src/knowledge/curate.ts` (tag the fact via `insightTags`)

- [ ] **Step 1: Add the `tag` node type**

In `src/domain/graph.ts`, add `"tag",` to the `KgNodeType` enum (after `"cohort",` on line 24):

```ts
  "cohort",
  "tag",
]);
```

- [ ] **Step 2: Write the failing test**

Create `src/db/repositories/insightTags.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { repositories } from "../index.ts";
import { openMemoryDb } from "../index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";
const FACT = "source:f1";
beforeEach(() => {
  repos = repositories(openMemoryDb());
});

describe("insightTags", () => {
  test("adds and reads tags across dimensions", () => {
    repos.insightTags.addTag(FACT, { dimension: "ticker", value: "NVDA", source: "ai" }, NOW);
    repos.insightTags.addTag(FACT, { dimension: "sector", value: "Information Technology", source: "ai" }, NOW);
    repos.insightTags.addTag(FACT, { dimension: "direction", value: "bullish", source: "human" }, NOW);
    const tags = repos.insightTags.tagsFor(FACT);
    expect(tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
    expect(tags).toContainEqual({ dimension: "sector", value: "Information Technology", source: "ai" });
    expect(tags).toContainEqual({ dimension: "direction", value: "bullish", source: "human" });
  });

  test("re-adding a tag is idempotent and can flip its source", () => {
    repos.insightTags.addTag(FACT, { dimension: "ticker", value: "NVDA", source: "ai" }, NOW);
    repos.insightTags.addTag(FACT, { dimension: "ticker", value: "NVDA", source: "human" }, NOW);
    const tickers = repos.insightTags.tagsFor(FACT).filter((t) => t.dimension === "ticker");
    expect(tickers).toEqual([{ dimension: "ticker", value: "NVDA", source: "human" }]);
  });

  test("removes a tag", () => {
    repos.insightTags.addTag(FACT, { dimension: "direction", value: "bullish", source: "ai" }, NOW);
    repos.insightTags.removeTag(FACT, "direction", "bullish");
    expect(repos.insightTags.tagsFor(FACT)).toEqual([]);
  });

  test("finds insight nodes by tag and builds a taxonomy with counts", () => {
    repos.insightTags.addTag("source:f1", { dimension: "sector", value: "Energy", source: "ai" }, NOW);
    repos.insightTags.addTag("source:f2", { dimension: "sector", value: "Energy", source: "ai" }, NOW);
    expect(repos.insightTags.insightNodeIdsForTag("sector", "Energy").sort()).toEqual(["source:f1", "source:f2"]);
    expect(repos.insightTags.taxonomy()).toContainEqual({ dimension: "sector", value: "Energy", count: 2 });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `bun test src/db/repositories/insightTags.test.ts`
Expected: FAIL — `repos.insightTags` is undefined.

- [ ] **Step 4: Implement the repo**

Create `src/db/repositories/insightTags.ts`:

```ts
import type { DB } from "../connection.ts";
import { nodeId, edgeId, type KgRelation } from "../../domain/index.ts";

/** The tag dimensions an AI insight can carry. */
export type TagDimension = "ticker" | "sector" | "theme" | "direction" | "horizon";
export type InsightTag = { dimension: TagDimension; value: string; source: "ai" | "human" };

/** Each dimension's graph edge relation (ticker reuses `mentions`; the rest use `tagged_with`). */
const REL_BY_DIM: Record<TagDimension, KgRelation> = {
  ticker: "mentions",
  sector: "tagged_with",
  theme: "tagged_with",
  direction: "tagged_with",
  horizon: "tagged_with",
};

/** The canonical graph node a (dimension,value) tag points at. ticker/sector/theme reuse existing
 *  node types; direction/horizon are dedicated `tag:` nodes. */
function tagTarget(dim: TagDimension, value: string): { id: string; type: string; label: string } {
  if (dim === "ticker") return { id: nodeId("ticker", value), type: "ticker", label: value.toUpperCase() };
  if (dim === "sector") return { id: nodeId("sector", value), type: "sector", label: value };
  if (dim === "theme") return { id: nodeId("theme", value), type: "theme", label: value };
  return { id: nodeId("tag", `${dim}-${value}`), type: "tag", label: `${dim}:${value}` };
}

export function insightTagsRepo(db: DB) {
  return {
    /** Tag an insight node (`source:<id>` for facts). Idempotent per (insight, dimension, value);
     *  the latest call's `source` wins (ai → human override). */
    addTag(insightNodeId: string, tag: InsightTag, now: string): void {
      const t = tagTarget(tag.dimension, tag.value);
      const rel = REL_BY_DIM[tag.dimension];
      db.query(
        `INSERT INTO kg_nodes (id, type, label, summary, data_json, status, created_at, updated_at)
         VALUES (?, ?, ?, '', '{}', 'active', ?, ?)
         ON CONFLICT (id) DO UPDATE SET updated_at = excluded.updated_at`,
      ).run(t.id, t.type, t.label, now, now);
      db.query(
        `INSERT INTO kg_edges (id, src_id, dst_id, rel, weight, data_json, created_at)
         VALUES (?, ?, ?, ?, 1, ?, ?)
         ON CONFLICT (src_id, rel, dst_id) DO UPDATE SET data_json = excluded.data_json`,
      ).run(
        edgeId(insightNodeId, rel, t.id),
        insightNodeId,
        t.id,
        rel,
        JSON.stringify({ dimension: tag.dimension, value: tag.value, source: tag.source }),
        now,
      );
    },

    removeTag(insightNodeId: string, dimension: TagDimension, value: string): void {
      const t = tagTarget(dimension, value);
      db.query("DELETE FROM kg_edges WHERE id = ?").run(edgeId(insightNodeId, REL_BY_DIM[dimension], t.id));
    },

    tagsFor(insightNodeId: string): InsightTag[] {
      const rows = db
        .query<{ data_json: string }, [string]>(
          "SELECT data_json FROM kg_edges WHERE src_id = ? AND rel IN ('tagged_with','mentions')",
        )
        .all(insightNodeId);
      const out: InsightTag[] = [];
      for (const r of rows) {
        const d = JSON.parse(r.data_json) as Partial<InsightTag>;
        if (d && d.dimension && d.value) out.push({ dimension: d.dimension, value: d.value, source: d.source ?? "ai" });
      }
      return out;
    },

    insightNodeIdsForTag(dimension: TagDimension, value: string): string[] {
      const t = tagTarget(dimension, value);
      return db
        .query<{ src_id: string }, [string]>("SELECT src_id FROM kg_edges WHERE dst_id = ?")
        .all(t.id)
        .map((r) => r.src_id);
    },

    taxonomy(): { dimension: TagDimension; value: string; count: number }[] {
      const rows = db
        .query<{ data_json: string }, []>(
          "SELECT data_json FROM kg_edges WHERE rel IN ('tagged_with','mentions') AND data_json LIKE '%dimension%'",
        )
        .all();
      const m = new Map<string, { dimension: TagDimension; value: string; count: number }>();
      for (const r of rows) {
        const d = JSON.parse(r.data_json) as Partial<InsightTag>;
        if (!d?.dimension || !d.value) continue;
        const key = `${d.dimension}:${d.value}`;
        const e = m.get(key);
        if (e) e.count++;
        else m.set(key, { dimension: d.dimension, value: d.value, count: 1 });
      }
      return [...m.values()].sort((a, b) => b.count - a.count);
    },
  };
}
export type InsightTagsRepo = ReturnType<typeof insightTagsRepo>;
```

- [ ] **Step 5: Register the repo**

In `src/db/index.ts`, add the import after line 16:

```ts
import { insightTagsRepo } from "./repositories/insightTags.ts";
```
and add to the returned object (after `knowledge: knowledgeRepo(db),` line 40):
```ts
    insightTags: insightTagsRepo(db),
```

- [ ] **Step 6: Run test to verify it passes**

Run: `bun test src/db/repositories/insightTags.test.ts`
Expected: PASS.

- [ ] **Step 7: Auto-tag facts in `curate.ts`**

In `src/knowledge/curate.ts`, locate the graph block that creates the ticker node + `mentions` edge (lines 125-133). After the existing `app.repos.graph.upsertEdge({ ... rel: "mentions" ... })` call, add ticker + sector auto-tagging:

```ts
    // Tags: ticker (carries the tag triple so it surfaces in the AI Library), plus the ticker's sector.
    app.repos.insightTags.addTag(sourceNode, { dimension: "ticker", value: input.ticker, source: "ai" }, input.now);
    const sector = app.repos.graph
      .neighbors(tickerNode, { rel: "belongs_to", direction: "out" })
      .map((n) => n.node)
      .find((n) => n?.type === "sector");
    if (sector) {
      app.repos.insightTags.addTag(sourceNode, { dimension: "sector", value: sector.label, source: "ai" }, input.now);
    }
```

- [ ] **Step 8: Run test to verify no regressions**

Run: `bun test src/knowledge src/db/repositories`
Expected: PASS (the curate test's stored-node assertions still hold; new tagging is additive).

- [ ] **Step 9: Commit**

```bash
git add src/domain/graph.ts src/db/repositories/insightTags.ts src/db/repositories/insightTags.test.ts src/db/index.ts src/knowledge/curate.ts
git commit -m "feat(tags): graph-native insightTags repo + auto-tag facts (ticker, sector)"
```

---

## Task 5: Canonical `AiInsight` serializer (fact variant)

**Files:**
- Create: `src/knowledge/serialize.ts`
- Create: `src/knowledge/serialize.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/knowledge/serialize.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { curateFacts } from "./curate.ts";
import { serializeFact } from "./serialize.ts";

let app: App;
const NOW = "2026-06-02T12:00:00.000Z";
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ startingCash: 100_000 }), now: () => "2026-06-02", queryModel: null });
  curateFacts(app, {
    ticker: "NVDA",
    facts: [{ fact: "NVDA CUDA lock-in", citationUrl: "https://nvidianews.nvidia.com/x", scope: "ticker", significance: 0.88, category: "moat" }],
    runId: "r1", reportId: "rep1", journalEntryId: "j1", now: NOW,
  });
});

describe("serializeFact → AiInsight", () => {
  test("produces the canonical fact shape with tags, ticker, significance, and citation", () => {
    const raw = app.repos.knowledge.listCuratedFacts()[0]!;
    const insight = serializeFact(app, raw);
    expect(insight.kind).toBe("fact");
    expect(insight.level).toBe("fact");
    expect(insight.date).toBe("2026-06-02");
    expect(insight.subject).toBe("NVDA");
    expect(insight.headline).toBe("NVDA CUDA lock-in");
    expect(insight.body).toBe("");
    expect(insight.stance).toBeNull();
    expect(insight.significance).toBe(0.88);
    expect(insight.tickers).toEqual(["NVDA"]);
    expect(insight.tags).toContainEqual({ dimension: "ticker", value: "NVDA", source: "ai" });
    expect(insight.sources).toEqual([{ title: "nvidianews.nvidia.com", url: "https://nvidianews.nvidia.com/x" }]);
    expect(insight.status).toBe("active");
    expect(insight.provenance.runId).toBe("r1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/knowledge/serialize.test.ts`
Expected: FAIL — `Cannot find module './serialize.ts'`.

- [ ] **Step 3: Implement the serializer**

Create `src/knowledge/serialize.ts`:

```ts
import type { App } from "../app.ts";
import { nodeId } from "../domain/index.ts";
import type { InsightTag } from "../db/repositories/insightTags.ts";

/** One canonical, tagged shape for any AI-produced knowledge — the contract every consumer reads.
 *  Phase 1 emits the `kind: "fact"` variant; Phase 3 fills the thesis fields. */
export type AiInsight = {
  id: string;
  kind: "fact" | "thesis";
  level: "fact" | "regime" | "sector" | "theme";
  date: string;
  createdAt: string;
  subject: string;
  headline: string;
  body: string;
  stance: string | null;
  conviction: number | null;
  horizon: string | null;
  significance: number | null;
  tags: InsightTag[];
  tickers: string[];
  sources: { title: string; url: string }[];
  status: "active" | "superseded" | "archived";
  provenance: { runId: string | null; reportId: string | null; journalEntryId?: string };
};

/** The flat fact row shape returned by `knowledge.listCuratedFacts()`. */
type CuratedFactRow = {
  id: string;
  ticker: string | null;
  scope: string;
  fact: string;
  citationUrl: string | null;
  createdAt: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function serializeFact(app: App, row: CuratedFactRow): AiInsight {
  const node = nodeId("source", row.id);
  const tags = app.repos.insightTags.tagsFor(node);
  const data = app.repos.graph.getNode(node)?.data ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    id: row.id,
    kind: "fact",
    level: "fact",
    date: row.createdAt.slice(0, 10),
    createdAt: row.createdAt,
    subject: row.ticker ?? "global",
    headline: row.fact,
    body: "",
    stance: null,
    conviction: null,
    horizon: null,
    significance: num(data.significance),
    tags,
    tickers: tags.filter((t) => t.dimension === "ticker").map((t) => t.value),
    sources: row.citationUrl ? [{ title: hostOf(row.citationUrl), url: row.citationUrl }] : [],
    status: "active",
    provenance: {
      runId: str(data.runId),
      reportId: str(data.reportId),
      journalEntryId: str(data.journalEntryId) ?? undefined,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/knowledge/serialize.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/knowledge/serialize.ts src/knowledge/serialize.test.ts
git commit -m "feat(ai-library): canonical AiInsight serializer (fact variant)"
```

---

## Task 6: AI Library API routes

**Files:**
- Create: `src/server/routes/aiKnowledge.ts`
- Modify: `src/server/app.ts` (import + mount)
- Test: `src/server/aiKnowledge.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/server/aiKnowledge.test.ts`:

```ts
import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";
import { curateFacts } from "../knowledge/curate.ts";

const DATE = "2026-06-02";
let app: App;
let server: ReturnType<typeof createServer>;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE });
  server = createServer(app);
  curateFacts(app, {
    ticker: "NVDA",
    facts: [{ fact: "NVDA CUDA lock-in", citationUrl: "https://x.com/a", scope: "ticker", significance: 0.9, category: "moat" }],
    runId: "r1", reportId: "rep1", journalEntryId: "j1", now: `${DATE}T10:00:00.000Z`,
  });
});
const req = (path: string, init?: RequestInit) => server.fetch(new Request(`http://test/api${path}`, init));

describe("AI Library routes", () => {
  test("GET /ai-library/days returns day buckets with counts", async () => {
    const body = (await (await req("/ai-library/days")).json()) as { days: { date: string; factCount: number }[] };
    expect(body.days).toContainEqual({ date: DATE, factCount: 1 });
  });

  test("GET /ai-library/day/:date returns serialized insights", async () => {
    const body = (await (await req(`/ai-library/day/${DATE}`)).json()) as { facts: { headline: string }[] };
    expect(body.facts[0]!.headline).toBe("NVDA CUDA lock-in");
  });

  test("GET /ai-library/search filters by text and tag", async () => {
    const byText = (await (await req("/ai-library/search?q=cuda")).json()) as { insights: unknown[] };
    expect(byText.insights.length).toBe(1);
    const byTag = (await (await req("/ai-library/search?dimension=ticker&value=NVDA")).json()) as { insights: unknown[] };
    expect(byTag.insights.length).toBe(1);
    const miss = (await (await req("/ai-library/search?q=zzzznope")).json()) as { insights: unknown[] };
    expect(miss.insights.length).toBe(0);
  });

  test("GET /tags returns a taxonomy", async () => {
    const body = (await (await req("/tags")).json()) as { tags: { dimension: string; value: string; count: number }[] };
    expect(body.tags).toContainEqual({ dimension: "ticker", value: "NVDA", count: 1 });
  });

  test("PUT /ai-insights/fact/:id/tags adds a human tag", async () => {
    const id = app.repos.knowledge.listCuratedFacts()[0]!.id;
    const res = await req(`/ai-insights/fact/${id}/tags`, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ add: [{ dimension: "theme", value: "ai-infra" }], remove: [] }),
    });
    expect(res.status).toBe(200);
    const tags = (await res.json()) as { tags: { dimension: string; value: string; source: string }[] };
    expect(tags.tags).toContainEqual({ dimension: "theme", value: "ai-infra", source: "human" });
  });

  test("DELETE /ai-insights/fact/:id archives it (gone from the library)", async () => {
    const id = app.repos.knowledge.listCuratedFacts()[0]!.id;
    expect((await req(`/ai-insights/fact/${id}`, { method: "DELETE" })).status).toBe(200);
    expect(app.repos.knowledge.listCuratedFacts().length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/server/aiKnowledge.test.ts`
Expected: FAIL — 404s (routes not mounted).

- [ ] **Step 3: Implement the routes**

Create `src/server/routes/aiKnowledge.ts`:

```ts
import { Hono } from "hono";
import { z } from "zod";
import type { App } from "../../app.ts";
import { nodeId } from "../../domain/index.ts";
import { serializeFact } from "../../knowledge/serialize.ts";
import type { TagDimension } from "../../db/repositories/insightTags.ts";

const Dimension = z.enum(["ticker", "sector", "theme", "direction", "horizon"]);
const TagEdit = z.object({
  add: z.array(z.object({ dimension: Dimension, value: z.string().min(1) })).default([]),
  remove: z.array(z.object({ dimension: Dimension, value: z.string().min(1) })).default([]),
});

/** The AI's own knowledge: searchable, tagged, day-sectioned, archive-hidden. Facts only in Phase 1;
 *  theses (Phase 3) extend the same serializer + routes. Mounted at "/" so paths are absolute. */
export function aiKnowledgeRoutes(app: App): Hono {
  const r = new Hono();

  // All active self-curated facts, serialized to the canonical shape (small, bounded volume).
  const allFacts = () => app.repos.knowledge.listCuratedFacts().map((f) => serializeFact(app, f));

  r.get("/ai-library/days", (c) => {
    const counts = new Map<string, number>();
    for (const f of app.repos.knowledge.listCuratedFacts()) {
      const day = f.createdAt.slice(0, 10);
      counts.set(day, (counts.get(day) ?? 0) + 1);
    }
    return c.json({ days: [...counts.entries()].map(([date, factCount]) => ({ date, factCount })) });
  });

  r.get("/ai-library/day/:date", (c) => {
    const date = c.req.param("date");
    return c.json({ date, facts: allFacts().filter((i) => i.date === date) });
  });

  r.get("/ai-library/search", (c) => {
    const q = c.req.query("q")?.trim().toLowerCase();
    const dimension = c.req.query("dimension") as TagDimension | undefined;
    const value = c.req.query("value");
    const limit = Number(c.req.query("limit") ?? 50);
    let insights = allFacts();
    if (q) insights = insights.filter((i) => i.headline.toLowerCase().includes(q));
    if (dimension && value) insights = insights.filter((i) => i.tags.some((t) => t.dimension === dimension && t.value === value));
    return c.json({ insights: insights.slice(0, limit) });
  });

  r.get("/tags", (c) => c.json({ tags: app.repos.insightTags.taxonomy() }));

  r.put("/ai-insights/:kind/:id/tags", async (c) => {
    const id = c.req.param("id");
    const node = nodeId("source", id); // Phase 1: only fact insights, backed by source nodes
    const body = TagEdit.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.flatten() }, 400);
    const now = new Date().toISOString();
    for (const t of body.data.remove) app.repos.insightTags.removeTag(node, t.dimension, t.value);
    for (const t of body.data.add) app.repos.insightTags.addTag(node, { ...t, source: "human" }, now);
    return c.json({ tags: app.repos.insightTags.tagsFor(node) });
  });

  // Archive (provenance preserved; chunks deactivated) — the fact disappears from the library.
  r.delete("/ai-insights/:kind/:id", (c) => {
    const id = c.req.param("id");
    const updated = app.repos.knowledge.updateSource(id, { status: "archived" }, new Date().toISOString());
    if (!updated) return c.json({ error: "not found" }, 404);
    app.repos.knowledge.deactivateChunksForSource(id);
    return c.json({ ok: true, archived: id });
  });

  return r;
}
```

- [ ] **Step 4: Mount the routes**

In `src/server/app.ts`, add the import near the other route imports (after line 11):

```ts
import { aiKnowledgeRoutes } from "./routes/aiKnowledge.ts";
```
and mount it after the `/knowledge` route (after line 29):
```ts
  api.route("/", aiKnowledgeRoutes(app)); // /ai-library, /tags, /ai-insights
```

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test src/server/aiKnowledge.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/server/routes/aiKnowledge.ts src/server/app.ts src/server/aiKnowledge.test.ts
git commit -m "feat(ai-library): /ai-library, /tags, /ai-insights routes"
```

---

## Task 7: `search_ai_insights` query tool

**Files:**
- Modify: `src/query/tools.ts` (import + new tool in the `QUERY_TOOLS` array)
- Test: `src/query/tools.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `src/query/tools.test.ts` (inside the existing `describe("query tools registry", ...)` block, before its closing `});`):

```ts
  test("search_ai_insights returns the AI's curated facts by text and tag, with citations", async () => {
    const { curateFacts } = await import("../knowledge/curate.ts");
    curateFacts(app, {
      ticker: "NVDA",
      facts: [{ fact: "NVDA CUDA lock-in is a durable moat", citationUrl: "https://x.com/a", scope: "ticker", significance: 0.9, category: "moat" }],
      runId: "r1", reportId: "rep1", journalEntryId: "j1", now: "2026-06-02T10:00:00.000Z",
    });
    const t = tool("search_ai_insights");
    const res = (await t.run(app, { query: "cuda" })) as { insights: { headline: string }[] };
    expect(res.insights[0]!.headline).toContain("CUDA");
    const cites = t.cite!({ query: "cuda" }, res);
    expect(cites[0]!.title).toBe("x.com");
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test src/query/tools.test.ts`
Expected: FAIL — `QUERY_TOOLS_BY_NAME.get("search_ai_insights")` is undefined.

- [ ] **Step 3: Implement the tool**

In `src/query/tools.ts`, add to the imports at the top:

```ts
import { serializeFact } from "../knowledge/serialize.ts";
```

Then add this tool object inside the `QUERY_TOOLS` array, immediately before the closing `];` (after the `knowledge_search` tool):

```ts
  {
    name: "search_ai_insights",
    description:
      "Search the AI's OWN curated knowledge (durable facts it chose to remember) by text and/or tag (dimension=sector|ticker|theme|direction|horizon with a value). Returns tagged, cited insights — grounded, not recall.",
    parameters: obj({ query: S, dimension: S, value: S }),
    run(app, args) {
      const query = str(args.query)?.toLowerCase();
      const dimension = str(args.dimension);
      const value = str(args.value);
      let insights = app.repos.knowledge.listCuratedFacts().map((f) => serializeFact(app, f));
      if (query) insights = insights.filter((i) => i.headline.toLowerCase().includes(query));
      if (dimension && value) insights = insights.filter((i) => i.tags.some((t) => t.dimension === dimension && t.value === value));
      return { insights: cap(insights, 12) };
    },
    cite(_args, result) {
      const insights = (result as { insights?: { headline: string; date: string; subject: string; sources: { title: string; url: string }[] }[] }).insights ?? [];
      return insights
        .filter((i) => i.sources.length > 0)
        .map((i) => ({ kind: "knowledge", title: i.sources[0]!.title, ticker: i.subject, trust: "self_curated", date: i.date, excerpt: i.headline, url: i.sources[0]!.url }));
    },
  },
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test src/query/tools.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/query/tools.ts src/query/tools.test.ts
git commit -m "feat(query): search_ai_insights tool over the AI's curated knowledge"
```

---

## Task 8: Frontend API client + hooks

**Files:**
- Modify: `web/src/api/client.ts`
- Modify: `web/src/api/hooks.ts`

- [ ] **Step 1: Add types + client methods**

In `web/src/api/client.ts`, after the `CuratedDay` type (line 49) add:

```ts
/** A tag triple as served by the AI Library API. */
export type InsightTag = { dimension: string; value: string; source: "ai" | "human" };

/** The canonical AI-knowledge shape (Phase 1: facts). */
export type AiInsight = {
  id: string;
  kind: "fact" | "thesis";
  level: string;
  date: string;
  createdAt: string;
  subject: string;
  headline: string;
  body: string;
  stance: string | null;
  conviction: number | null;
  horizon: string | null;
  significance: number | null;
  tags: InsightTag[];
  tickers: string[];
  sources: { title: string; url: string }[];
  status: string;
  provenance: { runId: string | null; reportId: string | null; journalEntryId?: string };
};
export type AiLibraryDay = { date: string; factCount: number };
export type TagCount = { dimension: string; value: string; count: number };
export type TagEdit = { add: { dimension: string; value: string }[]; remove: { dimension: string; value: string }[] };
```

Then, inside the object literal that holds the client methods (the same object that contains `curatedMemory:` on line 120), add after `curatedMemory`:

```ts
  aiLibraryDays: () => api<{ days: AiLibraryDay[] }>("/ai-library/days"),
  aiLibraryDay: (date: string) => api<{ date: string; facts: AiInsight[] }>(`/ai-library/day/${date}`),
  aiLibrarySearch: (params: { q?: string; dimension?: string; value?: string }) => {
    const qs = new URLSearchParams();
    if (params.q) qs.set("q", params.q);
    if (params.dimension && params.value) {
      qs.set("dimension", params.dimension);
      qs.set("value", params.value);
    }
    return api<{ insights: AiInsight[] }>(`/ai-library/search?${qs.toString()}`);
  },
  tags: () => api<{ tags: TagCount[] }>("/tags"),
  editInsightTags: (kind: string, id: string, body: TagEdit) =>
    api<{ tags: InsightTag[] }>(`/ai-insights/${kind}/${id}/tags`, { method: "PUT", body: JSON.stringify(body) }),
  archiveInsight: (kind: string, id: string) =>
    api<{ ok: boolean }>(`/ai-insights/${kind}/${id}`, { method: "DELETE" }),
```

- [ ] **Step 2: Add hooks**

In `web/src/api/hooks.ts`, after the `useCuratedMemory` hook (ends line 108) add:

```ts
const aiLibraryKey = ["aiLibrary"] as const;

export const useAiLibraryDays = () =>
  useQuery({ queryKey: [...aiLibraryKey, "days"], queryFn: client.aiLibraryDays });

export const useAiLibraryDay = (date: string | null) =>
  useQuery({ queryKey: [...aiLibraryKey, "day", date], queryFn: () => client.aiLibraryDay(date!), enabled: !!date });

export const useAiLibrarySearch = (params: { q?: string; dimension?: string; value?: string }) =>
  useQuery({
    queryKey: [...aiLibraryKey, "search", params],
    queryFn: () => client.aiLibrarySearch(params),
    enabled: !!(params.q || (params.dimension && params.value)),
  });

export const useTags = () => useQuery({ queryKey: [...aiLibraryKey, "tags"], queryFn: client.tags });

export const useEditInsightTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id, body }: { kind: string; id: string; body: import("./client.ts").TagEdit }) =>
      client.editInsightTags(kind, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiLibraryKey }),
  });
};

export const useArchiveInsight = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: string; id: string }) => client.archiveInsight(kind, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiLibraryKey }),
  });
};
```

> Note: confirm `useQueryClient` is imported at the top of `hooks.ts` (it is used by `useInvalidateAll`). If `useMutation`/`useQuery` imports are present (they are), no import changes are needed.

- [ ] **Step 3: Typecheck the web app**

Run: `cd web && bunx tsc --noEmit && cd ..`
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add web/src/api/client.ts web/src/api/hooks.ts
git commit -m "feat(web): AI Library API client + hooks (insights, tags, search)"
```

---

## Task 9: AI Library component + its own Section

**Files:**
- Create: `web/src/components/AiLibrary.tsx`
- Modify: `web/src/App.tsx:194-199` (import + Section)
- Modify: `web/src/components/KnowledgeLibrary.tsx:28` (drop `self_curated` label)
- Delete: `web/src/components/CuratedMemory.tsx`

- [ ] **Step 1: Create the `AiLibrary` component**

Create `web/src/components/AiLibrary.tsx`:

```tsx
import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Search, Sparkles, Trash2, X } from "lucide-react";
import type { AiInsight } from "../api/client.ts";
import { useAiLibraryDay, useAiLibraryDays, useAiLibrarySearch, useArchiveInsight, useEditInsightTags, useTags } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The AI's own knowledge library: durable, citable facts it chose to remember — day-sectioned,
 *  searchable, tag-filterable, archive-hidden. Separate from the user's personal Knowledge Library. */
export function AiLibrary() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<{ dimension: string; value: string } | null>(null);
  const days = useAiLibraryDays();
  const tags = useTags();
  const searching = q.trim().length > 0 || tag !== null;
  const search = useAiLibrarySearch({ q: q.trim() || undefined, dimension: tag?.dimension, value: tag?.value });

  const total = useMemo(() => (days.data?.days ?? []).reduce((n, d) => n + d.factCount, 0), [days.data]);

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">AI knowledge library</p>
        {days.data && <Badge tone="neutral">{total}</Badge>}
        <span className="ml-auto text-[11px] text-text-muted">durable facts the AI saved — fed back into analysis</span>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-hairline px-3 py-2">
        <Search className="h-4 w-4 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search insights…"
          className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-text-muted"
        />
      </div>

      {(tags.data?.tags ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(tags.data?.tags ?? []).slice(0, 24).map((t) => {
            const active = tag?.dimension === t.dimension && tag?.value === t.value;
            return (
              <button
                key={`${t.dimension}:${t.value}`}
                onClick={() => setTag(active ? null : { dimension: t.dimension, value: t.value })}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  active ? "border-accent bg-accent/10 text-accent" : "border-hairline text-text-muted hover:text-text",
                )}
              >
                {t.dimension}:{t.value} <span className="opacity-60">{t.count}</span>
              </button>
            );
          })}
          {tag && (
            <button onClick={() => setTag(null)} className="inline-flex items-center gap-0.5 text-[10px] text-text-muted hover:text-text">
              <X className="h-3 w-3" /> clear
            </button>
          )}
        </div>
      )}

      {searching ? (
        search.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (search.data?.insights ?? []).length === 0 ? (
          <Empty text="No insights match." />
        ) : (
          <div className="divide-y divide-hairline">
            {(search.data?.insights ?? []).map((i) => (
              <InsightRow key={i.id} insight={i} />
            ))}
          </div>
        )
      ) : days.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (days.data?.days ?? []).length === 0 ? (
        <Empty text="Nothing curated yet — when the analysis surfaces a durable, structural fact worth remembering, it lands here." />
      ) : (
        <div className="divide-y divide-hairline">
          {(days.data?.days ?? []).map((d, i) => (
            <DayGroup key={d.date} date={d.date} factCount={d.factCount} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">{text}</p>;
}

function DayGroup({ date, factCount, defaultOpen }: { date: string; factCount: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const day = useAiLibraryDay(open ? date : null);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        <span className="font-medium text-text">{dayLabel(date)}</span>
        <span className="ml-auto">
          <Badge tone="neutral">{factCount} {factCount === 1 ? "fact" : "facts"}</Badge>
        </span>
      </button>
      {open && (
        <div className="border-l border-hairline pl-3 pb-2">
          {day.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="divide-y divide-hairline">
              {(day.data?.facts ?? []).map((i) => (
                <InsightRow key={i.id} insight={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightRow({ insight }: { insight: AiInsight }) {
  const archive = useArchiveInsight();
  const editTags = useEditInsightTags();
  const source = insight.sources[0] ?? null;

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-text">{insight.headline}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
          <Badge tone="accent">self-curated</Badge>
          {insight.significance != null && <span>sig {insight.significance.toFixed(2)}</span>}
          {insight.tags.map((t) => (
            <button
              key={`${t.dimension}:${t.value}`}
              onClick={() => editTags.mutate({ kind: insight.kind, id: insight.id, body: { add: [], remove: [{ dimension: t.dimension, value: t.value }] } })}
              title="Remove tag"
              className="group inline-flex items-center gap-0.5 rounded-full border border-hairline px-1.5 py-0.5 hover:border-neg hover:text-neg"
            >
              {t.dimension}:{t.value}
              <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
          {source && (
            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              <ExternalLink className="h-3 w-3" />
              {source.title}
            </a>
          )}
        </div>
      </div>
      <button
        onClick={() => archive.mutate({ kind: insight.kind, id: insight.id })}
        disabled={archive.isPending}
        title="Remove from memory (stops feeding analysis; provenance preserved)"
        className="mt-0.5 shrink-0 text-text-muted hover:text-neg disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Give it its own Section in `App.tsx`**

In `web/src/App.tsx`, replace the import of `CuratedMemory` (line 18 area: `import { CuratedMemory } from "./components/CuratedMemory.tsx";`) with:

```tsx
import { AiLibrary } from "./components/AiLibrary.tsx";
```

Then replace the "Knowledge library" Section block (lines 194-199) with two separate sections:

```tsx
        <Section title="Knowledge library" index={6}>
          <KnowledgeLibrary />
        </Section>

        <Section title="AI knowledge library" index={7}>
          <AiLibrary />
        </Section>
```

- [ ] **Step 3: Drop the dead `self_curated` label from KnowledgeLibrary**

In `web/src/components/KnowledgeLibrary.tsx`, remove the `self_curated: "ai-curated",` entry from the `TRUST_LABEL` map (line 28) — self-curated facts no longer reach this component.

- [ ] **Step 4: Delete the obsolete component**

```bash
git rm web/src/components/CuratedMemory.tsx
```

- [ ] **Step 5: Typecheck + build the web app**

Run: `cd web && bunx tsc --noEmit && bun run build && cd ..`
Expected: no type errors; build succeeds. (If `CuratedMemory` is referenced anywhere else, grep `rg CuratedMemory web/src` and remove those references.)

- [ ] **Step 6: Commit**

```bash
git add web/src/components/AiLibrary.tsx web/src/App.tsx web/src/components/KnowledgeLibrary.tsx
git commit -m "feat(web): AI Library section (search, tag chips, archive) replacing CuratedMemory"
```

---

## Task 10: Full-suite verification + docs

**Files:**
- Modify: `docs/architecture-and-roadmap.md`

- [ ] **Step 1: Run the entire backend suite**

Run: `bun test`
Expected: all PASS (existing + new). Investigate any failure before proceeding.

- [ ] **Step 2: Update the architecture doc**

In `docs/architecture-and-roadmap.md`, add a short subsection documenting: the AI Library is the sole home for `self_curated` facts (personal library excludes them); the significance/category curation gate; graph-native tags (`insightTags`); the canonical `AiInsight` serializer; the `/ai-library`, `/tags`, `/ai-insights` routes and the `search_ai_insights` tool. Note Phase 2 (daily tracking) and Phase 3 (theses/Market View) are pending.

- [ ] **Step 3: Commit**

```bash
git add docs/architecture-and-roadmap.md
git commit -m "docs: record Phase 1 AI Library architecture"
```

---

## Self-Review (completed by plan author)

**Spec coverage (Phase 1 sections of the spec):**
- §1.1 user-only library → Task 1. ✓
- §1.2 significance/category gate + top-N + near-dup + prompt → Tasks 2, 3. ✓
- §1.3 tagging (`insightTags`, auto-tag, human edit) → Tasks 4 (repo+auto-tag), 6 (PUT tags). ✓
- §1.4 canonical serializer + AI Library API + `search_ai_insights` → Tasks 5, 6, 7. ✓
- §1.5 frontend (`AiLibrary`, search, chips, archive, own Section; `KnowledgeLibrary` user-only) → Tasks 8, 9. ✓
- §4 canonical `AiInsight` shape → Task 5 (matches spec fields incl. `significance`). ✓
- §5 tag dimensions/edges/`{source}` in edge data → Task 4. ✓

**Type consistency:** `AiInsight` fields identical in `serialize.ts` (Task 5) and `client.ts` (Task 8). `InsightTag = {dimension,value,source}` identical in `insightTags.ts` (Task 4), serializer, and client. `addTag/removeTag/tagsFor/insightNodeIdsForTag/taxonomy` signatures used consistently in Tasks 4/5/6/7. Route paths (`/ai-library/days|day/:date|search`, `/tags`, `/ai-insights/:kind/:id[/tags]`) identical across Tasks 6/8.

**Placeholder scan:** none — every code step contains complete code.

**Deviation noted for reviewer:** AI Library search is in-memory over `listCuratedFacts()` (substring + tag filter), not FTS. Justified by bounded self-curated volume (≤40/scope) and avoiding the `nodeId` slug→sourceId reverse-mapping problem. Phase 3 adds `ai_theses_fts`; revisit fact FTS then if volume grows.
