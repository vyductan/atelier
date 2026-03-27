import { act, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ProjectGroup } from "./use-projects-and-sessions";
import { useWorkspaceSessions } from "./use-workspace-sessions";

// @vitest-environment jsdom

const mocks = vi.hoisted(() => ({
  useProjectsAndSessions: vi.fn(),
}));

vi.mock("./use-projects-and-sessions", () => ({
  useProjectsAndSessions: mocks.useProjectsAndSessions,
}));

function SessionsReader({
  onValue,
}: {
  onValue: (value: ReturnType<typeof useWorkspaceSessions>) => void;
}) {
  const value = useWorkspaceSessions();

  useEffect(() => {
    onValue(value);
  }, [onValue, value]);

  return null;
}

describe("useWorkspaceSessions", () => {
  let container: HTMLDivElement | null;
  let root: ReturnType<typeof createRoot> | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    mocks.useProjectsAndSessions.mockReset();
  });

  afterEach(() => {
    root?.unmount();
    root = null;
    container?.remove();
    container = null;
  });

  it("maps current project groups into Claude workspace sessions", async () => {
    const groups: ProjectGroup[] = [
      {
        name: "Alpha",
        escapedPath: "/workspaces/alpha",
        isMissing: false,
        sessions: [
          {
            sessionId: "session-alpha-1",
            fullPath: "/tmp/session-alpha-1.jsonl",
            fileMtime: 1_710_000_001,
            firstPrompt: "Draft release notes",
            summary: "Release notes planning",
            messageCount: 24,
            created: "2026-03-10T10:00:00.000Z",
            modified: "2026-03-10T12:00:00.000Z",
            projectPath: "/projects/alpha",
            isSidechain: false,
          },
          {
            sessionId: "session-alpha-2",
            fullPath: "/tmp/session-alpha-2.jsonl",
            fileMtime: 1_710_000_002,
            firstPrompt: "Fallback title prompt",
            messageCount: 0,
            created: "2026-03-10T09:00:00.000Z",
            modified: "2026-03-10T11:00:00.000Z",
            projectPath: "",
            isSidechain: false,
          },
        ],
      },
    ];

    mocks.useProjectsAndSessions.mockReturnValue({
      groups,
      isLoading: false,
      error: undefined,
    });

    const snapshots: Array<ReturnType<typeof useWorkspaceSessions>> = [];

    await act(async () => {
      root?.render(
        <SessionsReader onValue={(value) => snapshots.push(value)} />,
      );
      await Promise.resolve();
    });

    expect(snapshots.at(-1)).toEqual({
      sessions: [
        {
          id: "session-alpha-1",
          workspaceId: "/projects/alpha",
          provider: "claude",
          providerLabel: "Claude",
          title: "Release notes planning",
          subtitle: "24 messages",
          updatedAt: "2026-03-10T12:00:00.000Z",
          source: groups[0]?.sessions[0],
        },
        {
          id: "session-alpha-2",
          workspaceId: null,
          provider: "claude",
          providerLabel: "Claude",
          title: "Fallback title prompt",
          subtitle: "0 messages",
          updatedAt: "2026-03-10T11:00:00.000Z",
          source: groups[0]?.sessions[1],
        },
      ],
      isLoading: false,
      error: undefined,
    });
  });
});
