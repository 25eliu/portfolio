import type { DB } from "../connection.ts";
import { Schedule, DEFAULT_SCHEDULE } from "../../domain/index.ts";

const SINGLETON = "singleton";

type Row = {
  id: string;
  enabled: number;
  time_of_day: string;
  last_run_date: string | null;
};

const toDomain = (r: Row): Schedule =>
  Schedule.parse({ enabled: r.enabled === 1, time: r.time_of_day });

/**
 * Single-row store for the automatic-run schedule. `last_run_date` is the once-per-day guard the
 * scheduler uses so a given day's run fires at most once.
 */
export function scheduleRepo(db: DB) {
  const read = () =>
    db.query<Row, [string]>("SELECT * FROM schedule_settings WHERE id = ?").get(SINGLETON);

  return {
    get(): Schedule {
      const row = read();
      return row ? toDomain(row) : DEFAULT_SCHEDULE;
    },

    set(input: Schedule): Schedule {
      const valid = Schedule.parse(input);
      db.query(
        `INSERT INTO schedule_settings (id, enabled, time_of_day) VALUES (?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, time_of_day = excluded.time_of_day`,
      ).run(SINGLETON, valid.enabled ? 1 : 0, valid.time);
      return valid;
    },

    lastRunDate(): string | null {
      return read()?.last_run_date ?? null;
    },

    /** Record that the scheduled run for `date` (local YYYY-MM-DD) has fired. */
    markRan(date: string): void {
      db.query(
        `INSERT INTO schedule_settings (id, last_run_date) VALUES (?, ?)
         ON CONFLICT (id) DO UPDATE SET last_run_date = excluded.last_run_date`,
      ).run(SINGLETON, date);
    },
  };
}
export type ScheduleRepo = ReturnType<typeof scheduleRepo>;
