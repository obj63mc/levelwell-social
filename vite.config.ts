import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "./src"),
    },
  },
  // Prevent Vite from obscuring Rust errors
  clearScreen: false,
  server: {
    // Must match build.devUrl in src-tauri/tauri.conf.json
    port: 5173,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  // Expose Tauri env vars to the frontend alongside VITE_*
  envPrefix: ["VITE_", "TAURI_ENV_*"],
  // A published release must ship with no deployment baked in — users point the
  // app at their own Convex backend on first launch. Vite loads .env.local in
  // *every* mode, so blanking the vars here is what actually guarantees it.
  define:
    mode === "release"
      ? {
          "import.meta.env.VITE_CONVEX_URL": "undefined",
          "import.meta.env.VITE_CONVEX_SITE_URL": "undefined",
        }
      : {},
  build: {
    // macOS webview is WebKit; macOS 13 (our minimum) ships Safari 16
    target: "safari16",
    minify: !process.env.TAURI_ENV_DEBUG ? "esbuild" : false,
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
}));
