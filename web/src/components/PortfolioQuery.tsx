import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { MessageSquare, Send, Wrench } from "lucide-react";
import { client } from "../api/client.ts";
import type { Citation } from "../api/types.ts";
import { useMentionTickers, useQueryLog } from "../api/hooks.ts";
import { useQueryStream } from "../api/queryStream.ts";
import { parseMentions } from "@shared/query/tickers.ts";
import { MentionInput } from "./MentionInput.tsx";
import { QuerySources } from "./QuerySources.tsx";
import { SourceDetailDialog } from "./SourceDetailDialog.tsx";
import { Markdown } from "./Markdown.tsx";
import { Badge } from "./ui/Badge.tsx";

const EXAMPLES = [
  "How are my momentum calls doing?",
  "Why did the AI sell its worst position?",
  "Which strategy has the best expectancy?",
  "What does my research say about @NVDA?",
];

/** One finished question→answer exchange kept in the session transcript. */
type Turn = {
  id: string;
  question: string;
  answer: string;
  tools: { name: string; args: Record<string, unknown> }[];
  sources: Citation[];
  status: "done" | "error";
  errorMessage?: string;
};

function ToolBadges({ tools }: { tools: { name: string }[] }) {
  if (tools.length === 0) return null;
  return (
    <div className="mb-2 flex flex-wrap items-center gap-1.5">
      <Wrench className="h-3 w-3 text-text-muted" />
      {tools.map((t, i) => (
        <span key={i} className="rounded border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10px] text-text-muted">
          {t.name}
        </span>
      ))}
    </div>
  );
}

/** The user's question, right-aligned like a chat bubble. */
function QuestionBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-accent/15 px-3 py-2 text-[13px] text-text">{text}</div>
    </div>
  );
}

/** The assistant's grounded answer: tool badges, markdown body, and clickable source cards. */
function AnswerBlock({
  tools,
  answer,
  sources,
  status,
  errorMessage,
  streaming,
  onSelectSource,
}: {
  tools: { name: string }[];
  answer: string;
  sources: Citation[];
  status: "running" | "done" | "error";
  errorMessage?: string;
  streaming: boolean;
  onSelectSource: (c: Citation) => void;
}) {
  return (
    <div className="rounded-xl rounded-tl-sm border border-hairline bg-surface-2/40 p-3.5">
      <ToolBadges tools={tools} />
      {status === "error" ? (
        <p className="text-[12px] text-neg">{errorMessage ?? "Query failed."}</p>
      ) : answer ? (
        <Markdown>{answer}</Markdown>
      ) : (
        <p className="text-[13px] text-text-muted">{streaming ? "Thinking…" : ""}</p>
      )}
      <QuerySources sources={sources} onSelect={onSelectSource} />
    </div>
  );
}

/** Region 6 (query) — a grounded chat: ask, watch it stream, inspect the sources behind every answer. */
export function PortfolioQuery() {
  const qc = useQueryClient();
  const log = useQueryLog();
  const mentions = useMentionTickers();
  const [input, setInput] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [active, setActive] = useState<{ id: string; question: string } | null>(null);
  const [detail, setDetail] = useState<Citation | null>(null);
  const [pending, setPending] = useState(false);
  const threadRef = useRef<HTMLDivElement>(null);
  // `stream` is shared across turns and keeps its last terminal status until the next query resets it.
  // Without this guard, setting a new active turn would fold it immediately using the PREVIOUS answer
  // (stale "done"). We only fold once we've seen this query's stream actually start ("running").
  const startedRef = useRef(false);

  const stream = useQueryStream(active?.id ?? null);

  // Fold a finished in-flight turn into the transcript, then clear the active slot for the next question.
  const { status } = stream;
  useEffect(() => {
    if (!active) return;
    if (status === "running") {
      startedRef.current = true;
      return;
    }
    if (!startedRef.current || (status !== "done" && status !== "error")) return;
    setTurns((t) => [
      ...t,
      {
        id: active.id,
        question: active.question,
        answer: stream.answer,
        tools: stream.tools,
        sources: stream.sources,
        status,
        errorMessage: stream.errorMessage,
      },
    ]);
    setActive(null);
    setPending(false);
    void qc.invalidateQueries({ queryKey: ["queryLog"] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, active, qc]);

  // Keep the newest message in view as the transcript grows and the answer streams.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: "smooth" });
  }, [turns.length, active, stream.answer, stream.tools.length]);

  const streaming = pending || active !== null;

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || streaming) return;
    setInput("");
    setPending(true);
    startedRef.current = false; // arm the fold guard for this new query's fresh stream
    try {
      // @-mentions scope retrieval server-side (fewer tokens); the server re-parses too, so this is a hint.
      const { queryId: id } = await client.askQuery(q, parseMentions(q));
      setActive({ id, question: q });
    } catch (e) {
      setPending(false);
      setTurns((t) => [...t, { id: `err-${t.length}`, question: q, answer: "", tools: [], sources: [], status: "error", errorMessage: "Couldn't reach the server." }]);
      console.error("askQuery failed", e);
    }
  };

  const hasThread = turns.length > 0 || active !== null;

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <MessageSquare className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Ask your portfolio</p>
        <span className="ml-auto text-[11px] text-text-muted">
          type <span className="text-accent">@</span> to focus a ticker · answered only from your own data
        </span>
      </div>

      {hasThread && (
        <div ref={threadRef} className="mb-3 max-h-[440px] space-y-3 overflow-y-auto pr-1">
          {turns.map((t) => (
            <div key={t.id} className="space-y-2">
              <QuestionBubble text={t.question} />
              <AnswerBlock
                tools={t.tools}
                answer={t.answer}
                sources={t.sources}
                status={t.status}
                errorMessage={t.errorMessage}
                streaming={false}
                onSelectSource={setDetail}
              />
            </div>
          ))}
          {active && (
            <div className="space-y-2">
              <QuestionBubble text={active.question} />
              <AnswerBlock
                tools={stream.tools}
                answer={stream.answer}
                sources={stream.sources}
                status={stream.status}
                errorMessage={stream.errorMessage}
                streaming
                onSelectSource={setDetail}
              />
            </div>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void ask(input);
        }}
        className="flex items-start gap-2"
      >
        <MentionInput
          value={input}
          onChange={setInput}
          onSubmit={() => void ask(input)}
          tickers={mentions.data?.tickers ?? []}
          disabled={streaming}
          placeholder="e.g. how is @NVDA doing vs my momentum calls?"
        />
        <button
          type="submit"
          disabled={!input.trim() || streaming}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-[12px] font-medium text-white disabled:opacity-50"
        >
          <Send className="h-3.5 w-3.5" /> {streaming ? "Thinking…" : "Ask"}
        </button>
      </form>

      {!hasThread && (
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

      {detail && <SourceDetailDialog citation={detail} onClose={() => setDetail(null)} />}
    </div>
  );
}
