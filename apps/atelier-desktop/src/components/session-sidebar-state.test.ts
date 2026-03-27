import { describe, expect, it } from "vitest";

import type { WorkspaceRecord } from "../lib/tasks";
import type { WorkspaceSidebarItem } from "../lib/workspace-session-model";
import { buildSessionSidebarState } from "./session-sidebar-state";

function createWorkspace(
  id: string,
  overrides: Partial<WorkspaceRecord> = {},
): WorkspaceRecord {
  return {
    id,
    path: `/Users/vyductan/workspaces/${id}`,
    repoRoot: "/Users/vyductan/Developer/vyductan.dev",
    branch: "main",
    isWorktree: false,
    activeTaskIds: [],
    ...overrides,
  };
}

const baseItems: WorkspaceSidebarItem[] = [
  {
    workspace: createWorkspace("workspace-alpha", {
      path: "/Users/vyductan/workspaces/alpha",
    }),
    sessions: [
      {
        id: "selected-session",
        workspaceId: "workspace-alpha",
        provider: "claude",
        title: "Shell redesign",
        subtitle: "24 messages",
        updatedAt: "2026-03-09T12:00:00.000Z",
        timestampLabel: "1 day ago",
        isSelected: true,
        source: {
          projectPath: "/projects/alpha",
        },
      },
      {
        id: "idle-session",
        workspaceId: "workspace-alpha",
        provider: "openclaw",
        title: "Write docs",
        subtitle: "0 messages",
        updatedAt: "2026-03-08T09:30:00.000Z",
        timestampLabel: "2 days ago",
        isSelected: false,
        source: {
          projectPath: "/projects/alpha",
        },
      },
    ],
    isExpanded: true,
    isSelectedWorkspace: false,
  },
  {
    workspace: createWorkspace("workspace-beta", {
      path: "/Users/vyductan/workspaces/beta",
    }),
    sessions: [],
    isExpanded: false,
    isSelectedWorkspace: true,
  },
];

describe("buildSessionSidebarState", () => {
  it("converts workspace sidebar items into render-ready groups with provider labels", () => {
    const groups = buildSessionSidebarState(baseItems);

    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      name: "alpha",
      workspacePath: "/Users/vyductan/workspaces/alpha",
      sessionCount: 2,
      isCollapsed: false,
      isSelected: false,
    });
    expect(groups[0]?.sessions).toEqual([
      {
        sessionId: "selected-session",
        title: "Shell redesign",
        subtitle: "24 messages",
        timestampLabel: "1 day ago",
        providerLabel: "Claude",
        isSelected: true,
      },
      {
        sessionId: "idle-session",
        title: "Write docs",
        subtitle: "0 messages",
        timestampLabel: "2 days ago",
        providerLabel: "OpenClaw",
        isSelected: false,
      },
    ]);
  });

  it("keeps selected and collapsed workspace state and exposes empty-state labels", () => {
    const groups = buildSessionSidebarState(baseItems);

    expect(groups[1]).toMatchObject({
      name: "beta",
      workspacePath: "/Users/vyductan/workspaces/beta",
      sessionCount: 0,
      isCollapsed: true,
      emptyStateLabel: "No sessions yet",
      isSelected: true,
      sessions: [],
    });
  });
});
