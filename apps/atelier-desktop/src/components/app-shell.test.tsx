import type { ComponentPropsWithoutRef } from "react";
import type { Root } from "react-dom/client";
import { act, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type * as TaskWorkbenchModule from "../lib/task-workbench";
import type { TaskRecord } from "../lib/tasks";
import { createSupervisor } from "../lib/supervisor";
import { createTaskStore } from "../lib/task-store";

// @vitest-environment jsdom

vi.mock("@acme/ui/components/tabs", async () => {
  const React = await import("react");

  const TabsContext = React.createContext<{
    value: string;
    setValue: (value: string) => void;
  } | null>(null);

  return {
    Tabs: ({
      value,
      onValueChange,
      children,
      className,
    }: {
      value: string;
      onValueChange?: (value: string) => void;
      children?: React.ReactNode;
      className?: string;
    }) => {
      const [internalValue, setInternalValue] = React.useState(value);

      React.useEffect(() => {
        setInternalValue(value);
      }, [value]);

      return (
        <TabsContext.Provider
          value={{
            value: internalValue,
            setValue: (nextValue) => {
              setInternalValue(nextValue);
              onValueChange?.(nextValue);
            },
          }}
        >
          <div className={className}>{children}</div>
        </TabsContext.Provider>
      );
    },
    TabsList: ({
      children,
      className,
    }: {
      children?: React.ReactNode;
      className?: string;
    }) => (
      <div data-testid="tabs-list" className={className}>
        {children}
      </div>
    ),
    TabsTrigger: ({
      value,
      children,
      className,
    }: {
      value: string;
      children?: React.ReactNode;
      className?: string;
    }) => {
      const context = React.useContext(TabsContext);
      const isActive = context?.value === value;

      return (
        <button
          type="button"
          data-slot="tabs-trigger"
          data-state={isActive ? "active" : "inactive"}
          className={className}
          onClick={() => context?.setValue(value)}
        >
          {children}
        </button>
      );
    },
    TabsContent: ({
      value,
      children,
      className,
    }: {
      value: string;
      children?: React.ReactNode;
      className?: string;
    }) => {
      const context = React.useContext(TabsContext);
      const isActive = context?.value === value;

      return (
        <div
          data-slot="tabs-content"
          data-state={isActive ? "active" : "inactive"}
          className={className}
        >
          {children}
        </div>
      );
    },
  };
});

vi.mock("../features/services/services-panel", () => ({
  ServicesPanel: () => <div data-testid="services-panel">Services panel</div>,
}));

vi.mock("@acme/ui/components/button", () => ({
  Button: ({
    children,
    onClick,
    type = "button",
    ...props
  }: ComponentPropsWithoutRef<"button">) => (
    <button type={type} onClick={onClick} {...props}>
      {children}
    </button>
  ),
}));

vi.mock("@acme/ui/components/input", () => ({
  Input: (props: ComponentPropsWithoutRef<"input">) => <input {...props} />,
}));

function setNativeInputValue(element: HTMLInputElement, value: string) {
  const prototype = Object.getPrototypeOf(element) as HTMLInputElement;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  descriptor?.set?.call(element, value);
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function runWithActEnvironment(
  callback: () => Promise<void>,
): Promise<void> {
  const globalScope = globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  };
  const previousValue = globalScope.IS_REACT_ACT_ENVIRONMENT;
  globalScope.IS_REACT_ACT_ENVIRONMENT = true;

  try {
    await callback();
  } finally {
    globalScope.IS_REACT_ACT_ENVIRONMENT = previousValue;
  }
}

async function settleWorkbenchMount(): Promise<void> {
  await runWithActEnvironment(async () => {
    await act(async () => {
      await flushPromises();
    });
  });
}

function createMockTaskRecord(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    workspaceId: "/tmp/project",
    title: "Review deployment",
    prompt: "Review deployment",
    status: "queued",
    runnerPreference: "auto",
    resolvedRunner: null,
    currentStage: null,
    blockedReason: null,
    approvalRequest: null,
    lastErrorSummary: null,
    createdAt: "2026-03-11T00:00:00.000Z",
    updatedAt: "2026-03-11T00:00:00.000Z",
    summary: null,
    thread: [],
    ...overrides,
  };
}

