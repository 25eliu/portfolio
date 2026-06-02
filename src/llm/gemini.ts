/**
 * Gemini analyzer — TWO-STAGE design, now STREAMING (confirmed against gemini-3.1-pro-preview).
 *
 * Stage A — RESEARCH: Search-only call → research text + real `groundingMetadata.groundingChunks`.
 * Stage B — STRUCTURE: function-tool-only call (mode ANY) over the research → schema-valid args.
 * Both use `generateContentStream` and emit token deltas, thinking, and Search tool activity through
 * the optional `StreamSink` so the UI/terminal can show progress live. Returned values are unchanged.
 */
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Env } from "../config/env.ts";
import { Prediction, Recommendation, ScanCandidate } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { Analyzer, StreamSink } from "./analyze.ts";
import { normalizeAction } from "./normalize.ts";
import {
  buildDiscoveryResearchPrompt,
  buildDiscoveryStructurePrompt,
  buildMarketContextPrompt,
  buildTickerResearchPrompt,
  buildTickerStructurePrompt,
  type TickerInput,
} from "./prompts.ts";
import { candidatesFunctionDeclaration, recommendationFunctionDeclaration } from "./schema.ts";

const THINKING: Record<Env["GEMINI_THINKING_LEVEL"], ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

type Source = { title: string; url: string };

function citationsFrom(chunks: unknown[]): Source[] {
  return (chunks as { web?: { title?: string; uri?: string } }[])
    .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
    .filter((s) => s.url);
}

