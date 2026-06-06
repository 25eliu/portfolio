import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { client } from "../api/client.ts";
import type { Citation } from "../api/types.ts";
import { Dialog } from "./ui/Dialog.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";
import { Badge } from "./ui/Badge.tsx";
import { Markdown } from "./Markdown.tsx";

const TITLES: Record<Citation["kind"], string> = {
  knowledge: "Research note",
  lesson: "Wiki lesson",
  journal: "Journaled call",
  trade: "Trade decision",
  forecast: "Open forecast",
  outcome: "Resolved outcome",
};

const pct = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(1)}%`);
const num = (v: number | null | undefined, d = 2) => (v == null ? "—" : v.toFixed(d));

/** A labelled stat cell used across the detail bodies. */
function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="tnum text-[13px] text-text-secondary">{value}</div>
    </div>
  );
}

/** Journal call: the recommendation thesis + the forecast it produced + its resolved outcome. */
function JournalBody({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["journalEntry", id], queryFn: () => client.journalEntry(id) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError || !q.data) return <p className="text-[12px] text-neg">Couldn't load this call.</p>;
  const { entry, forecast, outcome } = q.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Field label="Ticker" value={entry.ticker} />
        <Field label="Action" value={entry.action} />
        <Field label="Conviction" value={num(entry.conviction)} />
        <Field label="Strategy" value={entry.strategyFamily} />
      </div>
      <div>
        <div className="mb-1 text-[10px] uppercase tracking-wide text-text-muted">Thesis</div>
        <Markdown>{entry.recommendation.thesis}</Markdown>
      </div>
      {forecast && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-text-muted">Forecast</div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            <Field label="Side" value={forecast.side} />
            <Field label="Entry" value={num(forecast.entry)} />
            <Field label="Target" value={num(forecast.target)} />
            <Field label="Stop" value={num(forecast.stop)} />
            <Field label="Resolve by" value={forecast.resolveAt} />
          </div>
        </div>
      )}
      {outcome && (
        <div>
          <div className="mb-1.5 text-[10px] uppercase tracking-wide text-text-muted">Outcome</div>
          <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
            <Field label="Result" value={outcome.outcome} />
            <Field label="Return" value={pct(outcome.terminalReturn)} />
            <Field label="vs SPY" value={pct(outcome.spyExcessReturn)} />
            <Field label="R" value={num(outcome.forecastR)} />
            <Field label="Resolved" value={outcome.resolutionDate} />
          </div>
        </div>
      )}
    </div>
  );
}

/** Wiki lesson: the full prose body + the cohort/sample it was derived from. */
function LessonBody({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["wikiLesson", id], queryFn: () => client.wikiLesson(id) });
  if (q.isLoading) return <Skeleton className="h-32 w-full" />;
  if (q.isError || !q.data) return <p className="text-[12px] text-neg">Couldn't load this lesson.</p>;
  const l = q.data.lesson;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="accent">{l.state}</Badge>
        <span className="text-[11px] text-text-muted">
          {l.window} · {l.cohortKey} · n={l.n}
        </span>
      </div>
      <Markdown>{l.body}</Markdown>
    </div>
  );
}

/** Research note: the cited excerpt, plus the source's provenance (origin link, scope, trust). */
function KnowledgeBody({ citation }: { citation: Citation }) {
  const id = citation.sourceId;
  const q = useQuery({ queryKey: ["knowledgeSource", id], queryFn: () => client.knowledgeSource(id!), enabled: !!id });
  const source = q.data?.source;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-muted">
        {citation.trust && <Badge tone="neutral">{citation.trust.replace(/_/g, " ")}</Badge>}
        {citation.date && <span>{citation.date}</span>}
        {source && (
          <span>
            {source.scope}
            {source.scopeTicker ? ` · ${source.scopeTicker}` : ""} · {source.status}
          </span>
        )}
      </div>
      {citation.excerpt && (
        <blockquote className="border-l-2 border-hairline-strong pl-3 text-[13px] leading-relaxed text-text-secondary">
          {citation.excerpt}
        </blockquote>
      )}
      {source?.origin && /^https?:\/\//.test(source.origin) && (
        <a
          href={source.origin}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-[12px] text-accent hover:underline"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open original source
        </a>
      )}
      {q.isLoading && <Skeleton className="h-4 w-40" />}
    </div>
  );
}

/**
 * Click-through detail for a grounded-answer source card. Each kind fetches its own full record so the
 * owner can verify exactly what the answer drew on (journal thesis + forecast/outcome, full lesson prose,
 * or a research note's excerpt + origin). Kinds without a detail route fall back to the citation's fields.
 */
export function SourceDetailDialog({ citation, onClose }: { citation: Citation; onClose: () => void }) {
  const body =
    citation.kind === "journal" && citation.sourceId ? (
      <JournalBody id={citation.sourceId} />
    ) : citation.kind === "lesson" && citation.sourceId ? (
      <LessonBody id={citation.sourceId} />
    ) : citation.kind === "knowledge" ? (
      <KnowledgeBody citation={citation} />
    ) : (
      <div className="space-y-2 text-[13px] text-text-secondary">
        {citation.detail && <p className="text-[11px] uppercase tracking-wide text-text-muted">{citation.detail}</p>}
        {citation.excerpt && <p className="leading-relaxed">{citation.excerpt}</p>}
      </div>
    );

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={citation.title}
      description={[TITLES[citation.kind], citation.ticker].filter(Boolean).join(" · ")}
      className="max-w-xl"
    >
      {body}
    </Dialog>
  );
}
