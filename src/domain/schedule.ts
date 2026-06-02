import { z } from "zod";

/**
 * Automatic-run schedule. When enabled, the in-process scheduler fires the daily analysis run once
 * per day at `time` (24h "HH:MM", interpreted in the server's local timezone).
 *
 * NOTE: this only fires while the server process is running and the machine is awake — a sleeping or
 * closed laptop suspends the timer. Truly always-on scheduling requires hosting the backend.
 */
export const Schedule = z.object({
  enabled: z.boolean(),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "time must be 24h HH:MM"),
});
export type Schedule = z.infer<typeof Schedule>;

/** Default schedule when none has been saved yet: off, at market open (09:30 local). */
export const DEFAULT_SCHEDULE: Schedule = { enabled: false, time: "09:30" };
