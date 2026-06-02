import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { App } from "../app.ts";
import {
  newId,
  nodeId,
  edgeId,
  type IngestionRun,
  type KnowledgeSource,
  type SourceScope,
  type TrustClass,
} from "../domain/index.ts";
import { extractText } from "./extract.ts";
import { chunkText } from "./chunk.ts";
import { classifyContent } from "./classify.ts";
import { safeFetch } from "./ssrf.ts";

export type IngestInput =
  | { kind: "note"; title: string; text: string; scope: SourceScope; scopeTicker?: string | null; useInAnalysis?: boolean }
  | { kind: "url"; url: string; title?: string; scope: SourceScope; scopeTicker?: string | null }
  | { kind: "upload"; title: string; filename: string; mime: string; bytes: Uint8Array; scope: SourceScope; scopeTicker?: string | null };

export type IngestResult = { source: KnowledgeSource; run: IngestionRun };

const TRUST: Record<IngestInput["kind"], TrustClass> = {
  note: "private_note",
  url: "public_url",
  upload: "public_upload",
};

const sha256 = (s: string): string => createHash("sha256").update(s).digest("hex");

function knowledgeDir(app: App): string | null {
  if (app.env.DATABASE_PATH === ":memory:") return null; // tests / in-memory: don't touch the filesystem
  return join(dirname(app.env.DATABASE_PATH), "knowledge");
}

/** Persist a new immutable version + its active chunks (FTS-indexed) for a source. */
function writeVersion(
  app: App,
  source: KnowledgeSource,
  text: string,
  rawBytes: Uint8Array | null,
): { versionId: string } {
  const now = new Date().toISOString();
  const version = app.repos.knowledge.nextVersionNumber(source.id);
  const versionId = newId();

  let rawPath: string | null = null;
  const dir = knowledgeDir(app);
  if (dir && rawBytes) {
    try {
      const sourceDir = join(dir, source.id);
      mkdirSync(sourceDir, { recursive: true });
      rawPath = join(sourceDir, `${versionId}.raw`);
      writeFileSync(rawPath, rawBytes);
    } catch {
      rawPath = null; // raw archival is best-effort; extracted text is the source of truth
    }
  }

  app.repos.knowledge.insertVersion({
    id: versionId,
    sourceId: source.id,
    version,
    contentHash: sha256(text),
    charCount: text.length,
    rawPath,
    createdAt: now,
  });

  // Re-ingest replaces the active chunk set; old chunks deactivate (history preserved, FTS pruned).
  app.repos.knowledge.deactivateChunksForSource(source.id);
  chunkText(text).forEach((chunkBody, ordinal) => {
    app.repos.knowledge.insertChunk({
      id: newId(),
      sourceId: source.id,
      versionId,
      ordinal,
      text: chunkBody,
      charCount: chunkBody.length,
      active: true,
      createdAt: now,
    });
  });

  return { versionId };
}

/** Connect the source into the knowledge graph (canonical source + ticker nodes, tagged_with edge). */
function linkGraph(app: App, source: KnowledgeSource): void {
  const now = new Date().toISOString();
  const sourceNode = nodeId("source", source.id);
  app.repos.graph.upsertNode({
    id: sourceNode,
    type: "source",
    label: source.title,
    summary: `${source.kind} · ${source.trustClass}`,
    data: { kind: source.kind, trustClass: source.trustClass, scope: source.scope },
    status: "active",
    createdAt: now,
    updatedAt: now,
  });
  if (source.scope === "ticker" && source.scopeTicker) {
    const tickerNode = nodeId("ticker", source.scopeTicker);
    app.repos.graph.upsertNode({
      id: tickerNode, type: "ticker", label: source.scopeTicker, summary: "",
      data: {}, status: "active", createdAt: now, updatedAt: now,
    });
    app.repos.graph.upsertEdge({
      id: edgeId(sourceNode, "tagged_with", tickerNode),
      srcId: sourceNode, dstId: tickerNode, rel: "tagged_with", weight: 1, data: {}, createdAt: now,
    });
  }
}

