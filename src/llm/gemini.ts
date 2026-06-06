/**
 * Gemini analyzer — TWO-STAGE design, now STREAMING (confirmed against Gemini 3.x; default gemini-3.5-flash).
 *
 * Stage A — RESEARCH: Search-only call → research text + real `groundingMetadata.groundingChunks`.
 * Stage B — STRUCTURE: function-tool-only call (mode ANY) over the research → schema-valid args.
 * Both use `generateContentStream` and emit token deltas, thinking, and Search tool activity through
 * the optional `StreamSink` so the UI/terminal can show progress live. Returned values are unchanged.
 */
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Env } from "../config/env.ts";
import { Deliberation, Outlook, Prediction, Recommendation, ScanCandidate } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { Analyzer, StreamSink } from "./analyze.ts";
import { normalizeAction } from "./normalize.ts";
import {
  buildDeliberationPrompt,
  buildDiscoveryResearchPrompt,
  buildDiscoveryStructurePrompt,
  buildMarketContextPrompt,
  buildOutlookResearchPrompt,
  buildOutlookStructurePrompt,
  buildTickerResearchPrompt,
  buildTickerStructurePrompt,
  type TickerInput,
} from "./prompts.ts";
import { candidatesFunctionDeclaration, deliberationFunctionDeclaration, outlookFunctionDeclaration, recommendationFunctionDeclaration } from "./schema.ts";

/** Parse a submit_deliberation function-call payload (snake_case) into the Deliberation schema. */
function parseDeliberation(args: Record<string, unknown> | undefined): Deliberation | null {
  if (!args) return null;
  const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
  const result = Deliberation.safeParse({
    bullCase: typeof args.bull_case === "string" ? args.bull_case : "",
    bearCase: typeof args.bear_case === "string" ? args.bear_case : "",
    keyUncertainties: strings(args.key_uncertainties),
    disconfirmers: strings(args.disconfirmers),
    baseRateNote: typeof args.base_rate_note === "string" ? args.base_rate_note : null,
    reversalCheck: typeof args.reversal_check === "string" ? args.reversal_check : null,
    provisionalStance: args.provisional_stance,
    provisionalConviction: args.provisional_conviction,
  });
  return result.success ? result.data : null;
}

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
      // Stage A.5 — bull/bear deliberation (Decision Engine v2). Non-fatal: on failure the recommendation
      // still proceeds without it, so a flaky extra call never blocks the verdict.
      sink?.({ kind: "stage", stage: "deliberate" });
      let deliberation: Deliberation | null = null;
      try {
        const dargs = await structure(
          buildDeliberationPrompt(input, ctx, text),
          { name: "submit_deliberation" },
          deliberationFunctionDeclaration,
          sink,
        );
        deliberation = parseDeliberation(dargs);
      } catch (err) {
        console.warn(`[deliberate] ${input.symbol} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      sink?.({ kind: "stage", stage: "structure" });
      const args = await structure(
        buildTickerStructurePrompt(input, ctx, text, sources, deliberation),
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
        deliberation,
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
        // Surface the funnel: if the model returned candidates but none parsed, that's a schema
        // mismatch silently dropping every opportunity — log it rather than return a quiet [].
        console.log(`[discovery] model returned ${raw.length} candidates, ${out.length} parsed`);
        return out.slice(0, count);
      } catch (err) {
        console.warn(`[discovery] failed: ${err instanceof Error ? err.message : String(err)}`);
        return [];
      }
    },

    async synthesizeOutlook(ctx: MarketContext, recs: Recommendation[], sink?: StreamSink): Promise<Outlook> {
      try {
        sink?.({ kind: "stage", stage: "research" });
        const recLines = recs.slice(0, 40).map((r) => `  ${r.ticker}: ${r.action} (${r.prediction.direction}, conv ${r.conviction.toFixed(2)})`);
        const { text, sources } = await research(buildOutlookResearchPrompt(ctx.date, ctx.macroSummary, recLines), sink);
        sink?.({ kind: "stage", stage: "structure" });
        const args = await structure(buildOutlookStructurePrompt(ctx.date, text), { name: "submit_outlook" }, outlookFunctionDeclaration, sink);
        const parsed = Outlook.safeParse(args ?? {});
        if (!parsed.success) {
          console.warn(`[outlook] schema parse failed, returning empty: ${parsed.error.message}`);
          return { regime: null, sectors: [], themes: [] };
        }
        const withSrc = (it: typeof parsed.data.sectors[number]) => ({ ...it, sources: it.sources.length ? it.sources : sources });
        return {
          regime: parsed.data.regime ? withSrc(parsed.data.regime) : null,
          sectors: parsed.data.sectors.map(withSrc),
          themes: parsed.data.themes.map(withSrc),
        };
      } catch (err) {
        console.warn(`[outlook] failed: ${err instanceof Error ? err.message : String(err)}`);
        return { regime: null, sectors: [], themes: [] };
      }
    },
  };
}