async function createMockTaskWorkbench(
  initialTasks: TaskRecord[] = [],
): Promise<{
  createTask: (input: {
    workspaceId: string;
    prompt: string;
    runnerPreference: "auto" | "claude" | "openclaw";
  }) => Promise<TaskRecord>;
  getTask: (taskId: string) => TaskRecord | null;
  listTasks: () => TaskRecord[];
  listTasksByWorkspace: (workspaceId: string) => TaskRecord[];
  startTask: (taskId: string) => Promise<TaskRecord | null>;
  approveTask: (taskId: string) => Promise<TaskRecord | null>;
  rejectTask: (taskId: string) => Promise<TaskRecord | null>;
  retryTask: (taskId: string) => Promise<TaskRecord | null>;
  resumeTask: (taskId: string) => Promise<TaskRecord | null>;
  rerunTask: (taskId: string) => Promise<TaskRecord | null>;
}> {
  const store = createTaskStore({ initialTasks });
  const supervisor = createSupervisor({
    store,
    claude: {
      execute: async (task, currentStore) => {
        const updateTaskOrThrow = (
          patch: Parameters<typeof currentStore.updateTask>[1],
        ): TaskRecord => {
          const updatedTask = currentStore.updateTask(task.id, patch);

          if (!updatedTask) {
            throw new Error(`Task ${task.id} not found`);
          }

          return updatedTask;
        };

        updateTaskOrThrow({
          status: "running",
          resolvedRunner: "claude",
          currentStage: "running",
          approvalRequest: null,
          blockedReason: null,
          lastErrorSummary: null,
        });

        const normalizedPrompt = task.prompt.toLowerCase();

        if (normalizedPrompt.includes("secondary workspace")) {
          return updateTaskOrThrow({
            status: "blocked",
            resolvedRunner: "claude",
            currentStage: "blocked",
            summary: "Blocked while waiting for follow-up action.",
            blockedReason: "Waiting for retry.",
          });
        }

        if (
          normalizedPrompt.includes("prepare patch") &&
          task.status !== "awaiting_approval"
        ) {
          return updateTaskOrThrow({
            status: "awaiting_approval",
            resolvedRunner: "claude",
            currentStage: "awaiting approval",
            summary: "Patch ready for approval.",
            approvalRequest: "Approve applying the patch.",
          });
        }

        return updateTaskOrThrow({
          status: "done",
          resolvedRunner: "claude",
          currentStage: "completed",
          summary: "Completed successfully.",
        });
      },
    },
    openclaw: {
      runTask: async () => ({
        status: "done",
        summary: "Completed successfully.",
        currentStage: "completed",
      }),
    },
    notify: () => void 0,
  });

  return {
    async createTask(input: {
      workspaceId: string;
      prompt: string;
      runnerPreference: "auto" | "claude" | "openclaw";
    }) {
      return store.createTask(input);
    },
    getTask(taskId: string) {
      return store.getTask(taskId);
    },
    listTasks() {
      return store.listTasks();
    },
    listTasksByWorkspace(workspaceId: string) {
      return store.listTasksByWorkspace(workspaceId);
    },
    startTask(taskId: string) {
      return supervisor.startTask(taskId);
    },
    approveTask(taskId: string) {
      return supervisor.approveTask(taskId);
    },
    rejectTask(taskId: string) {
      return supervisor.rejectTask(taskId);
    },
    retryTask(taskId: string) {
      return supervisor.retryTask(taskId);
    },
    resumeTask(taskId: string) {
      return supervisor.resumeTask(taskId);
    },
    rerunTask(taskId: string) {
      return supervisor.rerunTask(taskId);
    },
  };
}

vi.mock("./chat-sidebar", () => ({
  ChatSidebar: () => <div data-testid="chat-sidebar">Chat sidebar</div>,
}));

vi.mock("./conversation-view", () => ({
  ConversationView: () => (
    <div data-testid="conversation-workspace">Conversation workspace</div>
  ),
}));

vi.mock("./acme-sync", () => ({
  AcmeSync: () => <div data-testid="acme-sync-view">Acme Sync view</div>,
}));

vi.mock("./workspace-task-sidebar", () => ({
  WorkspaceTaskSidebar: ({
    groups,
    selectedWorkspaceId,
    selectedTaskId,
    onSelectWorkspace,
    onSelectTask,
  }: {
    groups: Array<{
      workspace: { id: string; path: string };
      tasks: Array<{ id: string; title: string; status: string }>;
      counts: {
        running: number;
        awaitingApproval: number;
        blocked: number;
        recent: number;
      };
    }>;
    selectedWorkspaceId: string | null;
    selectedTaskId: string | null;
    onSelectWorkspace: (workspaceId: string) => void;
    onSelectTask: (taskId: string) => void;
  }) => (
    <aside data-testid="workspace-task-sidebar">
      {groups.map((group) => {
        const workspaceLabel =
          group.workspace.path.split("/").findLast(Boolean) ??
          group.workspace.path;

        return (
          <section
            key={group.workspace.id}
            data-workspace-id={group.workspace.id}
          >
            <button
              type="button"
              data-selected={group.workspace.id === selectedWorkspaceId}
              onClick={() => onSelectWorkspace(group.workspace.id)}
            >
              {workspaceLabel}
            </button>
            <div>{`Running ${group.counts.running}`}</div>
            <div>{`Awaiting approval ${group.counts.awaitingApproval}`}</div>
            <div>{`Blocked ${group.counts.blocked}`}</div>
            <div>{`Recent ${group.counts.recent}`}</div>
            {group.tasks.map((task) => (
              <button
                key={task.id}
                type="button"
                data-selected={task.id === selectedTaskId}
                onClick={() => onSelectTask(task.id)}
              >
                {`${task.title} (${task.status})`}
              </button>
            ))}
          </section>
        );
      })}
    </aside>
  ),
}));

