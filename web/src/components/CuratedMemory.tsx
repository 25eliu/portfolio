import { useState } from "react";
import { ChevronDown, ExternalLink, Sparkles, Trash2 } from "lucide-react";
import type { CuratedDay, CuratedFact } from "../api/client.ts";
import { useArchiveSource, useCuratedMemory } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Badge } from "./ui/Badge.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";

/** Format an ISO calendar date (YYYY-MM-DD) as a readable day header, e.g. "Mon, Jun 2 2026". */
function dayLabel(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/**
 * The platform's self-curated factual memory: durable, structural facts the analyzer distilled from
 * its own research and chose to remember. Grouped by the day it was learned (newest first), each fed
 * back into future analysis as cited evidence. The user can remove any fact (archive), which stops it
 * informing future runs — provenance for past recommendations survives.
 */
export function CuratedMemory() {
  const curated = useCuratedMemory();
  const days = curated.data?.days ?? [];
  const total = days.reduce((n, d) => n + d.facts.length, 0);

  return (
    <div className="card p-6">
      <div className="mb-5 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-text-muted" />
        <p className="text-sm font-medium text-text-secondary">Self-curated memory</p>
        {curated.data && <Badge tone="neutral">{total}</Badge>}
        <span className="ml-auto text-[11px] text-text-muted">durable facts the AI saved — fed back into analysis</span>
      </div>

      {curated.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : days.length === 0 ? (
        <p className="rounded-xl border border-dashed border-hairline p-6 text-center text-[12px] text-text-muted">
          Nothing curated yet — when the analysis surfaces a durable, structural fact worth remembering, it
          lands here and informs future runs.
        </p>
      ) : (
        <div className="divide-y divide-hairline">
          {days.map((d, i) => (
            <DayGroup key={d.date} day={d} defaultOpen={i === 0} />
          ))}
        </div>
      )}
    </div>
  );
}

function DayGroup({ day, defaultOpen }: { day: CuratedDay; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-surface-2/40"
      >
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-text-muted transition-transform", open && "rotate-180")} />
        <span className="font-medium text-text">{dayLabel(day.date)}</span>
        <span className="ml-auto">
          <Badge tone="neutral">{day.facts.length} {day.facts.length === 1 ? "fact" : "facts"}</Badge>
        </span>
      </button>
      {open && (
        <div className="border-l border-hairline pl-3 pb-2">
          <div className="divide-y divide-hairline">
            {day.facts.map((f) => (
              <FactRow key={f.id} fact={f} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function FactRow({ fact }: { fact: CuratedFact }) {
  const archive = useArchiveSource();
  let host = "";
  if (fact.citationUrl) {
    try {
      host = new URL(fact.citationUrl).hostname;
    } catch {
      host = fact.citationUrl;
    }
  }

  return (
    <div className="flex items-start gap-3 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-[13px] leading-snug text-text">{fact.fact}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted">
          <Badge tone="accent">self-curated</Badge>
          <span>{fact.scope === "ticker" ? fact.ticker : "global"}</span>
          {fact.citationUrl && (
            <>
              <span>·</span>
              <a
                href={fact.citationUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-0.5 text-accent hover:underline"
              >
                <ExternalLink className="h-3 w-3" />
                {host}
              </a>
            </>
          )}
        </div>
      </div>
      <button
        onClick={() => archive.mutate(fact.id)}
        disabled={archive.isPending}
        title="Remove from memory (stops feeding analysis; provenance preserved)"
        className="mt-0.5 shrink-0 text-text-muted hover:text-neg disabled:opacity-50"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
