import { describe, expect, it } from "vitest";

import type { WorkspaceRecord } from "./tasks";
import type { ProviderSession } from "./types";
import {
  buildWorkspaceSidebarItems,
  findWorkspaceSession,
} from "./workspace-session-model";

function createWorkspace(
  id: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord {
  return {
    id,
    path: `/workspaces/${id}`,
    repoRoot: "/repo",
    branch: "main",
    isWorktree: false,
    activeTaskIds: [],
    ...overrides,
  };
}

function createSession(
  id: string,
  workspaceId: string,
  updatedAt: string,
  overrides: Partial<ProviderSession> = {},
): ProviderSession {
  return {
    id,
    workspaceId,
    provider: "claude",
    title: `${id} title`,
    subtitle: `${id} subtitle`,
    updatedAt,
    source: {
      projectPath: `/repo/${workspaceId}`,
    },
    ...overrides,
  };
}

describe("workspace session model", () => {
  it("groups sessions into their workspace and sorts newest first", () => {
    const workspaces = [
      createWorkspace("workspace-alpha"),
      createWorkspace("workspace-beta"),
    ];
    const sessions = [
      createSession(
        "alpha-older",
        "workspace-alpha",
        "2026-03-11T00:00:01.000Z",
      ),
      createSession(
        "beta-newest",
        "workspace-beta",
        "2026-03-11T00:00:04.000Z",
      ),
      createSession(
        "alpha-newest",
        "workspace-alpha",
        "2026-03-11T00:00:03.000Z",
      ),
    ];

    const items = buildWorkspaceSidebarItems({
      workspaces,
      sessions,
      selectedSessionId: null,
      selectedWorkspaceId: null,
      searchQuery: "",
      now: new Date("2026-03-11T00:10:00.000Z"),
    });

    expect(items.map((item) => item.workspace.id)).toEqual([
      "workspace-beta",
      "workspace-alpha",
    ]);
    expect(items[0]?.sessions.map((session) => session.id)).toEqual([
      "beta-newest",
    ]);
    expect(items[1]?.sessions.map((session) => session.id)).toEqual([
      "alpha-newest",
      "alpha-older",
    ]);
    expect(items[0]?.sessions[0]?.timestampLabel).toBeTruthy();
  });

  it("filters by search and keeps only matching workspaces", () => {
    const workspaces = [
      createWorkspace("workspace-alpha"),
      createWorkspace("workspace-beta"),
    ];
    const sessions = [
      createSession(
        "alpha-match",
        "workspace-alpha",
        "2026-03-11T00:00:03.000Z",
        {
          title: "Review migration plan",
          subtitle: "Add the new workspace session selector",
          source: {
            projectPath: "/repo/workspace-alpha",
          },
        },
      ),
      createSession("beta-miss", "workspace-beta", "2026-03-11T00:00:02.000Z", {
        title: "Unrelated task",
        subtitle: "Nothing to see here",
        source: {
          projectPath: "/repo/other-project",
        },
      }),
    ];

    const items = buildWorkspaceSidebarItems({
      workspaces,
      sessions,
      selectedSessionId: null,
      selectedWorkspaceId: null,
      searchQuery: "migration",
      now: new Date("2026-03-11T00:10:00.000Z"),
    });

    expect(items).toHaveLength(1);
    expect(items[0]?.workspace.id).toBe("workspace-alpha");
    expect(items[0]?.sessions.map((session) => session.id)).toEqual([
      "alpha-match",
    ]);
    expect(items[0]?.isExpanded).toBe(true);
  });

  it("marks the selected session and selected workspace", () => {
    const workspaces = [
      createWorkspace("workspace-alpha"),
      createWorkspace("workspace-beta"),
    ];
    const sessions = [
      createSession(
        "alpha-session",
        "workspace-alpha",
        "2026-03-11T00:00:03.000Z",
      ),
      createSession(
        "beta-session",
        "workspace-beta",
        "2026-03-11T00:00:02.000Z",
      ),
    ];

    const items = buildWorkspaceSidebarItems({
      workspaces,
      sessions,
      selectedSessionId: "alpha-session",
      selectedWorkspaceId: "workspace-beta",
      searchQuery: "",
      now: new Date("2026-03-11T00:10:00.000Z"),
    });

    const alphaItem = items.find(
      (item) => item.workspace.id === "workspace-alpha",
    );
    const betaItem = items.find(
      (item) => item.workspace.id === "workspace-beta",
    );

    expect(
      alphaItem?.sessions.find((session) => session.id === "alpha-session")
        ?.isSelected,
    ).toBe(true);
    expect(alphaItem?.isExpanded).toBe(true);
    expect(alphaItem?.isSelectedWorkspace).toBe(false);
    expect(betaItem?.isSelectedWorkspace).toBe(true);
  });

  it("respects store-backed expanded workspace ids", () => {
    const workspaces = [
      createWorkspace("workspace-alpha"),
      createWorkspace("workspace-beta"),
    ];
    const sessions = [
      createSession(
        "alpha-session",
        "workspace-alpha",
        "2026-03-11T00:00:03.000Z",
      ),
      createSession(
        "beta-session",
        "workspace-beta",
        "2026-03-11T00:00:02.000Z",
      ),
    ];

    const items = buildWorkspaceSidebarItems({
      workspaces,
      sessions,
      selectedSessionId: null,
      selectedWorkspaceId: null,
      expandedWorkspaceIds: new Set(["workspace-beta"]),
      searchQuery: "",
      now: new Date("2026-03-11T00:10:00.000Z"),
    });

    expect(
      items.find((item) => item.workspace.id === "workspace-alpha")?.isExpanded,
    ).toBe(false);
    expect(
      items.find((item) => item.workspace.id === "workspace-beta")?.isExpanded,
    ).toBe(true);
  });

  it("finds a normalized session by id", () => {
    const sessions = [
      createSession("session-a", "workspace-alpha", "2026-03-11T00:00:01.000Z"),
      createSession("session-b", "workspace-beta", "2026-03-11T00:00:02.000Z"),
    ];

    expect(findWorkspaceSession(sessions, "session-b")).toMatchObject({
      id: "session-b",
      workspaceId: "workspace-beta",
      provider: "claude",
      source: {
        projectPath: "/repo/workspace-beta",
      },
    });
    expect(findWorkspaceSession(sessions, "missing-session")).toBeNull();
  });
});
