import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client, type NoteInput, type SourcePatch, type UrlInput } from "./client.ts";
import type { HoldingInput, RiskPreset, Schedule } from "./types.ts";

const keys = {
  portfolios: ["portfolios"],
  holdings: ["holdings"],
  recommendations: ["recommendations"],
  snapshots: ["snapshots"],
  status: ["status"],
  risk: ["risk"],
  schedule: ["schedule"],
  watchlist: ["watchlist"],
  journal: ["journal"],
  graph: ["graph"],
  knowledge: ["knowledge"],
  wiki: ["wiki"],
  trades: ["trades"],
  queryLog: ["queryLog"],
  queryTickers: ["queryTickers"],
};

// Live-priced equity/P&L: the server reprices from fresh quotes on every request, so poll while the
// tab is visible (React Query pauses the interval when hidden) and refetch when the tab regains focus.
// This is what keeps equity / Total P&L / day P&L moving with the market without clicking Run Analysis.
export const usePortfolios = () =>
  useQuery({
    queryKey: keys.portfolios,
    queryFn: client.portfolios,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
  });
export const useHoldings = () => useQuery({ queryKey: keys.holdings, queryFn: client.holdings });
export const useRecommendations = () =>
  useQuery({ queryKey: keys.recommendations, queryFn: client.recommendations });
export const useSnapshots = () => useQuery({ queryKey: keys.snapshots, queryFn: client.snapshots });
export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: client.status });
export const useRisk = () => useQuery({ queryKey: keys.risk, queryFn: client.risk });
export const useSchedule = () => useQuery({ queryKey: keys.schedule, queryFn: client.schedule });
export const useWatchlist = () => useQuery({ queryKey: keys.watchlist, queryFn: client.watchlist });
export const useJournal = (ticker?: string) =>
  useQuery({ queryKey: [...keys.journal, "ticker", ticker ?? null], queryFn: () => client.journal({ ticker }) });
export const useJournalDays = () =>
  useQuery({ queryKey: [...keys.journal, "days"], queryFn: client.journalDays });
export const useJournalDay = (date: string | null) =>
  useQuery({ queryKey: [...keys.journal, "day", date], queryFn: () => client.journal({ date: date! }), enabled: date != null });
export const useJournalEntry = (id: string | null) =>
  useQuery({ queryKey: [...keys.journal, "entry", id], queryFn: () => client.journalEntry(id!), enabled: id != null });

// Knowledge-graph traversal: a focal node + its neighbors (the graph viz re-fetches per focal node), and
// the node picker's per-type listing.
export const useGraphNode = (id: string | null) =>
  useQuery({ queryKey: [...keys.graph, "node", id], queryFn: () => client.graphNode(id!), enabled: id != null });
export const useGraphNodes = (type?: string) =>
  useQuery({ queryKey: [...keys.graph, "nodes", type ?? null], queryFn: () => client.graphNodes(type) });
// Cross-type graph search (label/summary/id), ranked by match quality then connectedness. Disabled
// until there's a query so the panel doesn't fire on an empty box.
export const useGraphSearch = (q: string) =>
  useQuery({
    queryKey: [...keys.graph, "search", q],
    queryFn: () => client.graphSearch(q),
    enabled: q.trim().length > 0,
  });

/** Invalidate everything that a portfolio mutation / run can affect. */
export function useInvalidateAll() {
  const qc = useQueryClient();
  return () =>
    Promise.all(Object.values(keys).map((key) => qc.invalidateQueries({ queryKey: key })));
}

export function useAddHolding() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: HoldingInput) => client.addHolding(input), onSuccess: invalidate });
}

export function useDeleteHolding() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => client.deleteHolding(id), onSuccess: invalidate });
}

export function useSetCash() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (cash: number) => client.setCash(cash), onSuccess: invalidate });
}

/**
 * Start a run and return its `runId`. The run executes in the background and streams progress over
 * SSE (see `useRunStream`); the dashboard refreshes via `useInvalidateAll` when the stream finishes.
 */
export function useStartRun() {
  return useMutation({ mutationFn: () => client.run() });
}

export function useSetRisk() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (preset: RiskPreset) => client.setRisk(preset, "user"), onSuccess: invalidate });
}
export function useSetAiRisk() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (preset: RiskPreset) => client.setRisk(preset, "ai"), onSuccess: invalidate });
}

