import { useEffect, useReducer, useRef } from "react";

/** Events as sent over SSE (mirrors src/pipeline/events.ts; parsed loosely from JSON). */
type StreamEvent = {
  type: string;
  seq?: number;
  // run
  runId?: string;
  message?: string;
  // phase / universe
  phase?: string;
  label?: string;
  tickers?: { symbol: string; source: string; screen: string | null }[];
  // deltas / tools
  symbol?: string;
  stage?: "research" | "structure";
  channel?: "thinking" | "text";
  text?: string;
  query?: string;
  sources?: { title: string; url: string }[];
  // done
  action?: string;
  conviction?: number;
  summary?: string;
};

export type LaneStatus = "queued" | "researching" | "structuring" | "done" | "error";
export type ToolHit = { query?: string; sourceCount: number };
export type Lane = {
  symbol: string;
  source: string;
  screen: string | null;
  status: LaneStatus;
  text: string;
  thinking: string;
  tools: ToolHit[];
  action?: string;
  conviction?: number;
  error?: string;
};

export type StreamState = {
  phase: string;
  phaseLabel: string;
  contextText: string;
  contextThinking: string;
  contextTools: ToolHit[];
  lanes: Map<string, Lane>;
  order: string[];
  total: number;
  doneCount: number;
  status: "running" | "done" | "error";
  errorMessage?: string;
};

const INITIAL: StreamState = {
  phase: "",
  phaseLabel: "Starting…",
  contextText: "",
  contextThinking: "",
  contextTools: [],
  lanes: new Map(),
  order: [],
  total: 0,
  doneCount: 0,
  status: "running",
};

function lane(symbol: string, s: StreamState): Lane {
  return (
    s.lanes.get(symbol) ?? { symbol, source: "scan", screen: null, status: "queued", text: "", thinking: "", tools: [] }
  );
}
function withLane(s: StreamState, symbol: string, next: Lane): StreamState {
  const lanes = new Map(s.lanes);
  lanes.set(symbol, next);
  return { ...s, lanes };
}

function reduce(s: StreamState, e: StreamEvent): StreamState {
  switch (e.type) {
    case "run:start":
      return { ...s, status: "running" };
    case "phase":
      return { ...s, phase: e.phase ?? s.phase, phaseLabel: e.label ?? s.phaseLabel };
    case "universe": {
      const lanes = new Map(s.lanes);
      const order: string[] = [];
      for (const t of e.tickers ?? []) {
        order.push(t.symbol);
        lanes.set(t.symbol, {
          symbol: t.symbol,
          source: t.source,
          screen: t.screen,
          status: "queued",
          text: "",
          thinking: "",
          tools: [],
        });
      }
      return { ...s, lanes, order, total: order.length };
    }
    case "context:delta":
      return e.channel === "thinking"
        ? { ...s, contextThinking: s.contextThinking + (e.text ?? "") }
        : { ...s, contextText: s.contextText + (e.text ?? "") };
    case "context:tool":
      return { ...s, contextTools: [...s.contextTools, { query: e.query, sourceCount: e.sources?.length ?? 0 }] };
    case "ticker:start": {
      const l = lane(e.symbol!, s);
      return withLane(s, e.symbol!, { ...l, status: e.stage === "structure" ? "structuring" : "researching" });
    }
    case "ticker:delta": {
      const l = lane(e.symbol!, s);
      return e.channel === "thinking"
        ? withLane(s, e.symbol!, { ...l, thinking: l.thinking + (e.text ?? "") })
        : withLane(s, e.symbol!, { ...l, text: l.text + (e.text ?? "") });
    }
    case "ticker:tool": {
      const l = lane(e.symbol!, s);
      return withLane(s, e.symbol!, {
        ...l,
        tools: [...l.tools, { query: e.query, sourceCount: e.sources?.length ?? 0 }],
      });
    }
    case "ticker:done": {
      const l = lane(e.symbol!, s);
      return {
        ...withLane(s, e.symbol!, { ...l, status: "done", action: e.action, conviction: e.conviction }),
        doneCount: s.doneCount + 1,
      };
    }
    case "ticker:error": {
      const l = lane(e.symbol!, s);
      return {
        ...withLane(s, e.symbol!, { ...l, status: "error", error: e.message }),
        doneCount: s.doneCount + 1,
      };
    }
    case "run:done":
      return { ...s, status: "done" };
    case "run:error":
      return { ...s, status: "error", errorMessage: e.message };
    default:
      return s; // heartbeat, context:done, unknown
  }
}

/**
 * Subscribe to a run's SSE event stream and reduce it into renderable state. Calls `onFinished`
 * exactly once when the run ends (done or error). Closes the EventSource on unmount / runId change.
 */
export function useRunStream(runId: string | null, onFinished?: (status: "done" | "error", message?: string) => void) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!runId) return;
    finishedRef.current = false;
    let poll: ReturnType<typeof setInterval> | undefined;
    const es = new EventSource(`/api/run/${runId}/stream`);

    const finish = (status: "done" | "error", message?: string) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      es.close();
      if (poll) clearInterval(poll);
      onFinished?.(status, message);
    };

    es.onmessage = (msg) => {
      let ev: StreamEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      dispatch(ev);
      if (ev.type === "run:done") finish("done");
      else if (ev.type === "run:error") finish("error", ev.message);
    };

    // IMPORTANT: do NOT finish on `onerror`. EventSource fires it on transient hiccups and will
    // auto-reconnect; treating it as "done" would falsely end the run instantly. The /status poll
    // below is the authoritative completion signal, so the run resolves correctly even if SSE drops.
    es.onerror = () => {};

    poll = setInterval(async () => {
      try {
        const res = await fetch("/api/status");
        const { lastRun } = (await res.json()) as { lastRun: { status: string; error?: string | null } | null };
        if (lastRun && lastRun.status !== "running") {
          finish(lastRun.status === "error" ? "error" : "done", lastRun.error ?? undefined);
        }
      } catch {
        /* ignore — keep polling */
      }
    }, 2500);

    return () => {
      es.close();
      if (poll) clearInterval(poll);
    };
    // onFinished intentionally excluded — captured once per runId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId]);

  return state;
}