vi.mock("./not-tauri-error", () => ({
  NotTauriError: () => (
    <div data-testid="not-tauri-error">Not Running in Tauri</div>
  ),
}));

vi.mock("./task-detail-panel", () => ({
  TaskDetailPanel: ({
    task,
    onStartTask,
    onApproveTask,
    onRejectTask,
    onRetryTask,
    onResumeTask,
    onRerunTask,
  }: {
    task: { id: string; title: string; status: string };
    onStartTask?: (taskId: string) => void;
    onApproveTask?: (taskId: string) => void;
    onRejectTask?: (taskId: string) => void;
    onRetryTask?: (taskId: string) => void;
    onResumeTask?: (taskId: string) => void;
    onRerunTask?: (taskId: string) => void;
  }) => (
    <div data-testid="task-detail-panel">
      <div>{`Task detail: ${task.title}`}</div>
      {task.status === "queued" ? (
        <button type="button" onClick={() => onStartTask?.(task.id)}>
          Start
        </button>
      ) : null}
      {task.status === "awaiting_approval" ? (
        <>
          <button type="button" onClick={() => onApproveTask?.(task.id)}>
            Approve
          </button>
          <button type="button" onClick={() => onRejectTask?.(task.id)}>
            Reject
          </button>
        </>
      ) : null}
      {task.status === "blocked" ? (
        <>
          <button type="button" onClick={() => onRetryTask?.(task.id)}>
            Retry
          </button>
          <button type="button" onClick={() => onResumeTask?.(task.id)}>
            Resume
          </button>
        </>
      ) : null}
      {task.status === "failed" ? (
        <button type="button" onClick={() => onRetryTask?.(task.id)}>
          Retry
        </button>
      ) : null}
      {task.status === "done" ? (
        <button type="button" onClick={() => onRerunTask?.(task.id)}>
          Re-run
        </button>
      ) : null}
    </div>
  ),
}));

vi.mock("../lib/workspace-task-groups", () => ({
  buildWorkspaceTaskGroups: (
    workspaces: Array<{ id: string; path: string }>,
    tasks: Array<{
      id: string;
      workspaceId: string;
      title: string;
      status: string;
    }>,
  ) =>
    workspaces.map((workspace) => {
      const workspaceTasks = tasks.filter(
        (task) => task.workspaceId === workspace.id,
      );
      const running = workspaceTasks.filter(
        (task) => task.status === "running",
      );
      const awaitingApproval = workspaceTasks.filter(
        (task) => task.status === "awaiting_approval",
      );
      const blocked = workspaceTasks.filter(
        (task) => task.status === "blocked",
      );
      const recent = workspaceTasks.filter(
        (task) =>
          task.status !== "running" &&
          task.status !== "awaiting_approval" &&
          task.status !== "blocked",
      );

      return {
        workspace,
        tasks: workspaceTasks,
        counts: {
          running: running.length,
          awaitingApproval: awaitingApproval.length,
          blocked: blocked.length,
          recent: recent.length,
        },
        sections: {
          running,
          awaitingApproval,
          blocked,
          recent,
        },
      };
    }),
}));

vi.mock("./toaster", () => ({
  Toaster: () => <div data-testid="app-toaster">Toaster</div>,
}));

const sessionStoreMocks = vi.hoisted(() => ({
  getSelectedSession: vi.fn<() => { projectPath: string } | null>(() => null),
  sessions: [] as Array<{ projectPath: string; sessionId: string }>,
  selectedWorkspaceId: null as string | null,
  newSessionProject: null as string | null,
  newSessionPrompt: null as string | null,
  version: 0,
  listeners: new Set<() => void>(),
  emit: () => {
    sessionStoreMocks.version += 1;
    for (const listener of sessionStoreMocks.listeners) {
      listener();
    }
  },
  setSelectedWorkspaceId: vi.fn((id: string | null) => {
    sessionStoreMocks.selectedWorkspaceId = id;
    sessionStoreMocks.emit();
  }),
  setSelectedSessionId: vi.fn((id: string | null) => id),
  setNewSessionProject: vi.fn((project: string | null) => {
    sessionStoreMocks.newSessionProject = project;
    sessionStoreMocks.emit();
  }),
  setNewSessionPrompt: vi.fn((prompt: string | null) => {
    sessionStoreMocks.newSessionPrompt = prompt;
    sessionStoreMocks.emit();
  }),
}));

const atelierClientMocks = vi.hoisted(() => ({
  getStatus: vi.fn(),
}));

const tauriMocks = vi.hoisted(() => ({
  readTaskSnapshot: vi.fn(),
  writeTaskSnapshot: vi.fn(),
  ensureDirectory: vi.fn(),
}));

const pathApiMocks = vi.hoisted(() => ({
  homeDir: vi.fn(async () => "/Users/vyductan"),
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}));

