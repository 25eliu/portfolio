import { z } from "zod";

/**
 * Automatic-run schedule. When enabled, the in-process scheduler fires the analysis run when the
 * app opens / the machine wakes, and by `time` (24h "HH:MM", server-local) at the latest — but never
 * within `cooldownHours` of the previous run, so reopening the laptop repeatedly won't spam runs.
 *
 * NOTE: this only fires while the server process is running and the machine is awake — a sleeping or
 * closed laptop suspends the timer. Truly always-on scheduling requires hosting the backend.
 */
export const Schedule = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be 24h HH:MM"),
  /** Minimum hours between runs — a run is suppressed if one started within this window. */
  cooldownHours: z.number().int().positive().default(4),
});
export type Schedule = z.infer<typeof Schedule>;

/** Default schedule when none has been saved yet: off, by market open (09:30 local), 4h cooldown. */
export const DEFAULT_SCHEDULE: Schedule = { enabled: false, time: "09:30", cooldownHours: 4 };
