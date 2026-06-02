import { describe, expect, test } from "bun:test";
import { localDate, localHHMM, shouldRun, startScheduler, wokeFromSleep } from "./index.ts";
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

describe("shouldRun", () => {
  test("at the scheduled time while running continuously (not just opened)", () => {
    expect(shouldRun(enabled("09:30"), at("09:30"), false, false)).toBe(true);
    expect(shouldRun(enabled("09:30"), at("17:00"), false, false)).toBe(true);
  });

  test("does not fire before the scheduled time when running continuously", () => {
    expect(shouldRun(enabled("09:30"), at("09:29"), false, false)).toBe(false);
    expect(shouldRun(enabled("09:30"), at("00:00"), false, false)).toBe(false);
  });

  test("fires immediately on open/wake regardless of time (catch-up)", () => {
    expect(shouldRun(enabled("11:30"), at("08:00"), false, true)).toBe(true); // opened before the time
    expect(shouldRun(enabled("11:30"), at("15:00"), false, true)).toBe(true); // opened after the time
  });

  test("never fires when disabled", () => {
    expect(shouldRun({ enabled: false, time: "09:30" }, at("10:00"), false, true)).toBe(false);
  });

  test("never fires more than once per day (already ran today)", () => {
    expect(shouldRun(enabled("09:30"), at("10:00"), true, false)).toBe(false);
    expect(shouldRun(enabled("09:30"), at("10:00"), true, true)).toBe(false); // even on open
  });
});

describe("wokeFromSleep", () => {
  test("a normal tick gap is not a wake", () => {
    expect(wokeFromSleep(30_000, 30_000)).toBe(false);
    expect(wokeFromSleep(31_000, 30_000)).toBe(false);
  });
  test("a gap far larger than the tick interval is a wake", () => {
    expect(wokeFromSleep(3_600_000, 30_000)).toBe(true); // slept an hour
    expect(wokeFromSleep(120_001, 30_000)).toBe(true);
  });
});

describe("startScheduler (integration)", () => {
  const makeApp = () =>
    createApp({
      db: openMemoryDb(),
      gateway: createFakeGateway({ now: () => "2026-06-01", startingCash: 100_000 }),
      now: () => "2026-06-01",
    });

  test("catches up on boot when enabled, then never re-fires the same day", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: true, time: "23:59" }); // time is in the future, but boot catches up
    expect(app.repos.runs.latest()).toBeNull();

    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 40));
      const first = app.repos.runs.latest();
      expect(first).not.toBeNull(); // boot started a run immediately ("opened the laptop")

      await new Promise((r) => setTimeout(r, 40));
      expect(app.repos.runs.latest()?.id).toBe(first!.id); // guard: no second run today
    } finally {
      sched.stop();
    }
  });

  test("does not fire when disabled", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: false, time: "00:00" });
    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 40));
      expect(app.repos.runs.latest()).toBeNull();
    } finally {
      sched.stop();
    }
  });

  test("a manual run today suppresses the scheduled catch-up", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: true, time: "00:00" });
    app.repos.runs.start(); // simulate a manual run already today
    const before = app.repos.runs.latest()!.id;

    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 40));
      expect(app.repos.runs.latest()!.id).toBe(before); // no extra auto-run
    } finally {
      sched.stop();
    }
  });
});
