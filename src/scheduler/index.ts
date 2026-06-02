import type { App } from "../app.ts";
import { startRunGuarded } from "../pipeline/startRun.ts";
import type { Schedule } from "../domain/index.ts";

/** Local calendar date (YYYY-MM-DD) for `now` in the server's timezone. */
export function localDate(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Local wall-clock time (HH:MM, 24h) for `now` in the server's timezone. */
export function localHHMM(now: Date): string {
  const h = String(now.getHours()).padStart(2, "0");
  const m = String(now.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/**
 * Pure decision: should the scheduled run start right now? True iff the schedule is enabled, it has
 * not already run today (local date), and the current local time has reached the target time. Kept
 * pure (no clock, no I/O) so it is exhaustively unit-testable.
 */
export function dueToRun(schedule: Schedule, now: Date, lastRunDate: string | null): boolean {
  if (!schedule.enabled) return false;
  const todayLocal = localDate(now);
  if (lastRunDate === todayLocal) return false;
  return localHHMM(now) >= schedule.time;
}

const TICK_MS = 30_000;

/**
 * Start the in-process scheduler. Every ~30s it checks the saved schedule and fires the daily run
 * once when its time arrives. Returns a stop handle.
 *
 * Limitation: this is a process-local timer — it only fires while the server is running and the
 * machine is awake. A sleeping/closed laptop suspends it. Always-on scheduling needs a hosted backend.
 */
export function startScheduler(app: App, tickMs: number = TICK_MS): { stop: () => void } {
  const tick = () => {
    try {
      const schedule = app.repos.schedule.get();
      const now = new Date();
      if (dueToRun(schedule, now, app.repos.schedule.lastRunDate())) {
        const today = localDate(now);
        app.repos.schedule.markRan(today); // mark before starting so a slow run can't double-fire
        const { runId, status } = startRunGuarded(app);
        console.log(`→ scheduled run ${status} (${runId}) for ${today} ${schedule.time}`);
      }
    } catch (err) {
      console.error("scheduler tick failed:", err instanceof Error ? err.message : err);
    }
  };

  const handle = setInterval(tick, tickMs);
  return { stop: () => clearInterval(handle) };
}
