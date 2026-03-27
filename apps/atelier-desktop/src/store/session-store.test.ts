import { beforeEach, describe, expect, it } from "vitest";

import type { ClaudeContextWindowValue } from "../lib/claude-model-capabilities";
import { useSessionStore } from "./session-store";

describe("session-store", () => {
  beforeEach(() => {
    useSessionStore.setState({
      selectedProject: null,
      sessions: [],
      searchQuery: "",
      filterBranch: null,
      selectedWorkspaceId: null,
      expandedWorkspaceIds: new Set<string>(),
      selectedSessionId: null,
      previewOpen: false,
      newSessionProject: null,
      newSessionPrompt: null,
      newSessionContextWindow: null,
    });
  });

  it("tracks selected workspace independently from selected session", () => {
    useSessionStore.getState().setSelectedWorkspaceId("workspace-alpha");
    useSessionStore.getState().setSelectedSessionId("session-123");

    expect(useSessionStore.getState().selectedWorkspaceId).toBe(
      "workspace-alpha",
    );
    expect(useSessionStore.getState().selectedSessionId).toBe("session-123");

    useSessionStore.getState().setSelectedSessionId(null);

    expect(useSessionStore.getState().selectedWorkspaceId).toBe(
      "workspace-alpha",
    );
    expect(useSessionStore.getState().selectedSessionId).toBeNull();
  });

  it("tracks expanded workspace ids via toggleWorkspaceExpanded", () => {
    useSessionStore.getState().toggleWorkspaceExpanded("workspace-alpha");

    expect(useSessionStore.getState().expandedWorkspaceIds).toEqual(
      new Set(["workspace-alpha"]),
    );

    useSessionStore.getState().toggleWorkspaceExpanded("workspace-beta");

    expect(useSessionStore.getState().expandedWorkspaceIds).toEqual(
      new Set(["workspace-alpha", "workspace-beta"]),
    );

    useSessionStore.getState().toggleWorkspaceExpanded("workspace-alpha");

    expect(useSessionStore.getState().expandedWorkspaceIds).toEqual(
      new Set(["workspace-beta"]),
    );
  });

  it("keeps the selected workspace after toggling workspace expansion", () => {
    useSessionStore.getState().setSelectedWorkspaceId("workspace-alpha");

    useSessionStore.getState().toggleWorkspaceExpanded("workspace-alpha");
    useSessionStore.getState().toggleWorkspaceExpanded("workspace-beta");
    useSessionStore.getState().toggleWorkspaceExpanded("workspace-alpha");

    expect(useSessionStore.getState().selectedWorkspaceId).toBe(
      "workspace-alpha",
    );
    expect(useSessionStore.getState().expandedWorkspaceIds).toEqual(
      new Set(["workspace-beta"]),
    );
  });

  it("sets and clears the new-session context-window draft", () => {
    const contextWindow: ClaudeContextWindowValue = "1m";

    useSessionStore.getState().setNewSessionContextWindow(contextWindow);
    expect(useSessionStore.getState().newSessionContextWindow).toBe("1m");

    useSessionStore.getState().setNewSessionContextWindow(null);
    expect(useSessionStore.getState().newSessionContextWindow).toBeNull();
  });

  it("clears the context-window draft without disturbing other new-session drafts", () => {
    useSessionStore.getState().setNewSessionProject("/tmp/workspace-alpha");
    useSessionStore.getState().setNewSessionPrompt("Draft prompt");
    useSessionStore.getState().setNewSessionContextWindow("1m");

    useSessionStore.getState().setNewSessionContextWindow(null);

    expect(useSessionStore.getState().newSessionProject).toBe(
      "/tmp/workspace-alpha",
    );
    expect(useSessionStore.getState().newSessionPrompt).toBe("Draft prompt");
    expect(useSessionStore.getState().newSessionContextWindow).toBeNull();
  });

  it("returns the selected session when sessions are hydrated", () => {
    useSessionStore.getState().setSessions([
      {
        sessionId: "session-123",
        fullPath: "/tmp/session-123.jsonl",
        fileMtime: 1_710_000_000_000,
        firstPrompt: "Investigate workspace-first selection",
        summary: "Workspace session",
        messageCount: 4,
        created: "2026-03-11T00:00:00.000Z",
        modified: "2026-03-11T00:05:00.000Z",
        gitBranch: "feature/atelier",
        projectPath: "/tmp/workspace-alpha",
        isSidechain: false,
      },
    ]);
    useSessionStore.getState().setSelectedSessionId("session-123");

    expect(useSessionStore.getState().getSelectedSession()).toMatchObject({
      sessionId: "session-123",
      projectPath: "/tmp/workspace-alpha",
    });
  });
});
