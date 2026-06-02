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
  knowledge: ["knowledge"],
  wiki: ["wiki"],
  trades: ["trades"],
  queryLog: ["queryLog"],
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
  return useMutation({ mutationFn: (preset: RiskPreset) => client.setRisk(preset), onSuccess: invalidate });
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

/** Day-grouped self-curated facts. Shares the `knowledge` key prefix so an archive refetches it. */
export const useCuratedMemory = () =>
  useQuery({ queryKey: [...keys.knowledge, "curated"], queryFn: client.curatedMemory });

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

export const useTrades = () => useQuery({ queryKey: keys.trades, queryFn: client.trades });
export const useQueryLog = () => useQuery({ queryKey: keys.queryLog, queryFn: client.queryLog });
