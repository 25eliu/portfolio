import { beforeEach, describe, expect, test } from "bun:test";
import { createApp, type App } from "../app.ts";
import { openMemoryDb } from "../db/index.ts";
import { createFakeGateway } from "../market/index.ts";
import { answerQuery, MAX_TOOL_ROUNDS, type QueryModel, type QuerySink } from "./answer.ts";

/** A scripted model: each turn returns the next step (tool calls and/or text), streaming text deltas. */
function stubModel(script: { calls?: { name: string; args: Record<string, unknown> }[]; text?: string }[]): {
  model: QueryModel;
  turns: () => number;
} {
  let i = 0;
  const model: QueryModel = {
    async turn(_input, sink: QuerySink) {
      const step = script[Math.min(i, script.length - 1)] ?? {};
      i++;
      if (step.text) sink({ kind: "delta", text: step.text });
      return { calls: step.calls ?? [], text: step.text ?? "" };
    },
  };
  return { model, turns: () => i };
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
});
