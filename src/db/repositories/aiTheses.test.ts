import { beforeEach, describe, expect, test } from "bun:test";
import { openMemoryDb, repositories } from "../index.ts";
import type { Thesis } from "../../domain/index.ts";

let repos: ReturnType<typeof repositories>;
const NOW = "2026-06-02T00:00:00.000Z";

beforeEach(() => {
  repos = repositories(openMemoryDb());
});

const thesis = (over: Partial<Thesis>): Thesis => ({
  id: over.id ?? "t1", runId: "r1", reportId: "rep1", date: "2026-06-02", createdAt: NOW,
  level: "sector", subject: "Semiconductors", subjectKey: "sector:semiconductors",
  stance: "bullish", conviction: 0.7, horizon: "3mo", summary: "Semis bullish",
  thesis: "Data-center capex is durable.", status: "active", supersedesId: null,
  freshnessDeadline: null, tickers: ["NVDA"], sources: [{ title: "x", url: "https://x.com" }], ...over,
});

describe("aiTheses repo", () => {
  test("insert persists a row and indexes its prose for FTS search", () => {
    repos.aiTheses.insert(thesis({ id: "t1", thesis: "Data-center capex is durable and broad." }));
    expect(repos.aiTheses.get("t1")?.subject).toBe("Semiconductors");
    expect(repos.aiTheses.search("capex").map((t) => t.id)).toContain("t1");
  });

  test("supersedePriorActive flips the prior active thesis for a subject_key to superseded", () => {
    repos.aiTheses.insert(thesis({ id: "t1" }));
    const superseded = repos.aiTheses.supersedePriorActive("sector:semiconductors");
    expect(superseded).toEqual(["t1"]);
    expect(repos.aiTheses.get("t1")?.status).toBe("superseded");
  });

  test("currentByLevel returns only active theses of a level", () => {
    repos.aiTheses.insert(thesis({ id: "t1", level: "sector", subjectKey: "sector:semis" }));
    repos.aiTheses.insert(thesis({ id: "t2", level: "regime", subject: "market", subjectKey: "regime:market", stance: "risk_on" }));
    expect(repos.aiTheses.currentByLevel("regime").map((t) => t.id)).toEqual(["t2"]);
  });

  test("listDays + listDay group by day; historyForSubject returns the supersede chain newest-first", () => {
    repos.aiTheses.insert(thesis({ id: "t1", date: "2026-06-02" }));
    repos.aiTheses.supersedePriorActive("sector:semiconductors");
    repos.aiTheses.insert(thesis({ id: "t2", date: "2026-06-03", supersedesId: "t1" }));
    expect(repos.aiTheses.listDays().map((d) => d.date)).toEqual(["2026-06-03", "2026-06-02"]);
    expect(repos.aiTheses.listDay("2026-06-03").map((t) => t.id)).toEqual(["t2"]);
    expect(repos.aiTheses.historyForSubject("sector:semiconductors").map((t) => t.id)).toEqual(["t2", "t1"]);
  });

  test("expireStale flips active theses past their freshness deadline to expired; fresh ones stay active", () => {
    repos.aiTheses.insert(thesis({ id: "stale", subjectKey: "sector:a", freshnessDeadline: "2026-06-01" }));
    repos.aiTheses.insert(thesis({ id: "fresh", subjectKey: "sector:b", freshnessDeadline: "2026-12-01" }));
    repos.aiTheses.insert(thesis({ id: "nodeadline", subjectKey: "sector:c", freshnessDeadline: null }));
    expect(repos.aiTheses.expireStale("2026-06-02")).toEqual(["stale"]);
    expect(repos.aiTheses.get("stale")?.status).toBe("expired");
    expect(repos.aiTheses.get("fresh")?.status).toBe("active");
    expect(repos.aiTheses.get("nodeadline")?.status).toBe("active");
    expect(repos.aiTheses.listActive().map((t) => t.id).sort()).toEqual(["fresh", "nodeadline"]);
  });

  test("a thesis is fresh ON its deadline day and expires the day after", () => {
    repos.aiTheses.insert(thesis({ id: "boundary", subjectKey: "sector:z", freshnessDeadline: "2026-06-02" }));
    expect(repos.aiTheses.expireStale("2026-06-02")).toEqual([]); // fresh on the deadline day
    expect(repos.aiTheses.get("boundary")?.status).toBe("active");
    expect(repos.aiTheses.expireStale("2026-06-03")).toEqual(["boundary"]); // expires the next day
  });

  test("search returns nothing for a blank query", () => {
    repos.aiTheses.insert(thesis({ id: "t1" }));
    expect(repos.aiTheses.search("   ")).toEqual([]);
  });
});
