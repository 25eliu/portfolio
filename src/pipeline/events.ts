import type { Source } from "../domain/index.ts";

/**
 * The run event bus: the backbone of live streaming. The background analysis run publishes typed
 * events here; the SSE endpoint subscribes (with buffered replay) to stream them to the browser, and
 * `logEvent` mirrors them to the Bun terminal.
 */

/** Event payloads (without `seq` — the bus assigns it). */
export type RunEventInput =
  | { type: "run:start"; runId: string; at: string }
  | { type: "run:done"; runId: string }
  | { type: "run:error"; runId: string; message: string }
  | { type: "phase"; phase: "context" | "scan" | "analyze"; label: string }
  | { type: "universe"; tickers: { symbol: string; source: string; screen: string | null }[] }
  | { type: "context:delta"; channel: "thinking" | "text"; text: string }
  | { type: "context:tool"; query?: string; sources?: Source[] }
  | { type: "context:done"; summary: string }
  | { type: "ticker:start"; symbol: string; stage: "research" | "deliberate" | "structure" }
  | { type: "ticker:delta"; symbol: string; channel: "thinking" | "text"; text: string }
  | { type: "ticker:tool"; symbol: string; query?: string; sources?: Source[] }
  | { type: "ticker:done"; symbol: string; action: string; conviction: number }
  | { type: "ticker:error"; symbol: string; message: string };

export type RunEvent = RunEventInput & { seq: number };

/** Emit a run event (assigns seq via the bus + mirrors to the terminal). */
export type Emit = (e: RunEventInput) => void;

const BUFFER_CAP = 2000;
const PRUNE_AFTER_MS = 5 * 60_000;

class RunBus {
  private buffers = new Map<string, RunEvent[]>();
  private subs = new Map<string, Set<(e: RunEvent) => void>>();
  private seqs = new Map<string, number>();
  private finishedAt = new Map<string, number>();

  publish(runId: string, input: RunEventInput): void {
    const seq = (this.seqs.get(runId) ?? 0) + 1;
    this.seqs.set(runId, seq);
    const evt = { ...input, seq } as RunEvent;

    const buf = this.buffers.get(runId) ?? [];
    buf.push(evt);
    if (buf.length > BUFFER_CAP) buf.shift();
    this.buffers.set(runId, buf);

    if (input.type === "run:done" || input.type === "run:error") {
      this.finishedAt.set(runId, Date.now());
    }
    for (const fn of this.subs.get(runId) ?? []) {
      try {
        fn(evt);
      } catch {
        /* a slow subscriber must not break the run */
      }
    }
    this.prune();
  }

  /** Replay buffered events to `fn`, then stream live ones. Returns an unsubscribe function. */
  subscribe(runId: string, fn: (e: RunEvent) => void): () => void {
    for (const evt of this.buffers.get(runId) ?? []) fn(evt);
    let set = this.subs.get(runId);
    if (!set) {
      set = new Set();
      this.subs.set(runId, set);
    }
    set.add(fn);
    return () => set!.delete(fn);
  }

  hasBuffer(runId: string): boolean {
    return this.buffers.has(runId);
  }

  isActive(runId: string): boolean {
    return this.buffers.has(runId) && !this.finishedAt.has(runId);
  }

  private prune(): void {
    const cutoff = Date.now() - PRUNE_AFTER_MS;
    for (const [runId, t] of this.finishedAt) {
      if (t < cutoff) {
        this.buffers.delete(runId);
        this.subs.delete(runId);
        this.seqs.delete(runId);
        this.finishedAt.delete(runId);
      }
    }
  }
}

/** Process-wide singleton (the Bun server is single-process). */
export const runBus = new RunBus();

/** Mirror an event to the Bun terminal. Milestones by default; full token deltas when STREAM_LOG=verbose. */
export function logEvent(e: RunEventInput): void {
  const mode = process.env.STREAM_LOG;
  if (mode === "off") return;
  const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
  switch (e.type) {
    case "run:start":
      console.log(`\n━━ analysis run ${e.runId.slice(0, 8)} started`);
      break;
    case "phase":
      console.log(`▸ ${e.label}`);
      break;
    case "universe":
      console.log(dim(`  universe (${e.tickers.length}): ${e.tickers.map((t) => t.symbol).join(", ")}`));
      break;
    case "ticker:start":
      if (e.stage === "research") console.log(`  · ${e.symbol} researching…`);
      else if (e.stage === "deliberate") console.log(`  · ${e.symbol} deliberating (bull/bear)…`);
      break;
    case "ticker:tool":
    case "context:tool": {
      const who = e.type === "ticker:tool" ? e.symbol : "market";
      const q = e.query ? ` "${e.query}"` : "";
      const s = e.sources ? ` → ${e.sources.length} sources` : "";
      console.log(`  🔍 ${who}${q}${s}`);
      break;
    }
    case "ticker:done":
      console.log(`  ✓ ${e.symbol} ${e.action} ${e.conviction.toFixed(2)}`);
      break;
    case "ticker:error":
      console.log(`  ✗ ${e.symbol} ${e.message}`);
      break;
    case "run:done":
      console.log(`━━ run done\n`);
      break;
    case "run:error":
      console.log(`━━ run error: ${e.message}\n`);
      break;
    case "ticker:delta":
    case "context:delta":
      if (mode === "verbose" && e.text.trim()) {
        process.stdout.write(e.channel === "thinking" ? dim(e.text) : e.text);
      }
      break;
    default:
      break;
  }
}
