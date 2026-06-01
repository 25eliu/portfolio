import { Activity, Pencil, Play, Sparkles } from "lucide-react";
import { useRisk, useSetRisk, useStatus } from "../api/hooks.ts";
import type { RiskPreset } from "../api/types.ts";
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
  onSeed: () => void;
  onRun: () => void;
  seeding: boolean;
  running: boolean;
};

export function Header({ onManage, onSeed, onRun, seeding, running }: Props) {
  const status = useStatus();
  const risk = useRisk();
  const setRisk = useSetRisk();

  const lastRun = status.data?.lastRun;
  const preset = risk.data?.risk?.preset ?? "balanced";
  const ok = lastRun?.status === "ok";

  return (
    <header className="sticky top-0 z-30 border-b border-hairline bg-canvas/80 backdrop-blur-xl">
      <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-x-4 gap-y-3 px-6 py-3.5">
        <div className="mr-auto flex items-center gap-3">
          <div className="grid h-9 w-9 place-items-center rounded-xl border border-accent/30 bg-accent-soft text-accent">
            <Activity className="h-[18px] w-[18px]" strokeWidth={2.25} />
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
          <Button variant="ghost" size="sm" icon={<Pencil className="h-4 w-4" />} onClick={onManage}>
            Manage
          </Button>
          <Button
            variant="secondary"
            size="sm"
            icon={<Sparkles className="h-4 w-4" />}
            onClick={onSeed}
            loading={seeding}
          >
            Seed AI
          </Button>
          <Button
            variant="primary"
            size="sm"
            icon={<Play className="h-4 w-4" fill="currentColor" />}
            onClick={onRun}
            loading={running}
          >
            {running ? "Running" : "Run analysis"}
          </Button>
        </div>
      </div>
    </header>
  );
}
