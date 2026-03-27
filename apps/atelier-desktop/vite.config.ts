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
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "~": path.resolve(__dirname, "./src"),
      "@acme/ui/components": path.resolve(
        __dirname,
        "../../@acme/ui/src/components",
      ),
      "@acme/ui/shadcn": path.resolve(__dirname, "../../@acme/ui/src/shadcn"),
      "@acme/ui/lib": path.resolve(__dirname, "../../@acme/ui/src/lib"),
      "@acme/ui/icons": path.resolve(__dirname, "../../@acme/ui/src/icons"),
      "@acme/ui/src": path.resolve(__dirname, "../../@acme/ui/src"),
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
