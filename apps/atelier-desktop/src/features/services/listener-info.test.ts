import { describe, expect, it } from "vitest";

import type { KnownListener, Listener } from "../../lib/services-client";
import {
  describeListener,
  groupListeners,
  SYSTEM_GROUP,
} from "./listener-info";

const listener = (over: Partial<Listener>): Listener => ({
  pid: 1,
  command: "x",
  address: "127.0.0.1",
  port: 1,
  cwd: null,
  exe: null,
  app: null,
  system: false,
  launchdLabel: null,
  launchdPlist: null,
  ...over,
});

const rapportd = listener({
  command: "rapportd",
  port: 54931,
  exe: "/usr/libexec/rapportd",
  system: true,
  launchdLabel: "com.apple.rapportd",
});
const agTools = listener({
  command: "antigravi",
  port: 8045,
  exe: "/Applications/Antigravity Tools.app/Contents/MacOS/antigravity-tools",
  app: "Antigravity Tools",
});
const socat = listener({
  command: "socat1",
  port: 8045,
  exe: "/opt/homebrew/bin/socat",
  launchdLabel: "dev.vyductan.antigravity-relay",
});
const cloudflared = listener({
  command: "cloudflar",
  port: 20242,
  exe: "/Users/me/.antigravity_tools/bin/cloudflared",
  app: "Antigravity Tools",
});

describe("describeListener", () => {
  it("groups macOS executables apart and folds them away, with a built-in note", () => {
    expect(describeListener(rapportd, [])).toMatchObject({
      group: SYSTEM_GROUP,
      hidden: true,
      note: expect.stringContaining("Continuity"),
    });
  });

  it("falls back to the app bundle for the group and the launchd job or exe for the note", () => {
    expect(describeListener(agTools, [])).toMatchObject({
      group: "Antigravity Tools",
      note: agTools.exe,
      hidden: false,
    });
    expect(describeListener(socat, [])).toMatchObject({
      group: "socat1",
      note: "launchd: dev.vyductan.antigravity-relay",
    });
  });

  it("applies a services.yaml note, matching lsof's name or the exe file name", () => {
    const known: KnownListener[] = [
      {
        match: { command: "socat", port: 8045 },
        note: "relay",
        group: "Antigravity Tools",
      },
    ];
    expect(describeListener(socat, known)).toMatchObject({
      group: "Antigravity Tools",
      note: "relay",
    });
    expect(describeListener({ ...socat, port: 9000 }, known).note).not.toBe(
      "relay",
    );
  });

  it("lets services.yaml override built-ins, including hide", () => {
    const known: KnownListener[] = [
      { match: { label: "com.apple.rapportd" }, note: "mine", hide: false },
    ];
    expect(describeListener(rapportd, known)).toMatchObject({
      note: "mine",
      hidden: false,
    });
  });

  it("ignores an entry with no criteria", () => {
    expect(
      describeListener(socat, [{ match: {}, note: "everything" }]).note,
    ).not.toBe("everything");
  });
});

describe("groupListeners", () => {
  it("puts processes of one app together and the hidden ones apart", () => {
    const known: KnownListener[] = [
      { match: { command: "socat1" }, group: "Antigravity Tools" },
    ];
    const { visible, hidden } = groupListeners(
      [cloudflared, rapportd, socat, agTools],
      known,
    );
    expect(visible).toHaveLength(1);
    expect(visible[0]?.name).toBe("Antigravity Tools");
    expect(visible[0]?.listeners.map((d) => d.listener.command)).toEqual([
      "antigravi",
      "socat1",
      "cloudflar",
    ]);
    expect(hidden.map((g) => g.name)).toEqual([SYSTEM_GROUP]);
  });
});
