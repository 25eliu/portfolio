import { useMemo, useState } from "react";
import { ChevronDown, ExternalLink, Search, Sparkles, Trash2, X } from "lucide-react";
import type { AiInsight } from "../api/client.ts";
import { useAiLibraryDay, useAiLibraryDays, useAiLibrarySearch, useArchiveInsight, useEditInsightTags, useTags } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The AI's own knowledge library: durable, citable facts it chose to remember — day-sectioned,
 *  searchable, tag-filterable, archive-hidden. Separate from the user's personal Knowledge Library. */
export function AiLibrary() {
  const [q, setQ] = useState("");
  const [tag, setTag] = useState<{ dimension: string; value: string } | null>(null);
  const days = useAiLibraryDays();
  const tags = useTags();
  const searching = q.trim().length > 0 || tag !== null;
  const search = useAiLibrarySearch({ q: q.trim() || undefined, dimension: tag?.dimension, value: tag?.value });

  const total = useMemo(() => (days.data?.days ?? []).reduce((n, d) => n + d.factCount, 0), [days.data]);

  return (
    <div className="card p-6">
      <div className="mb-4 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">AI knowledge library</p>
        {days.data && <Badge tone="neutral">{total}</Badge>}
        <span className="ml-auto text-[11px] text-text-muted">durable facts the AI saved — fed back into analysis</span>
      </div>

      <div className="mb-3 flex items-center gap-2 rounded-xl border border-hairline px-3 py-2">
        <Search className="h-4 w-4 text-text-muted" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search insights…"
          className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-text-muted"
        />
      </div>

      {(tags.data?.tags ?? []).length > 0 && (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(tags.data?.tags ?? []).slice(0, 24).map((t) => {
            const active = tag?.dimension === t.dimension && tag?.value === t.value;
            return (
              <button
                key={`${t.dimension}:${t.value}`}
                onClick={() => setTag(active ? null : { dimension: t.dimension, value: t.value })}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  active ? "border-accent bg-accent/10 text-accent" : "border-hairline text-text-muted hover:text-text",
                )}
              >
                {t.dimension}:{t.value} <span className="opacity-60">{t.count}</span>
              </button>
            );
          })}
          {tag && (
            <button onClick={() => setTag(null)} className="inline-flex items-center gap-0.5 text-[10px] text-text-muted hover:text-text">
              <X className="h-3 w-3" /> clear
            </button>
          )}
        </div>
      )}

      {searching ? (
        search.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : (search.data?.insights ?? []).length === 0 ? (
          <Empty text="No insights match." />
        ) : (
          <div className="divide-y divide-hairline">
            {(search.data?.insights ?? []).map((i) => (
              <InsightRow key={i.id} insight={i} />
            ))}
          </div>
        )
      ) : days.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : (days.data?.days ?? []).length === 0 ? (
        <Empty text="Nothing curated yet — when the analysis surfaces a durable, structural fact worth remembering, it lands here." />
      ) : (
        <div className="divide-y divide-hairline">
          {(days.data?.days ?? []).map((d, i) => (
            <DayGroup key={d.date} date={d.date} factCount={d.factCount} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">{text}</p>;
}

function DayGroup({ date, factCount, defaultOpen }: { date: string; factCount: number; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  const day = useAiLibraryDay(open ? date : null);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        <span className="font-medium text-text">{dayLabel(date)}</span>
        <span className="ml-auto">
          <Badge tone="neutral">{factCount} {factCount === 1 ? "fact" : "facts"}</Badge>
        </span>
      </button>
      {open && (
        <div className="border-l border-hairline pl-3 pb-2">
          {day.isLoading ? (
            <Skeleton className="h-10 w-full" />
          ) : (
            <div className="divide-y divide-hairline">
              {(day.data?.facts ?? []).map((i) => (
                <InsightRow key={i.id} insight={i} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightRow({ insight }: { insight: AiInsight }) {
  const archive = useArchiveInsight();
  const editTags = useEditInsightTags();
  const source = insight.sources[0] ?? null;

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-text">{insight.headline}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
          <Badge tone="accent">self-curated</Badge>
          {insight.significance != null && <span>sig {insight.significance.toFixed(2)}</span>}
          {insight.tags.map((t) => (
            <button
              key={`${t.dimension}:${t.value}`}
              onClick={() => editTags.mutate({ kind: insight.kind, id: insight.id, body: { add: [], remove: [{ dimension: t.dimension, value: t.value }] } })}
              title="Remove tag"
              className="group inline-flex items-center gap-0.5 rounded-full border border-hairline px-1.5 py-0.5 hover:border-neg hover:text-neg"
            >
              {t.dimension}:{t.value}
              <X className="h-2.5 w-2.5 opacity-0 group-hover:opacity-100" />
            </button>
          ))}
          {source && (
            <a href={source.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 text-accent hover:underline">
              <ExternalLink className="h-3 w-3" />
              {source.title}
            </a>
          )}
        </div>
      </div>
      <button
        onClick={() => archive.mutate({ kind: insight.kind, id: insight.id })}
        disabled={archive.isPending}
        title="Remove from memory (stops feeding analysis; provenance preserved)"
        className="mt-0.5 shrink-0 text-text-muted hover:text-neg disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
