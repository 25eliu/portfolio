import { describe, expect, test } from "bun:test";
import { dueToRun, localDate, localHHMM, startScheduler } from "./index.ts";
import type { Schedule } from "../domain/index.ts";
import { createApp } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";

const at = (hhmm: string): Date => {
  const [h, m] = hhmm.split(":").map(Number);
  // Local-time construction so the test matches the scheduler's local-time logic regardless of TZ.
  return new Date(2026, 5, 1, h, m, 0); // 2026-06-01 local
};
const enabled = (time: string): Schedule => ({ enabled: true, time });

describe("local helpers", () => {
  test("localDate / localHHMM read the server-local clock", () => {
    const d = at("09:30");
    expect(localDate(d)).toBe("2026-06-01");
    expect(localHHMM(d)).toBe("09:30");
  });
});

describe("dueToRun", () => {
  test("fires when enabled, time reached, and not yet run today", () => {
    expect(dueToRun(enabled("09:30"), at("09:30"), null)).toBe(true);
    expect(dueToRun(enabled("09:30"), at("09:31"), "2026-05-31")).toBe(true);
    expect(dueToRun(enabled("09:30"), at("17:00"), null)).toBe(true);
  });

  test("does not fire before the target time", () => {
    expect(dueToRun(enabled("09:30"), at("09:29"), null)).toBe(false);
    expect(dueToRun(enabled("09:30"), at("00:00"), null)).toBe(false);
  });

  test("does not fire when disabled", () => {
    expect(dueToRun({ enabled: false, time: "09:30" }, at("10:00"), null)).toBe(false);
  });

  test("fires at most once per local day", () => {
    expect(dueToRun(enabled("09:30"), at("10:00"), "2026-06-01")).toBe(false);
  });
});

describe("startScheduler (integration)", () => {
  const makeApp = () =>
    createApp({
      db: openMemoryDb(),
      gateway: createFakeGateway({ now: () => "2026-06-01", startingCash: 100_000 }),
      now: () => "2026-06-01",
    });

  test("fires a run when due, then guards against re-firing the same day", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: true, time: "00:00" }); // due any time today
    expect(app.repos.runs.latest()).toBeNull();

    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 60));
      const first = app.repos.runs.latest();
      expect(first).not.toBeNull(); // the tick started a run
      // The scheduler fires on the real wall clock (not the app's mocked `now`), so the guard
      // records today's real local date.
      expect(app.repos.schedule.lastRunDate()).toBe(localDate(new Date()));

      await new Promise((r) => setTimeout(r, 40));
      expect(app.repos.runs.latest()?.id).toBe(first!.id); // no second run that day
    } finally {
      sched.stop();
    }
  });

  test("does not fire when disabled", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: false, time: "00:00" });
    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 50));
      expect(app.repos.runs.latest()).toBeNull();
    } finally {
      sched.stop();
    }
  });
});
