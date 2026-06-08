import { describe, expect, test } from "bun:test";
import type { InFlightCall } from "../../api/client.ts";
import { groupCalls } from "./inFlight.ts";

/** Minimal InFlightCall factory — only the fields groupCalls reads matter. */
function call(p: Partial<InFlightCall> & { unrealizedR: number | null; status: string }): InFlightCall {
  return {
    forecastId: p.forecastId ?? Math.random().toString(36).slice(2),
    ticker: p.ticker ?? "MRVL",
    side: p.side ?? "bearish",
    resolveBy: "resolveBy" in p ? (p.resolveBy ?? null) : "2026-07-02",
    journalEntryId: p.journalEntryId ?? "je1",
    movePct: p.movePct ?? 0,
    unrealizedR: p.unrealizedR,
    mfe: p.mfe ?? 0,
    mae: p.mae ?? 0,
    status: p.status,
    entry: p.entry ?? null,
    stop: p.stop ?? null,
    target: p.target ?? null,
    markPrice: p.markPrice ?? 0,
    conviction: p.conviction ?? null,
    thesis: p.thesis ?? null,
    rationale: p.rationale ?? null,
  };
}

describe("groupCalls — the MRVL ×9 case", () => {
  // 9 concurrent bearish MRVL bets: one near_stop deep underwater, the other 8 on_track.
  const calls: InFlightCall[] = [
    call({ unrealizedR: -2.53, status: "near_stop", resolveBy: "2026-07-02" }),
    call({ unrealizedR: 0.46, status: "on_track", resolveBy: "2026-07-06" }),
    call({ unrealizedR: 0.97, status: "on_track", resolveBy: "2026-07-01" }),
    call({ unrealizedR: 1.14, status: "on_track", resolveBy: "2026-07-03" }),
    call({ unrealizedR: 1.45, status: "on_track", resolveBy: "2026-07-02" }),
    call({ unrealizedR: 1.45, status: "on_track", resolveBy: "2026-07-02" }),
    call({ unrealizedR: 1.45, status: "on_track", resolveBy: "2026-07-01" }),
    call({ unrealizedR: 2.15, status: "on_track", resolveBy: "2026-07-01" }),
    call({ unrealizedR: 2.4, status: "on_track", resolveBy: "2026-07-03" }),
  ];

  const [g] = groupCalls(calls);

  test("collapses to one ticker+side group of 9", () => {
    expect(groupCalls(calls)).toHaveLength(1);
    expect(g!.count).toBe(9);
    expect(g!.ticker).toBe("MRVL");
    expect(g!.side).toBe("bearish");
  });

  test("headline net R is the average (~0.99R), not the worst", () => {
    expect(g!.netR).toBeCloseTo(0.9933, 3);
  });

  test("worst R is the most-negative bet", () => {
    expect(g!.worstR).toBe(-2.53);
  });

  test("composite status counts: 1 near stop, 8 on track (attention-ordered)", () => {
    expect(g!.statusCounts).toEqual([
      { status: "near_stop", n: 1 },
      { status: "on_track", n: 8 },
    ]);
    expect(g!.worstStatus).toBe("near_stop");
  });

  test("members ordered by resolve deadline ascending (soonest first)", () => {
    const dates = g!.calls.map((c) => c.resolveBy);
    expect(dates).toEqual([...dates].sort());
    expect(dates[0]).toBe("2026-07-01");
    expect(dates[dates.length - 1]).toBe("2026-07-06");
  });
});

describe("groupCalls — edge cases", () => {
  test("single bet: netR equals worstR, one status bucket", () => {
    const [g] = groupCalls([call({ unrealizedR: 1.2, status: "on_track" })]);
    expect(g!.count).toBe(1);
    expect(g!.netR).toBe(1.2);
    expect(g!.worstR).toBe(1.2);
    expect(g!.statusCounts).toEqual([{ status: "on_track", n: 1 }]);
  });

  test("all-null R: netR and worstR are null, statuses still counted", () => {
    const [g] = groupCalls([
      call({ unrealizedR: null, status: "at_risk" }),
      call({ unrealizedR: null, status: "at_risk" }),
    ]);
    expect(g!.netR).toBeNull();
    expect(g!.worstR).toBeNull();
    expect(g!.statusCounts).toEqual([{ status: "at_risk", n: 2 }]);
  });

  test("null resolveBy sorts last", () => {
    const [g] = groupCalls([
      call({ unrealizedR: 1, status: "on_track", resolveBy: null }),
      call({ unrealizedR: 1, status: "on_track", resolveBy: "2026-07-01" }),
    ]);
    expect(g!.calls.map((c) => c.resolveBy)).toEqual(["2026-07-01", null]);
  });

  test("separate groups sorted by avg R: most-right first, most-wrong last", () => {
    const groups = groupCalls([
      call({ ticker: "MRVL", side: "bearish", unrealizedR: -1.0, status: "near_stop" }),
      call({ ticker: "AAPL", side: "bullish", unrealizedR: 1.5, status: "on_track" }),
      call({ ticker: "TSLA", side: "bullish", unrealizedR: 0.2, status: "on_track" }),
    ]);
    expect(groups.map((g) => g.ticker)).toEqual(["AAPL", "TSLA", "MRVL"]); // 1.5 → 0.2 → -1.0
  });

  test("groups with no R yet sort to the bottom", () => {
    const groups = groupCalls([
      call({ ticker: "AAA", side: "bullish", unrealizedR: null, status: "at_risk" }),
      call({ ticker: "BBB", side: "bullish", unrealizedR: -0.5, status: "at_risk" }),
    ]);
    expect(groups.map((g) => g.ticker)).toEqual(["BBB", "AAA"]); // -0.5 ranks above null
  });
});
