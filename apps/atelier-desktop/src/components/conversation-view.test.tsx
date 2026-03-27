import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom

const sessionStoreMocks = vi.hoisted(() => ({
  selectedSessionId: null as string | null,
  selectedWorkspaceId: null as string | null,
  newSessionProject: null as string | null,
  newSessionContextWindow: null as "default" | "1m" | null,
}));

const hookMocks = vi.hoisted(() => ({
  useProjectsAndSessions: vi.fn(),
  useWorkspaceSessions: vi.fn(),
}));

vi.mock("../store/session-store", () => ({
  useSessionStore: () => ({
    selectedSessionId: sessionStoreMocks.selectedSessionId,
    selectedWorkspaceId: sessionStoreMocks.selectedWorkspaceId,
    newSessionProject: sessionStoreMocks.newSessionProject,
    newSessionContextWindow: sessionStoreMocks.newSessionContextWindow,
  }),
}));

vi.mock("../hooks/use-projects-and-sessions", () => ({
  useProjectsAndSessions: hookMocks.useProjectsAndSessions,
}));

vi.mock("../hooks/use-workspace-sessions", () => ({
  useWorkspaceSessions: hookMocks.useWorkspaceSessions,
}));

vi.mock("./active-session-panel", () => ({
  ActiveSessionPanel: ({
    session,
    newSessionProject,
  }: {
    session?: { sessionId: string };
    newSessionProject?: string;
  }) => (
    <div data-testid="active-session-panel">
      {session
        ? `Session ${session.sessionId}`
        : `New session ${newSessionProject}`}
    </div>
  ),
}));

vi.mock("./workspace-overview-panel", () => ({
  WorkspaceOverviewPanel: ({ workspaceId }: { workspaceId: string }) => (
    <div data-testid="workspace-overview-panel">Workspace {workspaceId}</div>
  ),
}));

describe("ConversationView", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    sessionStoreMocks.selectedSessionId = null;
    sessionStoreMocks.selectedWorkspaceId = null;
    sessionStoreMocks.newSessionProject = null;
    sessionStoreMocks.newSessionContextWindow = null;
    hookMocks.useProjectsAndSessions.mockReset();
    hookMocks.useProjectsAndSessions.mockReturnValue({ groups: [] });
    hookMocks.useWorkspaceSessions.mockReset();
    hookMocks.useWorkspaceSessions.mockReturnValue({ sessions: [] });
  });

  afterEach(() => {
    if (root) {
      flushSync(() => {
        root?.unmount();
      });
      root = null;
    }

    container?.remove();
    container = null;
  });

  it("does not load project sessions when no session is selected", async () => {
    const { ConversationView } = await import("./conversation-view");

    flushSync(() => {
      root?.render(<ConversationView />);
    });

    expect(container?.textContent).toContain("Select a chat to view");
    expect(hookMocks.useProjectsAndSessions).not.toHaveBeenCalled();
  });

  it("shows the empty state when the selected session is missing", async () => {
    sessionStoreMocks.selectedSessionId = "missing-session";
    const { ConversationView } = await import("./conversation-view");

    flushSync(() => {
      root?.render(<ConversationView />);
    });

    expect(container?.textContent).toContain("Select a chat to view");
    expect(hookMocks.useWorkspaceSessions).toHaveBeenCalledTimes(1);
  });

  it("renders the new-session panel path even when a context-window draft is present", async () => {
    sessionStoreMocks.newSessionProject = "/repo/alpha";
    sessionStoreMocks.newSessionContextWindow = "1m";
    const { ConversationView } = await import("./conversation-view");

    flushSync(() => {
      root?.render(<ConversationView />);
    });

    expect(container?.textContent).toContain("New session /repo/alpha");
  });

  it("shows workspace overview when a workspace is selected without a session", async () => {
    sessionStoreMocks.selectedWorkspaceId = "/repo/alpha";
    const { ConversationView } = await import("./conversation-view");

    flushSync(() => {
      root?.render(<ConversationView />);
    });

    expect(container?.textContent).toContain("Workspace /repo/alpha");
  });
});