function recordRun(app: App, sourceId: string, status: IngestionRun["status"], versionId: string | null, warnings: string[], reason: string | null): IngestionRun {
  return app.repos.knowledge.insertIngestionRun({
    id: newId(), sourceId, versionId, status, warnings, reason, createdAt: new Date().toISOString(),
  });
}

/**
 * Ingest a new knowledge source. Fetches (URL, SSRF-guarded), extracts plain text, runs the no-tools
 * classification guardrail, and on success writes an immutable version + FTS-indexed chunks + graph
 * links. Suspicious or unparseable content quarantines the source instead of indexing it.
 */
export async function ingestSource(app: App, input: IngestInput): Promise<IngestResult> {
  const now = new Date().toISOString();
  const trustClass = TRUST[input.kind];
  const source: KnowledgeSource = {
    id: newId(),
    kind: input.kind,
    title: input.kind === "url" ? (input.title ?? input.url) : input.title,
    trustClass,
    scope: input.scope,
    scopeTicker: input.scope === "ticker" ? (input.scopeTicker ?? null) : null,
    // Private notes are opt-in for analysis; public sources default on.
    useInAnalysis: input.kind === "note" ? (input.useInAnalysis ?? false) : true,
    status: "active",
    origin: input.kind === "url" ? input.url : input.kind === "upload" ? input.filename : null,
    createdAt: now,
    updatedAt: now,
  };
  app.repos.knowledge.insertSource(source);

  try {
    let text: string;
    let rawBytes: Uint8Array | null = null;
    const warnings: string[] = [];

    if (input.kind === "note") {
      ({ text } = await extractText({ kind: "note", text: input.text }));
    } else if (input.kind === "url") {
      const fetched = await safeFetch(input.url);
      rawBytes = fetched.bytes;
      const r = await extractText({ kind: "url", mime: fetched.contentType, bytes: fetched.bytes });
      text = r.text;
      warnings.push(...r.warnings);
    } else {
      rawBytes = input.bytes;
      const r = await extractText({ kind: "upload", mime: input.mime, filename: input.filename, bytes: input.bytes });
      text = r.text;
      warnings.push(...r.warnings);
    }

    const verdict = classifyContent(text);
    warnings.push(...verdict.warnings);
    if (!verdict.ok) {
      app.repos.knowledge.updateSource(source.id, { status: "quarantined" }, new Date().toISOString());
      const run = recordRun(app, source.id, "quarantined", null, warnings, verdict.reason ?? "classification rejected");
      return { source: { ...source, status: "quarantined" }, run };
    }

    const { versionId } = writeVersion(app, source, text, rawBytes);
    linkGraph(app, source);
    const run = recordRun(app, source.id, "ok", versionId, warnings, null);
    return { source, run };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    app.repos.knowledge.updateSource(source.id, { status: "quarantined" }, new Date().toISOString());
    const run = recordRun(app, source.id, "failed", null, [], reason);
    return { source: { ...source, status: "quarantined" }, run };
  }
}

/** Re-fetch a URL source as a NEW immutable version (history is never overwritten). */
export async function refreshSource(app: App, sourceId: string): Promise<IngestResult | null> {
  const source = app.repos.knowledge.getSource(sourceId);
  if (!source || source.kind !== "url" || !source.origin) return null;
  try {
    const fetched = await safeFetch(source.origin);
    const { text, warnings } = await extractText({ kind: "url", mime: fetched.contentType, bytes: fetched.bytes });
    const verdict = classifyContent(text);
    if (!verdict.ok) {
      const run = recordRun(app, sourceId, "quarantined", null, [...warnings, ...verdict.warnings], verdict.reason ?? "classification rejected");
      return { source, run };
    }
    const { versionId } = writeVersion(app, source, text, fetched.bytes);
    app.repos.knowledge.updateSource(sourceId, { status: "active" }, new Date().toISOString());
    const run = recordRun(app, sourceId, "ok", versionId, [...warnings, ...verdict.warnings], null);
    return { source, run };
  } catch (err) {
    const run = recordRun(app, sourceId, "failed", null, [], err instanceof Error ? err.message : String(err));
    return { source, run };
  }
}
