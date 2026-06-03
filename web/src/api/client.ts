import type {
  Briefing,
  DailyReport,
  ForecastOutcome,
  Holding,
  HoldingInput,
  IngestionRun,
  JournalEntry,
  KgNeighbor,
  KgNode,
  KnowledgeSource,
  KnowledgeVersion,
  MarketSnapshot,
  MentionTicker,
  PricedPortfolio,
  QueryLog,
  RiskPreset,
  RiskProfile,
  Run,
  Schedule,
  ScoredForecast,
  Snapshot,
  TradeDecision,
  WatchlistItem,
  WikiLesson,
  WikiMetric,
} from "./types.ts";

export type SourcePatch = {
  title?: string;
  scope?: "global" | "ticker";
  scopeTicker?: string | null;
  useInAnalysis?: boolean;
  status?: "active" | "quarantined" | "archived";
};
export type NoteInput = { title: string; text: string; scope: "global" | "ticker"; scopeTicker?: string; useInAnalysis?: boolean };
export type UrlInput = { url: string; title?: string; scope: "global" | "ticker"; scopeTicker?: string };
type IngestResult = { source: KnowledgeSource; run: IngestionRun };

/** One self-curated fact (the analyzer's own distilled memory) and its day grouping. */
export type CuratedFact = {
  id: string;
  ticker: string | null;
  scope: "global" | "ticker";
  fact: string;
  citationUrl: string | null;
  createdAt: string;
};
export type CuratedDay = { date: string; facts: CuratedFact[] };

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: unknown };
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${res.status})`);
  }
  return (await res.json()) as T;
}

export const client = {
  portfolios: () => api<{ user: PricedPortfolio; ai: PricedPortfolio }>("/portfolios"),
  holdings: () => api<Holding[]>("/holdings"),
  addHolding: (input: HoldingInput) =>
    api<Holding>("/holdings", { method: "POST", body: JSON.stringify(input) }),
  deleteHolding: (id: string) => api<{ ok: boolean }>(`/holdings/${id}`, { method: "DELETE" }),
  setCash: (cash: number) =>
    api<{ cash: number }>("/portfolios/cash", { method: "PUT", body: JSON.stringify({ cash }) }),
  run: () => api<{ runId: string; status: string }>("/run", { method: "POST" }),
  recommendations: () => api<{ report: DailyReport | null }>("/recommendations"),
  snapshots: () =>
    api<{ user: Snapshot[]; ai: Snapshot[]; spy: MarketSnapshot[] }>("/snapshots"),
  status: () => api<{ lastRun: Run | null }>("/status"),
  risk: () => api<{ risk: RiskProfile | null; user: RiskProfile | null; ai: RiskProfile | null }>("/risk"),
  setRisk: (preset: RiskPreset, portfolio: "user" | "ai" = "user") =>
    api<RiskProfile>("/risk", { method: "PUT", body: JSON.stringify({ preset, portfolio }) }),
  schedule: () => api<{ schedule: Schedule }>("/schedule"),
  setSchedule: (s: Schedule) =>
    api<Schedule>("/schedule", { method: "PUT", body: JSON.stringify(s) }),
  watchlist: () => api<WatchlistItem[]>("/watchlist"),
  addWatch: (symbol: string) =>
    api<WatchlistItem>("/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }),
  removeWatch: (id: string) => api<{ ok: boolean }>(`/watchlist/${id}`, { method: "DELETE" }),
  journal: (filter: { ticker?: string; date?: string } = {}) => {
    const qs = new URLSearchParams();
    if (filter.ticker) qs.set("ticker", filter.ticker);
    if (filter.date) qs.set("date", filter.date);
    const q = qs.toString();
    return api<{ entries: JournalEntry[] }>(`/journal${q ? `?${q}` : ""}`);
  },
  journalDays: () => api<{ days: { date: string; count: number; scored: number }[] }>("/journal/days"),
  journalEntry: (id: string) =>
    api<{ entry: JournalEntry; forecast: ScoredForecast | null; outcome: ForecastOutcome | null }>(
      `/journal/${id}`,
    ),
  knowledgeSources: () => api<{ sources: KnowledgeSource[] }>("/knowledge/sources"),
  knowledgeSource: (id: string) =>
    api<{ source: KnowledgeSource; versions: KnowledgeVersion[]; activeChunks: number }>(`/knowledge/sources/${id}`),
  addNote: (input: NoteInput) =>
    api<IngestResult>("/knowledge/sources/note", { method: "POST", body: JSON.stringify(input) }),
  addUrl: (input: UrlInput) =>
    api<IngestResult>("/knowledge/sources/url", { method: "POST", body: JSON.stringify(input) }),
  uploadKnowledge: (file: File, scope: "global" | "ticker", scopeTicker?: string) => {
    const fd = new FormData();
    fd.set("file", file);
    fd.set("scope", scope);
    if (scopeTicker) fd.set("scopeTicker", scopeTicker);
    // No JSON content-type: let the browser set the multipart boundary.
    return fetch("/api/knowledge/sources/upload", { method: "POST", body: fd }).then(async (res) => {
      if (!res.ok) throw new Error(`Upload failed (${res.status})`);
      return (await res.json()) as IngestResult;
    });
  },
  updateSource: (id: string, patch: SourcePatch) =>
    api<KnowledgeSource>(`/knowledge/sources/${id}`, { method: "PUT", body: JSON.stringify(patch) }),
  refreshSource: (id: string) => api<IngestResult>(`/knowledge/sources/${id}/refresh`, { method: "POST" }),
  archiveSource: (id: string) => api<{ ok: boolean }>(`/knowledge/sources/${id}`, { method: "DELETE" }),
  curatedMemory: () => api<{ days: CuratedDay[] }>("/knowledge/curated"),
  graphNode: (id: string) => api<{ node: KgNode; neighbors: KgNeighbor[] }>(`/graph/node/${id}`),
  wikiBriefing: () => api<{ briefing: Briefing | null }>("/wiki/briefing"),
  wikiLessons: () => api<{ lessons: WikiLesson[] }>("/wiki/lessons"),
  wikiLesson: (id: string) => api<{ lesson: WikiLesson }>(`/wiki/lessons/${id}`),
  wikiMetrics: (window?: string) =>
    api<{ metrics: WikiMetric[] }>(`/wiki/metrics${window ? `?window=${window}` : ""}`),
  trades: () => api<{ trades: TradeDecision[] }>("/trades"),
  askQuery: (question: string, tickers: string[] = []) =>
    api<{ queryId: string }>("/query", { method: "POST", body: JSON.stringify({ question, tickers }) }),
  queryTickers: () => api<{ tickers: MentionTicker[] }>("/query/tickers"),
  queryLog: () => api<{ queries: QueryLog[] }>("/query/log"),
};
