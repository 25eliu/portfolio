import type { App } from "../app.ts";
import { newId } from "../domain/index.ts";
import { priceAiPortfolio, priceUserPortfolio } from "./pricing.ts";
import { generateFakeReport } from "./fakeReport.ts";
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
 * The pipeline spine. One function, two triggers (manual `POST /run` now, scheduler later).
 * Phase 0+1 step set: sync + price both portfolios → emit a fake report → persist snapshots,
 * the SPY benchmark point, the report, and a run-log row. Wrapped so a failure is recorded.
 */
export async function dailyRun(app: App): Promise<RunResult> {
  const runId = app.repos.runs.start();
  try {
    const date = app.now();

    // Steps 1+2 — sync + price both portfolios.
    const [user, ai] = await Promise.all([priceUserPortfolio(app), priceAiPortfolio(app)]);

    // Step 3 — placeholder for the Phase 2 LLM analysis.
    const report = generateFakeReport(
      user.positions.map((p) => p.symbol),
      date,
    );

    // Step 4 — persist snapshots, SPY benchmark, report.
    persistSnapshot(app, user, date);
    persistSnapshot(app, ai, date);
    const spy = await app.gateway.getQuote("SPY");
    app.repos.marketSnapshots.upsert(date, spy.price);
    app.repos.reports.insert(report);

    app.repos.runs.finish(runId, "ok");
    return { runId, date, status: "ok", portfolios: [user, ai], report };
  } catch (err) {
    app.repos.runs.finish(runId, "error", err instanceof Error ? err.message : String(err));
    throw err;
  }
}