export function useSetSchedule() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (s: Schedule) => client.setSchedule(s), onSuccess: invalidate });
}

export function useAddWatch() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (symbol: string) => client.addWatch(symbol), onSuccess: invalidate });
}

export function useRemoveWatch() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => client.removeWatch(id), onSuccess: invalidate });
}

export const useKnowledgeSources = () =>
  useQuery({ queryKey: keys.knowledge, queryFn: client.knowledgeSources });

const aiLibraryKey = ["aiLibrary"] as const;

export const useAiLibraryDays = () =>
  useQuery({ queryKey: [...aiLibraryKey, "days"], queryFn: client.aiLibraryDays });

export const useAiLibraryDay = (date: string | null) =>
  useQuery({ queryKey: [...aiLibraryKey, "day", date], queryFn: () => client.aiLibraryDay(date!), enabled: !!date });

export const useAiLibrarySearch = (params: { q?: string; dimension?: string; value?: string }) =>
  useQuery({
    queryKey: [...aiLibraryKey, "search", params],
    queryFn: () => client.aiLibrarySearch(params),
    enabled: !!(params.q || (params.dimension && params.value)),
  });

export const useTags = () => useQuery({ queryKey: [...aiLibraryKey, "tags"], queryFn: client.tags });

export const useEditInsightTags = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id, body }: { kind: string; id: string; body: import("./client.ts").TagEdit }) =>
      client.editInsightTags(kind, id, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiLibraryKey }),
  });
};

export const useArchiveInsight = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ kind, id }: { kind: string; id: string }) => client.archiveInsight(kind, id),
    onSuccess: () => qc.invalidateQueries({ queryKey: aiLibraryKey }),
  });
};

export function useAddNote() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: NoteInput) => client.addNote(input), onSuccess: invalidate });
}
export function useAddUrl() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (input: UrlInput) => client.addUrl(input), onSuccess: invalidate });
}
export function useUploadKnowledge() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (a: { file: File; scope: "global" | "ticker"; scopeTicker?: string }) =>
      client.uploadKnowledge(a.file, a.scope, a.scopeTicker),
    onSuccess: invalidate,
  });
}
export function useUpdateSource() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: (a: { id: string; patch: SourcePatch }) => client.updateSource(a.id, a.patch),
    onSuccess: invalidate,
  });
}
export function useArchiveSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => client.archiveSource(id), onSuccess: invalidate });
}
export function useRefreshSource() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => client.refreshSource(id), onSuccess: invalidate });
}

export const useWikiBriefing = () => useQuery({ queryKey: [...keys.wiki, "briefing"], queryFn: client.wikiBriefing });
export const useWikiLessons = () => useQuery({ queryKey: [...keys.wiki, "lessons"], queryFn: client.wikiLessons });
export const useWikiMetrics = (window?: string) =>
  useQuery({ queryKey: [...keys.wiki, "metrics", window ?? "all"], queryFn: () => client.wikiMetrics(window) });
export const useWikiInFlight = () => useQuery({ queryKey: [...keys.wiki, "in-flight"], queryFn: client.wikiInFlight });
export const useForecastMarks = (id: string | null) =>
  useQuery({ queryKey: [...keys.wiki, "marks", id], queryFn: () => client.forecastMarks(id!), enabled: id != null });

const marketViewKey = ["marketView"] as const;
export const useMarketViewCurrent = () => useQuery({ queryKey: [...marketViewKey, "current"], queryFn: client.marketViewCurrent });
export const useMarketViewSubject = (level: string | null, subject: string | null) =>
  useQuery({ queryKey: [...marketViewKey, "subject", level, subject], queryFn: () => client.marketViewSubject(level!, subject!), enabled: !!(level && subject) });
export const useMarketViewDay = (date: string | null) =>
  useQuery({ queryKey: [...marketViewKey, "day", date], queryFn: () => client.marketViewDay(date!), enabled: date != null });

export const useTrades = () => useQuery({ queryKey: keys.trades, queryFn: client.trades });
export const useQueryLog = () => useQuery({ queryKey: keys.queryLog, queryFn: client.queryLog });
// The @-mention universe (holdings ∪ AI book ∪ watchlist). Refetched on focus; changes rarely.
export const useMentionTickers = () =>
  useQuery({ queryKey: keys.queryTickers, queryFn: client.queryTickers, staleTime: 60_000 });
