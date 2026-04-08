import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./apps/atelier-desktop/src"),
      "@acme/ui/components": path.resolve(
        __dirname,
        "./packages/ui/src/components",
      ),
      "@acme/ui/lib": path.resolve(__dirname, "./packages/ui/src/lib"),
      "@acme/ui/icons": path.resolve(__dirname, "./packages/ui/src/icons"),
      "@acme/ui": path.resolve(__dirname, "./packages/ui/src"),
    },
  },
});
