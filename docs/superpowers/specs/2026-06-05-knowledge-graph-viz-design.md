# Knowledge-Graph Visualization — Design / Implementation Plan

_Date: 2026-06-05 · Status: planned (not started) · Owner: Eric_

## Context

The platform is built on a knowledge-graph substrate (`kg_nodes` / `kg_edges`, §5a of the architecture
doc): tickers, sectors, themes, strategy families, lessons, sources, theses, and metrics are all
canonical nodes connected by typed edges (`belongs_to`, `tagged_with`, `cites`, `derived_from`,
`supports`, `supersedes`, …). The read-only API to traverse it already exists and is exercised by the
backend, but **nothing renders it** — `graphNode()` is defined in the web client and never called, and
there is no graph component anywhere in `web/`. This is the single biggest explainability gap: a user
cannot *see* how a recommendation, its evidence, its sector calibration, and the lessons learned connect.

This plan is **Plan 2, slice 2** of the explainability arc. Slice 1 (deliberation + calibration chain +
glossary tooltips) shipped. The calibration chain already exposes the *cohort* relationships in text;
this slice makes the whole graph **visual and navigable**.

**Decided with user:** hand-rolled SVG, **no new dependencies** (keep the bundle lean for an OSS
showcase). A focused node-neighborhood ("ego graph") explorer with click-to-recenter — not a full
physics force-directed layout. **Frame: a full-width dashboard section** (like Journal / Wiki), toolbar on
top, legend along the bottom. **Nodes: colored label chips** (rounded-rect, label always legible, colored
+ faintly icon'd by type; focal chip is larger with a ring).

## Goal & scope

A **Knowledge Graph** dashboard panel that lets a person start from any entity (a ticker, sector, theme,
lesson, thesis, or source) and **walk the connections**: the focal node sits at the center, its direct
neighbors fan out radially, edges are drawn and labeled by relationship, and clicking any neighbor
re-centers on it. Plus **deep links** from existing surfaces ("view in graph" on a recommendation,
journal entry, wiki lesson, and Market View thesis) so the graph is reached in context, not in isolation.

### Non-goals (this slice)
- No force-directed physics / global "whole graph at once" view (an ego graph is clearer and cheaper).
- No graph editing — read-only, like the API.
- No new backend tables or model changes. One small optional query param is the only server change.
- No new npm dependency.

## Data & API (mostly already there)

- `GET /api/graph/node/:id` → `{ node: KgNode, neighbors: KgNeighbor[] }` where
  `KgNeighbor = { edge: KgEdge, node: KgNode | null, direction: "out" | "in" }`. **Exists.**
- `GET /api/graph/nodes?type=<type>` → `{ nodes: KgNode[] }` (capped). **Exists** — used for the focal-node
  picker.
- Node types: `ticker, sector, theme, catalyst, concept, strategy_family, signal, source, lesson, metric,
  cohort, tag, thesis`. Edge rels: `tagged_with, mentions, cites, derived_from, supports, contradicts,
  belongs_to, supersedes, in_cohort, related_to`.
- Node ids are stable slugs (`ticker:aapl`, `sector:information-technology`, `lesson:all_time:overall`).
  Deep links build the id with the existing `nodeId(type, key)` convention (the slug rule: lowercase,
  non-alphanumeric → `-`).
- **`belongs_to` (ticker→sector) is now materialized** during journaling (fixed earlier this session), so
  sector clusters are populated: a ticker chip links to its sector, and the sector node **back-links** to
  every ticker in it (`neighbors(direction: "in")`) — ideal for "show the rest of this sector".
- **Small optional server add:** a `q` substring filter on `GET /api/graph/nodes` (`?type=ticker&q=nv`)
  so the picker can search by label without pulling every node. If skipped, the client filters the
  capped list in-memory for v1 (acceptable, but log/label any cap).

## UX design

### Frame (full-width section)

A `card` section titled **Knowledge Graph**, sitting in the dashboard alongside Journal / Wiki. Three bands:

```
┌─ Knowledge Graph ───────────────[ticker ▾][search…]─┐
│ Home › sector:Semis › NVDA      [relations ▾] [← back]│   ← toolbar
│                                                       │
│          ○ AI-infra            ◇ momentum             │
│            \ tagged_with     supports /               │
│   □ source ──mentions──▶  ⬢ NVDA  ◀──belongs_to── ▣ Semis │   ← SVG ego graph
│              cites /        │  \ supports              │
│            ◆ forecast   derived △ lesson              │
│ ● ticker ● sector ● theme ● lesson ● source  +3 ▾    │   ← legend
└───────────────────────────────────────────────────────┘
```

- **Toolbar:** focal-node **picker** (type dropdown defaulting to `ticker` + search box that queries
  `/graph/nodes?type=`), a **breadcrumb** of the visited path (each crumb clickable), a **relations
  filter** (multiselect of edge rels, default all), and a **back** button (pops the breadcrumb stack).
- **Canvas:** the SVG ego graph (below).
- **Legend:** node-type color key; overflow types collapse under "+N ▾".

### Visual encoding (colored label chips)

- **Nodes = rounded-rect chips.** Label = `node.label`, truncated to ~18 chars with a hover tooltip
  showing the full label + `node.summary` + type. A small leading glyph per type. The **focal** chip is
  larger, centered, and gets a ring; neighbors are standard size.
- **Type → color** (`NODE_TYPE_STYLE`, reusing the theme tokens used by `Badge`):

  | type | tone | glyph | | type | tone | glyph |
  |---|---|---|---|---|---|---|
  | ticker | accent | ⬢ | | source | muted | □ |
  | sector | blue | ▣ | | lesson | amber | △ |
  | theme | violet | ○ | | thesis | green | ◇ |
  | strategy_family | teal | ◇ | | metric | muted | ▭ |
  | catalyst / signal / concept / tag / cohort | neutral | · | | | | |

- **Null-node neighbors.** Some edges point at an id with **no canonical `kg_nodes` row** (e.g.
  `derived_from → forecast:<id>` — `forecast` isn't a node type), so `KgNeighbor.node` is `null`. Render a
  **faded chip derived from the edge's far id** (type = slug prefix before `:`, label = the suffix); it's
  non-clickable (nothing to expand). Never drop the edge silently — the connection is real.
- **Edges = lines** from focal to each neighbor, with:
  - an **arrowhead** encoding `direction` (`out` points away from focal, `in` points back toward it);
  - a short **rel label** at the line midpoint (abbreviated — `belongs_to`→"in", `tagged_with`→"tag",
    `derived_from`→"from", `supersedes`→"replaces", …; full name on hover);
  - line style by rel family: structural (`belongs_to`, `tagged_with`, `mentions`) solid; provenance
    (`cites`, `derived_from`, `supports`) solid accent; conflict (`contradicts`, `supersedes`) dashed.

### Interaction

- **Click a neighbor chip** → it becomes the new focal (fetch its node + neighbors, push the old focal
  onto the breadcrumb). No full-page nav; the canvas re-lays-out in place.
- **Breadcrumb / back** → re-focus any earlier node; back pops one level.
- **Hover** a chip → tooltip (full label + summary + type); hover an edge → full relationship name.
- **Relations filter** → hide/show neighbor sets by rel to tame dense hubs.
- **No silent truncation:** neighbors are capped per render (≈16). If more exist, show the kept count and
  a **"+N more — filter by relationship"** chip; never a quiet cut. (Mirrors the project's
  no-silent-caps rule.)

### Entry points

- The **Knowledge Graph** section in `App.tsx`, with the focal-node picker (defaults to a sensible node —
  e.g. the first held ticker, else `overall`).
- **Deep links** — a small "View in graph →" affordance that sets the focal node and scrolls to the
  section: on `RecommendationCard` + `Journal` rows (`ticker:<sym>`), `Wiki` lessons (`lesson:<id>`), and
  `MarketView` theses / sectors (`thesis:*` / `sector:*`). App owns the focal-node state so any surface
  can set it via a shared `onViewInGraph(nodeId)` callback.

### Empty / error / loading states

- Isolated node (no neighbors) → render the focal chip alone with "No connections yet."
- Unknown id → "Node not found" with a reset-to-picker action.
- Loading → a skeleton ring of placeholder chips.

## Components & files

- `web/src/api/client.ts` — add `graphNodes(type?, q?)`; `graphNode(id)` already exists.
- `web/src/api/hooks.ts` — `useGraphNode(id)`, `useGraphNodes(type, q)` (TanStack Query).
- `web/src/components/KnowledgeGraph.tsx` — the panel: focal-node picker, breadcrumb, legend, filter,
  and the SVG canvas. Keep it focused; if it grows past ~300 lines, split out:
  - `web/src/components/graph/EgoGraphSvg.tsx` — pure presentational SVG (focal + neighbors + edges),
    props: `{ node, neighbors, onSelect, filter }`. Easy to unit/visually test in isolation.
  - `web/src/components/graph/nodeStyle.ts` — `NODE_TYPE_STYLE` (color/icon/label) and `REL_LABEL` maps,
    plus the radial-layout helper `layoutNeighbors(n, opts)` (pure, unit-testable).
- `web/src/components/graph/layout.test.ts` — unit-test the layout math (angles, ring split, cap +
  remainder count) since it's pure and the visual correctness hinges on it.
- `web/src/App.tsx` — mount the new section + own the focal-node state so deep links can set it.
- Deep-link buttons in `RecommendationCard.tsx`, `Journal.tsx`, `Wiki.tsx`, `MarketView.tsx` (one small
  "view in graph" affordance each), calling a shared `onViewInGraph(nodeId)` passed from `App`.
- `web/src/lib/glossary.ts` — add short defs for a few relationship terms surfaced in the legend
  (`belongs_to`, `derived_from`, `supports`, `supersedes`) via the existing `Term` tooltip.

## Layout math (the one tricky bit)

```
layoutNeighbors(n, { cx, cy, r1, r2, cap }):
  shown = min(n, cap); hiddenCount = n - shown
  for i in 0..shown-1:
    ring = (shown > 10 && i % 2) ? r2 : r1
    theta = -PI/2 + (i / shown) * 2*PI
    x = cx + ring*cos(theta); y = cy + ring*sin(theta)
  return { positions, hiddenCount }
```

Deterministic (no `Math.random`), so it unit-tests cleanly and renders stably across re-fetches.

## Verification

1. **Unit** (`layout.test.ts`): N nodes → N positions on the expected ring(s); cap respected;
   `hiddenCount` correct; angles deterministic.
2. **Build:** `bun run build:web` clean (watch the bundle-size note — this is SVG/React only, no new dep).
3. **Live/offline run:** after a `dailyRun` (the graph is populated by curation, theses, and lessons),
   open the Knowledge Graph panel, focus a ticker, and confirm its `belongs_to → sector`,
   `tagged_with`/`mentions → source`, and any `supports → lesson` neighbors render and are clickable;
   step in and back via the breadcrumb. Confirm deep links from a recommendation card and a wiki lesson
   land on the right focal node.
4. **Dense-hub check:** focus a busy `overall`/sector node and confirm the cap + "+N more" affordance
   shows (no silent truncation) and the relationship filter narrows it.

## Follow-on (later, not this slice)
- Optional `q` server-side search if the in-memory picker filter proves limiting.
- A "path between two nodes" view; edge weights as line thickness; a force layout only if the ego graph
  proves insufficient.
- Slice 3 of the arc: README / showcase polish (demo GIF of the graph), repo tidy.
