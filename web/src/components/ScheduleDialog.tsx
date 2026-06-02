import { useState } from "react";
import { Check } from "lucide-react";
import { useSchedule, useSetSchedule } from "../api/hooks.ts";
import { time12h } from "../lib/format.ts";
import { Button } from "./ui/Button.tsx";
import { Dialog } from "./ui/Dialog.tsx";
import { SegmentedControl } from "./ui/SegmentedControl.tsx";

const inputClass =
  "rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent";

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const TOGGLE_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "on", label: "On" },
] as const;

/** Set the time of day the analysis run fires automatically. Mirrors the TickerManager dialog. */
export function ScheduleDialog({ onClose }: { onClose: () => void }) {
  const schedule = useSchedule();
  const save = useSetSchedule();

  const [enabled, setEnabled] = useState<boolean>(schedule.data?.schedule.enabled ?? false);
  const [time, setTime] = useState<string>(schedule.data?.schedule.time ?? "09:30");
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!TIME_RE.test(time)) {
      setError("Pick a valid time of day.");
      return;
    }
    try {
      await save.mutateAsync({ enabled, time });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save schedule");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="Automatic run schedule"
      description="Run the daily analysis automatically at a time you choose."
      className="max-w-md"
    >
      <div className="space-y-5">
        <div className="flex items-center justify-between gap-3">
          <div className="eyebrow">Automatic run</div>
          <SegmentedControl
            value={enabled ? "on" : "off"}
            onChange={(v) => setEnabled(v === "on")}
            options={[...TOGGLE_OPTIONS]}
            size="sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-5">
          <div>
            <div className="eyebrow mb-1">Time of day</div>
            <p className="text-xs text-text-muted">
              {enabled ? `Runs daily at ${time12h(time)}.` : "Turn on automatic runs to schedule a time."}
            </p>
          </div>
          <input
            type="time"
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className={`${inputClass} font-mono`}
            disabled={!enabled}
          />
        </div>

        <p className="rounded-lg border border-hairline bg-surface-2 px-3 py-2.5 text-xs text-text-muted">
          Uses this computer's local time and runs only while the app is open on this Mac. It will
          not run while the computer is asleep or closed.
        </p>

        {error && <p className="text-xs text-neg">{error}</p>}

        <div className="flex justify-end border-t border-hairline pt-5">
          <Button
            variant="primary"
            size="sm"
            icon={<Check className="h-4 w-4" />}
            onClick={submit}
            loading={save.isPending}
          >
            Save schedule
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
