import { describe, expect, test } from "bun:test";
import { runBus, type RunEvent } from "./events.ts";
import { newId } from "../domain/index.ts";

describe("runBus", () => {
  test("assigns increasing seq and replays buffered events on subscribe", () => {
    const runId = newId();
    runBus.publish(runId, { type: "run:start", runId, at: "t" });
    runBus.publish(runId, { type: "phase", phase: "analyze", label: "x" });

    const replayed: RunEvent[] = [];
    const unsub = runBus.subscribe(runId, (e) => replayed.push(e));
    expect(replayed.map((e) => e.type)).toEqual(["run:start", "phase"]);
    expect(replayed.map((e) => e.seq)).toEqual([1, 2]);

    // live events reach the subscriber
    runBus.publish(runId, { type: "run:done", runId });
    expect(replayed.at(-1)?.type).toBe("run:done");
    expect(replayed.at(-1)?.seq).toBe(3);
    unsub();
  });

  test("unsubscribe stops delivery; isActive reflects lifecycle", () => {
    const runId = newId();
    runBus.publish(runId, { type: "run:start", runId, at: "t" });
    expect(runBus.isActive(runId)).toBe(true);

    const seen: RunEvent[] = [];
    const unsub = runBus.subscribe(runId, (e) => seen.push(e));
    unsub();
    runBus.publish(runId, { type: "phase", phase: "context", label: "y" });
    expect(seen.some((e) => e.type === "phase")).toBe(false);

    runBus.publish(runId, { type: "run:done", runId });
    expect(runBus.isActive(runId)).toBe(false);
    expect(runBus.hasBuffer(runId)).toBe(true);
  });

  test("unknown run has no buffer", () => {
    expect(runBus.hasBuffer("never-started")).toBe(false);
  });
});
