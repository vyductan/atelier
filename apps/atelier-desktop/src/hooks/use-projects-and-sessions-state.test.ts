import { describe, expect, it } from "vitest";

import {
  buildProjectGroupResult,
  shouldInvalidateProjectsAndSessions,
  sortSessionEntriesByModified,
} from "./use-projects-and-sessions-state";

describe("sortSessionEntriesByModified", () => {
  it("sorts newest sessions first", () => {
    const sorted = sortSessionEntriesByModified([
      {
        fullPath: "/tmp/older",
        fileMtime: 1,
        messageCount: 0,
        firstPrompt: "older",
        modified: "2026-03-01T10:00:00.000Z",
        created: "2026-03-01T09:00:00.000Z",
        projectPath: "/tmp/project",
        sessionId: "older",
        isSidechain: false,
      },
      {
        fullPath: "/tmp/newer",
        fileMtime: 2,
        messageCount: 0,
        firstPrompt: "newer",
        modified: "2026-03-02T10:00:00.000Z",
        created: "2026-03-02T09:00:00.000Z",
        projectPath: "/tmp/project",
        sessionId: "newer",
        isSidechain: false,
      },
    ]);

    expect(sorted.map((entry) => entry.sessionId)).toEqual(["newer", "older"]);
  });
});

describe("buildProjectGroupResult", () => {
  it("preserves session load errors instead of pretending the project has no sessions", () => {
    const result = buildProjectGroupResult({
      name: "Demo",
      escapedPath: "demo",
      sessionsResult: { ok: false, error: "permission denied" },
      isMissing: false,
    });

    expect(result).toEqual({
      name: "Demo",
      escapedPath: "demo",
      sessions: [],
      error: "permission denied",
    });
  });
});

describe("shouldInvalidateProjectsAndSessions", () => {
  it("invalidates when the watcher reports a session jsonl change", () => {
    expect(
      shouldInvalidateProjectsAndSessions({
        path: "/tmp/demo/session.jsonl",
        kind: "modify",
      }),
    ).toBe(true);
  });

  it("invalidates when the watcher reports a sessions index change", () => {
    expect(
      shouldInvalidateProjectsAndSessions({
        path: "/tmp/demo/sessions-index.json",
        kind: "create",
      }),
    ).toBe(true);
  });

  it("ignores unrelated watcher payloads", () => {
    expect(
      shouldInvalidateProjectsAndSessions({
        path: "/tmp/demo/README.md",
        kind: "modify",
      }),
    ).toBe(false);
  });
});