const toastMocks = vi.hoisted(() => ({
  addToast: vi.fn(),
}));

const taskWorkbenchMocks = vi.hoisted(() => ({
  createTaskWorkbench: vi.fn(),
}));

function unresolvedWorkbenchResolver(): never {
  throw new Error("Expected workbench resolver to be set");
}

vi.mock("../store/session-store", () => ({
  useSessionStore: Object.assign(
    (
      selector?: (state: {
        getSelectedSession: () => { projectPath: string } | null;
        sessions: Array<{ projectPath: string; sessionId: string }>;
        selectedWorkspaceId: string | null;
        newSessionProject: string | null;
        newSessionPrompt: string | null;
        setSelectedWorkspaceId: (id: string | null) => void;
        setSelectedSessionId: (id: string | null) => void;
        setNewSessionProject: (project: string | null) => void;
        setNewSessionPrompt: (prompt: string | null) => void;
      }) => unknown,
    ) => {
      useSyncExternalStore(
        (listener) => {
          sessionStoreMocks.listeners.add(listener);
          return () => {
            sessionStoreMocks.listeners.delete(listener);
          };
        },
        () => sessionStoreMocks.version,
        () => sessionStoreMocks.version,
      );

      const state = {
        getSelectedSession: sessionStoreMocks.getSelectedSession,
        sessions: sessionStoreMocks.sessions,
        selectedWorkspaceId: sessionStoreMocks.selectedWorkspaceId,
        newSessionProject: sessionStoreMocks.newSessionProject,
        newSessionPrompt: sessionStoreMocks.newSessionPrompt,
        setSelectedWorkspaceId: sessionStoreMocks.setSelectedWorkspaceId,
        setSelectedSessionId: sessionStoreMocks.setSelectedSessionId,
        setNewSessionProject: sessionStoreMocks.setNewSessionProject,
        setNewSessionPrompt: sessionStoreMocks.setNewSessionPrompt,
      };

      return selector ? selector(state) : state;
    },
    {
      getState: () => ({
        getSelectedSession: sessionStoreMocks.getSelectedSession,
        sessions: sessionStoreMocks.sessions,
        selectedWorkspaceId: sessionStoreMocks.selectedWorkspaceId,
        newSessionProject: sessionStoreMocks.newSessionProject,
        newSessionPrompt: sessionStoreMocks.newSessionPrompt,
        setSelectedWorkspaceId: sessionStoreMocks.setSelectedWorkspaceId,
        setSelectedSessionId: sessionStoreMocks.setSelectedSessionId,
        setNewSessionProject: sessionStoreMocks.setNewSessionProject,
        setNewSessionPrompt: sessionStoreMocks.setNewSessionPrompt,
      }),
    },
  ),
}));

vi.mock("../lib/atelier-client", () => ({
  atelierClient: {
    workspace: {
      getStatus: atelierClientMocks.getStatus,
    },
  },
}));

vi.mock("../lib/task-workbench", () => ({
  createTaskWorkbench: taskWorkbenchMocks.createTaskWorkbench,
}));

vi.mock("../lib/tauri", () => ({
  readTaskSnapshot: tauriMocks.readTaskSnapshot,
  writeTaskSnapshot: tauriMocks.writeTaskSnapshot,
  ensureDirectory: tauriMocks.ensureDirectory,
}));

vi.mock("@tauri-apps/api/path", () => ({
  homeDir: pathApiMocks.homeDir,
  join: pathApiMocks.join,
}));

vi.mock("../store/toast-store", () => ({
  useToastStore: (
    selector: (state: { addToast: typeof toastMocks.addToast }) => unknown,
  ) => selector({ addToast: toastMocks.addToast }),
}));

