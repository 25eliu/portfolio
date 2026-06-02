import type { App } from "../app.ts";
import { dailyRun } from "./index.ts";

export type StartRunResult = { runId: string; status: "started" | "already_running" };

/**
 * Start a daily run in the background, guarding against concurrent runs, and return its id so a
 * caller can open the SSE stream for it. Shared by the manual HTTP trigger (POST /run) and the
 * automatic scheduler so both go through the exact same concurrency guard and error handling.
 */
export function startRunGuarded(app: App): StartRunResult {
  const active = app.repos.runs.latest();
  if (active?.status === "running") {
    return { runId: active.id, status: "already_running" };
  }
  const runId = app.repos.runs.start();
  void dailyRun(app, { runId }).catch((err) =>
    console.error("dailyRun failed:", err instanceof Error ? err.message : err),
  );
  return { runId, status: "started" };
}
