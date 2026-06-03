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
  const [cooldownHours, setCooldownHours] = useState<number>(
    schedule.data?.schedule.cooldownHours ?? 4,
  );
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    if (!TIME_RE.test(time)) {
      setError("Pick a valid time of day.");
      return;
    }
    if (!Number.isInteger(cooldownHours) || cooldownHours < 1) {
      setError("Cooldown must be a whole number of hours (1 or more).");
      return;
    }
    try {
      await save.mutateAsync({ enabled, time, cooldownHours });
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
            <div className="eyebrow mb-1">Run by</div>
            <p className="text-xs text-text-muted">
              {enabled
                ? `Runs by ${time12h(time)} — or as soon as you open your laptop, whichever comes first.`
                : "Turn on automatic runs to choose a time."}
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

        <div className="flex items-center justify-between gap-3 border-t border-hairline pt-5">
          <div>
            <div className="eyebrow mb-1">Cooldown</div>
            <p className="text-xs text-text-muted">
              {enabled
                ? `Won't run again within ${cooldownHours}h of the last run, so reopening repeatedly won't trigger extra runs.`
                : "Minimum hours between runs."}
            </p>
          </div>
          <input
            type="number"
            min={1}
            step={1}
            value={cooldownHours}
            onChange={(e) => setCooldownHours(Math.trunc(Number(e.target.value)))}
            className={`${inputClass} w-20 font-mono`}
            disabled={!enabled}
          />
        </div>

        <p className="rounded-lg border border-hairline bg-surface-2 px-3 py-2.5 text-xs text-text-muted">
          Runs in this computer's local time — when you open your laptop or by the set time, whichever
          comes first, but never more than once per cooldown window. If your laptop is asleep or off,
          the run happens the next time you open it — so long as the app is still running (keep it
          open, or launch it on login).
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
