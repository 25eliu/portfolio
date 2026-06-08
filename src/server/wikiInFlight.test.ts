import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { createServer } from "./app.ts";
import { trackOpenForecasts } from "../resolution/track.ts";
import { newId } from "../domain/index.ts";

const DATE = "2026-06-03";
let app: App;
let server: ReturnType<typeof createServer>;

/** Seed report → journal entry → OPEN scored forecast so FKs hold and listOpen returns it. */
function seedForecast(app: App, id: string): void {
  const reportId = newId();
  app.repos.reports.insert({ id: reportId, date: "2026-06-01", generatedAt: "2026-06-01T00:00:00.000Z", source: "llm", recommendations: [], marketContext: null, outlook: null });
  const entryId = newId();
  app.repos.journalEntries.insert({
    id: entryId, reportId, runId: null, date: "2026-06-01", createdAt: "2026-06-01T00:00:00.000Z",
    ticker: "NVDA", held: false, action: "BUY", conviction: 0.7, strategyFamily: "momentum",
    recommendation: { ticker: "NVDA", held: false, action: "BUY", conviction: 0.7, strategyFamily: "momentum", thesis: "t", signals: [], prediction: { direction: "bullish", horizon: "1mo", invalidation: "x", rationale: "y", target: 120, stop: 90 }, technicals: {} } as Parameters<typeof app.repos.journalEntries.insert>[0]["recommendation"],
    marketContextId: null, scored: true,
  });
  app.repos.scoredForecasts.insert({
    id, journalEntryId: entryId, ticker: "NVDA", side: "bullish", strategyFamily: "momentum", signals: [],
    createdAt: "2026-06-01T00:00:00.000Z", asOfTimestamp: "2026-06-01T00:00:00.000Z", marketSession: "regular",
    quoteTimestamp: null, priceFeed: "fake", referencePrice: 100, entry: 100, target: 120, stop: 90,
    horizonTradingSessions: 10, resolveAt: "2026-06-15", conviction: 0.7, benchmarkSymbol: "SPY",
    benchmarkReferencePrice: 400, resolutionPolicyVersion: "v1", marketContextId: null, citedSourceIds: [], retrievedChunkIds: [],
  } as Parameters<typeof app.repos.scoredForecasts.insert>[0]);
}

beforeEach(async () => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE });
  server = createServer(app);
  seedForecast(app, "f1");
  await trackOpenForecasts(app);
});
const req = (path: string) => server.fetch(new Request(`http://test/api${path}`));

describe("wiki in-flight API", () => {
  test("GET /wiki/in-flight returns today's assessment + open calls", async () => {
    const body = (await (await req("/wiki/in-flight")).json()) as {
      assessment: { total: number; onTrack: number };
      calls: {
        ticker: string; side: string | null; status: string; journalEntryId: string | null;
        thesis: string | null; rationale: string | null;
        entry: number | null; stop: number | null; target: number | null; markPrice: number;
      }[];
    };
    expect(body.assessment.total).toBe(1);
    expect(body.calls[0]!.ticker).toBe("NVDA");
    expect(body.calls[0]!.side).toBe("bullish");
    // journalEntryId backs the "view in journal" drill-down link.
    expect(typeof body.calls[0]!.journalEntryId).toBe("string");
    expect(body.calls[0]!.journalEntryId).toBe(app.repos.scoredForecasts.get("f1")!.journalEntryId);
    // Drill-down feedback fields are serialized from the forecast + its journal entry.
    expect(body.calls[0]!.thesis).toBe("t");
    expect(body.calls[0]!.rationale).toBe("y");
    expect(body.calls[0]!.entry).toBe(100);
    expect(body.calls[0]!.stop).toBe(90);
    expect(body.calls[0]!.target).toBe(120);
    expect(typeof body.calls[0]!.markPrice).toBe("number");
  });

  test("GET /wiki/in-flight is zeroed when nothing is open", async () => {
    const fresh = createServer(createApp({ db: openMemoryDb(), gateway: createFakeGateway({ now: () => DATE, startingCash: 100_000 }), now: () => DATE }));
    const body = (await (await fresh.fetch(new Request(`http://test/api/wiki/in-flight`))).json()) as { assessment: { total: number }; calls: unknown[] };
    expect(body.assessment.total).toBe(0);
    expect(body.calls).toEqual([]);
  });

  test("GET /wiki/forecasts/:id/marks returns the per-call trajectory", async () => {
    const body = (await (await req("/wiki/forecasts/f1/marks")).json()) as { marks: { date: string }[] };
    expect(body.marks.length).toBe(1);
    expect(body.marks[0]!.date).toBe(DATE);
  });

  test("GET /wiki/tickers groups the open call into a per-ticker record with a live R", async () => {
    const body = (await (await req("/wiki/tickers")).json()) as {
      tickers: {
        ticker: string; total: number; open: number; resolved: number;
        trackR: number | null; avgUnrealizedR: number | null;
        calls: { forecastId: string; journalEntryId: string; resolved: boolean; status: string | null }[];
      }[];
    };
    expect(body.tickers).toHaveLength(1);
    const t = body.tickers[0]!;
    expect(t.ticker).toBe("NVDA");
    expect(t.total).toBe(1);
    expect(t.open).toBe(1);
    expect(t.resolved).toBe(0);
    expect(typeof t.trackR).toBe("number"); // falls back to live unrealized R while open
    expect(t.calls[0]!.resolved).toBe(false);
    expect(t.calls[0]!.forecastId).toBe("f1");
    expect(t.calls[0]!.journalEntryId).toBe(app.repos.scoredForecasts.get("f1")!.journalEntryId);
  });
});
