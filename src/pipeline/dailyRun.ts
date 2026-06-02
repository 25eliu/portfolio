import type { App } from "../app.ts";
import { newId } from "../domain/index.ts";
import { priceAiPortfolio, priceUserPortfolio } from "./pricing.ts";
import { generateFakeReport } from "./fakeReport.ts";
import { generateLlmReport } from "./llmReport.ts";
import { type Emit, logEvent, runBus } from "./events.ts";
import type { PricedPortfolio, RunResult } from "./types.ts";

function persistSnapshot(app: App, p: PricedPortfolio, date: string): void {
  app.repos.snapshots.upsert({
    id: newId(),
    portfolioId: p.portfolioId,
    date,
    totalValue: p.equity,
    cash: p.cash,
    positions: p.positions,
  });
}

/**
 * The pipeline spine. One function, two triggers (manual `POST /run`, scheduler later).
 * Publishes live progress events to the run bus (and the terminal) so the UI can stream the run.
 * `opts.runId` lets the caller pre-create the run id (so it can hand it to a client before the run
 * finishes); otherwise a fresh one is started here.
 */
export async function dailyRun(app: App, opts: { runId?: string } = {}): Promise<RunResult> {
  const runId = opts.runId ?? app.repos.runs.start();
  const emit: Emit = (e) => {
    runBus.publish(runId, e);
    logEvent(e);
  };
  emit({ type: "run:start", runId, at: new Date().toISOString() });
  try {
    const date = app.now();

    // Steps 1+2 — sync + price both portfolios.
    const [user, ai] = await Promise.all([priceUserPortfolio(app), priceAiPortfolio(app)]);

    // Step 3 — analysis: real LLM report (streamed) when an analyzer is configured, else fake fallback.
    const report = app.analyzer
      ? await generateLlmReport(app, emit)
      : generateFakeReport(user.positions.map((p) => p.symbol), date);

    // Step 4 — persist snapshots, SPY benchmark, report.
    persistSnapshot(app, user, date);
    persistSnapshot(app, ai, date);
    const spy = await app.gateway.getQuote("SPY");
    app.repos.marketSnapshots.upsert(date, spy.price);
    app.repos.reports.insert(report);

    app.repos.runs.finish(runId, "ok");
    emit({ type: "run:done", runId });
    return { runId, date, status: "ok", portfolios: [user, ai], report };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.repos.runs.finish(runId, "error", message);
    emit({ type: "run:error", runId, message });
    throw err;
  }
}
