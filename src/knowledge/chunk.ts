/**
 * Deterministic text chunking for retrieval. Splits on paragraph boundaries and packs paragraphs into
 * chunks of roughly `targetChars`, never splitting mid-paragraph unless a single paragraph exceeds the
 * size. Deterministic so re-ingesting identical content yields identical chunks (stable provenance).
 */
export function chunkText(text: string, opts: { targetChars?: number } = {}): string[] {
  const target = opts.targetChars ?? 1200;
  const clean = text.trim();
  if (!clean) return [];

  const paragraphs = clean.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const chunks: string[] = [];
  let current = "";

  const flush = () => {
    if (current.trim()) chunks.push(current.trim());
    current = "";
  };

  for (const para of paragraphs) {
    if (para.length > target * 1.5) {
      // Oversized paragraph: flush what we have, then hard-split the paragraph by sentences.
      flush();
      for (const piece of splitLong(para, target)) chunks.push(piece);
      continue;
    }
    if (current.length + para.length + 2 > target && current) flush();
    current = current ? `${current}\n\n${para}` : para;
  }
  flush();
  return chunks;
}

/** Split an oversized paragraph into ≤target pieces on sentence boundaries, falling back to hard cuts. */
function splitLong(para: string, target: number): string[] {
  const sentences = para.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  let cur = "";
  for (const s of sentences) {
    if (s.length > target) {
      if (cur) { out.push(cur.trim()); cur = ""; }
      for (let i = 0; i < s.length; i += target) out.push(s.slice(i, i + target));
      continue;
    }
    if (cur.length + s.length + 1 > target && cur) { out.push(cur.trim()); cur = ""; }
    cur = cur ? `${cur} ${s}` : s;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}
