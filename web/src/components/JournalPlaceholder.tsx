import { BookOpen, MessageSquare, Target } from "lucide-react";

const PHASES = [
  { icon: BookOpen, label: "Prediction journal", note: "Every call, captured & resolved" },
  { icon: Target, label: "Calibration", note: "Brier score & accuracy over time" },
  { icon: MessageSquare, label: "Natural-language query", note: "Ask your portfolio anything" },
];

/** Region 4 from the design — present so the layout is right; wired up in a later phase. */
export function JournalPlaceholder() {
  return (
    <div className="card p-6">
      <div className="mb-5 flex items-center gap-2">
        <p className="text-sm font-medium text-text-secondary">Journal &amp; Query</p>
        <span className="rounded-full border border-hairline-strong bg-surface-2 px-2 py-0.5 text-[10px] font-medium text-text-muted">
          Phase 3–5
        </span>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {PHASES.map(({ icon: Icon, label, note }) => (
          <div
            key={label}
            className="flex items-start gap-3 rounded-xl border border-dashed border-hairline bg-surface-2/40 p-3.5"
          >
            <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-3 text-text-muted">
              <Icon className="h-4 w-4" />
            </div>
            <div>
              <div className="text-[13px] font-medium text-text-secondary">{label}</div>
              <p className="mt-0.5 text-[11px] leading-snug text-text-muted">{note}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
