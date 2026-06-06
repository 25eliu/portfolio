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

/** Minutes-since-midnight for an "HH:MM" string, so times compare numerically (not lexically). */
function hhmm(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h * 60 + m;
}

/**
 * Pure decision: should the scheduled run start on this evaluation?
 *
 * Semantics ("run once a day, at or after the set time"):
 *  - disabled, or a run already happened today (`ranToday`) → never. This is the once-per-day cap.
 *  - otherwise → run once the local wall-clock has reached the set time. A machine that is awake at
 *    the set time fires then; a machine first started/woken *after* the set time catches up on the
 *    next tick. Before the set time it waits — so a brief overnight wake never triggers an early run.
 *
 * Kept pure (no clock, no I/O) so every branch is unit-testable.
 */
export function shouldRun(schedule: Schedule, now: Date, ranToday: boolean): boolean {
  if (!schedule.enabled) return false;
  if (ranToday) return false;
  return hhmm(localHHMM(now)) >= hhmm(schedule.time);
}

const TICK_MS = 30_000;

/** True if the most recent run (manual or scheduled) started on the same local day as `now`. */
export function ranToday(app: App, now: Date): boolean {
  const latest = app.repos.runs.latest();
  if (latest == null) return false;
  return localDate(new Date(latest.startedAt)) === localDate(now);
}

/**
 * Start the in-process scheduler. It fires the run once a day at (or after) the user's chosen time,
 * and catches up with an immediate run when the app launches or the machine wakes after the set time
 * but hasn't run yet today. Returns a stop handle.
 *
 * Limitation: this is a process-local timer. It can only fire while the app is running — so for the
 * catch-up to work, keep the server running (or launch it on login). A machine that is fully powered
 * off with the app not running will catch up the next time the app starts (if that's after the set
 * time and it hasn't already run today).
 */
export function startScheduler(app: App, tickMs: number = TICK_MS): { stop: () => void } {
  const evaluate = () => {
    try {
      const now = new Date();
      const schedule = app.repos.schedule.get();
      if (shouldRun(schedule, now, ranToday(app, now))) {
        const { runId, status } = startRunGuarded(app);
        console.log(`→ scheduled run ${status} (${runId}) at ${localDate(now)} ${localHHMM(now)}`);
      }
    } catch (err) {
      console.error("scheduler tick failed:", err instanceof Error ? err.message : err);
    }
  };

  // Boot = the app just launched (e.g. you opened your laptop and it started) → check immediately;
  // a wake mid-day is caught by the next tick within `tickMs`.
  evaluate();

  const handle = setInterval(evaluate, tickMs);

  return { stop: () => clearInterval(handle) };
}
