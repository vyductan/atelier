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

vi.mock("@acme/ui/components/input", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@acme/ui/components/input")>();

  return {
    ...actual,
    Input: (props: ComponentPropsWithoutRef<"input">) => <input {...props} />,
  };
});

vi.mock("@acme/ui/components/select", () => ({
  Select: ({
    id,
    value,
    options = [],
    onChange,
    "aria-label": ariaLabel,
  }: {
    id?: string;
    value?: string;
    options?: Array<{ label: string; value: string }>;
    onChange?: (value: string) => void;
    "aria-label"?: string;
  }) => (
    <select
      aria-label={ariaLabel}
      id={id}
      value={value ?? ""}
      onChange={(event) => onChange?.(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));

vi.mock("@acme/ui/components/switch", () => ({
  Switch: ({
    checked,
    onChange,
    id,
    disabled,
    "aria-label": ariaLabel,
  }: {
    checked?: boolean;
    onChange?: (checked: boolean) => void;
    id?: string;
    disabled?: boolean;
    "aria-label"?: string;
  }) => (
    <input
      aria-label={ariaLabel}
      checked={checked ?? false}
      disabled={disabled}
      id={id}
      type="checkbox"
      onChange={(event) => onChange?.(event.target.checked)}
    />
  ),
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
  ChatSidebar: ({
    allTasks,
    selectedTaskId,
    selectedWorkspaceId,
    onSelectWorkspace,
    onSelectTask,
  }: {
    allTasks: TaskRecord[];
    selectedTaskId: string | null;
    selectedWorkspaceId?: string | null;
    onSelectWorkspace?: (workspaceId: string) => void;
    onSelectTask: (taskId: string) => void;
  }) => {
    const workspaceIds = [
      ...(selectedWorkspaceId ? [selectedWorkspaceId] : []),
      ...sessionStoreMocks.sessions
        .map((session) => session.projectPath)
        .filter((value): value is string => Boolean(value)),
      ...allTasks.map((task) => task.workspaceId),
    ].filter((value, index, values) => values.indexOf(value) === index);

    return (
      <aside data-testid="chat-sidebar">
        <div>Chat sidebar</div>
        {workspaceIds.map((workspaceId) => {
          const workspaceTasks = allTasks.filter((task) => task.workspaceId === workspaceId);
          const workspaceLabel = workspaceId.split("/").filter(Boolean).at(-1) ?? workspaceId;
          const counts = {
            running: workspaceTasks.filter((task) => task.status === "running").length,
            awaitingApproval: workspaceTasks.filter((task) => task.status === "awaiting_approval").length,
            blocked: workspaceTasks.filter((task) => task.status === "blocked").length,
            recent: workspaceTasks.filter(
              (task) => task.status !== "running" && task.status !== "awaiting_approval" && task.status !== "blocked",
            ).length,
          };

          return (
            <section key={workspaceId} data-workspace-id={workspaceId}>
              <button
                type="button"
                data-selected={workspaceId === selectedWorkspaceId}
                onClick={() => onSelectWorkspace?.(workspaceId)}
              >
                {workspaceLabel}
              </button>
              <div>{`Running ${counts.running}`}</div>
              <div>{`Awaiting approval ${counts.awaitingApproval}`}</div>
              <div>{`Blocked ${counts.blocked}`}</div>
              <div>{`Recent ${counts.recent}`}</div>
              {workspaceTasks.map((task) => (
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
    );
  },
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
  readScheduledTaskSnapshot: vi.fn(),
  writeScheduledTaskSnapshot: vi.fn(),
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

const scheduledTaskWorkbenchMocks = vi.hoisted(() => ({
  createScheduledTaskWorkbench: vi.fn(),
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

vi.mock("../lib/scheduled-task-workbench", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../lib/scheduled-task-workbench")>();

  return {
    ...actual,
    createScheduledTaskWorkbench: scheduledTaskWorkbenchMocks.createScheduledTaskWorkbench,
  };
});

vi.mock("../lib/tauri", () => ({
  readTaskSnapshot: tauriMocks.readTaskSnapshot,
  writeTaskSnapshot: tauriMocks.writeTaskSnapshot,
  readScheduledTaskSnapshot: tauriMocks.readScheduledTaskSnapshot,
  writeScheduledTaskSnapshot: tauriMocks.writeScheduledTaskSnapshot,
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
    scheduledTaskWorkbenchMocks.createScheduledTaskWorkbench.mockReset();
    scheduledTaskWorkbenchMocks.createScheduledTaskWorkbench.mockImplementation(async () => {
      const tasks = [
        {
          id: "sched-1",
          name: "Daily workspace check-in",
          description: "Summarize the workspace every morning.",
          workspacePath: "/tmp/project",
          prompt: "Summarize what changed and flag anything blocked.",
          model: "claude-sonnet-4-6",
          permissionMode: "ask",
          worktree: { enabled: true },
          schedule: {
            type: "daily",
            cron: "0 9 * * *",
            timezone: "UTC",
            enabled: true,
            jitterMinutes: 10,
          },
          nextRunAt: null,
          lastScheduledAt: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastMissedAt: null,
          engineState: "idle",
          rememberedApprovals: [],
          importSource: "none",
          importedAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      ];
      const runs = [
        {
          runId: "run-1",
          scheduledTaskId: "sched-1",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          startedAt: "2026-04-05T09:00:30.000Z",
          finishedAt: "2026-04-05T09:01:00.000Z",
          status: "completed",
          reason: "run_now",
          linkedSessionId: null,
          linkedTaskId: null,
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-05T09:00:00.000Z",
          updatedAt: "2026-04-05T09:01:00.000Z",
        },
      ];

      return {
        createScheduledTask: vi.fn(async (input) => {
          const createdTask = {
            ...tasks[0],
            id: `sched-${tasks.length + 1}`,
            name: input.name,
            description: input.description,
            workspacePath: input.workspacePath,
            prompt: input.prompt,
            model: input.model,
            permissionMode: input.permissionMode,
            worktree: input.worktree,
            schedule: input.schedule,
          };
          tasks.push(createdTask);
          return createdTask;
        }),
        getScheduledTask: vi.fn((taskId: string) =>
          tasks.find((task) => task.id === taskId) ?? null,
        ),
        listScheduledTasks: vi.fn(() => tasks),
        listScheduledRuns: vi.fn(() => runs),
        listRunsByTask: vi.fn((taskId: string) =>
          runs.filter((run) => run.scheduledTaskId === taskId),
        ),
        reconcileLinkedRun: vi.fn(async () => null),
        runNow: vi.fn(async (taskId: string) => {
          const run = {
            runId: `run-${runs.length + 1}`,
            scheduledTaskId: taskId,
            scheduledFor: null,
            startedAt: "2026-04-05T10:00:00.000Z",
            finishedAt: "2026-04-05T10:01:00.000Z",
            status: "completed",
            reason: "run_now",
            linkedSessionId: null,
            linkedTaskId: null,
            errorSummary: null,
            summary: null,
            createdAt: "2026-04-05T10:00:00.000Z",
            updatedAt: "2026-04-05T10:01:00.000Z",
          };
          runs.push(run);
          return run;
        }),
        tick: vi.fn(async () => []),
      };
    });
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
    tauriMocks.readScheduledTaskSnapshot.mockReset();
    tauriMocks.readScheduledTaskSnapshot.mockRejectedValue(
      Object.assign(new Error("File not found"), { code: "ENOENT" }),
    );
    tauriMocks.writeScheduledTaskSnapshot.mockReset();
    tauriMocks.writeScheduledTaskSnapshot.mockImplementation(async () => {
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
      "Failed to initialize workbenches:",
      expect.objectContaining({ message: "snapshot parse failed" }),
      expect.objectContaining({
        taskSnapshotPath: "task-snapshot.json",
        scheduledTaskSnapshotPath: "scheduled-task-snapshot.json",
      }),
    );
    expect(toastMocks.addToast).toHaveBeenCalledWith(
      "Failed to load scheduled tasks: snapshot parse failed",
      "error",
    );
    expect(container?.textContent).toContain("snapshot parse failed");

    consoleErrorSpy.mockRestore();
  });

  it("surfaces scheduled task engine bootstrap failures to the user", async () => {
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
      "Failed to initialize workbenches:",
      expect.objectContaining({ message: "snapshot parse failed" }),
      expect.objectContaining({
        taskSnapshotPath: "task-snapshot.json",
        scheduledTaskSnapshotPath: "scheduled-task-snapshot.json",
      }),
    );
    expect(toastMocks.addToast).toHaveBeenCalledWith(
      "Failed to load scheduled tasks: snapshot parse failed",
      "error",
    );
    expect(container?.textContent).toContain("snapshot parse failed");

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
    expect(toastMocks.addToast).toHaveBeenCalledWith(
      "Failed to start task: runner crashed",
      "error",
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
    expect(container?.textContent).toContain("Schedule");
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

  it("switches to the schedule tab and shows persisted scheduled tasks", async () => {
    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={<div data-testid="config-view" />}
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

    const scheduleButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Schedule"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      scheduleButton?.click();
    });

    const activePanel = container?.querySelector(
      '[data-state="active"][data-slot="tabs-content"]',
    );
    const worktreeToggle = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Worktree enabled",
    ) as HTMLInputElement | undefined;

    expect(activePanel?.textContent).toContain("Scheduled tasks");
    expect(activePanel?.textContent).toContain("Daily workspace check-in");
    expect(activePanel?.textContent).toContain("Run now");
    expect(activePanel?.textContent).not.toContain("Conversation workspace");
    expect(worktreeToggle?.disabled).toBe(false);
  });

  it("passes the selected worktree setting when creating a scheduled task", async () => {
    const createScheduledTask = vi.fn(async (input) => ({
      id: "sched-created",
      name: input.name,
      description: input.description,
      workspacePath: input.workspacePath,
      prompt: input.prompt,
      model: input.model,
      permissionMode: input.permissionMode,
      worktree: input.worktree,
      schedule: input.schedule,
      nextRunAt: null,
      lastScheduledAt: null,
      lastStartedAt: null,
      lastFinishedAt: null,
      lastMissedAt: null,
      engineState: "idle",
      rememberedApprovals: [],
      importSource: "none",
      importedAt: null,
      createdAt: "2026-04-05T00:00:00.000Z",
      updatedAt: "2026-04-05T00:00:00.000Z",
    }));

    scheduledTaskWorkbenchMocks.createScheduledTaskWorkbench.mockImplementationOnce(async () => {
      const tasks = [
        {
          id: "sched-1",
          name: "Daily workspace check-in",
          description: "Summarize the workspace every morning.",
          workspacePath: "/tmp/project",
          prompt: "Summarize what changed and flag anything blocked.",
          model: "claude-sonnet-4-6",
          permissionMode: "ask",
          worktree: { enabled: true },
          schedule: {
            type: "daily",
            cron: "0 9 * * *",
            timezone: "UTC",
            enabled: true,
            jitterMinutes: 10,
          },
          nextRunAt: null,
          lastScheduledAt: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastMissedAt: null,
          engineState: "idle",
          rememberedApprovals: [],
          importSource: "none",
          importedAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      ];
      const runs = [
        {
          runId: "run-1",
          scheduledTaskId: "sched-1",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          startedAt: "2026-04-05T09:00:30.000Z",
          finishedAt: "2026-04-05T09:01:00.000Z",
          status: "completed",
          reason: "run_now",
          linkedSessionId: null,
          linkedTaskId: null,
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-05T09:00:00.000Z",
          updatedAt: "2026-04-05T09:01:00.000Z",
        },
      ];

      return {
        createScheduledTask,
        getScheduledTask: vi.fn((taskId: string) =>
          tasks.find((task) => task.id === taskId) ?? null,
        ),
        listScheduledTasks: vi.fn(() => tasks),
        listScheduledRuns: vi.fn(() => runs),
        listRunsByTask: vi.fn((taskId: string) =>
          runs.filter((run) => run.scheduledTaskId === taskId),
        ),
        reconcileLinkedRun: vi.fn(async () => null),
        runNow: vi.fn(async (taskId: string) => ({
          runId: `run-${runs.length + 1}`,
          scheduledTaskId: taskId,
          scheduledFor: null,
          startedAt: "2026-04-05T10:00:00.000Z",
          finishedAt: "2026-04-05T10:01:00.000Z",
          status: "completed",
          reason: "run_now",
          linkedSessionId: null,
          linkedTaskId: null,
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:01:00.000Z",
        })),
        tick: vi.fn(async () => []),
      };
    });

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={<div data-testid="config-view" />}
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

    const scheduleButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Schedule"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      scheduleButton?.click();
    });

    const nameInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Name",
    ) as HTMLInputElement | undefined;
    const workspaceInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Workspace path",
    ) as HTMLInputElement | undefined;
    const cronInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Cron expression",
    ) as HTMLInputElement | undefined;
    const promptInput = [...(container?.querySelectorAll("textarea") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Prompt",
    ) as HTMLTextAreaElement | undefined;
    const submitButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Create schedule"),
    ) as HTMLButtonElement | undefined;

    const worktreeToggle = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Worktree enabled",
    ) as HTMLInputElement | undefined;

    flushSync(() => {
      if (nameInput) {
        setNativeInputValue(nameInput, "Morning review");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (workspaceInput) {
        setNativeInputValue(workspaceInput, "/tmp/project");
        workspaceInput.dispatchEvent(new Event("input", { bubbles: true }));
        workspaceInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (cronInput) {
        setNativeInputValue(cronInput, "0 9 * * *");
        cronInput.dispatchEvent(new Event("input", { bubbles: true }));
        cronInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (promptInput) {
        promptInput.value = "Review the workspace";
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (worktreeToggle) {
        worktreeToggle.click();
      }
    });

    await runWithActEnvironment(async () => {
      await act(async () => {
        submitButton?.click();
        await flushPromises();
      });
    });

    expect(createScheduledTask).toHaveBeenCalledWith(
      expect.objectContaining({
        worktree: { enabled: true },
      }),
    );
  });

  it("shows a toast when scheduled task creation fails", async () => {
    scheduledTaskWorkbenchMocks.createScheduledTaskWorkbench.mockImplementationOnce(async () => {
      const tasks = [
        {
          id: "sched-1",
          name: "Daily workspace check-in",
          description: "Summarize the workspace every morning.",
          workspacePath: "/tmp/project",
          prompt: "Summarize what changed and flag anything blocked.",
          model: "claude-sonnet-4-6",
          permissionMode: "ask",
          worktree: { enabled: true },
          schedule: {
            type: "daily",
            cron: "0 9 * * *",
            timezone: "UTC",
            enabled: true,
            jitterMinutes: 10,
          },
          nextRunAt: null,
          lastScheduledAt: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastMissedAt: null,
          engineState: "idle",
          rememberedApprovals: [],
          importSource: "none",
          importedAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T00:00:00.000Z",
        },
      ];
      const runs = [
        {
          runId: "run-1",
          scheduledTaskId: "sched-1",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          startedAt: "2026-04-05T09:00:30.000Z",
          finishedAt: "2026-04-05T09:01:00.000Z",
          status: "completed",
          reason: "run_now",
          linkedSessionId: null,
          linkedTaskId: null,
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-05T09:00:00.000Z",
          updatedAt: "2026-04-05T09:01:00.000Z",
        },
      ];

      return {
        createScheduledTask: vi.fn(async () => {
          throw new Error("persist failed");
        }),
        getScheduledTask: vi.fn((taskId: string) =>
          tasks.find((task) => task.id === taskId) ?? null,
        ),
        listScheduledTasks: vi.fn(() => tasks),
        listScheduledRuns: vi.fn(() => runs),
        listRunsByTask: vi.fn((taskId: string) =>
          runs.filter((run) => run.scheduledTaskId === taskId),
        ),
        reconcileLinkedRun: vi.fn(async () => null),
        runNow: vi.fn(async (taskId: string) => ({
          runId: `run-${runs.length + 1}`,
          scheduledTaskId: taskId,
          scheduledFor: null,
          startedAt: "2026-04-05T10:00:00.000Z",
          finishedAt: "2026-04-05T10:01:00.000Z",
          status: "completed",
          reason: "run_now",
          linkedSessionId: null,
          linkedTaskId: null,
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:01:00.000Z",
        })),
        tick: vi.fn(async () => []),
      };
    });

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={<div data-testid="config-view" />}
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

    const scheduleButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Schedule"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      scheduleButton?.click();
    });

    const nameInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Name",
    ) as HTMLInputElement | undefined;
    const workspaceInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Workspace path",
    ) as HTMLInputElement | undefined;
    const cronInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Cron expression",
    ) as HTMLInputElement | undefined;
    const promptInput = [...(container?.querySelectorAll("textarea") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Prompt",
    ) as HTMLTextAreaElement | undefined;
    const submitButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Create schedule"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      if (nameInput) {
        setNativeInputValue(nameInput, "Morning review");
        nameInput.dispatchEvent(new Event("input", { bubbles: true }));
        nameInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (workspaceInput) {
        setNativeInputValue(workspaceInput, "/tmp/project");
        workspaceInput.dispatchEvent(new Event("input", { bubbles: true }));
        workspaceInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (cronInput) {
        setNativeInputValue(cronInput, "0 9 * * *");
        cronInput.dispatchEvent(new Event("input", { bubbles: true }));
        cronInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
      if (promptInput) {
        promptInput.value = "Review the workspace";
        promptInput.dispatchEvent(new Event("input", { bubbles: true }));
        promptInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    });

    await runWithActEnvironment(async () => {
      await act(async () => {
        submitButton?.click();
        await flushPromises();
      });
    });

    expect(toastMocks.addToast).toHaveBeenCalledWith(
      "Failed to create schedule: persist failed",
      "error",
    );
  });

  it("opens the schedule tab with a prefilled draft from the sync view", async () => {
    const { AppShell } = await import("./app-shell");
    const SyncView = ({
      onCreateScheduledSyncTask,
    }: {
      onCreateScheduledSyncTask?: (draft: import("./scheduled-task-form").ScheduledTaskFormInput) => void;
    }) => (
      <button
        type="button"
        onClick={() =>
          onCreateScheduledSyncTask?.({
            name: "@acme sync project-a",
            description: "Daily bidirectional @acme sync for project-a with review and PR creation.",
            workspacePath: "/repo/project-a",
            prompt: "Run the daily @acme sync workflow.",
            frequency: "daily",
            cron: "0 9 * * *",
            worktreeEnabled: true,
          })
        }
      >
        Seed scheduled sync draft
      </button>
    );

    flushSync(() => {
      root?.render(
        <AppShell
          configView={<div data-testid="config-view" />}
          chatsWorkspace={
            <div data-testid="conversation-workspace">
              Conversation workspace
            </div>
          }
          syncView={<SyncView />}
        />,
      );
    });

    await settleWorkbenchMount();

    const syncButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("@acme Sync"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      syncButton?.click();
    });

    const seedButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Seed scheduled sync draft"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        seedButton?.click();
        await flushPromises();
      });
    });

    const scheduleTrigger = container?.querySelector(
      '[data-slot="tabs-trigger"][data-state="active"]',
    );
    const activePanel = container?.querySelector(
      '[data-state="active"][data-slot="tabs-content"]',
    );
    const nameInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Name",
    ) as HTMLInputElement | undefined;
    const workspaceInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Workspace path",
    ) as HTMLInputElement | undefined;
    const cronInput = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Cron expression",
    ) as HTMLInputElement | undefined;
    const promptInput = [...(container?.querySelectorAll("textarea") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Prompt",
    ) as HTMLTextAreaElement | undefined;
    const worktreeToggle = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Worktree enabled",
    ) as HTMLInputElement | undefined;

    expect(scheduleTrigger?.textContent).toContain("Schedule");
    expect(activePanel?.textContent).toContain("Create scheduled task");
    expect(nameInput?.value).toBe("@acme sync project-a");
    expect(workspaceInput?.value).toBe("/repo/project-a");
    expect(cronInput?.value).toBe("0 9 * * *");
    expect(promptInput?.value).toContain("Run the daily @acme sync workflow.");
    expect(worktreeToggle?.checked).toBe(true);
  });

  it("clears the prefilled draft when cancelling schedule creation", async () => {
    const { AppShell } = await import("./app-shell");
    const SyncView = ({
      onCreateScheduledSyncTask,
    }: {
      onCreateScheduledSyncTask?: (draft: import("./scheduled-task-form").ScheduledTaskFormInput) => void;
    }) => (
      <button
        type="button"
        onClick={() =>
          onCreateScheduledSyncTask?.({
            name: "@acme sync project-a",
            description: "Daily bidirectional @acme sync for project-a with review and PR creation.",
            workspacePath: "/repo/project-a",
            prompt: "Run the daily @acme sync workflow.",
            frequency: "daily",
            cron: "0 9 * * *",
            worktreeEnabled: true,
          })
        }
      >
        Seed scheduled sync draft
      </button>
    );

    flushSync(() => {
      root?.render(
        <AppShell
          configView={<div data-testid="config-view" />}
          chatsWorkspace={<div data-testid="conversation-workspace">Conversation workspace</div>}
          syncView={<SyncView />}
        />,
      );
    });

    await settleWorkbenchMount();

    const syncButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("@acme Sync"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      syncButton?.click();
    });

    const seedButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Seed scheduled sync draft"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        seedButton?.click();
        await flushPromises();
      });
    });

    const cancelButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Cancel"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        cancelButton?.click();
        await flushPromises();
      });
    });

    const nameInputAfterCancel = [...(container?.querySelectorAll("input") ?? [])].find(
      (input) => input.getAttribute("aria-label") === "Name",
    ) as HTMLInputElement | undefined;

    expect(nameInputAfterCancel?.value).toBe("");
  });

  it("warns when a schedule starts but persistence fails", async () => {
    scheduledTaskWorkbenchMocks.createScheduledTaskWorkbench.mockImplementationOnce(async () => {
      const tasks = [
        {
          id: "sched-1",
          name: "Daily workspace check-in",
          description: "Summarize the workspace every morning.",
          workspacePath: "/tmp/project",
          prompt: "Summarize what changed and flag anything blocked.",
          model: "claude-sonnet-4-6",
          permissionMode: "ask",
          worktree: { enabled: false },
          schedule: {
            type: "daily",
            cron: "0 9 * * *",
            timezone: "UTC",
            enabled: true,
            jitterMinutes: 10,
          },
          nextRunAt: null,
          lastScheduledAt: null,
          lastStartedAt: "2026-04-05T10:00:00.000Z",
          lastFinishedAt: null,
          lastMissedAt: null,
          engineState: "running",
          rememberedApprovals: [],
          importSource: "none",
          importedAt: null,
          createdAt: "2026-04-05T00:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z",
        },
      ];
      const runs = [
        {
          runId: "run-1",
          scheduledTaskId: "sched-1",
          scheduledFor: null,
          startedAt: "2026-04-05T10:00:00.000Z",
          finishedAt: null,
          status: "running",
          reason: "run_now",
          linkedSessionId: null,
          linkedTaskId: "task-123",
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-05T10:00:00.000Z",
          updatedAt: "2026-04-05T10:00:00.000Z",
        },
      ];

      return {
        createScheduledTask: vi.fn(async () => tasks[0]),
        getScheduledTask: vi.fn((taskId: string) =>
          tasks.find((task) => task.id === taskId) ?? null,
        ),
        listScheduledTasks: vi.fn(() => tasks),
        listScheduledRuns: vi.fn(() => runs),
        listRunsByTask: vi.fn((taskId: string) =>
          runs.filter((run) => run.scheduledTaskId === taskId),
        ),
        reconcileLinkedRun: vi.fn(async () => null),
        runNow: vi.fn(async () => {
          const workbenchModule = await import("../lib/scheduled-task-workbench");
          throw new workbenchModule.ScheduledRunPersistenceError({
            message: "Scheduled run started but its state could not be persisted",
            run: runs[0],
            task: tasks[0],
            cause: new Error("disk full"),
          });
        }),
        tick: vi.fn(async () => []),
      };
    });

    const { AppShell } = await import("./app-shell");

    flushSync(() => {
      root?.render(
        <AppShell
          configView={<div data-testid="config-view" />}
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

    const scheduleButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Schedule"),
    ) as HTMLButtonElement | undefined;

    flushSync(() => {
      scheduleButton?.click();
    });

    const runNowButton = [...(container?.querySelectorAll("button") ?? [])].find(
      (button) => button.textContent?.includes("Run now"),
    ) as HTMLButtonElement | undefined;

    await runWithActEnvironment(async () => {
      await act(async () => {
        runNowButton?.click();
        await flushPromises();
      });
    });

    expect(toastMocks.addToast).toHaveBeenCalledWith(
      "Schedule started, but Atelier could not save its updated state. Avoid retrying until persistence is fixed.",
      "error",
    );
    expect(container?.textContent).toContain("Daily workspace check-in");
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

  it("boots the workbench with the task snapshot persistence adapter", async () => {
    const createTaskWorkbenchSpy = vi.fn();

    taskWorkbenchMocks.createTaskWorkbench.mockImplementationOnce(
      async (options) => {
        createTaskWorkbenchSpy(options);
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

    expect(createTaskWorkbenchSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        persistence: expect.objectContaining({
          loadTasks: expect.any(Function),
          saveTasks: expect.any(Function),
        }),
      }),
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
