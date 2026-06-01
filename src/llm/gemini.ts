/**
 * Gemini analyzer — TWO-STAGE design (confirmed against gemini-3.1-pro-preview via `bun run gemini:smoke`).
 *
 * Gemini 3 CAN combine Google Search grounding with a function call in one request (set
 * `toolConfig.includeServerSideToolInvocations = true`), BUT in that combined mode the real grounding
 * citations are NOT returned (`groundingMetadata` is empty; the tool-response part only carries Search
 * "suggestion" chips, not source URLs). Since trustworthy source citations matter here, we instead run:
 *   Stage A — RESEARCH: Search-only call → research text + real `groundingMetadata.groundingChunks`.
 *   Stage B — STRUCTURE: function-tool-only call (mode ANY) over the research → schema-valid args.
 * marketMacro is a single Search-only call (it needs grounding + citations, no structured output).
 */
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Env } from "../config/env.ts";
import { Recommendation, ScanCandidate } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { Analyzer } from "./analyze.ts";
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

export function createGeminiAnalyzer(env: Env): Analyzer {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const thinkingLevel = THINKING[env.GEMINI_THINKING_LEVEL];

  /** Stage A: grounded research call (Search only). Returns the text + real citations. */
  async function research(contents: string): Promise<{ text: string; sources: Source[] }> {
    const res = await ai.models.generateContent({
      model: env.GEMINI_MODEL,
      contents,
      config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
    });
    return { text: res.text ?? "", sources: citations(res) };
  }

  /** Stage B: structuring call (function tool only, forced via mode ANY). Returns the function args. */
  async function structure(
    contents: string,
    fn: { name: string },
    declaration: unknown,
  ): Promise<Record<string, unknown> | undefined> {
    const res = await ai.models.generateContent({
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
    return res.functionCalls?.find((c) => c.name === fn.name)?.args as
      | Record<string, unknown>
      | undefined;
  }

  function citations(res: { candidates?: unknown }): Source[] {
    const chunks =
      (res as { candidates?: { groundingMetadata?: { groundingChunks?: unknown[] } }[] }).candidates?.[0]
        ?.groundingMetadata?.groundingChunks ?? [];
    return (chunks as { web?: { title?: string; uri?: string } }[])
      .map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
      .filter((s) => s.url);
  }

  return {
    kind: "gemini",

    async analyzeTicker(input: TickerInput, ctx: MarketContext): Promise<Recommendation> {
      const { text, sources } = await research(buildTickerResearchPrompt(input, ctx));
      const args = await structure(
        buildTickerStructurePrompt(input, ctx, text),
        { name: "submit_recommendation" },
        recommendationFunctionDeclaration,
      );
      if (!args) throw new Error(`No recommendation call for ${input.symbol}`);
      const upside =
        input.fundamentals.priceTargetMean && input.price
          ? Math.round(((input.fundamentals.priceTargetMean - input.price) / input.price) * 10000) / 100
          : null;
      return Recommendation.parse({
        ...args,
        ticker: input.symbol,
        technicals: input.technicals,
        fundamentals: input.fundamentals,
        priceTargetUpside: upside,
        sources,
        screen: input.screen,
      });
    },

    async marketMacro(date, spyTrend, spyPctFromSma200) {
      const { text, sources } = await research(buildMarketContextPrompt(date, spyTrend, spyPctFromSma200));
      return { summary: text, sources };
    },

    async discoverOpportunities(ctx: MarketContext, count: number): Promise<ScanCandidate[]> {
      if (count <= 0) return [];
      try {
        const { text, sources } = await research(buildDiscoveryResearchPrompt(ctx, count));
        const args = await structure(
          buildDiscoveryStructurePrompt(ctx, count, text),
          { name: "submit_candidates" },
          candidatesFunctionDeclaration,
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
