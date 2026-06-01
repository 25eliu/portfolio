/** Spike/verification for the TWO-STAGE Gemini path used by src/llm/gemini.ts. Run: bun run gemini:smoke
 *
 * Stage A (Search only) must return research text + real grounding citations; Stage B (function tool
 * only, mode ANY) must return a populated submit_recommendation call. Prints both so you can confirm
 * structured output AND non-empty sources against gemini-3.1-pro-preview. */
import {
  FunctionCallingConfigMode,
  type FunctionDeclaration,
  GoogleGenAI,
  ThinkingLevel,
  Type,
} from "@google/genai";
import { loadEnv } from "../src/config/env.ts";

const env = loadEnv();
if (!env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY in .env");
  process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });

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

// Stage A — grounded research (Search only).
const a = await ai.models.generateContent({
  model: env.GEMINI_MODEL,
  contents: "Research NVDA's latest catalysts and sentiment today. Summarize in 4 sentences.",
  config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
});
const chunks =
  (a.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as { web?: { title?: string; uri?: string } }[];
const sources = chunks.map((c) => ({ title: c.web?.title ?? "", url: c.web?.uri ?? "" })).filter((s) => s.url);

// Stage B — structure the research (function tool only, forced).
const b = await ai.models.generateContent({
  model: env.GEMINI_MODEL,
  contents: `Using this research, call submit_recommendation for NVDA.\n\n${a.text ?? ""}`,
  config: {
    tools: [{ functionDeclarations: [submitRecommendation] }],
    toolConfig: {
      functionCallingConfig: {
        mode: FunctionCallingConfigMode.ANY,
        allowedFunctionNames: ["submit_recommendation"],
      },
    },
    thinkingConfig: { thinkingLevel: THINKING_LEVEL() },
  },
});

function THINKING_LEVEL() {
  return { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH }[
    env.GEMINI_THINKING_LEVEL
  ];
}

const call = b.functionCalls?.find((c) => c.name === "submit_recommendation");
console.log("Stage A sources:", sources.length);
console.log(sources.slice(0, 5).map((s) => `  - ${s.title}`).join("\n"));
console.log("\nStage B functionCall:", JSON.stringify(call?.args, null, 2));
console.log(
  call && sources.length > 0
    ? "\n✓ Two-stage path works: structured output + grounded citations."
    : "\n✗ Something is off — inspect the output above.",
);
