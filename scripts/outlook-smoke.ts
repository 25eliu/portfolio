/** Diagnostic for the OUTLOOK two-stage path used by src/llm/gemini.ts -> synthesizeOutlook. Run:
 *   bun run scripts/outlook-smoke.ts
 *
 * Production `synthesizeOutlook` swallows every failure and returns an empty outlook, which is why
 * `ai_theses` can stay at 0 rows with no trace. This script replicates the exact two stages with the
 * real prompts + `outlookFunctionDeclaration`, then runs `Outlook.safeParse` so we can see which layer
 * is empty: a thrown API error, an unparseable function call, or a genuinely empty outlook.
 * No DB writes, no trades — one research call + one structuring call. */
import {
  FunctionCallingConfigMode,
  GoogleGenAI,
  ThinkingLevel,
} from "@google/genai";
import { loadEnv } from "../src/config/env.ts";
import { buildOutlookResearchPrompt, buildOutlookStructurePrompt } from "../src/llm/prompts.ts";
import { outlookFunctionDeclaration } from "../src/llm/schema.ts";
import { Outlook } from "../src/domain/index.ts";

const env = loadEnv();
if (!env.GEMINI_API_KEY) {
  console.error("Set GEMINI_API_KEY in .env");
  process.exit(1);
}

const THINKING = { low: ThinkingLevel.LOW, medium: ThinkingLevel.MEDIUM, high: ThinkingLevel.HIGH };
const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
const date = new Date().toISOString().slice(0, 10);

// Stage A — grounded research (Search only), mirroring gemini.ts `research`.
console.log(`[stage A] research (model=${env.GEMINI_MODEL}, googleSearch)…`);
const a = await ai.models.generateContent({
  model: env.GEMINI_MODEL,
  contents: buildOutlookResearchPrompt(date, "calm", []),
  config: { tools: [{ googleSearch: {} }], thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
});
const chunks =
  (a.candidates?.[0]?.groundingMetadata?.groundingChunks ?? []) as { web?: { title?: string; uri?: string } }[];
const researchText = a.text ?? "";
console.log(`[stage A] research text length=${researchText.length}, grounding sources=${chunks.length}`);

// Stage B — structure the research via submit_outlook (function tool only, forced), mirroring `structure`.
console.log(`[stage B] structure (submit_outlook, mode=ANY, thinking=${env.GEMINI_THINKING_LEVEL})…`);
const b = await ai.models.generateContent({
  model: env.GEMINI_MODEL,
  contents: buildOutlookStructurePrompt(date, researchText),
  config: {
    tools: [{ functionDeclarations: [outlookFunctionDeclaration] }],
    toolConfig: {
      functionCallingConfig: { mode: FunctionCallingConfigMode.ANY, allowedFunctionNames: ["submit_outlook"] },
    },
    thinkingConfig: { thinkingLevel: THINKING[env.GEMINI_THINKING_LEVEL] },
  },
});

const call = b.functionCalls?.find((c) => c.name === "submit_outlook") ?? b.functionCalls?.[0];
console.log("\n[stage B] raw submit_outlook args:");
console.log(JSON.stringify(call?.args ?? null, null, 2));

// The exact gate that production uses (gemini.ts:222) — does the function call satisfy the zod schema?
const parsed = Outlook.safeParse(call?.args ?? {});
if (!parsed.success) {
  console.log("\n✗ Outlook.safeParse FAILED — this is the silent empty-outlook cause:");
  console.log(parsed.error.message);
  process.exit(1);
}
const o = parsed.data;
console.log("\n✓ Outlook.safeParse OK:");
console.log(`  regime: ${o.regime ? `${o.regime.subject}/${o.regime.stance}` : "(null)"}`);
console.log(`  sectors: ${o.sectors.length} -> ${o.sectors.map((s) => `${s.subject}/${s.stance}`).join(", ") || "(none)"}`);
console.log(`  themes:  ${o.themes.length} -> ${o.themes.map((t) => `${t.subject}/${t.stance}`).join(", ") || "(none)"}`);
const total = (o.regime ? 1 : 0) + o.sectors.length + o.themes.length;
console.log(
  total > 0
    ? `\n✓ Outlook non-empty (${total} items) — Gemini path is healthy; empty ai_theses means a STALE SERVER ran the analyses.`
    : `\n✗ Outlook parsed but EMPTY — Gemini returned no regime/sectors/themes. Inspect the raw args + prompt above.`,
);
