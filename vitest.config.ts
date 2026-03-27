import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./apps/atelier-desktop/src"),
      "~": path.resolve(__dirname, "./apps/atelier-desktop/src"),
      "@acme/ui/components": path.resolve(__dirname, "./@acme/ui/src/components"),
      "@acme/ui/shadcn": path.resolve(__dirname, "./@acme/ui/src/shadcn"),
      "@acme/ui/lib": path.resolve(__dirname, "./@acme/ui/src/lib"),
      "@acme/ui/icons": path.resolve(__dirname, "./@acme/ui/src/icons"),
      "@acme/ui/src": path.resolve(__dirname, "./@acme/ui/src"),
      "@acme/ui": path.resolve(__dirname, "./@acme/ui/src"),
    },
  },
});
