import { useEffect, useReducer, useRef } from "react";

/** A query SSE event (mirrors src/query/bus.ts), parsed loosely from JSON. */
type QueryStreamEvent = {
  type: string;
  seq?: number;
  name?: string;
  args?: Record<string, unknown>;
  text?: string;
  answer?: string;
  toolsUsed?: string[];
  message?: string;
};

export type QueryState = {
  answer: string;
  tools: { name: string; args: Record<string, unknown> }[];
  toolsUsed: string[];
  status: "running" | "done" | "error";
  errorMessage?: string;
};

const INITIAL: QueryState = { answer: "", tools: [], toolsUsed: [], status: "running" };

function reduce(s: QueryState, e: QueryStreamEvent): QueryState {
  switch (e.type) {
    case "reset":
      return INITIAL;
    case "tool":
      return { ...s, tools: [...s.tools, { name: e.name ?? "", args: e.args ?? {} }] };
    case "delta":
      return { ...s, answer: s.answer + (e.text ?? "") };
    case "done":
      return { ...s, answer: e.answer ?? s.answer, toolsUsed: e.toolsUsed ?? s.toolsUsed, status: "done" };
    case "error":
      return { ...s, status: "error", errorMessage: e.message };
    default:
      return s;
  }
}

/**
 * Subscribe to a query's SSE stream and reduce it into renderable state (tool calls + streamed answer).
 * Calls `onFinished` once when the answer completes or errors. Closes the EventSource on unmount.
 */
export function useQueryStream(queryId: string | null, onFinished?: (status: "done" | "error") => void) {
  const [state, dispatch] = useReducer(reduce, INITIAL);
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!queryId) return;
    finishedRef.current = false;
    dispatch({ type: "reset" }); // ignored by reducer; new EventSource below drives fresh state
    const es = new EventSource(`/api/query/${queryId}/stream`);
    const finish = (status: "done" | "error") => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      es.close();
      onFinished?.(status);
    };
    es.onmessage = (msg) => {
      let ev: QueryStreamEvent;
      try {
        ev = JSON.parse(msg.data);
      } catch {
        return;
      }
      dispatch(ev);
      if (ev.type === "done") finish("done");
      else if (ev.type === "error") finish("error");
    };
    es.onerror = () => {}; // transient; the done/error event is authoritative
    return () => es.close();
    // onFinished intentionally excluded — captured once per queryId.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryId]);

  return state;
}
