import type { App } from "../app.ts";
import { newId } from "../domain/index.ts";
import { answerQuery, createGeminiQueryModel, type QueryModel, type QuerySink } from "./answer.ts";
import { queryBus } from "./bus.ts";

export { answerQuery, createGeminiQueryModel, SYSTEM_PROMPT, MAX_TOOL_ROUNDS, type QueryModel } from "./answer.ts";
export { QUERY_TOOLS, QUERY_TOOLS_BY_NAME } from "./tools.ts";
export { queryBus } from "./bus.ts";

/** Build the query model for the selected env (Gemini when a key is present; null offline/in tests). */
export function createQueryModel(env: App["env"]): QueryModel | null {
  return env.GEMINI_API_KEY ? createGeminiQueryModel(env) : null;
}

async function runInBackground(app: App, queryId: string, question: string): Promise<void> {
  const sink: QuerySink = (e) =>
    e.kind === "delta"
      ? queryBus.publish(queryId, { type: "delta", text: e.text })
      : queryBus.publish(queryId, { type: "tool", name: e.name, args: e.args });
  const now = new Date().toISOString();
  try {
    if (!app.queryModel) throw new Error("Query unavailable: no model configured (set GEMINI_API_KEY).");
    const { answer, toolsUsed } = await answerQuery(app, question, app.queryModel, sink);
    app.repos.queryLog.insert({ id: queryId, question, answer, toolsUsed, status: "ok", createdAt: now });
    queryBus.publish(queryId, { type: "done", answer, toolsUsed });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    app.repos.queryLog.insert({ id: queryId, question, answer: "", toolsUsed: [], status: "error", createdAt: now });
    queryBus.publish(queryId, { type: "error", message });
  }
}

/** Start a grounded query in the background; the caller streams it via the query bus by `queryId`. */
export function startQuery(app: App, question: string): { queryId: string } {
  const queryId = newId();
  void runInBackground(app, queryId, question);
  return { queryId };
}
