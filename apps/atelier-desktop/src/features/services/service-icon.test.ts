import { describe, expect, it } from "vitest";

import type { ServiceDef, ServiceKind } from "../../lib/services-client";
import { inferServiceIcon } from "./service-icon";

function makeDef({
  kind = "process",
  cmd = null,
  icon = null,
}: {
  kind?: ServiceKind;
  cmd?: string | null;
  icon?: string | null;
}): ServiceDef {
  return {
    id: "svc",
    kind,
    name: null,
    group: null,
    cwd: null,
    cmd,
    stop_cmd: null,
    port: null,
    health: null,
    url: null,
    label: null,
    log: null,
    icon,
    env: {},
    keep_alive: false,
  };
}

describe("inferServiceIcon", () => {
  describe("explicit icon", () => {
    it("uses a known icon from services.yaml", () => {
      expect(inferServiceIcon(makeDef({ cmd: "pnpm dev", icon: "server" }))).toBe(
        "server",
      );
    });

    it("is case- and whitespace-insensitive", () => {
      expect(inferServiceIcon(makeDef({ icon: " Database " }))).toBe("database");
    });

    it("falls back to inference for an unknown icon", () => {
      expect(
        inferServiceIcon(makeDef({ cmd: "supabase start", icon: "rocket" })),
      ).toBe("database");
    });

    it("ignores prototype keys", () => {
      expect(inferServiceIcon(makeDef({ icon: "constructor" }))).toBe("terminal");
    });
  });

  describe("inferred from kind", () => {
    it("uses cloud for remote services", () => {
      expect(inferServiceIcon(makeDef({ kind: "remote" }))).toBe("cloud");
    });

    it("uses cog for existing launchd agents", () => {
      expect(inferServiceIcon(makeDef({ kind: "launchd" }))).toBe("cog");
    });
  });

  describe("inferred from cmd", () => {
    it.each([
      ["supabase start", "database"],
      ["docker compose up -d", "container"],
      ["docker-compose up", "container"],
      ["pnpm storybook --ci", "book-open"],
      ["pnpm dev:web", "globe"],
      ["pnpm dev --port 5190 --strictPort", "globe"],
      ["npm run dev", "globe"],
      ["bun dev", "globe"],
      ["vite --host", "globe"],
      ["next dev", "globe"],
      ["python -m http.server", "terminal"],
    ] as const)("%s → %s", (cmd, icon) => {
      expect(inferServiceIcon(makeDef({ cmd }))).toBe(icon);
    });

    it("prefers the specific tool over the generic dev-server rule", () => {
      // `pnpm dev` alone is a web app, but here the script starts Supabase.
      expect(inferServiceIcon(makeDef({ cmd: "pnpm dev && supabase start" }))).toBe(
        "database",
      );
    });

    it("does not match tool names inside other words", () => {
      expect(inferServiceIcon(makeDef({ cmd: "./nextcloud-sync" }))).toBe(
        "terminal",
      );
    });

    it("uses terminal when there is no cmd", () => {
      expect(inferServiceIcon(makeDef({}))).toBe("terminal");
    });
  });
});
