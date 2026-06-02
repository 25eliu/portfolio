/**
 * Text extraction from supported inputs. We only ever keep PLAIN TEXT — all markup is discarded — and
 * the extracted text is treated downstream as untrusted evidence (delimited, never executed). Supported
 * v1 inputs: PDF, Markdown, plain text, pasted notes, and fetched HTML.
 */

const MAX_TEXT_CHARS = 400_000; // cap extracted text to keep storage + retrieval bounded

export type ExtractResult = { text: string; warnings: string[] };

const decoder = new TextDecoder("utf-8", { fatal: false });

/** Strip HTML to readable text: drop script/style/head, remove tags, decode common entities. */
export function htmlToText(html: string): string {
  const withoutBlocks = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(script|style|noscript|head|svg)[\s\S]*?<\/\1>/gi, " ");
  const withoutTags = withoutBlocks
    .replace(/<\/(p|div|br|li|h[1-6]|tr|table|section|article)>/gi, "\n")
    .replace(/<[^>]+>/g, " ");
  return decodeEntities(withoutTags).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function decodeEntities(s: string): string {
  const named: Record<string, string> = {
    "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&apos;": "'", "&nbsp;": " ",
  };
  return s
    .replace(/&[a-z]+;|&#\d+;/gi, (m) => {
      if (named[m]) return named[m]!;
      const num = m.match(/^&#(\d+);$/);
      return num ? String.fromCodePoint(Number(num[1])) : m;
    });
}

/** Normalize plain text / markdown — collapse excessive whitespace, trim, cap length. */
function normalizeText(text: string): string {
  return text.replace(/\r\n/g, "\n").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

/** Decide which extractor to use from MIME type and/or filename, then extract plain text. */
export async function extractText(input: {
  kind: "upload" | "url" | "note";
  mime?: string;
  filename?: string;
  bytes?: Uint8Array;
  text?: string;
}): Promise<ExtractResult> {
  const warnings: string[] = [];

  if (input.kind === "note") {
    return { text: cap(normalizeText(input.text ?? ""), warnings), warnings };
  }

  const mime = (input.mime ?? "").toLowerCase();
  const ext = (input.filename ?? "").toLowerCase().split(".").pop() ?? "";
  const bytes = input.bytes ?? new Uint8Array();

  if (mime.includes("pdf") || ext === "pdf") {
    return { text: cap(await extractPdf(bytes, warnings), warnings), warnings };
  }
  if (mime.includes("html") || ext === "html" || ext === "htm") {
    return { text: cap(htmlToText(decoder.decode(bytes || new TextEncoder().encode(input.text ?? ""))), warnings), warnings };
  }
  if (
    mime.includes("text/") || mime.includes("markdown") ||
    ["md", "markdown", "txt", "text", ""].includes(ext)
  ) {
    return { text: cap(normalizeText(input.text ?? decoder.decode(bytes)), warnings), warnings };
  }
  throw new Error(`unsupported content type: ${mime || ext || "unknown"}`);
}

async function extractPdf(bytes: Uint8Array, warnings: string[]): Promise<string> {
  try {
    // Lazy import so the rest of ingestion works even if the optional parser is unavailable.
    const { getDocumentProxy, extractText: pdfExtract } = await import("unpdf");
    const pdf = await getDocumentProxy(bytes);
    const { text } = await pdfExtract(pdf, { mergePages: true });
    const joined = Array.isArray(text) ? text.join("\n\n") : text;
    return normalizeText(joined);
  } catch (err) {
    throw new Error(`pdf extraction failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

function cap(text: string, warnings: string[]): string {
  if (text.length > MAX_TEXT_CHARS) {
    warnings.push(`text truncated to ${MAX_TEXT_CHARS} chars`);
    return text.slice(0, MAX_TEXT_CHARS);
  }
  return text;
}
