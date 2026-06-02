import { z } from "zod";
import { Symbol } from "./holding.ts";

/**
 * Research knowledge base (roadmap §8, 3C). User-provided documents, URL snapshots, and notes are
 * stored as immutable hashed versions of sanitized text chunks, retrieved lexically and injected into
 * the LLM's research stage as cited, *untrusted* evidence — never as instructions.
 */

// "fact" is a single self-curated claim the analyzer distilled from its own research (Phase 3C-fact).
export const SourceKind = z.enum(["upload", "url", "note", "fact"]);
export type SourceKind = z.infer<typeof SourceKind>;

// "self_curated" facts come from the LLM's own analysis (public-web grounded), distinct from the
// user's own notes/uploads and from system_lesson (the outcome-calibrated wiki).
export const TrustClass = z.enum([
  "public_url",
  "public_upload",
  "private_note",
  "system_lesson",
  "self_curated",
]);
export type TrustClass = z.infer<typeof TrustClass>;

export const SourceScope = z.enum(["global", "ticker"]);
export type SourceScope = z.infer<typeof SourceScope>;

export const SourceStatus = z.enum(["active", "quarantined", "archived"]);
export type SourceStatus = z.infer<typeof SourceStatus>;

export const KnowledgeSource = z.object({
  id: z.string().min(1),
  kind: SourceKind,
  title: z.string().min(1),
  trustClass: TrustClass,
  scope: SourceScope,
  scopeTicker: Symbol.nullable().default(null),
  /** Private notes default false — each requires explicit opt-in before retrieval into analysis. */
  useInAnalysis: z.boolean().default(true),
  status: SourceStatus.default("active"),
  origin: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type KnowledgeSource = z.infer<typeof KnowledgeSource>;

export const KnowledgeVersion = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  version: z.number().int().positive(),
  contentHash: z.string(),
  charCount: z.number().int().nonnegative(),
  rawPath: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
});
export type KnowledgeVersion = z.infer<typeof KnowledgeVersion>;

export const KnowledgeChunk = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  versionId: z.string().min(1),
  ordinal: z.number().int().nonnegative(),
  text: z.string(),
  charCount: z.number().int().nonnegative(),
  active: z.boolean().default(true),
  createdAt: z.string().datetime(),
});
export type KnowledgeChunk = z.infer<typeof KnowledgeChunk>;

export const IngestionStatus = z.enum(["ok", "quarantined", "failed"]);
export type IngestionStatus = z.infer<typeof IngestionStatus>;

export const IngestionRun = z.object({
  id: z.string().min(1),
  sourceId: z.string().min(1),
  versionId: z.string().nullable().default(null),
  status: IngestionStatus,
  warnings: z.array(z.string()).default([]),
  reason: z.string().nullable().default(null),
  createdAt: z.string().datetime(),
});
export type IngestionRun = z.infer<typeof IngestionRun>;

export const RecommendationEvidence = z.object({
  id: z.string().min(1),
  journalEntryId: z.string().min(1),
  chunkId: z.string().min(1),
  sourceId: z.string().min(1),
  rank: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
});
export type RecommendationEvidence = z.infer<typeof RecommendationEvidence>;

/** A retrieved excerpt handed to the LLM — every excerpt carries full provenance (roadmap §8). */
export const RetrievedExcerpt = z.object({
  chunkId: z.string(),
  sourceId: z.string(),
  title: z.string(),
  trustClass: TrustClass,
  version: z.number().int().positive(),
  timestamp: z.string(),
  text: z.string(),
});
export type RetrievedExcerpt = z.infer<typeof RetrievedExcerpt>;
