import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const webRoot = resolve(import.meta.dirname, ".");
const repoRoot = resolve(import.meta.dirname, "..");

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  resolve: {
    // Share backend domain/contract TYPES with the frontend (single source of truth).
    alias: { "@shared": resolve(repoRoot, "src") },
  },
  server: {
    port: 5173,
    fs: { allow: [repoRoot] },
    proxy: { "/api": "http://localhost:8787" },
  },
  build: {
    outDir: resolve(repoRoot, "dist/web"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Split heavy, rarely-changing vendor libs into their own cacheable chunks so the app chunk
        // stays small and a redeploy doesn't bust the whole bundle. Charts/motion/markdown are the bulk.
        manualChunks(id) {
          if (!id.includes("node_modules")) return;
          if (id.includes("recharts") || id.includes("/d3-")) return "charts";
          if (id.includes("framer-motion")) return "motion";
          // React core in its own chunk — self-contained (no edges back to vendor), so other chunks
          // depend on it one-directionally and there's no circular-chunk warning.
          if (/[/\\]node_modules[/\\](react-dom|react|scheduler)[/\\]/.test(id)) return "react";
          if (id.includes("@radix-ui")) return "radix";
          if (id.includes("@tanstack")) return "query";
          return "vendor";
        },
      },
    },
  },
});