export function createGeminiAnalyzer(env: Env): Analyzer {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const thinkingLevel = THINKING[env.GEMINI_THINKING_LEVEL];

  /** Iterate a streamed response: emit deltas/thinking/tool via `sink`, accumulate text/sources/call. */
  async function consume(
    stream: AsyncGenerator<unknown>,
    sink?: StreamSink,
  ): Promise<{ text: string; sources: Source[]; call?: { name?: string; args?: Record<string, unknown> } }> {
    let text = "";
    let sources: Source[] = [];
    let call: { name?: string; args?: Record<string, unknown> } | undefined;
    const seenQueries = new Set<string>();

    for await (const chunkUnknown of stream) {
      const chunk = chunkUnknown as {
        functionCalls?: { name?: string; args?: Record<string, unknown> }[];
        candidates?: {
          content?: { parts?: { text?: string; thought?: boolean; functionCall?: { name?: string; args?: Record<string, unknown> } }[] };
          groundingMetadata?: { groundingChunks?: unknown[]; webSearchQueries?: string[] };
        }[];
      };
      const cand = chunk.candidates?.[0];
      for (const p of cand?.content?.parts ?? []) {
        if (typeof p.text === "string" && p.text) {
          if (p.thought) sink?.({ kind: "thinking", text: p.text });
          else {
            text += p.text;
            sink?.({ kind: "text", text: p.text });
          }
        }
        if (p.functionCall) call = p.functionCall;
      }
      const gm = cand?.groundingMetadata;
      for (const q of gm?.webSearchQueries ?? []) {
        if (!seenQueries.has(q)) {
          seenQueries.add(q);
          sink?.({ kind: "tool", query: q });
        }
      }
      if (gm?.groundingChunks?.length) sources = citationsFrom(gm.groundingChunks);
      if (!call && chunk.functionCalls?.length) call = chunk.functionCalls[0];
    }
    if (sources.length) sink?.({ kind: "tool", sources });
    return { text, sources, call };
  }

  /** Stage A: grounded research (Search only), streamed. */
  async function research(contents: string, sink?: StreamSink): Promise<{ text: string; sources: Source[] }> {
    const stream = await ai.models.generateContentStream({
      model: env.GEMINI_MODEL,
      contents,
      config: {
        tools: [{ googleSearch: {} }],
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW, includeThoughts: true },
      },
    });
    const { text, sources } = await consume(stream, sink);
    return { text, sources };
  }

  /** Stage B: structuring call (function tool only, forced via mode ANY), streamed. */
  async function structure(
    contents: string,
    fn: { name: string },
    declaration: unknown,
    sink?: StreamSink,
  ): Promise<Record<string, unknown> | undefined> {
    const stream = await ai.models.generateContentStream({
      model: env.GEMINI_MODEL,
      contents,
      config: {
        tools: [{ functionDeclarations: [declaration as never] }],
        toolConfig: {
          functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: [fn.name] },
        },
        thinkingConfig: { thinkingLevel },
      },
    });
    const { call } = await consume(stream, sink);
    return call?.name === fn.name ? call.args : call?.args;
  }

  return {
    kind: "gemini",

    async analyzeTicker(input: TickerInput, ctx: MarketContext, sink?: StreamSink): Promise<Recommendation> {
      sink?.({ kind: "stage", stage: "research" });
      const { text, sources } = await research(buildTickerResearchPrompt(input, ctx), sink);
      sink?.({ kind: "stage", stage: "structure" });
      const args = await structure(
        buildTickerStructurePrompt(input, ctx, text),
        { name: "submit_recommendation" },
        recommendationFunctionDeclaration,
        sink,
      );
      if (!args) throw new Error(`No recommendation call for ${input.symbol}`);
      const upside =
        input.fundamentals.priceTargetMean && input.price
          ? Math.round(((input.fundamentals.priceTargetMean - input.price) / input.price) * 10000) / 100
          : null;
      const rawPred = (args.prediction ?? {}) as Record<string, unknown>;
      const price = input.price;
      const target = typeof rawPred.target === "number" ? rawPred.target : null;
      const prediction = Prediction.parse({
        ...rawPred,
        direction:
          rawPred.direction === "bullish" || rawPred.direction === "bearish" || rawPred.direction === "neutral"
            ? rawPred.direction
            : "neutral",
        horizon:
          typeof rawPred.horizon === "string" && ["1d", "1w", "1mo", "3mo", "6mo", "1y"].includes(rawPred.horizon)
            ? rawPred.horizon
            : "1mo",
        entry: typeof rawPred.entry === "number" ? rawPred.entry : price,
        expectedReturnPct:
          typeof rawPred.expectedReturnPct === "number"
            ? rawPred.expectedReturnPct
            : target && price
              ? Math.round(((target - price) / price) * 10000) / 100
              : null,
        invalidation: typeof rawPred.invalidation === "string" ? rawPred.invalidation : "thesis no longer supported",
        rationale: typeof rawPred.rationale === "string" ? rawPred.rationale : input.symbol,
      });
      return Recommendation.parse({
        ...args,
        ticker: input.symbol,
        held: input.held,
        action: normalizeAction(String(args.action ?? (input.held ? "HOLD" : "PASS")), input.held),
        prediction,
        technicals: input.technicals,
        fundamentals: input.fundamentals,
        priceTargetUpside: upside,
        sources,
        screen: input.screen,
      });
    },

    async marketMacro(date, spyTrend, spyPctFromSma200, sink) {
      const { text, sources } = await research(
        buildMarketContextPrompt(date, spyTrend, spyPctFromSma200),
        sink,
      );
      return { summary: text, sources };
    },

    async discoverOpportunities(ctx: MarketContext, count: number, sink?: StreamSink): Promise<ScanCandidate[]> {
      if (count <= 0) return [];
      try {
        sink?.({ kind: "stage", stage: "research" });
        const { text, sources } = await research(buildDiscoveryResearchPrompt(ctx, count), sink);
        sink?.({ kind: "stage", stage: "structure" });
        const args = await structure(
          buildDiscoveryStructurePrompt(ctx, count, text),
          { name: "submit_candidates" },
          candidatesFunctionDeclaration,
          sink,
        );
        const raw = (args as { candidates?: unknown[] } | undefined)?.candidates ?? [];
        const out: ScanCandidate[] = [];
        for (const item of raw) {
          const parsed = ScanCandidate.safeParse({ ...(item as object), sources });
          if (parsed.success) out.push(parsed.data);
        }
        return out.slice(0, count);
      } catch {
        return [];
      }
    },
  };
}
