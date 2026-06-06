import { BookOpen, FileText, GraduationCap, Layers } from "lucide-react";
import type { Citation } from "../api/types.ts";
import { Badge } from "./ui/Badge.tsx";

/** Display grouping for the sources panel — the kinds we actually cite, in a sensible reading order. */
const GROUPS: { kind: Citation["kind"]; label: string; icon: typeof BookOpen }[] = [
  { kind: "knowledge", label: "Research", icon: BookOpen },
  { kind: "lesson", label: "Wiki lessons", icon: GraduationCap },
  { kind: "journal", label: "Journal calls", icon: FileText },
];

function SourceCard({ c, onSelect }: { c: Citation; onSelect?: (c: Citation) => void }) {
  const meta = [c.trust?.replace(/_/g, " "), c.detail, c.date].filter(Boolean).join(" · ");
  return (
    <button
      type="button"
      onClick={() => onSelect?.(c)}
      className="block w-full rounded-lg border border-hairline bg-surface-2/50 p-2.5 text-left transition-colors hover:border-hairline-strong hover:bg-surface-2"
    >
      <div className="flex items-center gap-2">
        {c.ticker && <Badge tone="accent">{c.ticker}</Badge>}
        <span className="truncate text-[12px] font-medium text-text-secondary">{c.title}</span>
      </div>
      {meta && <div className="mt-0.5 text-[10px] uppercase tracking-wide text-text-muted">{meta}</div>}
      {c.excerpt && <p className="mt-1 line-clamp-3 text-[11px] leading-relaxed text-text-muted">{c.excerpt}</p>}
    </button>
  );
}

/**
 * The "sources" panel: the structured evidence the grounded answer drew on, grouped by kind. Makes the
 * answer auditable — every research note, wiki lesson, and journal call that fed the model is shown.
 */
export function QuerySources({ sources, onSelect }: { sources: Citation[]; onSelect?: (c: Citation) => void }) {
  if (sources.length === 0) return null;
  const groups = GROUPS.map((g) => ({ ...g, items: sources.filter((s) => s.kind === g.kind) })).filter((g) => g.items.length > 0);
  const other = sources.filter((s) => !GROUPS.some((g) => g.kind === s.kind));

  return (
    <div className="mt-3 border-t border-hairline pt-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium text-text-muted">
        <Layers className="h-3 w-3" /> Sources <span className="text-text-muted/60">({sources.length})</span>
      </div>
      <div className="space-y-3">
        {groups.map((g) => (
          <div key={g.kind}>
            <div className="mb-1.5 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted">
              <g.icon className="h-3 w-3" /> {g.label} <span className="text-text-muted/60">({g.items.length})</span>
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {g.items.map((c, i) => (
                <SourceCard key={`${g.kind}-${i}`} c={c} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
        {other.length > 0 && (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {other.map((c, i) => (
              <SourceCard key={`other-${i}`} c={c} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
