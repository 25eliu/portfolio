import type { DB } from "../connection.ts";
import { Schedule, DEFAULT_SCHEDULE } from "../../domain/index.ts";

const SINGLETON = "singleton";

// `last_run_date` exists in the table (migration 005) but is reserved/unused: the scheduler derives
// "ran within the cooldown window" from the runs table so manual runs also count toward the guard.
type Row = {
  id: string;
  enabled: number;
  time_of_day: string;
  cooldown_hours: number;
};

const toDomain = (r: Row): Schedule =>
  Schedule.parse({ enabled: r.enabled === 1, time: r.time_of_day, cooldownHours: r.cooldown_hours });

/** Single-row store for the automatic-run schedule (enabled + time of day + cooldown). */
export function scheduleRepo(db: DB) {
  return {
    get(): Schedule {
      const row = db
        .query<Row, [string]>(
          "SELECT id, enabled, time_of_day, cooldown_hours FROM schedule_settings WHERE id = ?",
        )
        .get(SINGLETON);
      return row ? toDomain(row) : DEFAULT_SCHEDULE;
    },

    set(input: Schedule): Schedule {
      const valid = Schedule.parse(input);
      db.query(
        `INSERT INTO schedule_settings (id, enabled, time_of_day, cooldown_hours) VALUES (?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET enabled = excluded.enabled, time_of_day = excluded.time_of_day,
           cooldown_hours = excluded.cooldown_hours`,
      ).run(SINGLETON, valid.enabled ? 1 : 0, valid.time, valid.cooldownHours);
      return valid;
    },
  };
}
export type ScheduleRepo = ReturnType<typeof scheduleRepo>;
