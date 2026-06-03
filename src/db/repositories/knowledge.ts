import type { DB } from "../connection.ts";
import {
  IngestionRun,
  KnowledgeChunk,
  KnowledgeSource,
  KnowledgeVersion,
  RecommendationEvidence,
  type SourceStatus,
} from "../../domain/index.ts";

type SourceRow = {
  id: string;
  kind: string;
  title: string;
  trust_class: string;
  scope: string;
  scope_ticker: string | null;
  use_in_analysis: number;
  status: string;
  origin: string | null;
  created_at: string;
  updated_at: string;
};

const sourceToDomain = (r: SourceRow): KnowledgeSource =>
  KnowledgeSource.parse({
    id: r.id,
    kind: r.kind,
    title: r.title,
    trustClass: r.trust_class,
    scope: r.scope,
    scopeTicker: r.scope_ticker,
    useInAnalysis: r.use_in_analysis === 1,
    status: r.status,
    origin: r.origin,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  });

/** A chunk joined with its source's provenance — the row shape retrieval turns into an excerpt. */
export type SearchHit = {
  chunk_id: string;
  source_id: string;
  title: string;
  trust_class: string;
  version: number;
  created_at: string;
  text: string;
  score?: number; // bm25 relevance (lower = better); set by searchActiveChunks only
};

