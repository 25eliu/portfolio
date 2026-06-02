import type { DB } from "../connection.ts";
import { Schedule, DEFAULT_SCHEDULE } from "../../domain/index.ts";

const SINGLETON = "singleton";

// `last_run_date` exists in the table (migration 005) but is reserved/unused: the scheduler derives
// "already ran today" from the runs table so manual runs also count toward the once-per-day guard.
type Row = {
  id: string;
  enabled: number;
  time_of_day: string;
};

const toDomain = (r: Row): Schedule =>
  Schedule.parse({ enabled: r.enabled === 1, time: r.time_of_day });

/** Single-row store for the automatic-run schedule (enabled + time of day). */
export function scheduleRepo(db: DB) {
  return {
    get(): Schedule {
      const row = db
        .query<Row, [string]>("SELECT id, enabled, time_of_day FROM schedule_settings WHERE id = ?")
        .get(SINGLETON);
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
  };
}
export type ScheduleRepo = ReturnType<typeof scheduleRepo>;
