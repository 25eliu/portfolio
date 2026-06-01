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

/** Invalidate everything that a portfolio mutation can affect. */
function useInvalidateAll() {
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

export function useSeedAi() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => client.seedAi(), onSuccess: invalidate });
}

export function useRunNow() {
  const invalidate = useInvalidateAll();
  return useMutation({ mutationFn: () => client.run(), onSuccess: invalidate });
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
