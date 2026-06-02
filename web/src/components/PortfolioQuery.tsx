import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Wrench } from "lucide-react";
import { client } from "../api/client.ts";
import { useQueryLog } from "../api/hooks.ts";
import { useQueryStream } from "../api/queryStream.ts";
import { Badge } from "./ui/Badge.tsx";

const EXAMPLES = [
  "How are my momentum calls doing?",
  "Why did the AI sell its worst position?",
  "Which strategy has the best expectancy?",
  "What does my research say about NVDA?",
];

/** Region 6 (query) — "ask your portfolio anything", answered strictly from the system's own data. */
export function PortfolioQuery() {
  const qc = useQueryClient();
  const log = useQueryLog();
  const [input, setInput] = useState("");
  const [queryId, setQueryId] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const stream = useQueryStream(queryId, () => {
    setPending(false);
    void qc.invalidateQueries({ queryKey: ["queryLog"] });
  });

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || pending) return;
    setInput(q);
    setPending(true);
    setQueryId(null);
    try {
      const { queryId: id } = await client.askQuery(q);
      setQueryId(id);
    } catch (e) {
      setPending(false);
      // surface as an inline error via a synthetic stream state is overkill; just log
      console.error("askQuery failed", e);
    }
  };

  const streaming = pending || stream.status === "running";

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Ask your portfolio</p>
        <span className="ml-auto text-[11px] text-text-muted">answered only from your own journal, wiki, trades &amp; research</span>
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="e.g. how are my momentum calls doing?"
          className="flex-1 rounded-lg border border-hairline bg-surface-2 px-3 py-2 text-[13px] text-text"
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> {streaming ? "Thinking…" : "Ask"}
        </button>
      </form>

      {!queryId && !streaming && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              onClick={() => void ask(ex)}
              className="rounded-full border border-hairline bg-surface-2 px-2.5 py-1 text-[11px] text-text-muted hover:text-text-secondary"
            >
              {ex}
            </button>
          ))}
        </div>
      )}

      {queryId && (
        <div className="mt-4 rounded-xl border border-hairline bg-surface-2/40 p-3.5">
          {stream.tools.length > 0 && (
            <div className="mb-2 flex flex-wrap items-center gap-1.5">
              <Wrench className="h-3 w-3 text-text-muted" />
              {stream.tools.map((t, i) => (
                <span key={i} className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">
                  {t.name}
                </span>
              ))}
            </div>
          )}
          {stream.status === "error" ? (
            <p className="text-[12px] text-neg">{stream.errorMessage ?? "Query failed."}</p>
          ) : (
            <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-text-secondary">
              {stream.answer || (streaming ? "…" : "")}
            </p>
          )}
        </div>
      )}

      {(log.data?.queries.length ?? 0) > 0 && (
        <div className="mt-4">
          <div className="mb-1.5 text-[11px] font-medium text-text-muted">Recent questions</div>
          <div className="divide-y divide-hairline">
            {log.data!.queries.slice(0, 5).map((q) => (
              <button
                key={q.id}
                onClick={() => void ask(q.question)}
                className="flex w-full items-center gap-2 py-2 text-left text-[12px] text-text-secondary hover:text-text"
              >
                <span className="flex-1 truncate">{q.question}</span>
                {q.status === "error" && <Badge tone="warn">error</Badge>}
                <span className="tnum text-[10px] text-text-muted">{q.createdAt.slice(0, 10)}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
