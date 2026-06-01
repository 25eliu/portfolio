/** Spike: confirm gemini-3.1-pro-preview can ground via Google Search AND return a structured
 *  function-tool call with citations, in one request. Run: bun run gemini:smoke
 *
 *  REQUIRES a live GEMINI_API_KEY (not available in CI/sandbox). This is the live verification path
 *  for src/llm/gemini.ts: it must print a populated submit_recommendation function call alongside a
 *  non-zero grounding-chunk count. If it returns text instead of a call when both tools are present,
 *  switch gemini.ts to the documented two-stage fallback. */
import { type FunctionDeclaration, GoogleGenAI, ThinkingLevel, Type } from "@google/genai";
import { loadEnv } from "../src/config/env.ts";

const env = loadEnv();
if (!env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY in .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

const THINKING: Record<typeof env.GEMINI_THINKING_LEVEL, ThinkingLevel> = {
  low: ThinkingLevel.LOW,
  medium: ThinkingLevel.MEDIUM,
  high: ThinkingLevel.HIGH,
};

const submitRecommendation: FunctionDeclaration = {
  name: "submit_recommendation",
  description: "Return the structured recommendation for the ticker.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      ticker: { type: Type.STRING },
      action: { type: Type.STRING, enum: ["BUY", "SELL", "HOLD", "WATCH"] },
      conviction: { type: Type.NUMBER },
      thesis: { type: Type.STRING },
    },
    required: ["ticker", "action", "conviction", "thesis"],
  },
};

const res = await ai.models.generateContent({
  model: env.GEMINI_MODEL,
  contents: "Research the latest news on NVDA today, then call submit_recommendation with your call.",
  config: {
    tools: [{ googleSearch: {} }, { functionDeclarations: [submitRecommendation] }],
    thinkingConfig: { thinkingLevel: THINKING[env.GEMINI_THINKING_LEVEL] },
  },
});

console.log("functionCalls:", JSON.stringify(res.functionCalls, null, 2));
console.log("text:", res.text);
const gm = res.candidates?.[0]?.groundingMetadata;
console.log("grounding chunks:", gm?.groundingChunks?.length ?? 0);
