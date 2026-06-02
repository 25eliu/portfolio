import type { App } from "../app.ts";
import { newId, type RetrievedExcerpt } from "../domain/index.ts";
import { priceAiPortfolio, priceUserPortfolio } from "./pricing.ts";
import { generateFakeReport } from "./fakeReport.ts";
import { generateLlmReport } from "./llmReport.ts";
import { persistJournal } from "./journal.ts";
import { persistCuratedFacts } from "../knowledge/curate.ts";
import { resolveDueForecasts } from "../resolution/index.ts";
import { compileWiki } from "../wiki/index.ts";
import { executeAiTrades } from "../execution/index.ts";
import { backfillUntrackedEntries } from "./backfill.ts";
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
 * The pipeline spine. One function, two triggers (manual `POST /run` and the scheduler).
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

    // Step 0 — stamp a cost basis + buy date on any untracked My-Portfolio holding so its P&L is real.
    await backfillUntrackedEntries(app).catch((err) =>
      console.warn(`[backfill] step failed: ${err instanceof Error ? err.message : String(err)}`),
    );

    // Steps 1+2 — sync + price both portfolios.
    const [user, ai] = await Promise.all([priceUserPortfolio(app), priceAiPortfolio(app)]);

    // Step 2b — resolve any forecasts whose horizon has elapsed, before new analysis (no lookahead).
    // Degrades gracefully: resolution failures are logged and retried next run, never aborting the run.
    const resolution = await resolveDueForecasts(app).catch((err) => {
      console.warn(`[resolution] step failed: ${err instanceof Error ? err.message : String(err)}`);
      return { resolved: 0, skipped: 0 };
    });
    if (resolution.resolved > 0 || resolution.skipped > 0) {
      console.log(`[resolution] resolved=${resolution.resolved} skipped=${resolution.skipped}`);
    }

    // Step 2c — compile the performance wiki from resolved outcomes (after resolution, before analysis)
    // so the freshest, evidence-gated briefing is injected into this run. Degrades gracefully.
    const wiki = await Promise.resolve()
      .then(() => compileWiki(app))
      .catch((err) => {
        console.warn(`[wiki] compile failed: ${err instanceof Error ? err.message : String(err)}`);
        return { metrics: 0, lessons: 0, briefing: "" };
      });
    if (wiki.lessons > 0) console.log(`[wiki] metrics=${wiki.metrics} lessons=${wiki.lessons}`);

    // Step 3 — analysis: real LLM report (streamed) when an analyzer is configured, else fake fallback.
    // The AI's own positions join the universe so it can decide ADD/TRIM/SELL on its book each run.
    const aiHeld = ai.positions.map((p) => p.symbol);
    const { report, referencePrices, evidenceByTicker } = app.analyzer
      ? await generateLlmReport(app, emit, aiHeld)
      : {
          report: generateFakeReport(user.positions.map((p) => p.symbol), date),
          referencePrices: new Map<string, number>(),
          evidenceByTicker: new Map<string, RetrievedExcerpt[]>(),
        };

    // Step 4 — persist the user snapshot, SPY benchmark, report, then the typed journal. The AI
    // snapshot waits until AFTER this run's fills so its equity curve reflects today's trades.
    persistSnapshot(app, user, date);
    const spy = await app.gateway.getQuote("SPY");
    app.repos.marketSnapshots.upsert(date, spy.price);
    app.repos.reports.insert(report);
    const journaled = persistJournal(app, report, runId, spy.price, referencePrices, evidenceByTicker);
    console.log(`[journal] entries=${journaled.entries} scored=${journaled.scored} evidence=${journaled.evidence}`);

    // Step 4b — self-curated memory: persist the durable facts the analyzer chose to remember this run
    // (deduped against existing memory). Degrades gracefully — a curation failure never aborts the run.
    try {
      const curated = persistCuratedFacts(app, report, runId, journaled.linkByTicker);
      if (curated.added > 0 || curated.skipped > 0) {
        console.log(`[curate] added=${curated.added} skipped=${curated.skipped}`);
      }
    } catch (err) {
      console.warn(`[curate] step failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    // Step 5 — the AI acts on its own book: deterministic paper trades from the same analysis, filled
    // against its isolated DB ledger. Sized against the pre-trade `ai` snapshot priced above.
    const trades = await executeAiTrades(app, report, runId, {
      ai,
      referencePrices,
      journalLink: journaled.linkByTicker,
    }).catch((err) => {
      console.warn(`[execution] step failed: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    });
    if (trades) {
      console.log(`[execution] filled=${trades.filled} proposed=${trades.proposed} skipped=${trades.skipped}`);
    }

    // Step 6 — re-price the AI from its now-updated ledger and snapshot the post-trade book. Fills are
    // transactional, so even a failed execution step leaves a consistent book to snapshot.
    const aiPost = await priceAiPortfolio(app);
    persistSnapshot(app, aiPost, date);

    app.repos.runs.finish(runId, "ok");
    emit({ type: "run:done", runId });
    return { runId, date, status: "ok", portfolios: [user, aiPost], report };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.repos.runs.finish(runId, "error", message);
    emit({ type: "run:error", runId, message });
    throw err;
  }
}
