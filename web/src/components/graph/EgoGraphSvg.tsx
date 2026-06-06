import { motion } from "framer-motion";
import type { KgNeighbor, KgNode } from "../../api/types.ts";
import { fallbackLabel, layoutNeighbors, nodeStyle, parseNodeId, REL_LABEL, relStyle } from "./nodeStyle.ts";

const W = 880;
const H = 560;
const CX = W / 2;
const CY = 282;
const R1 = 208;
const R2 = 138;
const CAP = 16;

/** The far node id of a neighbor relative to the focal node (handles in/out direction). */
function farId(n: KgNeighbor): string {
  return n.direction === "out" ? n.edge.dstId : n.edge.srcId;
}

/** Approx chip width from the label so text never overflows the rect (Geist ≈ 7px/char at 12px). */
function chipWidth(label: string, focal = false): number {
  const base = label.length * (focal ? 8 : 6.6) + 40;
  return Math.max(focal ? 96 : 72, Math.min(focal ? 220 : 184, base));
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

type ChipDatum = {
  key: string;
  id: string;
  type: string;
  label: string;
  summary: string;
  rel: string;
  direction: "in" | "out";
  x: number;
  y: number;
  clickable: boolean;
};

/**
 * The luminous ego graph: a glowing focal node, neighbors springing out into a constellation, and edges
 * drawn in like signal traces — colored by relationship family, arrowed by direction. Pure presentational
 * SVG (no data fetching), keyed by focal id upstream so every re-focus replays the entrance. Tuned to the
 * dashboard's graphite palette + chart colors.
 */
export function EgoGraphSvg({
  node,
  neighbors,
  relFilter,
  onSelect,
}: {
  node: KgNode;
  neighbors: KgNeighbor[];
  relFilter: ReadonlySet<string> | null;
  onSelect: (id: string) => void;
}) {
  const filtered = relFilter ? neighbors.filter((n) => relFilter.has(n.edge.rel)) : neighbors;
  const { positions, hiddenCount } = layoutNeighbors(filtered.length, { cx: CX, cy: CY, r1: R1, r2: R2, cap: CAP });

  const chips: ChipDatum[] = positions.map((p, i) => {
    const nb = filtered[i]!;
    const id = farId(nb);
    const meta = nb.node ?? { type: parseNodeId(id).type, label: fallbackLabel(id), summary: "" };
    return {
      key: nb.edge.id,
      id,
      type: meta.type,
      label: meta.label,
      summary: meta.summary ?? "",
      rel: nb.edge.rel,
      direction: nb.direction,
      x: p.x,
      y: p.y,
      clickable: nb.node != null,
    };
  });

  const focalStyle = nodeStyle(node.type);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full select-none" style={{ maxHeight: 560 }} role="img" aria-label={`Knowledge graph centered on ${node.label}`}>
      <defs>
        <radialGradient id="focal-glow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={focalStyle.color} stopOpacity="0.32" />
          <stop offset="55%" stopColor={focalStyle.color} stopOpacity="0.08" />
          <stop offset="100%" stopColor={focalStyle.color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id="canvas-vignette" cx="50%" cy="42%" r="70%">
          <stop offset="0%" stopColor="#11161D" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0B0D10" stopOpacity="0" />
        </radialGradient>
        <pattern id="dot-grid" width="26" height="26" patternUnits="userSpaceOnUse">
          <circle cx="1.2" cy="1.2" r="1.2" fill="#222934" />
        </pattern>
        {["#2E343D", "#4F8DFD", "#E3B341"].map((c) => (
          <marker key={c} id={`arrow-${c.slice(1)}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0,0 L8,4 L0,8 z" fill={c} />
          </marker>
        ))}
      </defs>

      {/* Atmosphere: dot-grid map texture + a soft vignette so the canvas reads as lit, not a flat void. */}
      <rect width={W} height={H} fill="url(#dot-grid)" opacity="0.5" />
      <rect width={W} height={H} fill="url(#canvas-vignette)" />
      <circle cx={CX} cy={CY} r={170} fill="url(#focal-glow)" />

      {/* Edges — drawn first so chips sit on top. Each is a gentle curve from the focal node to a neighbor. */}
      {chips.map((c, i) => {
        const rs = relStyle(c.rel);
        // Draw toward the destination so the arrowhead (marker-end) always points the right way.
        const [ax, ay, bx, by] = c.direction === "out" ? [CX, CY, c.x, c.y] : [c.x, c.y, CX, CY];
        const mx = (ax + bx) / 2;
        const my = (ay + by) / 2;
        // Perpendicular bow so overlapping radial lines separate a touch.
        const dx = bx - ax;
        const dy = by - ay;
        const len = Math.hypot(dx, dy) || 1;
        const qx = mx + (-dy / len) * 16;
        const qy = my + (dx / len) * 16;
        return (
          <g key={c.key}>
            <motion.path
              d={`M${ax},${ay} Q${qx},${qy} ${bx},${by}`}
              fill="none"
              stroke={rs.stroke}
              strokeWidth={1.5}
              strokeDasharray={rs.dash}
              markerEnd={`url(#arrow-${rs.stroke.slice(1)})`}
              initial={{ pathLength: 0, opacity: 0 }}
              animate={{ pathLength: 1, opacity: rs.family === "structural" ? 0.55 : 0.8 }}
              transition={{ duration: 0.45, delay: 0.12 + i * 0.025, ease: "easeOut" }}
            />
            <motion.text
              x={qx}
              y={qy}
              dy={-3}
              textAnchor="middle"
              className="fill-text-muted"
              style={{ fontSize: 9 }}
              initial={{ opacity: 0 }}
              animate={{ opacity: 0.85 }}
              transition={{ delay: 0.3 + i * 0.025 }}
            >
              {REL_LABEL[c.rel] ?? c.rel}
            </motion.text>
          </g>
        );
      })}

      {/* Neighbor chips — spring out from the center into their ring positions, staggered. */}
      {chips.map((c, i) => (
        <Chip key={c.key} c={c} index={i} onSelect={onSelect} />
      ))}

      {/* Focal node — larger, ringed, with a slow breathing glow. */}
      <FocalChip node={node} color={focalStyle.color} glyph={focalStyle.glyph} />

      {/* No silent truncation: surface what the cap dropped. */}
      {hiddenCount > 0 && (
        <text x={CX} y={H - 16} textAnchor="middle" className="fill-text-muted" style={{ fontSize: 11 }}>
          +{hiddenCount} more — filter by relationship to see them
        </text>
      )}
    </svg>
  );
}

function FocalChip({ node, color, glyph }: { node: KgNode; color: string; glyph: string }) {
  const label = truncate(node.label, 22);
  const w = chipWidth(label, true);
  const h = 44;
  return (
    <g transform={`translate(${CX - w / 2}, ${CY - h / 2})`}>
      <title>{`${node.label}${node.summary ? ` — ${node.summary}` : ""} · ${node.type}`}</title>
      <motion.rect
        x={-5}
        y={-5}
        width={w + 10}
        height={h + 10}
        rx={14}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        animate={{ opacity: [0.5, 0.18, 0.5] }}
        transition={{ duration: 2.4, repeat: Infinity, ease: "easeInOut" }}
      />
      <rect width={w} height={h} rx={11} fill="#1E232B" stroke={color} strokeWidth={2} />
      <text x={16} y={h / 2} dy="0.32em" style={{ fontSize: 17, fontWeight: 700 }} fill={color}>
        {glyph}
      </text>
      <text x={38} y={h / 2} dy="0.32em" style={{ fontSize: 14, fontWeight: 650 }} className="fill-text">
        {label}
      </text>
    </g>
  );
}

function Chip({ c, index, onSelect }: { c: ChipDatum; index: number; onSelect: (id: string) => void }) {
  const style = nodeStyle(c.type);
  const label = truncate(c.label, 18);
  const w = chipWidth(label);
  const h = 30;
  return (
    <motion.g
      initial={{ opacity: 0, x: CX - c.x, y: CY - c.y, scale: 0.5 }}
      animate={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      transition={{ type: "spring", stiffness: 220, damping: 24, delay: 0.1 + index * 0.03 }}
      style={{ cursor: c.clickable ? "pointer" : "default", originX: c.x, originY: c.y }}
      whileHover={c.clickable ? { scale: 1.07 } : undefined}
      onClick={c.clickable ? () => onSelect(c.id) : undefined}
    >
      <g transform={`translate(${c.x - w / 2}, ${c.y - h / 2})`}>
        <title>{`${c.label}${c.summary ? ` — ${c.summary}` : ""} · ${style.label}${c.clickable ? "" : " (no detail)"}`}</title>
        <rect
          width={w}
          height={h}
          rx={8}
          fill="#181C22"
          stroke={style.color}
          strokeWidth={1.5}
          strokeOpacity={c.clickable ? 0.9 : 0.4}
          strokeDasharray={c.clickable ? undefined : "4 3"}
        />
        {/* A colored notch on the left edge keeps the type readable even when the glyph is subtle. */}
        <rect width={3} height={h} rx={1.5} fill={style.color} fillOpacity={c.clickable ? 0.9 : 0.45} />
        <text x={13} y={h / 2} dy="0.32em" style={{ fontSize: 12 }} fill={style.color} fillOpacity={c.clickable ? 1 : 0.6}>
          {style.glyph}
        </text>
        <text
          x={28}
          y={h / 2}
          dy="0.32em"
          style={{ fontSize: 11.5 }}
          className={c.clickable ? "fill-text-secondary" : "fill-text-muted"}
        >
          {label}
        </text>
      </g>
    </motion.g>
  );
}
