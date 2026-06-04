import { z } from "zod";

/**
 * Automatic-run schedule. When enabled, the in-process scheduler fires the analysis run once a day
 * at (or after) `time` (24h "HH:MM", server-local). If the machine is first started or woken after
 * the set time and hasn't run yet today, it catches up immediately; before the set time it waits.
 *
 * NOTE: this only fires while the server process is running and the machine is awake — a sleeping or
 * closed laptop suspends the timer. Truly always-on scheduling requires hosting the backend.
 */
export const Schedule = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be 24h HH:MM"),
});
export type Schedule = z.infer<typeof Schedule>;

/** Default schedule when none has been saved yet: off, by market open (09:30 local). */
export const DEFAULT_SCHEDULE: Schedule = { enabled: false, time: "09:30" };
