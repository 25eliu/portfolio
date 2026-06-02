/**
 * Dev runner: starts the backend (Bun, watch) and the Vite frontend together.
 *   bun run dev
 */
const procs = [
  // No --watch on the backend: an analysis run takes minutes, and a watch-triggered restart
  // mid-run would abandon it (runs.abandonRunning marks it "error: abandoned (server restart)").
  // Restart the backend manually after backend edits. The UI keeps Vite hot-reload below.
  Bun.spawn(["bun", "src/server/index.ts"], { stdout: "inherit", stderr: "inherit" }),
  Bun.spawn(["bunx", "vite", "--config", "web/vite.config.ts"], {
    stdout: "inherit",
    stderr: "inherit",
  }),
];

const shutdown = () => {
  for (const p of procs) p.kill();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

await Promise.all(procs.map((p) => p.exited));
