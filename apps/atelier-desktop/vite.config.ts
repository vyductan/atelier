import path from "path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],

  // Prevent vite from clearing the screen
  clearScreen: false,

  // Tauri expects a fixed port
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      // Tell vite to ignore watching `src-tauri`
      ignored: ["**/src-tauri/**"],
    },
  },

  // Tauri uses env vars that start with VITE_ or TAURI_
  envPrefix: ["VITE_", "TAURI_"],

  build: {
    // Tauri uses Chromium on Windows and WebKit on macOS and Linux
    target: process.env.TAURI_PLATFORM === "windows" ? "chrome105" : "safari13",
    // Don't minify for debug builds
    minify: !process.env.TAURI_DEBUG ? "esbuild" : false,
    // Produce sourcemaps for debug builds
    sourcemap: !!process.env.TAURI_DEBUG,
  },

  resolve: {
    // One React for the app and its UI libraries: a second copy (e.g. a stale
    // hoisted one next to @dnd-kit) makes every hook call fail ("Invalid hook call").
    dedupe: ["react", "react-dom"],
    alias: {
      "~": path.resolve(__dirname, "./src"),
      "@acme/ui": path.resolve(__dirname, "../../@acme/ui/src"),
    },
  },

  test: {
    include: [
      "src/**/*.{test,spec}.?(c|m)[jt]s?(x)",
      "src/**/*-test.?(c|m)[jt]s?(x)",
    ],
  },
});