describe("AppShell", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    taskWorkbenchMocks.createTaskWorkbench.mockReset();
    taskWorkbenchMocks.createTaskWorkbench.mockImplementation(() =>
      createMockTaskWorkbench(),
    );
    sessionStoreMocks.getSelectedSession.mockReset();
    sessionStoreMocks.getSelectedSession.mockReturnValue({
      projectPath: "/tmp/project",
    });
    sessionStoreMocks.sessions = [];
    sessionStoreMocks.selectedWorkspaceId = null;
    sessionStoreMocks.newSessionProject = null;
    sessionStoreMocks.newSessionPrompt = null;
    sessionStoreMocks.version = 0;
    sessionStoreMocks.listeners.clear();
    sessionStoreMocks.setSelectedWorkspaceId.mockClear();
    sessionStoreMocks.setSelectedSessionId.mockReset();
    sessionStoreMocks.setSelectedSessionId.mockImplementation(
      (id: string | null) => id,
    );
    sessionStoreMocks.setNewSessionProject.mockClear();
    sessionStoreMocks.setNewSessionPrompt.mockClear();
    atelierClientMocks.getStatus.mockReset();
    atelierClientMocks.getStatus.mockResolvedValue({
      branch: "feature/atelier",
      changedFiles: [],
      isGitRepo: true,
      totalChanged: 0,
      worktreeLabel: "atelier",
    });
    tauriMocks.readTaskSnapshot.mockReset();
    tauriMocks.readTaskSnapshot.mockRejectedValue(
      Object.assign(new Error("File not found"), { code: "ENOENT" }),
    );
    tauriMocks.writeTaskSnapshot.mockReset();
    tauriMocks.writeTaskSnapshot.mockImplementation(async () => {
      return;
    });
    tauriMocks.ensureDirectory.mockReset();
    tauriMocks.ensureDirectory.mockImplementation(async () => {
      return;
    });
    pathApiMocks.homeDir.mockReset();
    pathApiMocks.homeDir.mockImplementation(async () => "/Users/vyductan");
    pathApiMocks.join.mockReset();
    pathApiMocks.join.mockImplementation(async (...parts: string[]) =>
      parts.join("/"),
    );
    toastMocks.addToast.mockReset();
  });

  afterEach(() => {
    vi.resetModules();

    if (root) {
      flushSync(() => {
        root?.unmount();
      });
      root = null;
    }

    container?.remove();
    container = null;
    delete (globalThis.window as Window & { __TAURI_INTERNALS__?: unknown })
      .__TAURI_INTERNALS__;
  });

  it("logs workspace status load failures with project context", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => void 0);
    atelierClientMocks.getStatus.mockRejectedValueOnce(
      new Error("workspace load failed"),
    );
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to load workspace status:",
      expect.objectContaining({ message: "workspace load failed" }),
      expect.objectContaining({ projectPath: "/tmp/project" }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("logs task workbench bootstrap failures with snapshot context", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => void 0);
    taskWorkbenchMocks.createTaskWorkbench.mockRejectedValueOnce(
      new Error("snapshot parse failed"),
    );
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to initialize task workbench:",
      expect.objectContaining({ message: "snapshot parse failed" }),
      expect.objectContaining({ snapshotPath: "task-snapshot.json" }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("logs task lifecycle action failures with task context", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => void 0);
    const lifecycleError = new Error("runner crashed");
    taskWorkbenchMocks.createTaskWorkbench.mockImplementationOnce(async () => ({
      ...(await createMockTaskWorkbench([
        createMockTaskRecord({
          id: "task-1",
          workspaceId: "/tmp/project",
          title: "Queued task",
          prompt: "Queued task",
          status: "queued",
        }),
      ])),
      startTask: vi.fn(async () => {
        throw lifecycleError;
      }),
    }));
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    const queuedTaskButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) => button.textContent?.includes("Queued task (queued)")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      queuedTaskButton?.click();
    });

    const startButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Start"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        startButton?.click();
        await flushPromises();
      });
    });

    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to run task lifecycle action:",
      expect.objectContaining({ message: "runner crashed" }),
      expect.objectContaining({ actionName: "startTask", taskId: "task-1" }),
    );

    consoleErrorSpy.mockRestore();
  });

  it("renders the top-level header and chats workspace by default", async () => {
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    expect(container?.textContent).toContain("Atelier");
    expect(container?.textContent).toContain("Chats");
    expect(container?.textContent).toContain("@acme Sync");
    expect(
      container?.querySelector('[data-testid="workbench-status-bar"]'),
    ).not.toBeNull();
    expect(container?.textContent).toContain("Tasks");
    expect(container?.textContent).toContain("Create task");
    expect(container?.textContent).toContain("Auto");

    const activePanel = container?.querySelector(
      '[data-state="active"][data-slot="tabs-content"]',
    );
    const inactivePanel = container?.querySelector(
      '[data-state="inactive"][data-slot="tabs-content"]',
    );

    expect(activePanel?.textContent).toContain("Chat sidebar");
    expect(activePanel?.textContent).toContain("Conversation workspace");
    expect(inactivePanel?.textContent).not.toContain("Acme Sync view");
  });

  it("leaves hidden views out and opens the first visible one", async () => {
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={({ onOptimizeRules }) => (
            <div data-testid="config-view">
              {onOptimizeRules ? "Optimize Rules" : "no optimize"}
            </div>
          )}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
          hiddenViews={["chats", "sync"]}
        />,
      );
    });

    await settleWorkbenchMount();

    const tabs = [
      ...(container?.querySelectorAll('[data-slot="tabs-trigger"]') ?? []),
    ];
    const tabLabels = tabs.map((tab) => tab.textContent);
    expect(tabLabels).toEqual(["Services", "Skills", "Claude Config"]);

    const activePanel = container?.querySelector(
      '[data-state="active"][data-slot="tabs-content"]',
    );
    expect(activePanel?.textContent).toContain("Services panel");
    expect(activePanel?.textContent).not.toContain("Conversation workspace");

    const configTab = tabs.find((tab) => tab.textContent === "Claude Config");
    flushSync(() => {
      configTab?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    // Optimize Rules would switch to the hidden Chats tab, so it is withheld.
    expect(
      container?.querySelector('[data-testid="config-view"]')?.textContent,
    ).toBe("no optimize");
  });

  it("disables task creation until the workbench is ready", async () => {
    const pendingWorkbench = createMockTaskWorkbench();
    let resolveWorkbench: (value: Awaited<typeof pendingWorkbench>) => void =
      unresolvedWorkbenchResolver;
    taskWorkbenchMocks.createTaskWorkbench.mockImplementationOnce(
      () =>
        new Promise<Awaited<typeof pendingWorkbench>>((resolve) => {
          resolveWorkbench = resolve;
        }),
    );
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    const createButtonBeforeReady = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;

    expect(createButtonBeforeReady?.disabled).toBe(true);

    const resolvedWorkbench = await createMockTaskWorkbench();

    resolveWorkbench(resolvedWorkbench);
    await settleWorkbenchMount();

    const createButtonAfterReady = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;

    expect(createButtonAfterReady?.disabled).toBe(false);
  });

  it("boots the workbench with the Tauri task snapshot adapter", async () => {
    taskWorkbenchMocks.createTaskWorkbench.mockImplementationOnce(
      async (options) => {
        const actualModule = (await vi.importActual(
          "../lib/task-workbench",
        )) as typeof TaskWorkbenchModule;

        return actualModule.createTaskWorkbench(options);
      },
    );
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    expect(tauriMocks.readTaskSnapshot).toHaveBeenCalledWith(
      "task-snapshot.json",
    );
  });

  it("shows a persisted task after mount", async () => {
    taskWorkbenchMocks.createTaskWorkbench.mockImplementationOnce(() =>
      createMockTaskWorkbench([
        createMockTaskRecord({
          id: "task-1",
          workspaceId: "/tmp/project",
          title: "Persisted task",
          prompt: "Persisted task",
          status: "done",
          runnerPreference: "claude",
          resolvedRunner: "claude",
          currentStage: "completed",
          updatedAt: "2026-03-11T00:05:00.000Z",
          summary: "Finished review.",
          thread: [
            {
              id: "thread-1",
              role: "system",
              text: "Task completed successfully.",
              createdAt: "2026-03-11T00:05:00.000Z",
            },
          ],
        }),
      ]),
    );
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    expect(container?.textContent).toContain("Persisted task (done)");
  });

  it("switches from chats to sync without losing the shell header", async () => {
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    const syncButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("@acme Sync"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      syncButton?.click();
    });

    expect(container?.textContent).toContain("Atelier");
    expect(container?.textContent).toContain("Acme Sync view");

    const chatsPanel = container?.querySelector(
      '[data-state="inactive"][data-slot="tabs-content"]',
    );
    const syncPanel = container?.querySelector(
      '[data-state="active"][data-slot="tabs-content"]',
    );

    expect(chatsPanel?.textContent).toContain("Chat sidebar");
    expect(chatsPanel?.textContent).toContain("Conversation workspace");
    expect(syncPanel?.textContent).toContain("Acme Sync view");
  });

  it("preserves sync view state after switching away and back", async () => {
    const { useState } = await import("react");
    const { AppShell } = await import("./app-shell");

    function StatefulSyncView() {
      const [count, setCount] = useState(0);

      return (
        <div>
          <div>{`Sync count ${count}`}</div>
          <button
            type="button"
            onClick={() => setCount((current) => current + 1)}
          >
            Increment sync count
          </button>
        </div>
      );
    }

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<StatefulSyncView />}
        />,
      );
    });

    const syncButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("@acme Sync"),
    ) as HTMLButtonElement | undefined;
    const chatsButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Chats"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      syncButton?.click();
    });

    const incrementButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Increment sync count")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      incrementButton?.click();
    });

    expect(container?.textContent).toContain("Sync count 1");

    flushSync(() => {
      chatsButton?.click();
    });

    flushSync(() => {
      syncButton?.click();
    });

    expect(container?.textContent).toContain("Sync count 1");
  });

  it("shows multiple workspace groups in the shell sidebar while preserving the task create bar", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
    ];

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    expect(container?.textContent).toContain("project");
    expect(container?.textContent).toContain("secondary-workspace");
    expect(container?.textContent).toContain("Create task");
  });

  it("synchronizes workspace selection when a task is chosen and keeps other workspaces visible", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
    ];

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    const promptInput = container?.querySelector(
      'input[placeholder="Ask Atelier to work on this workspace"]',
    ) as HTMLInputElement | undefined;
    const createButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "Task for project");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      createButton?.click();
    });
    await settleWorkbenchMount();

    const secondaryWorkspaceButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) => button.textContent?.includes("secondary-workspace")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      secondaryWorkspaceButton?.click();
    });

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "Task for secondary workspace");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      createButton?.click();
    });
    await settleWorkbenchMount();

    const secondaryTaskButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) =>
      button.textContent?.includes("Task for secondary workspace"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      secondaryTaskButton?.click();
    });

    const selectedWorkspace = container?.querySelector(
      '[data-workspace-id="/tmp/secondary-workspace"] > button[data-selected="true"]',
    );

    expect(selectedWorkspace?.textContent).toContain("secondary-workspace");
    expect(container?.textContent).toContain("Task for project");
    expect(container?.textContent).toContain("Task for secondary workspace");
  });

  it("shows a task detail empty state when no valid task is selected for the focused workspace", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
    ];

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    await settleWorkbenchMount();

    const promptInput = container?.querySelector(
      'input[placeholder="Ask Atelier to work on this workspace"]',
    ) as HTMLInputElement | undefined;
    const createButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;
    const secondaryWorkspaceButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) => button.textContent?.includes("secondary-workspace")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "Task for project");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      createButton?.click();
    });
    await settleWorkbenchMount();

    flushSync(() => {
      secondaryWorkspaceButton?.click();
    });

    expect(container?.textContent).toContain(
      "Select a task for secondary-workspace.",
    );
    expect(container?.textContent).toContain(
      "Choose a task from the focused workspace to inspect its overview, thread, and changes.",
    );
    expect(container?.textContent).toContain("project");
    expect(container?.textContent).toContain("secondary-workspace");
  });

  it("updates sidebar counts after approving an awaiting approval task", async () => {
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    const promptInput = container?.querySelector(
      'input[placeholder="Ask Atelier to work on this workspace"]',
    ) as HTMLInputElement | undefined;
    const createButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "Prepare patch");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      createButton?.click();
    });
    await settleWorkbenchMount();

    const startButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Start"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        startButton?.click();
        await flushPromises();
      });
    });

    expect(container?.textContent).toContain("Awaiting approval 1");

    const approveButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Approve")) as
      | HTMLButtonElement
      | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        approveButton?.click();
        await flushPromises();
      });
    });

    expect(container?.textContent).toContain("Awaiting approval 0");
    expect(container?.textContent).toContain("Recent 1");
    expect(container?.textContent).toContain("Prepare patch (done)");
  });

  it("retries a blocked task and updates its section while keeping other workspaces visible", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
    ];

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    const promptInput = container?.querySelector(
      'input[placeholder="Ask Atelier to work on this workspace"]',
    ) as HTMLInputElement | undefined;
    const createButton = [
      ...(container?.querySelectorAll("button") ?? []),
    ].find((button) => button.textContent?.includes("Create task")) as
      | HTMLButtonElement
      | undefined;
    const secondaryWorkspaceButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) => button.textContent?.includes("secondary-workspace")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "Task for project");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      createButton?.click();
    });
    await settleWorkbenchMount();

    flushSync(() => {
      secondaryWorkspaceButton?.click();
    });

    flushSync(() => {
      if (promptInput) {
        setNativeInputValue(promptInput, "Task for secondary workspace");
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    flushSync(() => {
      createButton?.click();
    });
    await settleWorkbenchMount();

    const secondaryTaskButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) =>
      button.textContent?.includes("Task for secondary workspace (queued)"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      secondaryTaskButton?.click();
    });

    const startButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Start"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        startButton?.click();
        await flushPromises();
      });
    });

    expect(container?.textContent).toContain("Blocked 1");

    const retryButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Retry"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        retryButton?.click();
        await flushPromises();
      });
    });

    expect(container?.textContent).toContain("Blocked 0");
    expect(container?.textContent).toContain("Recent 1");
    expect(container?.textContent).toContain("Task for project");
    expect(container?.textContent).toContain("Task for secondary workspace");
  });

  it("uses the store-selected workspace as the initial task focus", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
    ];
    sessionStoreMocks.selectedWorkspaceId = "/tmp/secondary-workspace";

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    const selectedWorkspace = container?.querySelector(
      '[data-workspace-id="/tmp/secondary-workspace"] > button[data-selected="true"]',
    );

    expect(selectedWorkspace?.textContent).toContain("secondary-workspace");
  });

  it("keeps task workspace focus local instead of mutating the chat workspace store", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
    ];
    sessionStoreMocks.selectedWorkspaceId = "/tmp/project";

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    const secondaryWorkspaceButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) => button.textContent?.includes("secondary-workspace")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      secondaryWorkspaceButton?.click();
    });

    const selectedWorkspace = container?.querySelector(
      '[data-workspace-id="/tmp/secondary-workspace"] > button[data-selected="true"]',
    );

    expect(selectedWorkspace?.textContent).toContain("secondary-workspace");
    expect(sessionStoreMocks.setSelectedWorkspaceId).not.toHaveBeenCalled();
    expect(sessionStoreMocks.selectedWorkspaceId).toBe("/tmp/project");
  });

  it("resyncs task workspace focus when the chat workspace changes", async () => {
    sessionStoreMocks.sessions = [
      { sessionId: "session-1", projectPath: "/tmp/project" },
      { sessionId: "session-2", projectPath: "/tmp/secondary-workspace" },
      { sessionId: "session-3", projectPath: "/tmp/tertiary-workspace" },
    ];
    sessionStoreMocks.selectedWorkspaceId = "/tmp/project";

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    const secondaryWorkspaceButton = [
      ...(container?.querySelectorAll("button[data-selected]") ?? []),
    ].find((button) => button.textContent?.includes("secondary-workspace")) as
      | HTMLButtonElement
      | undefined;

    flushSync(() => {
      secondaryWorkspaceButton?.click();
    });

    sessionStoreMocks.selectedWorkspaceId = "/tmp/tertiary-workspace";
    sessionStoreMocks.getSelectedSession.mockReturnValue({
      projectPath: "/tmp/tertiary-workspace",
    });
    sessionStoreMocks.newSessionProject = "/tmp/tertiary-workspace";
    sessionStoreMocks.emit();

    await settleWorkbenchMount();

    const selectedWorkspace = container?.querySelector(
      '[data-workspace-id="/tmp/tertiary-workspace"] > button[data-selected="true"]',
    );

    expect(selectedWorkspace?.textContent).toContain("tertiary-workspace");
  });

  it("starts a new optimize-rules chat in the chats view", async () => {
    const tauriWindow = globalThis.window as Window & {
      __TAURI_INTERNALS__?: unknown;
    };
    tauriWindow.__TAURI_INTERNALS__ = {};

    const optimizeRulesPrompt =
      "Please review my ~/.claude/settings.json 'allow' and 'deny' lists and group similar commands together using wildcards (like `Bash(git *)` or `File(read:*)`) to make the configuration cleaner and more maintainable. After grouping them, please write the modified configuration back to ~/.claude/settings.json.";

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={({ onOptimizeRules }) => (
            <button type="button" onClick={onOptimizeRules}>
              Trigger Optimize Rules
            </button>
          )}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    const configTab = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Claude Config"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      configTab?.click();
    });

    const optimizeButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Trigger Optimize Rules"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        optimizeButton?.click();
        await flushPromises();
      });
    });

    expect(tauriMocks.ensureDirectory).toHaveBeenCalledWith("/tmp/project");
    expect(sessionStoreMocks.setNewSessionProject).toHaveBeenCalledWith(
      "/tmp/project",
    );
    expect(sessionStoreMocks.setNewSessionPrompt).toHaveBeenCalledWith(
      optimizeRulesPrompt,
    );
    expect(sessionStoreMocks.setSelectedSessionId).toHaveBeenCalledWith(null);
    expect(container?.querySelector('[data-slot="tabs-content"][data-state="active"]')?.textContent).toContain(
      "Conversation workspace",
    );
  });

  it("shows an error toast when optimize-rules setup fails before chat state updates", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => void 0);
    const tauriWindow = globalThis.window as Window & {
      __TAURI_INTERNALS__?: unknown;
    };
    tauriWindow.__TAURI_INTERNALS__ = {};
    tauriMocks.ensureDirectory.mockRejectedValueOnce(
      new Error("failed to create directory"),
    );

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={({ onOptimizeRules }) => (
            <button type="button" onClick={onOptimizeRules}>
              Trigger Optimize Rules
            </button>
          )}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<div data-testid="acme-sync-view">Acme Sync view</div>}
        />,
      );
    });

    await settleWorkbenchMount();

    const configTab = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Claude Config"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      configTab?.click();
    });

    const optimizeButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Trigger Optimize Rules"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        optimizeButton?.click();
        await flushPromises();
      });
    });

    expect(sessionStoreMocks.setNewSessionProject).not.toHaveBeenCalled();
    expect(sessionStoreMocks.setNewSessionPrompt).not.toHaveBeenCalled();
    expect(sessionStoreMocks.setSelectedSessionId).not.toHaveBeenCalled();
    expect(consoleErrorSpy).toHaveBeenCalledWith(
      "Failed to prepare Optimize Rules chat:",
      expect.objectContaining({ message: "failed to create directory" }),
      expect.objectContaining({
        effectiveSelectedWorkspaceId: "/tmp/project",
        attemptedProjectPath: "/tmp/project",
      }),
    );
    expect(toastMocks.addToast).toHaveBeenCalledWith(
      "Failed to prepare Optimize Rules chat: failed to create directory",
      "error",
    );
    expect(container?.querySelector('[data-slot="tabs-content"][data-state="active"]')?.textContent).not.toContain(
      "Conversation workspace",
    );

    consoleErrorSpy.mockRestore();
  });

  it("preserves the non-Tauri guard in the top-level app", async () => {
    const tauriWindow = globalThis.window as Window & {
      __TAURI_INTERNALS__?: unknown;
    };
    delete tauriWindow.__TAURI_INTERNALS__;

    const { default: App } = await import("../app");

    flushSync(() => {
      root?.render(<App />);
    });

    expect(
      container?.querySelector('[data-testid="not-tauri-error"]'),
    ).not.toBeNull();
    expect(container?.querySelector('[data-testid="app-toaster"]')).toBeNull();
  });
});
