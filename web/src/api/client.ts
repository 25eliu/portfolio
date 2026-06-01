import type {
  DailyReport,
  Holding,
  HoldingInput,
  MarketSnapshot,
  PricedPortfolio,
  RiskPreset,
  RiskProfile,
  Run,
  Snapshot,
  WatchlistItem,
} from "./types.ts";

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
  seedAi: () => api<{ seeded: boolean }>("/portfolios/ai/seed", { method: "POST" }),
  run: () => api<{ status: string }>("/run", { method: "POST" }),
  recommendations: () => api<{ report: DailyReport | null }>("/recommendations"),
  snapshots: () =>
    api<{ user: Snapshot[]; ai: Snapshot[]; spy: MarketSnapshot[] }>("/snapshots"),
  status: () => api<{ lastRun: Run | null }>("/status"),
  risk: () => api<{ risk: RiskProfile | null }>("/risk"),
  setRisk: (preset: RiskPreset) =>
    api<RiskProfile>("/risk", { method: "PUT", body: JSON.stringify({ preset }) }),
  watchlist: () => api<WatchlistItem[]>("/watchlist"),
  addWatch: (symbol: string) =>
    api<WatchlistItem>("/watchlist", { method: "POST", body: JSON.stringify({ symbol }) }),
  removeWatch: (id: string) => api<{ ok: boolean }>(`/watchlist/${id}`, { method: "DELETE" }),
};
