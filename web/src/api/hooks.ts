import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { client } from "./client.ts";
import type { HoldingInput, RiskPreset } from "./types.ts";

const keys = {
  portfolios: ["portfolios"],
  holdings: ["holdings"],
  recommendations: ["recommendations"],
  snapshots: ["snapshots"],
  status: ["status"],
  risk: ["risk"],
  watchlist: ["watchlist"],
};

export const usePortfolios = () => useQuery({ queryKey: keys.portfolios, queryFn: client.portfolios });
export const useHoldings = () => useQuery({ queryKey: keys.holdings, queryFn: client.holdings });
export const useRecommendations = () =>
  useQuery({ queryKey: keys.recommendations, queryFn: client.recommendations });
export const useSnapshots = () => useQuery({ queryKey: keys.snapshots, queryFn: client.snapshots });
export const useStatus = () => useQuery({ queryKey: keys.status, queryFn: client.status });
export const useRisk = () => useQuery({ queryKey: keys.risk, queryFn: client.risk });
export const useWatchlist = () => useQuery({ queryKey: keys.watchlist, queryFn: client.watchlist });

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

export function useSeedAi() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => client.seedAi(), onSuccess: invalidate });
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

export function useAddWatch() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (symbol: string) => client.addWatch(symbol), onSuccess: invalidate });
}

export function useRemoveWatch() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: (id: string) => client.removeWatch(id), onSuccess: invalidate });
}
