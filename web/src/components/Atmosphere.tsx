/**
 * Ambient background mesh — a few large, heavily-blurred color blobs drifting slowly
 * behind everything, so the canvas reads as softly lit rather than a flat void. The blobs
 * show through the page gutters around the solid panels. Purely decorative: fixed, behind
 * all content, and non-interactive.
 *
 * Motion is paused automatically under `prefers-reduced-motion` (see index.css), and the
 * whole layer is invisible to assistive tech.
 */
export function Atmosphere() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
    >
      {/* Accent blue — upper left, the dominant light source. */}
      <div
        className="absolute -left-[10%] -top-[15%] h-[42rem] w-[42rem] rounded-full opacity-[0.16] blur-[120px] animate-aurora-drift"
        style={{
          background:
            "radial-gradient(circle at center, #4F8DFD 0%, rgba(79,141,253,0) 70%)",
        }}
      />
      {/* Teal — upper right, cooler counterweight. */}
      <div
        className="absolute -right-[12%] top-[6%] h-[34rem] w-[34rem] rounded-full opacity-[0.10] blur-[120px] animate-aurora-drift"
        style={{
          animationDelay: "-9s",
          background:
            "radial-gradient(circle at center, #36C5CF 0%, rgba(54,197,207,0) 70%)",
        }}
      />
      {/* Violet — lower center, faint depth so the page doesn't fall off into black. */}
      <div
        className="absolute bottom-[-18%] left-[28%] h-[40rem] w-[40rem] rounded-full opacity-[0.08] blur-[130px] animate-aurora-drift"
        style={{
          animationDelay: "-17s",
          background:
            "radial-gradient(circle at center, #A78BFA 0%, rgba(167,139,250,0) 70%)",
        }}
      />
    </div>
  );
}
