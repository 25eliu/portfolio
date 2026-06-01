import { useState } from "react";
import { Plus, Trash2, X } from "lucide-react";
import { useAddHolding, useDeleteHolding, useHoldings, useAddWatch, useRemoveWatch, useWatchlist } from "../api/hooks.ts";
import { usd } from "../lib/format.ts";
import { Button } from "./ui/Button.tsx";
import { Dialog } from "./ui/Dialog.tsx";

const inputClass =
  "w-full rounded-lg border border-hairline bg-surface-2 px-2.5 py-1.5 text-text outline-none transition-colors placeholder:text-text-muted focus:border-accent";

export function TickerManager({ onClose }: { onClose: () => void }) {
  const holdings = useHoldings();
  const add = useAddHolding();
  const del = useDeleteHolding();

  const watchlist = useWatchlist();
  const addWatch = useAddWatch();
  const removeWatch = useRemoveWatch();

  const [symbol, setSymbol] = useState("");
  const [shares, setShares] = useState("");
  const [costBasis, setCostBasis] = useState("");
  const [error, setError] = useState<string | null>(null);

  const [watchSymbol, setWatchSymbol] = useState("");
  const [watchError, setWatchError] = useState<string | null>(null);

  const submit = async () => {
    setError(null);
    const sharesNum = Number(shares);
    if (!symbol.trim() || !Number.isFinite(sharesNum) || sharesNum <= 0) {
      setError("Enter a symbol and a positive share count.");
      return;
    }
    try {
      await add.mutateAsync({
        symbol: symbol.trim().toUpperCase(),
        shares: sharesNum,
        costBasis: costBasis ? Number(costBasis) : null,
      });
      setSymbol("");
      setShares("");
      setCostBasis("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add holding");
    }
  };

  const submitWatch = async () => {
    setWatchError(null);
    if (!watchSymbol.trim()) {
      setWatchError("Enter a ticker symbol.");
      return;
    }
    try {
      await addWatch.mutateAsync(watchSymbol.trim().toUpperCase());
      setWatchSymbol("");
    } catch (e) {
      setWatchError(e instanceof Error ? e.message : "Failed to add to watchlist");
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title="My Portfolio holdings"
      description="Mirror your real account — add, edit, or remove positions."
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="eyebrow text-left">
            <th className="pb-2 font-medium">Symbol</th>
            <th className="pb-2 text-right font-medium">Shares</th>
            <th className="pb-2 text-right font-medium">Cost basis</th>
            <th className="pb-2" />
          </tr>
        </thead>
        <tbody>
          {holdings.data?.map((h) => (
            <tr key={h.id} className="border-t border-hairline">
              <td className="py-2 font-medium text-text">{h.symbol}</td>
              <td className="tnum py-2 text-right font-mono text-text-secondary">{h.shares}</td>
              <td className="tnum py-2 text-right font-mono text-text-secondary">
                {h.costBasis == null ? "—" : usd(h.costBasis)}
              </td>
              <td className="py-2 text-right">
                <button
                  className="inline-grid h-7 w-7 place-items-center rounded-lg text-text-muted transition-colors hover:bg-neg/10 hover:text-neg"
                  onClick={() => del.mutate(h.id)}
                  aria-label={`Remove ${h.symbol}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
          <tr className="border-t border-hairline-strong">
            <td className="py-3 pr-2">
              <input
                value={symbol}
                onChange={(e) => setSymbol(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="AAPL"
                className={`${inputClass} uppercase`}
              />
            </td>
            <td className="py-3 pr-2">
              <input
                value={shares}
                onChange={(e) => setShares(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="10"
                inputMode="decimal"
                className={`${inputClass} text-right font-mono`}
              />
            </td>
            <td className="py-3 pr-2">
              <input
                value={costBasis}
                onChange={(e) => setCostBasis(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submit()}
                placeholder="optional"
                inputMode="decimal"
                className={`${inputClass} text-right font-mono`}
              />
            </td>
            <td className="py-3 text-right">
              <Button
                variant="primary"
                size="sm"
                icon={<Plus className="h-4 w-4" />}
                onClick={submit}
                loading={add.isPending}
              >
                Add
              </Button>
            </td>
          </tr>
        </tbody>
      </table>

      {error && <p className="mt-3 text-xs text-neg">{error}</p>}

      {/* ── Watchlist section ─────────────────────────────────────── */}
      <div className="mt-6 border-t border-hairline pt-5">
        <div className="eyebrow mb-3">Watchlist</div>

        {/* Current watchlist chips */}
        {watchlist.data && watchlist.data.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {watchlist.data.map((w) => (
              <span
                key={w.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-hairline-strong bg-surface-2 px-2.5 py-1 text-xs font-medium text-text"
              >
                {w.symbol}
                <button
                  onClick={() => removeWatch.mutate(w.id)}
                  aria-label={`Remove ${w.symbol} from watchlist`}
                  className="ml-0.5 rounded-full p-0.5 text-text-muted transition-colors hover:bg-neg/10 hover:text-neg"
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        {watchlist.data?.length === 0 && (
          <p className="mb-3 text-xs text-text-muted">No symbols on your watchlist yet.</p>
        )}

        {/* Add to watchlist row */}
        <div className="flex items-center gap-2">
          <input
            value={watchSymbol}
            onChange={(e) => setWatchSymbol(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submitWatch()}
            placeholder="Add to watchlist"
            className={`${inputClass} flex-1 uppercase`}
          />
          <Button
            variant="secondary"
            size="sm"
            icon={<Plus className="h-4 w-4" />}
            onClick={submitWatch}
            loading={addWatch.isPending}
          >
            Watch
          </Button>
        </div>
        {watchError && <p className="mt-2 text-xs text-neg">{watchError}</p>}
      </div>
    </Dialog>
  );
}
