import { type FunctionDeclaration, Type } from "@google/genai";

/** The function declaration Gemini calls to return a structured recommendation. Kept in sync with
 *  the Recommendation Zod schema; output is re-validated with Zod after the call. */
export const recommendationFunctionDeclaration: FunctionDeclaration = {
  name: "submit_recommendation",
  description: "Return the final structured recommendation for one ticker.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      ticker: { type: Type.STRING },
      action: { type: Type.STRING, enum: ["ADD", "TRIM", "HOLD", "SELL", "BUY", "WATCH", "PASS"] },
      conviction: { type: Type.NUMBER, description: "0..1" },
      strategyFamily: { type: Type.STRING },
      thesis: { type: Type.STRING },
      signals: { type: Type.ARRAY, items: { type: Type.STRING } },
      catalyst: {
        type: Type.OBJECT,
        nullable: true,
        properties: {
          kind: { type: Type.STRING },
          summary: { type: Type.STRING },
          sentiment: { type: Type.NUMBER },
        },
      },
      prediction: {
        type: Type.OBJECT,
        properties: {
          direction: { type: Type.STRING, enum: ["bullish", "bearish", "neutral"] },
          horizon: { type: Type.STRING, enum: ["1d", "1w", "1mo", "3mo", "6mo", "1y"] },
          entry: { type: Type.NUMBER, nullable: true },
          target: { type: Type.NUMBER, nullable: true },
          stop: { type: Type.NUMBER, nullable: true },
          expectedReturnPct: { type: Type.NUMBER, nullable: true },
          rMultiple: { type: Type.NUMBER, nullable: true },
          trigger: { type: Type.STRING, nullable: true },
          actionIfTriggered: { type: Type.STRING, nullable: true },
          invalidation: { type: Type.STRING },
          rationale: { type: Type.STRING },
        },
        required: ["direction", "horizon", "invalidation", "rationale"],
      },
    },
    required: ["ticker", "action", "conviction", "strategyFamily", "thesis", "signals", "prediction"],
  },
};

/** The function declaration Gemini calls to return sentiment/thematic discovery candidates. Each
 *  candidate is re-validated through the ScanCandidate Zod schema after the call; grounding
 *  citations are attached as the candidate's sources. */
export const candidatesFunctionDeclaration: FunctionDeclaration = {
  name: "submit_candidates",
  description:
    "Return up to N high-potential US-listed equities credible professionals are currently flagging.",
  parameters: {
    type: Type.OBJECT,
    properties: {
      candidates: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            symbol: { type: Type.STRING },
            screen: { type: Type.STRING, enum: ["sentiment", "thematic"] },
            reason: { type: Type.STRING, description: "one-line, credibility-aware rationale" },
          },
          required: ["symbol", "screen", "reason"],
        },
      },
    },
    required: ["candidates"],
  },
};
