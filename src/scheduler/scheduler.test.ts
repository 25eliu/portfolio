import { describe, expect, test } from "bun:test";
import { localDate, localHHMM, ranToday, shouldRun, startScheduler } from "./index.ts";
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
  test("fires at or after the set time when it hasn't run today", () => {
    expect(shouldRun(enabled("09:30"), at("09:30"), false)).toBe(true);
    expect(shouldRun(enabled("09:30"), at("17:00"), false)).toBe(true); // catch-up after the time
  });

  test("does not fire before the set time", () => {
    expect(shouldRun(enabled("09:30"), at("09:29"), false)).toBe(false);
  });

  test("does not fire on a brief overnight wake before the set time (the midnight-run bug)", () => {
    expect(shouldRun(enabled("09:30"), at("00:10"), false)).toBe(false);
    expect(shouldRun(enabled("09:30"), at("00:00"), false)).toBe(false);
  });

  test("never fires twice in a day (already ran today)", () => {
    expect(shouldRun(enabled("09:30"), at("09:30"), true)).toBe(false);
    expect(shouldRun(enabled("09:30"), at("17:00"), true)).toBe(false);
  });

  test("never fires when disabled", () => {
    expect(shouldRun({ enabled: false, time: "09:30" }, at("10:00"), false)).toBe(false);
  });

  test("compares times numerically, not lexically", () => {
    // "9:00" < "10:00" numerically; a naive string compare would get edge cases like this wrong.
    expect(shouldRun(enabled("09:00"), at("10:00"), false)).toBe(true);
    expect(shouldRun(enabled("21:00"), at("09:00"), false)).toBe(false);
  });
});

describe("startScheduler (integration)", () => {
  const makeApp = () =>
    createApp({
      db: openMemoryDb(),
      gateway: createFakeGateway({ now: () => "2026-06-01", startingCash: 100_000 }),
      now: () => "2026-06-01",
    });

  test("catches up on boot when past the set time, then never re-fires the same day", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: true, time: "00:00" }); // any wall-clock time is ≥ 00:00
    expect(app.repos.runs.latest()).toBeNull();

    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 40));
      const first = app.repos.runs.latest();
      expect(first).not.toBeNull(); // boot started a run immediately

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

  test("a run already today suppresses the scheduled catch-up", async () => {
    const app = makeApp();
    app.repos.schedule.set({ enabled: true, time: "00:00" });
    app.repos.runs.start(); // a run earlier today (manual or otherwise)
    const before = app.repos.runs.latest()!.id;

    const sched = startScheduler(app, 10);
    try {
      await new Promise((r) => setTimeout(r, 40));
      expect(app.repos.runs.latest()!.id).toBe(before); // no extra auto-run today
    } finally {
      sched.stop();
    }
  });
});

describe("ranToday", () => {
  const makeApp = () =>
    createApp({
      db: openMemoryDb(),
      gateway: createFakeGateway({ now: () => "2026-06-01", startingCash: 100_000 }),
      now: () => "2026-06-01",
    });

  test("no prior run → false", () => {
    const app = makeApp();
    expect(ranToday(app, new Date())).toBe(false);
  });

  test("a run earlier today → true", () => {
    const app = makeApp();
    const now = new Date();
    app.repos.runs.start(new Date(now.getTime() - 20 * 60_000).toISOString());
    expect(ranToday(app, now)).toBe(true);
  });

  test("a run on a previous day → false (a new day's run is allowed)", () => {
    const app = makeApp();
    const now = new Date();
    const yesterday = new Date(now.getTime() - 26 * 3_600_000).toISOString();
    app.repos.runs.start(yesterday);
    expect(ranToday(app, now)).toBe(false);
  });
});
