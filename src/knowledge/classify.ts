/**
 * No-tools content guardrail before text enters the knowledge base (roadmap §8). This is defense in
 * depth, not the only defense: indirect prompt injection is ultimately contained by injecting evidence
 * only into the research stage inside a delimited, untrusted section. Here we cheaply quarantine
 * content that is empty, non-textual (binary/garbage), or carries overt instruction-injection markers.
 */

const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all|any|the|your)? ?(previous|prior|above) (instructions|prompts?)/i,
  /disregard (the|all|any|your)? ?(previous|prior|above|system)/i,
  /you are now (a|an|the)/i,
  /\bsystem prompt\b/i,
  /\bdeveloper (message|instructions)\b/i,
  /act as (a|an|the)? ?(jailbroken|unrestricted|dan)\b/i,
];

export type Classification = { ok: boolean; reason?: string; warnings: string[] };

/** Ratio of printable characters — low ratios signal binary/garbage extraction. */
function printableRatio(text: string): number {
  if (!text) return 0;
  let printable = 0;
  for (const ch of text) {
    const code = ch.codePointAt(0)!;
    if (code === 9 || code === 10 || code === 13 || (code >= 32 && code !== 127)) printable++;
  }
  return printable / text.length;
}

export function classifyContent(text: string): Classification {
  const warnings: string[] = [];
  const trimmed = text.trim();
  if (trimmed.length < 20) return { ok: false, reason: "content too short or empty", warnings };
  if (printableRatio(trimmed) < 0.85) return { ok: false, reason: "content appears non-textual (binary/garbage)", warnings };

  const hits = INJECTION_PATTERNS.filter((re) => re.test(trimmed));
  if (hits.length >= 2) {
    return { ok: false, reason: "content contains prompt-injection markers", warnings };
  }
  if (hits.length === 1) {
    warnings.push("possible instruction-like phrasing detected; treated as untrusted evidence only");
  }
  return { ok: true, warnings };
}
