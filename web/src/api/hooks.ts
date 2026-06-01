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

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

/**
 * /run is fire-and-poll: it starts the run server-side and returns immediately. We then poll
 * /status until the run leaves "running" so `isPending` (the "Analyzing" state) stays true for the
 * whole run, and the success/error toast fires at the right time.
 */
export function useRunNow() {
  const invalidate = useInvalidateAll();
  return useMutation({
    mutationFn: async () => {
      await client.run(); // "started" or "already_running" — either way, poll the in-flight run
      await sleep(500); // let the background run register its "running" row
      for (let i = 0; i < 300; i++) {
        // up to ~10 minutes
        const { lastRun } = await client.status();
        if (lastRun && lastRun.status !== "running") {
          if (lastRun.status === "error") throw new Error(lastRun.error ?? "Run failed");
          return lastRun;
        }
        await sleep(2000);
      }
      throw new Error("Run timed out");
    },
    onSuccess: invalidate,
  });
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
