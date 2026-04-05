import type { ComponentPropsWithoutRef, PropsWithChildren } from "react";
import type { Root } from "react-dom/client";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @vitest-environment jsdom

const mocks = vi.hoisted(() => ({
  addToast: vi.fn(),
  deleteSession: vi.fn(),
  invalidateQueries: vi.fn(),
  renameSession: vi.fn(),
  setNewSessionContextWindow: vi.fn(),
  setNewSessionProject: vi.fn(),
  setSearchQuery: vi.fn(),
  setSelectedSessionId: vi.fn(),
  setSelectedWorkspaceId: vi.fn(),
  toggleWorkspaceExpanded: vi.fn(),
  useProjectsAndSessions: vi.fn(),
  useWorkspaceSessions: vi.fn(),
  useSessionOperations: vi.fn(),
}));

vi.mock("../hooks/use-projects-and-sessions", () => ({
  useProjectsAndSessions: mocks.useProjectsAndSessions,
}));

vi.mock("../hooks/use-workspace-sessions", () => ({
  useWorkspaceSessions: mocks.useWorkspaceSessions,
}));

vi.mock("../hooks/use-session-operations", () => ({
  useSessionOperations: mocks.useSessionOperations,
}));

vi.mock("../store/session-store", () => ({
  useSessionStore: () => ({
    selectedSessionId: "selected-session",
    setSelectedSessionId: mocks.setSelectedSessionId,
    selectedWorkspaceId: "/projects/alpha",
    setSelectedWorkspaceId: mocks.setSelectedWorkspaceId,
    expandedWorkspaceIds: new Set(["/projects/alpha"]),
    toggleWorkspaceExpanded: mocks.toggleWorkspaceExpanded,
    searchQuery: "",
    setSearchQuery: mocks.setSearchQuery,
    setNewSessionProject: mocks.setNewSessionProject,
    setNewSessionContextWindow: mocks.setNewSessionContextWindow,
  }),
}));

vi.mock("../store/toast-store", () => ({
  useToastStore: (selector: (state: unknown) => unknown) =>
    selector({ addToast: mocks.addToast }),
}));

vi.mock("../lib/atelier-client", () => ({
  atelierClient: {
    sessions: {
      rename: mocks.renameSession,
    },
  },
}));

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({
    invalidateQueries: mocks.invalidateQueries,
  }),
}));

vi.mock("@acme/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    title,
    type = "button",
    ...props
  }: PropsWithChildren<ComponentPropsWithoutRef<"button">>) => (
    <button type={type} onClick={onClick} title={title} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@acme/ui/components/input", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@acme/ui/components/input")>();

  return {
    ...actual,
    Input: (props: ComponentPropsWithoutRef<"input">) => <input {...props} />,
  };
});

vi.mock("@acme/ui/components/badge", () => ({
  Badge: ({
    children,
    ...props
  }: PropsWithChildren<ComponentPropsWithoutRef<"span">>) => (
    <span {...props}>{children}</span>
  ),
}));

vi.mock("lucide-react", () => ({
  ChevronDown: () => null,
  ChevronRight: () => null,
  Folder: () => null,
  MessageSquare: () => null,
  Pencil: () => null,
  Plus: () => null,
  Search: () => null,
  Trash2: () => null,
}));

vi.mock("./delete-dialog", () => ({
  DeleteDialog: () => null,
}));

