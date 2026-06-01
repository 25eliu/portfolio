/**
 * Gemini analyzer — single-call design (Google Search grounding + a function tool in one
 * `generateContent` request), per the plan's Step 9 shape.
 *
 * LIVE-SPIKE PENDING: `gemini-3.1-pro-preview` plus the exact "grounding + function-tool in a single
 * call" behavior is newer than typical training data and could not be confirmed in this sandbox
 * (no live GEMINI_API_KEY). Run `bun run gemini:smoke` with a real key to confirm:
 *   - `res.functionCalls` is populated *alongside* `res.candidates[0].groundingMetadata.groundingChunks`.
 * If the model returns text instead of a function call when both tools are present, switch to the
 * documented TWO-STAGE FALLBACK: (a) grounded call (googleSearch only) → text, then (b) a second
 * call with only the function tool over that text for schema coercion. The offline mock analyzer +
 * its unit tests are the verification path here; this file is exercised live by the smoke script.
 */
import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import type { Env } from "../config/env.ts";
import { Recommendation, ScanCandidate } from "../domain/index.ts";
import type { MarketContext } from "../domain/marketContext.ts";
import type { Analyzer } from "./analyze.ts";
import { buildDiscoveryPrompt, buildMarketContextPrompt, buildTickerPrompt, type TickerInput } from "./prompts.ts";
import { candidatesFunctionDeclaration, recommendationFunctionDeclaration } from "./schema.ts";

const THINKING: Record<Env["GEMINI_THINKING_LEVEL"], ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

export function createGeminiAnalyzer(env: Env): Analyzer {
  const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
  const thinkingLevel = THINKING[env.GEMINI_THINKING_LEVEL];
  const baseConfig = {
    tools: [{ googleSearch: {} }, { functionDeclarations: [recommendationFunctionDeclaration] }],
    thinkingConfig: { thinkingLevel },
  };

  function citations(res: any): { title: string; url: string }[] {
    const chunks = res.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
    return chunks
      .map((c: any) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" }))
      .filter((s: any) => s.url);
  }

  return {
    kind: "gemini",
    async analyzeTicker(input: TickerInput, ctx: MarketContext): Promise<Recommendation> {
      const res = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: buildTickerPrompt(input, ctx),
        config: baseConfig,
      });
      const call = res.functionCalls?.find((c: any) => c.name === "submit_recommendation");
      if (!call) throw new Error(`No recommendation call for ${input.symbol}`);
      const upside =
        input.fundamentals.priceTargetMean && input.price
          ? Math.round(((input.fundamentals.priceTargetMean - input.price) / input.price) * 10000) / 100
          : null;
      return Recommendation.parse({
        ...call.args,
        ticker: input.symbol,
        technicals: input.technicals,
        fundamentals: input.fundamentals,
        priceTargetUpside: upside,
        sources: citations(res),
        screen: input.screen,
      });
    },

    async marketMacro(date, spyTrend, spyPctFromSma200) {
      const res = await ai.models.generateContent({
        model: env.GEMINI_MODEL,
        contents: buildMarketContextPrompt(date, spyTrend, spyPctFromSma200),
        config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
      });
      return { summary: res.text ?? "", sources: citations(res) };
    },

    async discoverOpportunities(ctx: MarketContext, count: number): Promise<ScanCandidate[]> {
      if (count <= 0) return [];
      try {
        const res = await ai.models.generateContent({
          model: env.GEMINI_MODEL,
          contents: buildDiscoveryPrompt(ctx, count),
          config: {
            tools: [{ googleSearch: {} }, { functionDeclarations: [candidatesFunctionDeclaration] }],
            thinkingConfig: { thinkingLevel },
          },
        });
        const call = res.functionCalls?.find((c: any) => c.name === "submit_candidates");
        const raw = (call?.args as { candidates?: unknown[] } | undefined)?.candidates ?? [];
        const sources = citations(res);
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
