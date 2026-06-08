import { useMemo } from "react";
import type { KgNeighbor, KgNode } from "../../api/types.ts";
import { cn } from "../../lib/cn.ts";
import { fallbackLabel, nodeStyle, parseNodeId, REL_LABEL } from "./nodeStyle.ts";

/**
 * The detail rail beside the canvas — what makes a node "enterable". For the focal node it shows the
 * canonical summary, a few metadata fields, and its connections grouped by neighbor type (the linked AI
 * knowledge: theses, sources, themes, sectors, lessons…). Every resolvable connection is a button that
 * re-centers the graph, so the panel is also a second way to navigate. Pure presentational — it reads the
 * `useGraphNode` payload the canvas already fetched, no extra request.
 */

/** Priority order so the most useful connection groups sit at the top. */
const TYPE_ORDER = ["ticker", "sector", "theme", "strategy_family", "thesis", "lesson", "source", "concept", "tag"];

type Conn = { id: string; type: string; label: string; rel: string; clickable: boolean };

function farId(n: KgNeighbor): string {
  return n.direction === "out" ? n.edge.dstId : n.edge.srcId;
}

/** Pull primitive metadata fields worth showing (skip objects/arrays and empty values). */
function metaFields(data: Record<string, unknown>): [string, string][] {
  return Object.entries(data)
    .filter(([, v]) => v != null && (typeof v === "string" || typeof v === "number" || typeof v === "boolean"))
    .filter(([, v]) => String(v).trim() !== "")
    .slice(0, 6)
    .map(([k, v]) => [k, String(v)]);
}

export function NodeDetailPanel({
  node,
  neighbors,
  onNavigate,
}: {
  node: KgNode;
  neighbors: KgNeighbor[];
  onNavigate: (id: string) => void;
}) {
  const s = nodeStyle(node.type);
  const fields = useMemo(() => metaFields(node.data ?? {}), [node.data]);

  // Group connections by the far node's type, deduped by id (an entity can be reached by >1 relation).
  const groups = useMemo(() => {
    const byId = new Map<string, Conn>();
    for (const n of neighbors) {
      const id = farId(n);
      if (byId.has(id)) continue;
      const meta = n.node ?? { type: parseNodeId(id).type, label: fallbackLabel(id) };
      byId.set(id, { id, type: meta.type, label: meta.label, rel: n.edge.rel, clickable: n.node != null });
    }
    const map = new Map<string, Conn[]>();
    for (const c of byId.values()) {
      const arr = map.get(c.type) ?? [];
      arr.push(c);
      map.set(c.type, arr);
    }
    return [...map.entries()].sort(
      (a, b) => (TYPE_ORDER.indexOf(a[0]) + 1 || 99) - (TYPE_ORDER.indexOf(b[0]) + 1 || 99),
    );
  }, [neighbors]);

  return (
    <aside className="flex h-[420px] flex-col gap-3 overflow-y-auto rounded-xl border border-hairline bg-surface-2/40 p-3.5">
      <header>
        <div className="flex items-center gap-2">
          <span className="text-base" style={{ color: s.color }}>{s.glyph}</span>
          <h3 className="text-sm font-semibold text-text">{node.label}</h3>
        </div>
        <span className="mt-1 inline-block rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide" style={{ borderColor: `${s.color}55`, color: s.color }}>
          {s.label}
        </span>
      </header>

      {node.summary ? (
        <p className="text-[12px] leading-relaxed text-text-secondary">{node.summary}</p>
      ) : (
        <p className="text-[12px] italic text-text-muted">No summary yet.</p>
      )}

      {fields.length > 0 && (
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[11px]">
          {fields.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-text-muted">{k}</dt>
              <dd className="truncate text-text-secondary" title={v}>{v}</dd>
            </div>
          ))}
        </dl>
      )}

      <div className="mt-auto flex flex-col gap-2.5">
        {groups.length === 0 ? (
          <p className="text-[11px] text-text-muted">No connections yet.</p>
        ) : (
          groups.map(([type, conns]) => {
            const gs = nodeStyle(type);
            return (
              <div key={type}>
                <div className="mb-1 flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted">
                  <span style={{ color: gs.color }}>{gs.glyph}</span>
                  {gs.label}
                  <span className="text-text-muted/60">· {conns.length}</span>
                </div>
                <ul className="flex flex-col gap-0.5">
                  {conns.map((c) => (
                    <li key={c.id}>
                      <button
                        type="button"
                        disabled={!c.clickable}
                        onClick={() => c.clickable && onNavigate(c.id)}
                        className={cn(
                          "flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-[12px] transition-colors",
                          c.clickable ? "text-text-secondary hover:bg-surface-3 hover:text-text" : "cursor-default text-text-muted/70",
                        )}
                        title={c.id}
                      >
                        <span className="truncate">{c.label}</span>
                        <span className="ml-auto shrink-0 text-[10px] text-text-muted">{REL_LABEL[c.rel] ?? c.rel}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
