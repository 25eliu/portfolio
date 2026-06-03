import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import type { Citation } from "../domain/index.ts";
import { answerQuery, MAX_TOOL_ROUNDS, toGenaiContents, type QueryContent, type QueryModel, type QuerySink } from "./answer.ts";

/** A scripted model: each turn returns the next step (tool calls and/or text), streaming text deltas. */
function stubModel(script: { calls?: { name: string; args: Record<string, unknown> }[]; text?: string }[]): {
  model: QueryModel;
  turns: () => number;
  lastSystemPrompt: () => string;
} {
  let i = 0;
  let lastSystemPrompt = "";
  const model: QueryModel = {
    async turn(input, sink: QuerySink) {
      lastSystemPrompt = input.systemPrompt;
      const step = script[Math.min(i, script.length - 1)] ?? {};
      i++;
      if (step.text) sink({ kind: "delta", text: step.text });
      return { calls: step.calls ?? [], text: step.text ?? "" };
    },
  };
  return { model, turns: () => i, lastSystemPrompt: () => lastSystemPrompt };
}

let app: App;
beforeEach(() => {
  app = createApp({ db: openMemoryDb(), gateway: createFakeGateway(), now: () => "2026-06-02", queryModel: null });
});

describe("answerQuery", () => {
  test("calls a tool, then answers from the result and reports the tool used", async () => {
    const { model } = stubModel([
      { calls: [{ name: "portfolio_state", args: {} }] },
      { text: "Your AI book holds no positions yet." },
    ]);
    const deltas: string[] = [];
    const res = await answerQuery(app, "what do I hold?", model, (e) => {
      if (e.kind === "delta") deltas.push(e.text);
    });
    expect(res.answer).toBe("Your AI book holds no positions yet.");
    expect(res.toolsUsed).toEqual(["portfolio_state"]);
    expect(deltas.join("")).toContain("no positions");
  });

  test("declines (no fabrication) when the model answers without calling any tool", async () => {
    const { model } = stubModel([{ text: "I couldn't find that in the available data." }]);
    const res = await answerQuery(app, "what's the weather?", model, () => {});
    expect(res.toolsUsed).toEqual([]);
    expect(res.answer).toContain("couldn't find");
  });

  test("respects the tool-round cap and terminates with a fallback", async () => {
    // A model that never stops calling tools must not loop forever.
    const { model, turns } = stubModel([{ calls: [{ name: "cohort_metrics", args: {} }] }]);
    const res = await answerQuery(app, "loop forever", model, () => {});
    expect(turns()).toBeLessThanOrEqual(MAX_TOOL_ROUNDS + 1);
    expect(res.toolsUsed).toEqual(["cohort_metrics"]);
    expect(res.answer).toContain("couldn't find an answer");
  });

  test("an unknown tool name yields an error result, not a throw", async () => {
    const { model } = stubModel([{ calls: [{ name: "nonexistent_tool", args: {} }] }, { text: "done" }]);
    const res = await answerQuery(app, "x", model, () => {});
    expect(res.answer).toBe("done");
    expect(res.toolsUsed).toEqual(["nonexistent_tool"]);
  });

  test("focusTickers from @-mentions are injected into the system prompt to scope retrieval", async () => {
    const { model, lastSystemPrompt } = stubModel([{ text: "ok" }]);
    await answerQuery(app, "how is @NVDA?", model, () => {}, { focusTickers: ["nvda", "AAPL"] });
    expect(lastSystemPrompt()).toContain("NVDA, AAPL");
    expect(lastSystemPrompt()).toContain("scoped to these tickers");
  });

  test("surfaces structured citations from evidence tools, deduped across rounds", async () => {
    // Seed one wiki lesson so the real list_lessons tool has something to cite.
    const now = "2026-06-02T00:00:00.000Z";
    app.repos.wiki.upsertLesson({
      id: "all_time:overall", title: "Momentum calls beat SPY", body: "Across 22 resolved calls, momentum led by 3.1%.",
      state: "active", cohortKind: "overall", cohortKey: "overall", window: "all_time", n: 22,
      dateWindowStart: null, dateWindowEnd: null, sourceForecastIds: [], freshnessDeadline: null, metrics: {},
      createdAt: now, updatedAt: now,
    });
    // Model calls list_lessons twice (two rounds) then answers — the same lesson must be cited only once.
    const { model } = stubModel([
      { calls: [{ name: "list_lessons", args: {} }] },
      { calls: [{ name: "list_lessons", args: {} }] },
      { text: "Your momentum cohort is your strongest." },
    ]);
    const sourced: Citation[] = [];
    const res = await answerQuery(app, "which cohort is best?", model, (e) => {
      if (e.kind === "source") sourced.push(...e.citations);
    });
    expect(res.citations).toHaveLength(1);
    expect(res.citations[0]).toMatchObject({ kind: "lesson", title: "Momentum calls beat SPY", sourceId: "all_time:overall" });
    expect(sourced).toHaveLength(1); // emitted live to the UI exactly once (deduped)
  });
});

describe("toGenaiContents (thought_signature round-trip)", () => {
  test("echoes each function call's thoughtSignature back verbatim (else Gemini 2.5 400s on round 2)", () => {
    const contents: QueryContent[] = [
      { role: "user", text: "hi" },
      { role: "model", calls: [{ name: "portfolio_state", args: {}, thoughtSignature: "SIG_A" }, { name: "list_lessons", args: { x: 1 }, thoughtSignature: "SIG_B" }] },
      { role: "tool", results: [{ name: "portfolio_state", result: { ok: true } }] },
    ];
    const out = toGenaiContents(contents) as { role: string; parts: { functionCall?: { name: string }; thoughtSignature?: string }[] }[];
    const modelParts = out[1]!.parts;
    expect(modelParts[0]).toMatchObject({ functionCall: { name: "portfolio_state" }, thoughtSignature: "SIG_A" });
    expect(modelParts[1]).toMatchObject({ functionCall: { name: "list_lessons" }, thoughtSignature: "SIG_B" });
  });

  test("omits thoughtSignature when absent (stub/test turns) rather than sending undefined", () => {
    const out = toGenaiContents([{ role: "model", calls: [{ name: "portfolio_state", args: {} }] }]) as {
      parts: { thoughtSignature?: string }[];
    }[];
    expect("thoughtSignature" in out[0]!.parts[0]!).toBe(false);
  });
});
