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
  build: { outDir: resolve(repoRoot, "dist/web"), emptyOutDir: true },
});
