import { describe, expect, it } from "vitest";

import type { ServiceDef, ServiceKind } from "../../lib/services-client";
import { inferServiceIcon, resolveServiceIcon } from "./service-icon";

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

describe("resolveServiceIcon", () => {
  const favicon = "data:image/svg+xml;base64,PHN2Zy8+";

  it("prefers an explicit icon over the favicon", () => {
    expect(
      resolveServiceIcon(makeDef({ cmd: "pnpm dev", icon: "server" }), favicon),
    ).toEqual({ type: "icon", name: "server" });
  });

  it("uses the favicon when there is no explicit icon", () => {
    expect(resolveServiceIcon(makeDef({ cmd: "pnpm dev" }), favicon)).toEqual({
      type: "image",
      src: favicon,
    });
  });

  it("draws the fetched icon of an icon: site", () => {
    const stripe = makeDef({
      cmd: "stripe listen",
      icon: "https://stripe.com",
    });
    expect(resolveServiceIcon(stripe, favicon)).toEqual({
      type: "image",
      src: favicon,
    });
    // Not fetched yet (or the site has none): the inferred icon.
    expect(resolveServiceIcon(stripe, null)).toEqual({
      type: "icon",
      name: "terminal",
    });
  });

  it("uses the favicon when the explicit icon is unknown", () => {
    expect(
      resolveServiceIcon(makeDef({ cmd: "pnpm dev", icon: "rocket" }), favicon),
    ).toEqual({ type: "image", src: favicon });
  });

  it("falls back to the inferred icon without a favicon", () => {
    expect(resolveServiceIcon(makeDef({ cmd: "supabase start" }), null)).toEqual(
      { type: "icon", name: "database" },
    );
  });

  it("refuses favicons that are not image data URLs", () => {
    for (const src of [
      "http://localhost:3000/favicon.ico",
      "data:text/html;base64,PGgxPg==",
      "javascript:alert(1)",
    ]) {
      expect(resolveServiceIcon(makeDef({ kind: "remote" }), src)).toEqual({
        type: "icon",
        name: "cloud",
      });
    }
  });
});
