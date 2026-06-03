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
 * Pure decision: should the scheduled run start on this evaluation?
 *
 * Semantics ("run when I open my laptop, or by the set time — but not within the cooldown window"):
 *  - disabled, or a run started within the cooldown window (`cooldownActive`) → never.
 *  - `justOpened` (the app just launched or the machine woke from sleep) → run now, regardless of
 *    time. This is the catch-up that gives you a fresh run when you open your laptop.
 *  - otherwise (the app has been running continuously) → run once the set time is reached. The set
 *    time therefore acts as a guaranteed-by cap for a machine that stays awake.
 *
 * Kept pure (no clock, no I/O) so every branch is unit-testable.
 */
export function shouldRun(
  schedule: Schedule,
  now: Date,
  cooldownActive: boolean,
  justOpened: boolean,
): boolean {
  if (!schedule.enabled) return false;
  if (cooldownActive) return false;
  if (justOpened) return true;
  return localHHMM(now) >= schedule.time;
}

/**
 * Heuristic for "the laptop was reopened": a gap between scheduler ticks far larger than the tick
 * interval means the process was suspended (machine slept), i.e. it has just woken up.
 */
export function wokeFromSleep(gapMs: number, tickMs: number): boolean {
  return gapMs > Math.max(tickMs * 4, 90_000);
}

const TICK_MS = 30_000;

/** True if the most recent run (manual or scheduled) started within `cooldownHours` of `now`. */
export function inCooldown(app: App, now: Date, cooldownHours: number): boolean {
  const latest = app.repos.runs.latest();
  if (latest == null) return false;
  return now.getTime() - new Date(latest.startedAt).getTime() < cooldownHours * 3_600_000;
}

/**
 * Start the in-process scheduler. It fires the run by the user's chosen time, AND catches up with an
 * immediate run when the app launches or the machine wakes from sleep — but never within the
 * configured cooldown window of the previous run (so repeated reopens don't spam runs). Returns a
 * stop handle.
 *
 * Limitation: this is a process-local timer. It can only fire while the app is running — so for the
 * "run when I open my laptop" guarantee, keep the server running (or launch it on login). A machine
 * that is fully powered off with the app not running will catch up the next time the app starts.
 */
export function startScheduler(app: App, tickMs: number = TICK_MS): { stop: () => void } {
  const evaluate = (justOpened: boolean) => {
    try {
      const now = new Date();
      const schedule = app.repos.schedule.get();
      if (shouldRun(schedule, now, inCooldown(app, now, schedule.cooldownHours), justOpened)) {
        const { runId, status } = startRunGuarded(app);
        const reason = justOpened ? "on open" : "scheduled";
        console.log(`→ ${reason} run ${status} (${runId}) at ${localDate(now)} ${localHHMM(now)}`);
      }
    } catch (err) {
      console.error("scheduler tick failed:", err instanceof Error ? err.message : err);
    }
  };

  // Boot = the app just launched (e.g. you opened your laptop and it started) → catch up immediately.
  evaluate(true);

  let lastTickMs = realNowMs();
  const handle = setInterval(() => {
    const nowMs = realNowMs();
    const gap = nowMs - lastTickMs;
    lastTickMs = nowMs;
    evaluate(wokeFromSleep(gap, tickMs));
  }, tickMs);

  return { stop: () => clearInterval(handle) };
}

/** Wall-clock milliseconds. Isolated so the wake heuristic reads the real clock. */
function realNowMs(): number {
  return new Date().getTime();
}
