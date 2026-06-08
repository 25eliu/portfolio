import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, ChevronRight, Network, Search } from "lucide-react";
import type { KgNode } from "../api/types.ts";
import { useGraphNode, useGraphSearch } from "../api/hooks.ts";
import { cn } from "../lib/cn.ts";
import { Card, CardHeader } from "./ui/Card.tsx";
import { Skeleton } from "./ui/Skeleton.tsx";
import { Term } from "./ui/Term.tsx";
import { EgoGraphSvg, type GraphHover } from "./graph/EgoGraphSvg.tsx";
import { NodeDetailPanel } from "./graph/NodeDetailPanel.tsx";
import { nodeStyle, parseNodeId, REL_LABEL } from "./graph/nodeStyle.ts";

const LEGEND_TYPES = ["ticker", "sector", "theme", "strategy_family", "lesson", "thesis", "source"] as const;

/**
 * Region — the knowledge graph made navigable. A luminous ego view (focal node + its neighbors) over the
 * `/graph` API: search across every concept type, walk the connections by clicking a node, read a node's
 * detail + linked AI knowledge in the side rail, step back through the breadcrumb, and tame dense hubs by
 * relationship. Read-only, like the API.
 */
export function KnowledgeGraph({ focusId }: { focusId?: string | null }) {
  // Breadcrumb stack of visited node ids; the last entry is the current focal node.
  const [path, setPath] = useState<string[]>(focusId ? [focusId] : []);
  const [hiddenRels, setHiddenRels] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<string | null>(null);
  const [hover, setHover] = useState<GraphHover | null>(null);

  // A deep link (View in graph →) resets the trail to that node.
  useEffect(() => {
    if (focusId) setPath([focusId]);
  }, [focusId]);

  const current = path[path.length - 1] ?? null;
  const graph = useGraphNode(current);
  const search = useGraphSearch(query);

  // Clear any lingering tooltip whenever the focal node changes (a re-center can swallow mouseleave).
  useEffect(() => setHover(null), [current]);

  const neighbors = graph.data?.neighbors ?? [];
  const presentRels = useMemo(() => [...new Set(neighbors.map((n) => n.edge.rel))], [neighbors]);
  const relFilter = useMemo(
    () => (hiddenRels.size ? new Set(presentRels.filter((r) => !hiddenRels.has(r))) : null),
    [hiddenRels, presentRels],
  );

  const focus = (id: string) => {
    setHiddenRels(new Set());
    setHover(null);
    setQuery("");
    setTypeFilter(null);
    setPath((p) => (p[p.length - 1] === id ? p : [...p, id]));
  };

  // Cross-type results, ranked by the backend (match quality → connectedness), optionally narrowed by a
  // type chip. Only types actually present in the results get a chip — empty types never appear.
  const results = search.data?.nodes ?? [];
  const resultTypes = useMemo(() => [...new Set(results.map((n) => n.type))], [results]);
  const matches = (typeFilter ? results.filter((n) => n.type === typeFilter) : results).slice(0, 8);
  const showResults = query.trim().length > 0 && (search.isLoading || results.length > 0);

  return (
    <Card className="p-5">
      <CardHeader
        eyebrow="Knowledge graph"
        title={
          <span className="flex items-center gap-2">
            <Network className="h-4 w-4 text-accent" />
            {graph.data ? graph.data.node.label : "Explore the graph"}
          </span>
        }
        right={
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
            <input
              value={query}
              onChange={(e) => { setQuery(e.target.value); setTypeFilter(null); }}
              placeholder="search the graph…"
              className="w-56 rounded-lg border border-hairline bg-surface-2 py-1.5 pl-7 pr-2 text-[12px] text-text outline-none placeholder:text-text-muted focus:border-hairline-strong"
            />
            {showResults && (
              <div className="absolute right-0 top-full z-20 mt-1 w-72 overflow-hidden rounded-lg border border-hairline-strong bg-surface-2 shadow-pop">
                {resultTypes.length > 1 && (
                  <div className="flex flex-wrap gap-1 border-b border-hairline px-2 py-1.5">
                    {resultTypes.map((t) => {
                      const on = typeFilter === t;
                      const s = nodeStyle(t);
                      return (
                        <button
                          key={t}
                          onClick={() => setTypeFilter(on ? null : t)}
                          className={cn(
                            "rounded-full border px-1.5 py-0.5 text-[10px] transition-colors",
                            on ? "border-accent/50 bg-accent-soft text-accent" : "border-hairline text-text-muted hover:text-text-secondary",
                          )}
                        >
                          <span style={{ color: s.color }}>{s.glyph}</span> {s.label}
                        </button>
                      );
                    })}
                  </div>
                )}
                {matches.length > 0 ? (
                  matches.map((n) => <PickerRow key={n.id} node={n} onPick={() => focus(n.id)} />)
                ) : search.isLoading ? (
                  <div className="px-2.5 py-2 text-[12px] text-text-muted">searching…</div>
                ) : (
                  <div className="px-2.5 py-2 text-[12px] text-text-muted">no matches</div>
                )}
              </div>
            )}
          </div>
        }
        className="mb-3"
      />

      {/* Breadcrumb trail + back, and the relationship filter for taming dense hubs. */}
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setPath((p) => p.slice(0, -1))}
            disabled={path.length < 2}
            className="flex items-center gap-1 rounded-md border border-hairline bg-surface-2 px-1.5 py-1 text-[11px] text-text-muted transition-colors enabled:hover:text-text disabled:opacity-40"
          >
            <ArrowLeft className="h-3 w-3" /> back
          </button>
          <Breadcrumb path={path} onJump={(i) => setPath((p) => p.slice(0, i + 1))} />
        </div>
        {presentRels.length > 1 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">relations</span>
            {presentRels.map((rel) => {
              const on = !hiddenRels.has(rel);
              return (
                <button
                  key={rel}
                  onClick={() =>
                    setHiddenRels((s) => {
                      const next = new Set(s);
                      next.has(rel) ? next.delete(rel) : next.add(rel);
                      return next;
                    })
                  }
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                    on ? "border-accent/40 bg-accent-soft text-accent" : "border-hairline bg-surface-2 text-text-muted line-through",
                  )}
                >
                  <Term k={rel}>{REL_LABEL[rel] ?? rel}</Term>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Canvas + detail rail */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="overflow-hidden rounded-xl border border-hairline bg-canvas/60">
          {!current ? (
            <EmptyCanvas label="Search to explore the graph." sub="Find a ticker, theme, thesis, lesson or source above to start." />
          ) : graph.isLoading ? (
            <Skeleton className="h-[420px] w-full" />
          ) : graph.isError ? (
            <EmptyCanvas label="Node not found." sub="Search for another above." />
          ) : graph.data ? (
            neighbors.length === 0 ? (
              <SoloNode node={graph.data.node} />
            ) : (
              <EgoGraphSvg
                key={graph.data.node.id}
                node={graph.data.node}
                neighbors={neighbors}
                relFilter={relFilter}
                onSelect={focus}
                onHover={setHover}
              />
            )
          ) : (
            <EmptyCanvas label="No graph yet." sub="Run an analysis — curation, theses and lessons build the graph." />
          )}
        </div>
        {graph.data && (
          <NodeDetailPanel node={graph.data.node} neighbors={neighbors} onNavigate={focus} />
        )}
      </div>

      {/* Legend */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[10px] text-text-muted">
        {LEGEND_TYPES.map((t) => {
          const s = nodeStyle(t);
          return (
            <span key={t} className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full" style={{ background: s.color }} />
              {s.label}
            </span>
          );
        })}
        <span className="ml-auto text-text-muted/70">click a node to re-center · hover for detail · open the rail for connections</span>
      </div>

      {hover && <GraphTooltip h={hover} />}
    </Card>
  );
}

/** A cursor-following tooltip (position: fixed) summarizing the hovered node. */
function GraphTooltip({ h }: { h: GraphHover }) {
  const s = nodeStyle(h.type);
  const summary = h.summary.length > 160 ? `${h.summary.slice(0, 159)}…` : h.summary;
  return (
    <div
      className="pointer-events-none fixed z-50 w-64 rounded-lg border border-hairline-strong bg-surface-2 px-3 py-2 shadow-pop"
      style={{ left: h.x + 14, top: h.y + 14 }}
    >
      <div className="flex items-center gap-1.5 text-[12px] font-medium text-text">
        <span style={{ color: s.color }}>{s.glyph}</span>
        <span className="truncate">{h.label}</span>
        <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-text-muted">{s.label}</span>
      </div>
      {summary && <p className="mt-1 text-[11px] leading-snug text-text-secondary">{summary}</p>}
      <p className="mt-1 text-[10px] text-text-muted">{h.clickable ? "click to re-center" : "no detail node"}</p>
    </div>
  );
}

function Breadcrumb({ path, onJump }: { path: string[]; onJump: (i: number) => void }) {
  if (path.length === 0) return <span className="text-[11px] text-text-muted">— select a node —</span>;
  return (
    <nav className="flex flex-wrap items-center gap-0.5 text-[11px]">
      {path.map((id, i) => {
        const { type, key } = parseNodeId(id);
        const last = i === path.length - 1;
        return (
          <span key={`${id}-${i}`} className="flex items-center gap-0.5">
            {i > 0 && <ChevronRight className="h-3 w-3 text-text-muted/60" />}
            <button
              onClick={() => onJump(i)}
              className={cn("max-w-[12rem] truncate", last ? "font-medium text-text" : "text-text-muted hover:text-text-secondary")}
              style={last ? { color: nodeStyle(type).color } : undefined}
              title={id}
            >
              {key}
            </button>
          </span>
        );
      })}
    </nav>
  );
}

function PickerRow({ node, onPick }: { node: KgNode; onPick: () => void }) {
  const s = nodeStyle(node.type);
  return (
    <button onClick={onPick} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[12px] transition-colors hover:bg-surface-3">
      <span style={{ color: s.color }}>{s.glyph}</span>
      <span className="truncate text-text-secondary">{node.label}</span>
      <span className="ml-auto shrink-0 text-[10px] uppercase tracking-wide text-text-muted">{s.label}</span>
    </button>
  );
}

function SoloNode({ node }: { node: KgNode }) {
  const s = nodeStyle(node.type);
  return (
    <div className="flex h-[420px] flex-col items-center justify-center gap-3">
      <div className="rounded-xl border-2 px-4 py-3 text-sm font-semibold text-text" style={{ borderColor: s.color, background: "#1E232B" }}>
        <span style={{ color: s.color }}>{s.glyph}</span> {node.label}
      </div>
      <p className="text-[12px] text-text-muted">No connections yet.</p>
    </div>
  );
}

function EmptyCanvas({ label, sub }: { label: string; sub: string }) {
  return (
    <div className="flex h-[420px] flex-col items-center justify-center gap-1.5 text-center">
      <p className="text-sm text-text-secondary">{label}</p>
      <p className="text-[12px] text-text-muted">{sub}</p>
    </div>
  );
}
