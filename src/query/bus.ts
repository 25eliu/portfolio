/**
 * The query event bus — the streaming backbone for grounded NL queries, mirroring the run bus. A
 * background `answerQuery` publishes typed events here; the SSE endpoint subscribes (with buffered
 * replay, since the client POSTs then opens the stream a beat later) and relays them to the browser.
 */
import type { Citation } from "../domain/index.ts";

export type QueryEventInput =
  | { type: "tool"; name: string; args: Record<string, unknown> }
  | { type: "source"; citations: Citation[] }
  | { type: "delta"; text: string }
  | { type: "done"; answer: string; toolsUsed: string[]; citations: Citation[] }
  | { type: "error"; message: string };

export type QueryEvent = QueryEventInput & { seq: number };

const BUFFER_CAP = 1000;
const PRUNE_AFTER_MS = 5 * 60_000;

class QueryBus {
  private buffers = new Map<string, QueryEvent[]>();
  private subs = new Map<string, Set<(e: QueryEvent) => void>>();
  private seqs = new Map<string, number>();
  private finishedAt = new Map<string, number>();

  publish(queryId: string, input: QueryEventInput): void {
    const seq = (this.seqs.get(queryId) ?? 0) + 1;
    this.seqs.set(queryId, seq);
    const evt = { ...input, seq } as QueryEvent;
    const buf = this.buffers.get(queryId) ?? [];
    buf.push(evt);
    if (buf.length > BUFFER_CAP) buf.shift();
    this.buffers.set(queryId, buf);
    if (input.type === "done" || input.type === "error") this.finishedAt.set(queryId, Date.now());
    for (const fn of this.subs.get(queryId) ?? []) {
      try {
        fn(evt);
      } catch {
        /* a slow subscriber must not break the answer loop */
      }
    }
    this.prune();
  }

  subscribe(queryId: string, fn: (e: QueryEvent) => void): () => void {
    for (const evt of this.buffers.get(queryId) ?? []) fn(evt);
    let set = this.subs.get(queryId);
    if (!set) {
      set = new Set();
      this.subs.set(queryId, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  hasBuffer(queryId: string): boolean {
    return this.buffers.has(queryId);
  }

  private prune(): void {
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    for (const [id, t] of this.finishedAt) {
      if (t < cutoff) {
        this.buffers.delete(id);
        this.subs.delete(id);
        this.seqs.delete(id);
        this.finishedAt.delete(id);
      }
    }
  }
}

export const queryBus = new QueryBus();
