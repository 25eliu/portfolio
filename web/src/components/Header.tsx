import { Activity, Clock, Pencil, Play } from "lucide-react";
import { useRisk, useSchedule, useSetRisk, useStatus } from "../api/hooks.ts";
import type { RiskPreset } from "../api/types.ts";
import { time12h } from "../lib/format.ts";
import { Badge } from "./ui/Badge.tsx";
import { Button } from "./ui/Button.tsx";
import { SegmentedControl } from "./ui/SegmentedControl.tsx";

const RISK_OPTIONS: { value: RiskPreset; label: string }[] = [
  { value: "conservative", label: "Conservative" },
  { value: "balanced", label: "Balanced" },
  { value: "aggressive", label: "Aggressive" },
];

type Props = {
  onManage: () => void;
  onSchedule: () => void;
  onRun: () => void;
  running: boolean;
};

export function Header({ onManage, onSchedule, onRun, running }: Props) {
  const status = useStatus();
  const risk = useRisk();
  const setRisk = useSetRisk();
  const schedule = useSchedule();

  const lastRun = status.data?.lastRun;
  const preset = risk.data?.risk?.preset ?? "balanced";
  const ok = lastRun?.status === "ok";
  const sched = schedule.data?.schedule;

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-surface-2">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-3 px-6 py-3.5">
        <div className="mr-auto flex items-center gap-3">
          <div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl border border-accent/40 bg-gradient-to-b from-accent/25 to-accent-soft text-accent shadow-[inset_0_1px_0_rgba(255,255,255,0.18)]">
            <Activity className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold leading-tight tracking-tight text-text">
              Portfolio Intelligence
            </h1>
            <div className="mt-0.5 flex items-center gap-2">
              {lastRun ? (
                <Badge tone={ok ? "pos" : "neg"} dot>
                  {ok ? "ok" : lastRun.status}
                </Badge>
              ) : (
                <Badge tone="neutral" dot>
                  idle
                </Badge>
              )}
              <span className="text-[11px] text-text-muted">
                {lastRun
                  ? `Last run ${new Date(lastRun.startedAt).toLocaleString(undefined, {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}`
                  : "No runs yet"}
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <span className="eyebrow mr-1 hidden sm:inline">Risk</span>
          <SegmentedControl
            value={preset}
            onChange={(p) => setRisk.mutate(p)}
            options={RISK_OPTIONS}
            size="sm"
          />
        </div>

        <div className="h-6 w-px bg-hairline" aria-hidden />

        <div className="flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            icon={<Clock className="h-4 w-4" />}
            onClick={onSchedule}
            title="Schedule automatic runs"
          >
            {sched?.enabled ? time12h(sched.time) : "Schedule"}
          </Button>
          <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={onManage}>
            Manage
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Play className="h-4 w-4" fill="currentColor" />}
            onClick={onRun}
            loading={running}
          >
            {running ? "Analyzing" : "Run analysis"}
          </Button>
        </div>
      </div>
    </header>
  );
}
