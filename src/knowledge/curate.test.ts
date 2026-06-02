import { beforeEach, describe, expect, test } from "bun:test";
import type { App } from "../app.ts";
import { openMemoryDb, repositories, type Repositories } from "../db/index.ts";
import { nodeId, type MemorableFact } from "../domain/index.ts";
import { curateFacts, persistCuratedFacts } from "./curate.ts";
import { retrieveEvidence } from "./retrieve.ts";

const NOW = "2026-06-02T14:00:00.000Z";
let repos: Repositories;
let app: App;

const fact = (text: string, scope: "ticker" | "global" = "ticker", url: string | null = "https://example.com/x"): MemorableFact => ({
  fact: text,
  citationUrl: url,
  scope,
});

beforeEach(() => {
  repos = repositories(openMemoryDb());
  app = { repos } as unknown as App;
});

describe("curateFacts", () => {
  test("persists a fact as a self_curated, analysis-enabled source retrievable as evidence", () => {
    const r = curateFacts(app, {
      ticker: "NVDA",
      facts: [fact("NVDA data-center revenue is structurally the largest profit driver")],
      runId: "run-1",
      reportId: "rep-1",
      journalEntryId: "je-1",
      now: NOW,
    });
    expect(r).toEqual({ added: 1, skipped: 0 });

    const rows = repos.knowledge.listCuratedFacts();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.ticker).toBe("NVDA");
    expect(rows[0]!.citationUrl).toBe("https://example.com/x");
    expect(rows[0]!.fact).toContain("data-center");

    const source = repos.knowledge.getSource(rows[0]!.id)!;
    expect(source.kind).toBe("fact");
    expect(source.trustClass).toBe("self_curated");
    expect(source.useInAnalysis).toBe(true);

    // Retrievable for the ticker (its own scope) as prior memory.
    expect(repos.knowledge.selfCuratedFactsForTicker("NVDA")).toHaveLength(1);

    // Graph: source —mentions→ ticker provenance edge exists.
    const inbound = repos.graph.neighbors(nodeId("ticker", "NVDA"), { direction: "in", rel: "mentions" });
    expect(inbound.length).toBeGreaterThan(0);

    // The feedback loop: a curated fact is retrieved as evidence on a later run for the same ticker.
    const evidence = retrieveEvidence(app, "NVDA");
    expect(evidence.some((e) => e.trustClass === "self_curated" && e.text.includes("data-center"))).toBe(true);
  });

  test("exact-dedup: re-curating the same fact in the same scope is skipped", () => {
    const input = {
      ticker: "AAPL",
      facts: [fact("AAPL services gross margin anchors the bull thesis")],
      runId: "run-1",
      reportId: "rep-1",
      journalEntryId: "je-1",
      now: NOW,
    };
    expect(curateFacts(app, input).added).toBe(1);
    const second = curateFacts(app, { ...input, now: "2026-06-03T14:00:00.000Z" });
    expect(second).toEqual({ added: 0, skipped: 1 });
    expect(repos.knowledge.listCuratedFacts()).toHaveLength(1);
  });

  test("whitespace-normalized duplicates collide (same hash) and empty facts are skipped", () => {
    expect(curateFacts(app, { ticker: "AAPL", facts: [fact("a   structural    moat")], runId: null, reportId: "r", journalEntryId: "j", now: NOW }).added).toBe(1);
    const dup = curateFacts(app, { ticker: "AAPL", facts: [fact("a structural moat"), fact("   ")], runId: null, reportId: "r", journalEntryId: "j", now: NOW });
    expect(dup).toEqual({ added: 0, skipped: 2 });
  });

  test("per-scope cap archives the oldest facts beyond the limit", () => {
    const add = (text: string, now: string) =>
      curateFacts(app, { ticker: "TSLA", facts: [fact(text)], runId: null, reportId: "r", journalEntryId: "j", now, maxPerScope: 2 });
    add("TSLA structural fact one", "2026-06-01T00:00:00.000Z");
    add("TSLA structural fact two", "2026-06-02T00:00:00.000Z");
    add("TSLA structural fact three", "2026-06-03T00:00:00.000Z"); // pushes over cap → oldest archived

    const active = repos.knowledge.listCuratedFacts();
    expect(active).toHaveLength(2);
    expect(active.map((f) => f.fact)).toEqual([
      "TSLA structural fact three",
      "TSLA structural fact two",
    ]); // newest two remain; "one" archived
    expect(repos.knowledge.selfCuratedFactsForTicker("TSLA")).toHaveLength(2);
  });

  test("global-scope facts are stored scopeless and surface for any ticker", () => {
    curateFacts(app, {
      ticker: "NVDA",
      facts: [fact("Fed holding rates restrains multiple expansion across equities", "global", "https://fred.org")],
      runId: null,
      reportId: "r",
      journalEntryId: "j",
      now: NOW,
    });
    const row = repos.knowledge.listCuratedFacts()[0]!;
    expect(row.ticker).toBeNull();
    expect(row.scope).toBe("global");
    // A global macro fact is part of every ticker's prior memory.
    expect(repos.knowledge.selfCuratedFactsForTicker("AAPL")).toHaveLength(1);
  });

  test("at most MAX_FACTS_PER_RUN facts are persisted from a single call", () => {
    const many = ["one", "two", "three", "four", "five"].map((n) => fact(`MSFT durable fact ${n}`));
    const r = curateFacts(app, { ticker: "MSFT", facts: many, runId: null, reportId: "r", journalEntryId: "j", now: NOW });
    expect(r.added).toBe(3); // capped at 3 per run regardless of how many the model returns
    expect(repos.knowledge.listCuratedFacts()).toHaveLength(3);
  });
});

describe("persistCuratedFacts", () => {
  test("walks a report's recommendations and curates their facts under each ticker", () => {
    const report = {
      id: "rep-1",
      recommendations: [
        { ticker: "NVDA", memorableFacts: [fact("NVDA owns the AI training stack")] },
        { ticker: "AAPL", memorableFacts: [fact("AAPL ecosystem lock-in is durable")] },
        { ticker: "MSFT", memorableFacts: [] as MemorableFact[] },
      ],
    };
    const link = new Map([
      ["NVDA", { journalEntryId: "je-n" }],
      ["AAPL", { journalEntryId: "je-a" }],
    ]);
    const r = persistCuratedFacts(app, report, "run-1", link, NOW);
    expect(r.added).toBe(2);
    expect(repos.knowledge.listCuratedFacts()).toHaveLength(2);
    expect(repos.knowledge.selfCuratedFactsForTicker("NVDA")).toHaveLength(1);
    expect(repos.knowledge.selfCuratedFactsForTicker("MSFT")).toHaveLength(0);
  });
});