describe("ChatSidebar", () => {
  const onSelectTask = vi.fn();

  const baseGroup = {
    name: "Alpha",
    escapedPath: "/projects/alpha",
    sessions: [
      {
        sessionId: "selected-session",
        fullPath: "/tmp/selected.jsonl",
        fileMtime: 1_710_000_000,
        firstPrompt: "Investigate shell layout",
        summary: "Shell redesign",
        messageCount: 24,
        created: "2026-03-08T10:00:00.000Z",
        modified: "2026-03-09T12:00:00.000Z",
        projectPath: "/projects/alpha",
        isSidechain: false,
      },
    ],
  };

  const workspaceSessions = [
    {
      id: "selected-session",
      workspaceId: "/projects/alpha",
      provider: "claude" as const,
      providerLabel: "Claude" as const,
      title: "Shell redesign",
      subtitle: "24 messages",
      updatedAt: "2026-03-09T12:00:00.000Z",
      source: baseGroup.sessions[0],
    },
  ];
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    onSelectTask.mockReset();
    mocks.addToast.mockReset();
    mocks.deleteSession.mockReset();
    mocks.invalidateQueries.mockReset();
    mocks.setNewSessionContextWindow.mockReset();
    mocks.setNewSessionProject.mockReset();
    mocks.setSearchQuery.mockReset();
    mocks.setSelectedSessionId.mockReset();
    mocks.useWorkspaceSessions.mockReturnValue({
      sessions: [],
      isLoading: false,
      error: undefined,
    });
    mocks.useSessionOperations.mockReturnValue({
      deleteSession: mocks.deleteSession,
      isDeleting: false,
    });
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

  it("keeps project load failures out of the top-level empty state", async () => {
    const { ChatSidebar } = await import("./chat-sidebar");

    mocks.useProjectsAndSessions.mockReturnValue({
      groups: [
        {
          name: "Broken Project",
          escapedPath: "/tmp/broken-project",
          sessions: [],
          error: "Failed to load sessions for Broken Project",
        },
      ],
      isLoading: false,
    });

    flushSync(() => {
      root?.render(<ChatSidebar allTasks={[]} selectedTaskId={null} onSelectTask={onSelectTask} />);
    });

    expect(container?.textContent).toContain("Broken Project");
    expect(container?.textContent).toContain(
      "Failed to load sessions for Broken Project",
    );
    expect(container?.textContent).not.toContain("No workspaces yet");
  });

  it("shows top-level project load failures instead of the empty state", async () => {
    const { ChatSidebar } = await import("./chat-sidebar");

    mocks.useProjectsAndSessions.mockReturnValue({
      groups: [],
      isLoading: false,
      error: "Failed to load projects",
    });

    flushSync(() => {
      root?.render(<ChatSidebar allTasks={[]} selectedTaskId={null} onSelectTask={onSelectTask} />);
    });

    expect(container?.textContent).toContain("Failed to load projects");
    expect(container?.textContent).not.toContain("No chats yet");
  });

  it("uses workspace expansion state from the store-backed selector", async () => {
    const { ChatSidebar } = await import("./chat-sidebar");

    mocks.useProjectsAndSessions.mockReturnValue({
      groups: [baseGroup],
      isLoading: false,
    });
    mocks.useWorkspaceSessions.mockReturnValue({
      sessions: workspaceSessions,
      isLoading: false,
      error: undefined,
    });

    flushSync(() => {
      root?.render(<ChatSidebar allTasks={[]} selectedTaskId={null} onSelectTask={onSelectTask} />);
    });

    expect(container?.textContent).toContain("Shell redesign");
    expect(container?.textContent).toContain("Claude");

    const newSessionButton = container?.querySelector(
      'button[title="New session"]',
    ) as HTMLButtonElement | null;
    newSessionButton?.click();

    expect(mocks.setNewSessionProject).toHaveBeenCalledWith("/projects/alpha");
    expect(mocks.setNewSessionContextWindow).toHaveBeenCalledWith(null);
    expect(mocks.setSelectedSessionId).toHaveBeenCalledWith(null);
  });

  it("clears stale context-window draft when starting a general workspace chat", async () => {
    const { ChatSidebar } = await import("./chat-sidebar");

    mocks.useProjectsAndSessions.mockReturnValue({
      groups: [baseGroup],
      isLoading: false,
    });

    flushSync(() => {
      root?.render(<ChatSidebar allTasks={[]} selectedTaskId={null} onSelectTask={onSelectTask} />);
    });

    const generalWorkspaceButton = container?.querySelector(
      'button[title="General Chat (~/.atelier)"]',
    ) as HTMLButtonElement | null;

    generalWorkspaceButton?.click();

    expect(mocks.setSelectedWorkspaceId).toHaveBeenCalledWith("~/.atelier");
    expect(mocks.setNewSessionProject).toHaveBeenCalledWith("~/.atelier");
    expect(mocks.setNewSessionContextWindow).toHaveBeenCalledWith(null);
    expect(mocks.setSelectedSessionId).toHaveBeenCalledWith(null);
  });
});
