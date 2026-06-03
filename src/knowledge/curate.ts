import { createHash } from "node:crypto";
import type { App } from "../app.ts";
import { newId, nodeId, edgeId, type MemorableFact } from "../domain/index.ts";

/**
 * Self-curated factual memory (Phase 3C-fact). After each analysis the LLM emits a few durable,
 * structural facts (with citations) worth remembering; this module persists them as `self_curated`
 * knowledge sources so future runs retrieve them as evidence — the platform's self-updating knowledge
 * base. Bloat is held back by four guards: the prompt shows the model what it already knows (no
 * repeats), exact content-hash dedup here, a per-scope cap that archives the oldest overflow, and a
 * hard per-ticker-per-run limit.
 */

/** Facts are short claims; trim to keep the library dense and the title readable. */
const MAX_FACT_CHARS = 140;
/** Bound the self-curated library per scope; oldest facts beyond this are archived (still in history). */
export const MAX_CURATED_PER_TICKER = 40;
/** Never let a single ticker's single run flood memory, however many the model returns. */
const MAX_FACTS_PER_RUN = 3;
/** A fact must clear this model-rated decision value to be remembered. */
const MIN_SIGNIFICANCE = 0.6;
/** Reject a new fact whose token overlap with an existing one is at least this (near-duplicate). */
const NEAR_DUP_JACCARD = 0.8;

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

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

/** Collapse whitespace and clamp to the fact budget — also the dedup-normalization (hash) input. */
function normalizeFact(s: string): string {
  return s.trim().replace(/\s+/g, " ").slice(0, MAX_FACT_CHARS);
}

export type CurateInput = {
  /** The analyzed ticker — the scope for ticker-scoped facts and the provenance link for all of them. */
  ticker: string;
  facts: MemorableFact[];
  runId: string | null;
  reportId: string;
  journalEntryId: string;
  now: string;
  /** Per-scope cap override (tests). Defaults to MAX_CURATED_PER_TICKER. */
  maxPerScope?: number;
};

/** Archive the oldest active self_curated facts in a scope beyond `max` (keeps the library bounded). */
function enforceCap(app: App, scopeTicker: string | null, max: number, now: string): void {
  const ids = app.repos.knowledge.curatedSourceIdsForScope(scopeTicker); // oldest first
  const overflow = ids.length - max;
  for (let i = 0; i < overflow; i++) {
    app.repos.knowledge.updateSource(ids[i]!, { status: "archived" }, now);
    app.repos.knowledge.deactivateChunksForSource(ids[i]!);
  }
}

/**
 * Persist the analyzer's memorable facts as self_curated knowledge sources. Each fact → one source +
 * version + single chunk, linked into the graph (source —mentions→ analyzed ticker). Identical facts
 * already in the same scope are skipped. Returns counts for logging. IO but no return-value surprises;
 * a malformed/empty fact is silently skipped, never thrown.
 */
export function curateFacts(app: App, input: CurateInput): { added: number; skipped: number } {
  const max = input.maxPerScope ?? MAX_CURATED_PER_TICKER;
  let added = 0;
  let skipped = 0;
  const touchedScopes = new Set<string | null>();

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

    const sourceId = newId();
    app.repos.knowledge.insertSource({
      id: sourceId,
      kind: "fact",
      title: text,
      trustClass: "self_curated",
      scope,
      scopeTicker,
      useInAnalysis: true,
      status: "active",
      origin: citationUrl,
      createdAt: input.now,
      updatedAt: input.now,
    });
    const versionId = newId();
    app.repos.knowledge.insertVersion({
      id: versionId,
      sourceId,
      version: 1,
      contentHash: hash,
      charCount: text.length,
      rawPath: null,
      createdAt: input.now,
    });
    app.repos.knowledge.insertChunk({
      id: newId(),
      sourceId,
      versionId,
      ordinal: 0,
      text,
      charCount: text.length,
      active: true,
      createdAt: input.now,
    });

    // Graph: canonical source node (carries run provenance) —mentions→ the analyzed ticker.
    const sourceNode = nodeId("source", sourceId);
    app.repos.graph.upsertNode({
      id: sourceNode,
      type: "source",
      label: text,
      summary: `fact · self_curated`,
      data: { kind: "fact", trustClass: "self_curated", scope, runId: input.runId, reportId: input.reportId, journalEntryId: input.journalEntryId, citationUrl, significance: raw.significance, category: raw.category },
      status: "active",
      createdAt: input.now,
      updatedAt: input.now,
    });
    const tickerNode = nodeId("ticker", input.ticker);
    app.repos.graph.upsertNode({
      id: tickerNode, type: "ticker", label: input.ticker, summary: "",
      data: {}, status: "active", createdAt: input.now, updatedAt: input.now,
    });
    app.repos.graph.upsertEdge({
      id: edgeId(sourceNode, "mentions", tickerNode),
      srcId: sourceNode, dstId: tickerNode, rel: "mentions", weight: 1, data: {}, createdAt: input.now,
    });

    touchedScopes.add(scopeTicker);
    added++;
  }

  for (const scopeTicker of touchedScopes) enforceCap(app, scopeTicker, max, input.now);
  return { added, skipped };
}

/**
 * Persist curated facts for a whole report: walk each recommendation that emitted memorableFacts and
 * curate them under the recommendation's ticker. Called after the journal is persisted (so the
 * journalEntryId provenance exists). Pure orchestration over `curateFacts`.
 */
export function persistCuratedFacts(
  app: App,
  report: { id: string; recommendations: { ticker: string; memorableFacts?: MemorableFact[] }[] },
  runId: string | null,
  linkByTicker: Map<string, { journalEntryId: string }>,
  now: string = new Date().toISOString(),
): { added: number; skipped: number } {
  let added = 0;
  let skipped = 0;
  for (const rec of report.recommendations) {
    const facts = rec.memorableFacts ?? [];
    if (facts.length === 0) continue;
    const r = curateFacts(app, {
      ticker: rec.ticker,
      facts,
      runId,
      reportId: report.id,
      journalEntryId: linkByTicker.get(rec.ticker)?.journalEntryId ?? "",
      now,
    });
    added += r.added;
    skipped += r.skipped;
  }
  return { added, skipped };
}
