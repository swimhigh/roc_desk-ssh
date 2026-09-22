import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// This frontend only serves the standalone/ Tauri shell -- the build output
// must land in standalone/dist (tauri.conf.json's build.frontendDist points
// there), not in a dist/ folder next to src-web itself.
export default defineConfig({
  plugins: [react()],
  root: __dirname,
  build: {
    outDir: path.resolve(__dirname, "../standalone/dist"),
    emptyOutDir: true,
  },
  clearScreen: false,
});