export function knowledgeRepo(db: DB) {
  return {
    // ---- sources ---------------------------------------------------------
    insertSource(s: KnowledgeSource): KnowledgeSource {
      const v = KnowledgeSource.parse(s);
      db.query(
        `INSERT INTO knowledge_sources
           (id, kind, title, trust_class, scope, scope_ticker, use_in_analysis, status, origin, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        v.id, v.kind, v.title, v.trustClass, v.scope, v.scopeTicker,
        v.useInAnalysis ? 1 : 0, v.status, v.origin, v.createdAt, v.updatedAt,
      );
      return v;
    },

    getSource(id: string): KnowledgeSource | null {
      const row = db.query<SourceRow, [string]>("SELECT * FROM knowledge_sources WHERE id = ?").get(id);
      return row ? sourceToDomain(row) : null;
    },

    listSources(opts: { status?: SourceStatus } = {}): KnowledgeSource[] {
      const rows = opts.status
        ? db.query<SourceRow, [string]>("SELECT * FROM knowledge_sources WHERE status = ? ORDER BY updated_at DESC").all(opts.status)
        : db.query<SourceRow, []>("SELECT * FROM knowledge_sources ORDER BY updated_at DESC").all();
      return rows.map(sourceToDomain);
    },

    /** User-owned sources only — the notes/URLs/uploads the user ingested. Allowlists those kinds
     *  rather than excluding `self_curated`, so AI facts AND any system-generated content (e.g.
     *  `system_lesson`) can never surface in the personal library, whatever trust class they carry. */
    listUserSources(opts: { status?: SourceStatus } = {}): KnowledgeSource[] {
      const rows = opts.status
        ? db
            .query<SourceRow, [string]>(
              "SELECT * FROM knowledge_sources WHERE kind IN ('note','url','upload') AND status = ? ORDER BY updated_at DESC",
            )
            .all(opts.status)
        : db
            .query<SourceRow, []>(
              "SELECT * FROM knowledge_sources WHERE kind IN ('note','url','upload') ORDER BY updated_at DESC",
            )
            .all();
      return rows.map(sourceToDomain);
    },

    updateSource(
      id: string,
      patch: { title?: string; scope?: string; scopeTicker?: string | null; useInAnalysis?: boolean; status?: SourceStatus },
      now: string,
    ): KnowledgeSource | null {
      const existing = this.getSource(id);
      if (!existing) return null;
      const next = KnowledgeSource.parse({
        ...existing,
        title: patch.title ?? existing.title,
        scope: patch.scope ?? existing.scope,
        scopeTicker: patch.scopeTicker !== undefined ? patch.scopeTicker : existing.scopeTicker,
        useInAnalysis: patch.useInAnalysis ?? existing.useInAnalysis,
        status: patch.status ?? existing.status,
        updatedAt: now,
      });
      db.query(
        `UPDATE knowledge_sources SET title=?, scope=?, scope_ticker=?, use_in_analysis=?, status=?, updated_at=? WHERE id=?`,
      ).run(next.title, next.scope, next.scopeTicker, next.useInAnalysis ? 1 : 0, next.status, next.updatedAt, id);
      return next;
    },

    // ---- versions --------------------------------------------------------
    insertVersion(v: KnowledgeVersion): KnowledgeVersion {
      const x = KnowledgeVersion.parse(v);
      db.query(
        `INSERT INTO knowledge_versions (id, source_id, version, content_hash, char_count, raw_path, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(x.id, x.sourceId, x.version, x.contentHash, x.charCount, x.rawPath, x.createdAt);
      return x;
    },

    nextVersionNumber(sourceId: string): number {
      const row = db
        .query<{ n: number | null }, [string]>("SELECT MAX(version) AS n FROM knowledge_versions WHERE source_id = ?")
        .get(sourceId);
      return (row?.n ?? 0) + 1;
    },

    versionsBySource(sourceId: string): KnowledgeVersion[] {
      type VRow = { id: string; source_id: string; version: number; content_hash: string; char_count: number; raw_path: string | null; created_at: string };
      return db
        .query<VRow, [string]>("SELECT * FROM knowledge_versions WHERE source_id = ? ORDER BY version DESC")
        .all(sourceId)
        .map((r) =>
          KnowledgeVersion.parse({
            id: r.id, sourceId: r.source_id, version: r.version, contentHash: r.content_hash,
            charCount: r.char_count, rawPath: r.raw_path, createdAt: r.created_at,
          }),
        );
    },

    // ---- chunks (+ FTS sync) --------------------------------------------
    insertChunk(c: KnowledgeChunk): KnowledgeChunk {
      const x = KnowledgeChunk.parse(c);
      db.query(
        `INSERT INTO knowledge_chunks (id, source_id, version_id, ordinal, text, char_count, active, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(x.id, x.sourceId, x.versionId, x.ordinal, x.text, x.charCount, x.active ? 1 : 0, x.createdAt);
      if (x.active) db.query("INSERT INTO knowledge_chunks_fts (chunk_id, text) VALUES (?, ?)").run(x.id, x.text);
      return x;
    },

    /** Deactivate all currently-active chunks for a source and drop them from the FTS index. */
    deactivateChunksForSource(sourceId: string): void {
      const ids = db
        .query<{ id: string }, [string]>("SELECT id FROM knowledge_chunks WHERE source_id = ? AND active = 1")
        .all(sourceId);
      db.transaction(() => {
        for (const { id } of ids) {
          db.query("UPDATE knowledge_chunks SET active = 0 WHERE id = ?").run(id);
          db.query("DELETE FROM knowledge_chunks_fts WHERE chunk_id = ?").run(id);
        }
      })();
    },

    countActiveChunks(sourceId: string): number {
      const row = db
        .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE source_id = ? AND active = 1")
        .get(sourceId);
      return row?.n ?? 0;
    },

    /**
     * Lexical FTS5 search over ACTIVE chunks of ACTIVE, analysis-enabled sources, scoped to global +
     * the given ticker. Returns hits ranked by FTS relevance (bm25). The caller applies the top-N and
     * character caps.
     */
    searchActiveChunks(matchQuery: string, opts: { ticker?: string; limit?: number }): SearchHit[] {
      if (!matchQuery.trim()) return [];
      const limit = opts.limit ?? 12;
      const ticker = opts.ticker ?? null;
      return db
        .query<SearchHit, [string, string | null, number]>(
          `SELECT c.id AS chunk_id, c.source_id AS source_id, s.title AS title,
                  s.trust_class AS trust_class, v.version AS version, v.created_at AS created_at, c.text AS text,
                  bm25(knowledge_chunks_fts) AS score
             FROM knowledge_chunks_fts f
             JOIN knowledge_chunks c ON c.id = f.chunk_id
             JOIN knowledge_sources s ON s.id = c.source_id
             JOIN knowledge_versions v ON v.id = c.version_id
            WHERE knowledge_chunks_fts MATCH ?
              AND c.active = 1
              AND s.status = 'active'
              AND s.use_in_analysis = 1
              AND (s.scope = 'global' OR s.scope_ticker = ?)
            ORDER BY bm25(knowledge_chunks_fts)
            LIMIT ?`,
        )
        .all(matchQuery, ticker, limit);
    },

    /** Active chunks of an explicit set of sources (graph-linked retrieval), respecting status + opt-in. */
    activeChunksForSources(sourceIds: string[], limit: number): SearchHit[] {
      if (sourceIds.length === 0) return [];
      const placeholders = sourceIds.map(() => "?").join(",");
      return db
        .query<SearchHit, (string | number)[]>(
          `SELECT c.id AS chunk_id, c.source_id AS source_id, s.title AS title,
                  s.trust_class AS trust_class, v.version AS version, v.created_at AS created_at, c.text AS text
             FROM knowledge_chunks c
             JOIN knowledge_sources s ON s.id = c.source_id
             JOIN knowledge_versions v ON v.id = c.version_id
            WHERE c.active = 1
              AND s.status = 'active'
              AND s.use_in_analysis = 1
              AND c.source_id IN (${placeholders})
            ORDER BY c.ordinal
            LIMIT ?`,
        )
        .all(...sourceIds, limit);
    },

    /** Active chunks of sources explicitly scoped to `ticker` (no text match needed — scope is intent). */
    scopedActiveChunks(ticker: string, limit: number): SearchHit[] {
      return db
        .query<SearchHit, [string, number]>(
          `SELECT c.id AS chunk_id, c.source_id AS source_id, s.title AS title,
                  s.trust_class AS trust_class, v.version AS version, v.created_at AS created_at, c.text AS text
             FROM knowledge_chunks c
             JOIN knowledge_sources s ON s.id = c.source_id
             JOIN knowledge_versions v ON v.id = c.version_id
            WHERE c.active = 1
              AND s.status = 'active'
              AND s.use_in_analysis = 1
              AND s.scope = 'ticker'
              AND s.scope_ticker = ?
            ORDER BY c.ordinal
            LIMIT ?`,
        )
        .all(ticker, limit);
    },

    // ---- self-curated facts ---------------------------------------------
    /**
     * Active self-curated fact texts relevant to a ticker (its own scope + global macro facts),
     * newest first. Fed into the structure prompt as the system's existing long-term memory so the
     * model only proposes net-new facts — the primary guard against a bloated, repetitive library.
     */
    selfCuratedFactsForTicker(ticker: string, limit = 40): string[] {
      return db
        .query<{ text: string }, [string, number]>(
          `SELECT c.text AS text
             FROM knowledge_chunks c
             JOIN knowledge_sources s ON s.id = c.source_id
            WHERE c.active = 1
              AND s.status = 'active'
              AND s.trust_class = 'self_curated'
              AND (s.scope = 'global' OR s.scope_ticker = ?)
            ORDER BY s.created_at DESC
            LIMIT ?`,
        )
        .all(ticker, limit)
        .map((r) => r.text);
    },

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

    /** Exact-dedup guard: is there already an active self_curated source in this scope whose latest
     *  content hashes to `contentHash`? (`scopeTicker` null matches global facts via `IS ?`.) */
    hasCuratedFact(contentHash: string, scopeTicker: string | null): boolean {
      const row = db
        .query<{ n: number }, [string, string | null]>(
          `SELECT COUNT(*) AS n
             FROM knowledge_versions v
             JOIN knowledge_sources s ON s.id = v.source_id
            WHERE v.content_hash = ?
              AND s.trust_class = 'self_curated'
              AND s.status = 'active'
              AND s.scope_ticker IS ?`,
        )
        .get(contentHash, scopeTicker);
      return (row?.n ?? 0) > 0;
    },

    /** Ids of active self_curated sources in a scope, OLDEST first — for cap enforcement (archive the
     *  overflow beyond MAX_CURATED_PER_TICKER). `scopeTicker` null targets global facts. */
    curatedSourceIdsForScope(scopeTicker: string | null): string[] {
      return db
        .query<{ id: string }, [string | null]>(
          `SELECT id FROM knowledge_sources
            WHERE trust_class = 'self_curated' AND status = 'active' AND scope_ticker IS ?
            ORDER BY created_at ASC`,
        )
        .all(scopeTicker)
        .map((r) => r.id);
    },

    /** Active self-curated facts as flat rows (newest first); the route groups them by day for the UI. */
    listCuratedFacts(limit = 500): {
      id: string;
      ticker: string | null;
      scope: string;
      fact: string;
      citationUrl: string | null;
      createdAt: string;
    }[] {
      return db
        .query<
          { id: string; ticker: string | null; scope: string; fact: string; citationUrl: string | null; createdAt: string },
          [number]
        >(
          `SELECT s.id AS id, s.scope_ticker AS ticker, s.scope AS scope, c.text AS fact,
                  s.origin AS citationUrl, s.created_at AS createdAt
             FROM knowledge_sources s
             JOIN knowledge_chunks c ON c.source_id = s.id AND c.active = 1
            WHERE s.trust_class = 'self_curated' AND s.status = 'active'
            ORDER BY s.created_at DESC
            LIMIT ?`,
        )
        .all(limit);
    },

    // ---- ingestion runs --------------------------------------------------
    insertIngestionRun(r: IngestionRun): IngestionRun {
      const x = IngestionRun.parse(r);
      db.query(
        `INSERT INTO knowledge_ingestion_runs (id, source_id, version_id, status, warnings_json, reason, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(x.id, x.sourceId, x.versionId, x.status, JSON.stringify(x.warnings), x.reason, x.createdAt);
      return x;
    },

    // ---- recommendation evidence ----------------------------------------
    insertEvidence(e: RecommendationEvidence): RecommendationEvidence {
      const x = RecommendationEvidence.parse(e);
      db.query(
        `INSERT INTO recommendation_evidence (id, journal_entry_id, chunk_id, source_id, rank, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(x.id, x.journalEntryId, x.chunkId, x.sourceId, x.rank, x.createdAt);
      return x;
    },

    evidenceByEntry(journalEntryId: string): RecommendationEvidence[] {
      type ERow = { id: string; journal_entry_id: string; chunk_id: string; source_id: string; rank: number; created_at: string };
      return db
        .query<ERow, [string]>("SELECT * FROM recommendation_evidence WHERE journal_entry_id = ? ORDER BY rank")
        .all(journalEntryId)
        .map((r) =>
          RecommendationEvidence.parse({
            id: r.id, journalEntryId: r.journal_entry_id, chunkId: r.chunk_id, sourceId: r.source_id, rank: r.rank, createdAt: r.created_at,
          }),
        );
    },
  };
}
export type KnowledgeRepo = ReturnType<typeof knowledgeRepo>;
