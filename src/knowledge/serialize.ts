import type { App } from "../app.ts";
import { nodeId } from "../domain/index.ts";
import type { InsightTag } from "../db/repositories/insightTags.ts";

/** One canonical, tagged shape for any AI-produced knowledge — the contract every consumer reads.
 *  Phase 1 emits the `kind: "fact"` variant; Phase 3 fills the thesis fields. */
export type AiInsight = {
  id: string;
  kind: "fact" | "thesis";
  level: "fact" | "regime" | "sector" | "theme";
  date: string;
  createdAt: string;
  subject: string;
  headline: string;
  body: string;
  stance: string | null;
  conviction: number | null;
  horizon: string | null;
  significance: number | null;
  tags: InsightTag[];
  tickers: string[];
  sources: { title: string; url: string }[];
  status: "active" | "superseded" | "archived";
  provenance: { runId: string | null; reportId: string | null; journalEntryId?: string };
};

/** The flat fact row shape returned by `knowledge.listCuratedFacts()`. */
type CuratedFactRow = {
  id: string;
  ticker: string | null;
  scope: string;
  fact: string;
  citationUrl: string | null;
  createdAt: string;
};

function hostOf(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function serializeFact(app: App, row: CuratedFactRow): AiInsight {
  const node = nodeId("source", row.id);
  const tags = app.repos.insightTags.tagsFor(node);
  const data = app.repos.graph.getNode(node)?.data ?? {};
  const num = (v: unknown): number | null => (typeof v === "number" ? v : null);
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  return {
    id: row.id,
    kind: "fact",
    level: "fact",
    date: row.createdAt.slice(0, 10),
    createdAt: row.createdAt,
    subject: row.ticker ?? "global",
    headline: row.fact,
    body: "",
    stance: null,
    conviction: null,
    horizon: null,
    significance: num(data.significance),
    tags,
    tickers: tags.filter((t) => t.dimension === "ticker").map((t) => t.value),
    sources: row.citationUrl ? [{ title: hostOf(row.citationUrl), url: row.citationUrl }] : [],
    status: "active",
    provenance: {
      runId: str(data.runId),
      reportId: str(data.reportId),
      journalEntryId: str(data.journalEntryId) ?? undefined,
    },
  };
}
