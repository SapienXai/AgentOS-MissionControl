import path from "node:path";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopRoot = import.meta.dirname;

export default defineConfig({
  root: path.resolve(desktopRoot),
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: "127.0.0.1",
    hmr: { protocol: "ws", host: "127.0.0.1", port: 1421 }
  },
  envDir: path.resolve(desktopRoot, "../.."),
  resolve: {
    alias: {
      "@": path.resolve(desktopRoot, "../..")
    }
  },
  plugins: [react()],
  build: {
    outDir: path.resolve(desktopRoot, "dist"),
    emptyOutDir: true,
    sourcemap: false
  }
});
