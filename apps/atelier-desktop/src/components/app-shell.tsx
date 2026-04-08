import type { JSX, ReactNode } from "react";
import { cloneElement, isValidElement, useCallback, useEffect, useMemo, useState } from "react";

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@acme/ui/components/tabs";

import type { TaskWorkbench } from "../lib/task-workbench";
import {
  ScheduleDetailPanel,
  ScheduleSidebar,
  type ScheduledTaskDefinition,
  type ScheduledTaskFormInput,
  type ScheduledTaskRunRecord,
  createScheduledTaskWorkbench,
  ScheduledRunPersistenceError,
} from "~/features/scheduled-tasks";
import type { TaskRecord, WorkspaceRecord } from "../lib/tasks";
import type { WorkbenchStatusBarState } from "./workbench-status-bar";
import { atelierClient } from "../lib/atelier-client";
import {
  createScheduledTaskPersistence,
} from "~/features/scheduled-tasks/services/scheduled-task-persistence";
import {
  readScheduledTaskSnapshot,
  writeScheduledTaskSnapshot,
} from "~/features/scheduled-tasks/services/scheduled-task-tauri";
import { loadSyncStrategyMarkdown } from "~/features/scheduled-tasks/services/load-sync-strategy-markdown";
import { createTaskPersistence } from "../lib/task-persistence";
import { createTaskWorkbench } from "../lib/task-workbench";
import { readTaskSnapshot, writeTaskSnapshot } from "../lib/tauri";
import { regenerateScheduledSyncTaskDraft } from "~/features/scheduled-tasks/domain/scheduled-task-sync-strategy";
import { useSessionStore } from "../store/session-store";
import { useToastStore } from "../store/toast-store";
import { TaskCreateBar } from "./task-create-bar";
import { TaskDetailPanel } from "./task-detail-panel";
import { WorkbenchStatusBar } from "./workbench-status-bar";
import { ChatSidebar } from "./chat-sidebar";
import { SkillsManagerPanel } from "../features/skills-manager/skills-manager-panel";

interface AppShellProps {
  chatsWorkspace: ReactNode;
  syncView: ReactNode;
  configView: ReactNode | ((props: { onOptimizeRules: () => void }) => ReactNode);
}

function resolveWorkspaceState(
  projectPath: string | null,
  workspaceSnapshot: {
    projectPath: string;
    state: WorkbenchStatusBarState;
  } | null,
): WorkbenchStatusBarState {
  if (!projectPath) {
    return "error";
  }

  if (workspaceSnapshot?.projectPath !== projectPath) {
    return "loading";
  }

  return workspaceSnapshot.state;
}

function getWorkspaceName(workspace: WorkspaceRecord | null): string {
  if (!workspace) {
    return "Current workspace";
  }

  const segments = workspace.path.split("/").filter(Boolean);
  return segments.at(-1) ?? workspace.path;
}

function sortTasksByUpdatedAtDesc(tasks: TaskRecord[]): TaskRecord[] {
  return tasks.toSorted(
    (left, right) =>
      new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime(),
  );
}

function mapStartedTaskStatusToScheduledRunStatus(
  status: TaskRecord["status"],
): "running" | "stalled_for_permission" | "failed" | "completed" {
  if (status === "done") {
    return "completed";
  }

  if (status === "awaiting_approval") {
    return "stalled_for_permission";
  }

  if (status === "failed" || status === "blocked" || status === "cancelled") {
    return "failed";
  }

  return "running";
}

function mapTerminalTaskStatusToScheduledRunStatus(
  status: TaskRecord["status"],
): ScheduledTaskRunRecord["status"] {
  if (status === "done") {
    return "completed";
  }

  if (status === "awaiting_approval") {
    return "stalled_for_permission";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "failed" || status === "blocked") {
    return "failed";
  }

  return "running";
}

const TASK_SNAPSHOT_PATH = "task-snapshot.json";
const SCHEDULED_TASK_SNAPSHOT_PATH = "scheduled-task-snapshot.json";

export function AppShell({
  chatsWorkspace,
  syncView,
  configView,
}: AppShellProps): JSX.Element {
  const [activeView, setActiveView] = useState<
    "chats" | "schedule" | "sync" | "skills" | "config"
  >("chats");
  const [hasMountedSyncView, setHasMountedSyncView] = useState(false);
  const [hasMountedConfigView, setHasMountedConfigView] = useState(false);
  const [hasMountedSkillsView, setHasMountedSkillsView] = useState(false);
  const [taskWorkbench, setTaskWorkbench] = useState<TaskWorkbench | null>(
    null,
  );
  const [scheduledTaskWorkbench, setScheduledTaskWorkbench] = useState<Awaited<
    ReturnType<typeof createScheduledTaskWorkbench>
  > | null>(null);
  const [allTasks, setAllTasks] = useState<TaskRecord[]>([]);
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTaskDefinition[]>([]);
  const [scheduledTaskRuns, setScheduledTaskRuns] = useState<ScheduledTaskRunRecord[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedScheduledTaskId, setSelectedScheduledTaskId] = useState<string | null>(null);
  const [isEditingScheduledTask, setIsEditingScheduledTask] = useState(false);
  const [scheduledTaskDraft, setScheduledTaskDraft] =
    useState<ScheduledTaskFormInput | null>(null);
  const [scheduledTaskLoadError, setScheduledTaskLoadError] = useState<string | null>(null);
  const [scheduledTaskTickError, setScheduledTaskTickError] = useState<string | null>(null);
  const storedSelectedWorkspaceId = useSessionStore(
    (state) => state.selectedWorkspaceId,
  );
  const selectedSession = useSessionStore((state) =>
    state.getSelectedSession(),
  );
  const sessions = useSessionStore((state) => state.sessions);
  const newSessionProject = useSessionStore((state) => state.newSessionProject);
  const addToast = useToastStore((state) => state.addToast);
  const [workspaceSnapshot, setWorkspaceSnapshot] = useState<{
    projectPath: string;
    state: WorkbenchStatusBarState;
    status: Awaited<
      ReturnType<typeof atelierClient.workspace.getStatus>
    > | null;
  } | null>(null);
  const projectPath = newSessionProject ?? selectedSession?.projectPath ?? null;
  const chatWorkspaceId = storedSelectedWorkspaceId ?? projectPath ?? null;
  const [workspaceSelection, setWorkspaceSelection] = useState<{
    contextWorkspaceId: string | null;
    workspaceId: string | null;
  }>(() => ({
    contextWorkspaceId: chatWorkspaceId,
    workspaceId: chatWorkspaceId,
  }));

  const setSelectedWorkspaceId = (workspaceId: string | null) => {
    setWorkspaceSelection({
      contextWorkspaceId: chatWorkspaceId,
      workspaceId,
    });
  };

  const workspaces = useMemo<WorkspaceRecord[]>(() => {
    const paths = new Set<string>();

    if (projectPath) {
      paths.add(projectPath);
    }

    for (const session of sessions) {
      if (session.projectPath) {
        paths.add(session.projectPath);
      }
    }

    if (paths.size === 0) {
      paths.add("current-workspace");
    }

    return [...paths].map((path) => ({
      id: path,
      path,
      repoRoot: path,
      branch:
        path === projectPath
          ? (workspaceSnapshot?.status?.branch ?? null)
          : null,
      isWorktree: false,
      activeTaskIds: allTasks
        .filter((task) => task.workspaceId === path)
        .map((task) => task.id),
    }));
  }, [allTasks, projectPath, sessions, workspaceSnapshot?.status?.branch]);

  const candidateSelectedWorkspaceId =
    (workspaceSelection.contextWorkspaceId === chatWorkspaceId
      ? workspaceSelection.workspaceId
      : chatWorkspaceId) ??
    projectPath ??
    workspaces[0]?.id ??
    null;
  const effectiveSelectedWorkspaceId = workspaces.some(
    (workspace) => workspace.id === candidateSelectedWorkspaceId,
  )
    ? candidateSelectedWorkspaceId
    : (workspaces[0]?.id ?? null);
  const selectedWorkspace =
    workspaces.find(
      (workspace) => workspace.id === effectiveSelectedWorkspaceId,
    ) ??
    workspaces[0] ??
    null;
  const workspaceName = getWorkspaceName(selectedWorkspace);

  useEffect(() => {
    let cancelled = false;

    async function loadWorkbenches(): Promise<void> {
      try {
        const loadedTaskWorkbench = await createTaskWorkbench({
          persistence: createTaskPersistence({
            filePath: TASK_SNAPSHOT_PATH,
            readTextFile: readTaskSnapshot,
            writeTextFile: writeTaskSnapshot,
          }),
        });

        const loadedScheduledTaskWorkbench = await createScheduledTaskWorkbench({
          persistence: createScheduledTaskPersistence({
            filePath: SCHEDULED_TASK_SNAPSHOT_PATH,
            readTextFile: readScheduledTaskSnapshot,
            writeTextFile: writeScheduledTaskSnapshot,
          }),
          runner: {
            startScheduledRun: async ({ workspacePath, prompt }) => {
              const task = await loadedTaskWorkbench.createTask({
                workspaceId: workspacePath,
                prompt,
                runnerPreference: "claude",
              });
              const startedTask = await loadedTaskWorkbench.startTask(task.id);

              if (!cancelled) {
                setAllTasks(sortTasksByUpdatedAtDesc(loadedTaskWorkbench.listTasks()));
                setSelectedWorkspaceId(task.workspaceId);
                setSelectedTaskId(task.id);
              }

              return {
                linkedSessionId: null,
                linkedTaskId: task.id,
                status: mapStartedTaskStatusToScheduledRunStatus(
                  startedTask?.status ?? task.status,
                ),
              };
            },
          },
        });

        if (cancelled) {
          return;
        }

        setTaskWorkbench(loadedTaskWorkbench);
        setAllTasks(sortTasksByUpdatedAtDesc(loadedTaskWorkbench.listTasks()));
        setScheduledTaskWorkbench(loadedScheduledTaskWorkbench);
        setScheduledTasks(loadedScheduledTaskWorkbench.listScheduledTasks());
        setScheduledTaskRuns(loadedScheduledTaskWorkbench.listScheduledRuns());
        setScheduledTaskLoadError(null);
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to initialize workbenches:", error, {
          taskSnapshotPath: TASK_SNAPSHOT_PATH,
          scheduledTaskSnapshotPath: SCHEDULED_TASK_SNAPSHOT_PATH,
        });
        setScheduledTaskLoadError(
          error instanceof Error ? error.message : String(error),
        );
        addToast(
          `Failed to load scheduled tasks: ${error instanceof Error ? error.message : String(error)}`,
          "error",
        );
      }
    }

    void loadWorkbenches();

    return () => {
      cancelled = true;
    };
  }, [addToast]);

  useEffect(() => {
    if (!projectPath) {
      return;
    }

    const currentProjectPath = projectPath;
    let cancelled = false;

    async function loadWorkspaceStatus(): Promise<void> {
      try {
        const status =
          await atelierClient.workspace.getStatus(currentProjectPath);

        if (cancelled) {
          return;
        }

        setWorkspaceSnapshot({
          projectPath: currentProjectPath,
          state: "ready",
          status,
        });
      } catch (error) {
        if (cancelled) {
          return;
        }

        console.error("Failed to load workspace status:", error, {
          projectPath: currentProjectPath,
        });
        setWorkspaceSnapshot({
          projectPath: currentProjectPath,
          state: "error",
          status: null,
        });
      }
    }

    void loadWorkspaceStatus();

    return () => {
      cancelled = true;
    };
  }, [projectPath]);

  const resolvedWorkspaceState = resolveWorkspaceState(
    projectPath,
    workspaceSnapshot,
  );
  const resolvedWorkspaceStatus =
    workspaceSnapshot?.projectPath === projectPath
      ? workspaceSnapshot.status
      : null;

  function refreshWorkspaceTasks(workspaceId: string): void {
    if (!taskWorkbench) {
      return;
    }

    setAllTasks((currentTasks) => {
      const remainingTasks = currentTasks.filter(
        (task) => task.workspaceId !== workspaceId,
      );
      const refreshedWorkspaceTasks =
        taskWorkbench.listTasksByWorkspace(workspaceId);

      return sortTasksByUpdatedAtDesc([
        ...remainingTasks,
        ...refreshedWorkspaceTasks,
      ]);
    });
  }

  async function runTaskLifecycleAction(
    taskId: string,
    actionName: string,
    action: (taskId: string) => Promise<TaskRecord | null>,
  ): Promise<void> {
    try {
      const updatedTask = await action(taskId);

      if (!updatedTask) {
        return;
      }

      if (scheduledTaskWorkbench) {
        const reconciledRun = await scheduledTaskWorkbench.reconcileLinkedRun({
          linkedTaskId: updatedTask.id,
          status: mapTerminalTaskStatusToScheduledRunStatus(updatedTask.status),
        });

        if (reconciledRun) {
          setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
          setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
          setScheduledTaskTickError(null);
        }
      }

      refreshWorkspaceTasks(updatedTask.workspaceId);
      setSelectedTaskId(updatedTask.id);
      setSelectedWorkspaceId(updatedTask.workspaceId);
    } catch (error) {
      console.error("Failed to run task lifecycle action:", error, {
        actionName,
        taskId,
      });
      addToast(
        `Failed to ${actionName.replace(/([A-Z])/g, " $1").toLowerCase()}: ${error instanceof Error ? error.message : String(error)}`,
        "error",
      );
    }
  }

  useEffect(() => {
    if (!scheduledTaskWorkbench) {
      return;
    }

    let active = true;

    const runTick = () => {
      void (async () => {
        try {
          await scheduledTaskWorkbench.tick({ now: new Date().toISOString() });

          if (!active) {
            return;
          }

          setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
          setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
          setScheduledTaskTickError(null);
        } catch (error) {
          if (!active) {
            return;
          }

          console.error("Failed to process scheduled task tick:", error);
          setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
          setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
          setScheduledTaskTickError(
            error instanceof Error ? error.message : String(error),
          );
          addToast(
            error instanceof ScheduledRunPersistenceError
              ? "Scheduled task started, but Atelier could not save its updated state. Avoid retrying until persistence is fixed."
              : `Scheduled task engine stalled: ${error instanceof Error ? error.message : String(error)}`,
            "error",
          );
        }
      })();
    };

    runTick();
    const timer = globalThis.setInterval(runTick, 60_000);

    return () => {
      active = false;
      globalThis.clearInterval(timer);
    };
  }, [addToast, scheduledTaskWorkbench]);

  const selectedTask =
    selectedTaskId && taskWorkbench
      ? taskWorkbench.getTask(selectedTaskId)
      : null;
  const focusedTask =
    selectedTask && selectedTask.workspaceId === effectiveSelectedWorkspaceId
      ? selectedTask
      : null;
  const shouldShowTaskEmptyState =
    selectedTaskId !== null && !focusedTask && selectedWorkspace !== null;
  const selectedScheduledTask =
    selectedScheduledTaskId && scheduledTaskWorkbench
      ? scheduledTaskWorkbench.getScheduledTask(selectedScheduledTaskId)
      : null;
  const selectedScheduledTaskRuns = selectedScheduledTask
    ? scheduledTaskRuns.filter(
        (run) => run.scheduledTaskId === selectedScheduledTask.id,
      )
    : [];

  useEffect(() => {
    setIsEditingScheduledTask(false);
  }, [activeView, selectedScheduledTaskId]);

  const resolvedSyncView = isValidElement<{
    onCreateScheduledSyncTask?: (draft: ScheduledTaskFormInput) => void;
  }>(syncView)
    ? syncView
    : null;

  const syncViewWithScheduleBridge = resolvedSyncView
    ? cloneElement(resolvedSyncView, {
        onCreateScheduledSyncTask: (draft: ScheduledTaskFormInput) => {
          setScheduledTaskDraft(draft);
          setSelectedScheduledTaskId(null);
          setActiveView("schedule");
        },
      })
    : syncView;

  const regenerateScheduledTaskTemplate = useCallback(
    async (input: ScheduledTaskFormInput): Promise<ScheduledTaskFormInput> => {
      if (!input.template || input.template.source !== "acme-sync") {
        return input;
      }

      const strategyMarkdown = await loadSyncStrategyMarkdown(input.template.mainPath);

      return regenerateScheduledSyncTaskDraft({
        template: input.template,
        workspacePath: input.workspacePath,
        strategyMarkdown,
      });
    },
    [],
  );

  return (
    <Tabs
      value={activeView}
      onValueChange={(value: string) => {
        if (
          value === "chats" ||
          value === "schedule" ||
          value === "sync" ||
          value === "skills" ||
          value === "config"
        ) {
          if (value === "sync") {
            setHasMountedSyncView(true);
          }
          if (value === "config") {
            setHasMountedConfigView(true);
          }
          if (value === "skills") {
            setHasMountedSkillsView(true);
          }

          setActiveView(value);
        }
      }}
      className="bg-background text-foreground flex h-screen flex-col"
    >
      <header className="flex h-12 shrink-0 items-center gap-3 border-b px-4">
        <h1 className="text-sm font-semibold">Atelier</h1>
        <WorkbenchStatusBar
          state={resolvedWorkspaceState}
          status={resolvedWorkspaceStatus}
        />
        <TabsList className="h-auto">
          <TabsTrigger value="chats" className="px-3 py-1 text-xs">
            Chats
          </TabsTrigger>
          <TabsTrigger value="schedule" className="px-3 py-1 text-xs">
            Schedule
          </TabsTrigger>
          <TabsTrigger value="sync" className="px-3 py-1 text-xs">
            @acme Sync
          </TabsTrigger>
          <TabsTrigger value="skills" className="px-3 py-1 text-xs">
            Skills
          </TabsTrigger>
          <TabsTrigger value="config" className="px-3 py-1 text-xs">
            Claude Config
          </TabsTrigger>
        </TabsList>
      </header>

      <div className="flex flex-1 overflow-hidden">
        <TabsContent value="chats" className="flex flex-1 overflow-hidden">
          <div className="flex min-h-0 shrink-0 flex-col border-r">
            <TaskCreateBar
              workspaceName={workspaceName}
              disabled={!taskWorkbench || !effectiveSelectedWorkspaceId}
              onCreateTask={async ({ prompt, runnerPreference }) => {
                if (!effectiveSelectedWorkspaceId || !taskWorkbench) {
                  return;
                }

                const task = await taskWorkbench.createTask({
                  workspaceId: effectiveSelectedWorkspaceId,
                  prompt,
                  runnerPreference,
                });

                setAllTasks((currentTasks) =>
                  sortTasksByUpdatedAtDesc([...currentTasks, task]),
                );
                setSelectedWorkspaceId(task.workspaceId);
                setSelectedTaskId(task.id);
              }}
            />
            <ChatSidebar
              allTasks={allTasks}
              selectedTaskId={selectedTaskId}
              selectedWorkspaceId={effectiveSelectedWorkspaceId}
              onSelectWorkspace={setSelectedWorkspaceId}
              onSelectTask={(taskId) => {
                const task = taskWorkbench?.getTask(taskId) ?? null;
                setSelectedTaskId(taskId);
                if (task) {
                  setSelectedWorkspaceId(task.workspaceId);
                }
              }}
            />
          </div>
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {focusedTask ? (
              <TaskDetailPanel
                task={focusedTask}
                onStartTask={(taskId) =>
                  taskWorkbench
                    ? void runTaskLifecycleAction(
                        taskId,
                        "startTask",
                        taskWorkbench.startTask,
                      )
                    : void 0
                }
                onApproveTask={(taskId) =>
                  taskWorkbench
                    ? void runTaskLifecycleAction(
                        taskId,
                        "approveTask",
                        taskWorkbench.approveTask,
                      )
                    : void 0
                }
                onRejectTask={(taskId) =>
                  taskWorkbench
                    ? void runTaskLifecycleAction(
                        taskId,
                        "rejectTask",
                        taskWorkbench.rejectTask,
                      )
                    : void 0
                }
                onRetryTask={(taskId) =>
                  taskWorkbench
                    ? void runTaskLifecycleAction(
                        taskId,
                        "retryTask",
                        taskWorkbench.retryTask,
                      )
                    : void 0
                }
                onResumeTask={(taskId) =>
                  taskWorkbench
                    ? void runTaskLifecycleAction(
                        taskId,
                        "resumeTask",
                        taskWorkbench.resumeTask,
                      )
                    : void 0
                }
                onRerunTask={(taskId) =>
                  taskWorkbench
                    ? void runTaskLifecycleAction(
                        taskId,
                        "rerunTask",
                        taskWorkbench.rerunTask,
                      )
                    : void 0
                }
              />
            ) : shouldShowTaskEmptyState ? (
              <section className="flex min-h-0 flex-1 flex-col justify-center px-6 py-8">
                <h2 className="text-sm font-semibold">
                  Select a task for {workspaceName}.
                </h2>
                <p className="text-muted-foreground mt-2 text-sm">
                  Choose a task from the focused workspace to inspect its
                  overview, thread, and changes.
                </p>
              </section>
            ) : (
              chatsWorkspace
            )}
          </main>
        </TabsContent>
        <TabsContent value="schedule" className="flex flex-1 overflow-hidden">
          <ScheduleSidebar
            tasks={scheduledTasks}
            selectedTaskId={selectedScheduledTaskId}
            onSelectTask={(taskId) => {
              setIsEditingScheduledTask(false);
              setSelectedScheduledTaskId(taskId);
            }}
            onRunNow={(taskId) => {
              if (!scheduledTaskWorkbench) {
                return;
              }

              void (async () => {
                try {
                  await scheduledTaskWorkbench.runNow(taskId);
                  setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
                  setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
                  setSelectedScheduledTaskId(taskId);
                } catch (error) {
                  console.error("Failed to run scheduled task now:", error, { taskId });
                  setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
                  setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
                  setSelectedScheduledTaskId(taskId);
                  addToast(
                    error instanceof ScheduledRunPersistenceError
                      ? "Schedule started, but Atelier could not save its updated state. Avoid retrying until persistence is fixed."
                      : `Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`,
                    "error",
                  );
                }
              })();
            }}
          />
          <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
            <ScheduleDetailPanel
              task={selectedScheduledTask}
              runs={selectedScheduledTaskRuns}
              errorMessage={scheduledTaskLoadError ?? scheduledTaskTickError}
              createDraft={selectedScheduledTask ? null : scheduledTaskDraft}
              isEditing={isEditingScheduledTask && selectedScheduledTask !== null}
              onRegenerateTemplate={regenerateScheduledTaskTemplate}
              onStartEdit={() => {
                setIsEditingScheduledTask(true);
              }}
              onCancelCreate={() => {
                setIsEditingScheduledTask(false);
                setScheduledTaskDraft(null);
              }}
              onCancelEdit={() => {
                setIsEditingScheduledTask(false);
              }}
              onCreateTask={async (input) => {
                if (!scheduledTaskWorkbench) {
                  return;
                }

                try {
                  const task = await scheduledTaskWorkbench.createScheduledTask({
                    name: input.name,
                    description: input.description,
                    workspacePath: input.workspacePath,
                    prompt: input.prompt,
                    template: input.template ?? null,
                    model: "claude-sonnet-4-6",
                    permissionMode: "ask",
                    worktree: { enabled: input.worktreeEnabled },
                    schedule: {
                      type: input.frequency,
                      cron: input.cron,
                      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
                      enabled: true,
                      jitterMinutes: 10,
                    },
                  });

                  setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
                  setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
                  setSelectedScheduledTaskId(task.id);
                  setIsEditingScheduledTask(false);
                  setScheduledTaskDraft(null);
                  setScheduledTaskLoadError(null);
                } catch (error) {
                  console.error("Failed to create scheduled task:", error, {
                    workspacePath: input.workspacePath,
                    frequency: input.frequency,
                  });
                  addToast(
                    `Failed to create schedule: ${error instanceof Error ? error.message : String(error)}`,
                    "error",
                  );
                  throw error;
                }
              }}
              onEditTask={async (input) => {
                if (!scheduledTaskWorkbench || !selectedScheduledTask) {
                  return;
                }

                try {
                  await scheduledTaskWorkbench.updateScheduledTask(
                    selectedScheduledTask.id,
                    input,
                  );
                  setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
                  setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
                  setSelectedScheduledTaskId(selectedScheduledTask.id);
                  setIsEditingScheduledTask(false);
                  setScheduledTaskLoadError(null);
                } catch (error) {
                  console.error("Failed to update scheduled task:", error, {
                    taskId: selectedScheduledTask.id,
                    workspacePath: input.workspacePath,
                    frequency: input.frequency,
                  });
                  addToast(
                    `Failed to update schedule: ${error instanceof Error ? error.message : String(error)}`,
                    "error",
                  );
                  throw error;
                }
              }}
              onRunNow={(taskId) => {
                if (!scheduledTaskWorkbench) {
                  return;
                }

                void (async () => {
                  try {
                    await scheduledTaskWorkbench.runNow(taskId);
                    setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
                    setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
                  } catch (error) {
                    console.error("Failed to run scheduled task from detail panel:", error, {
                      taskId,
                    });
                    setScheduledTasks(scheduledTaskWorkbench.listScheduledTasks());
                    setScheduledTaskRuns(scheduledTaskWorkbench.listScheduledRuns());
                    addToast(
                      error instanceof ScheduledRunPersistenceError
                        ? "Schedule started, but Atelier could not save its updated state. Avoid retrying until persistence is fixed."
                        : `Failed to run schedule: ${error instanceof Error ? error.message : String(error)}`,
                      "error",
                    );
                  }
                })();
              }}
            />
          </main>
        </TabsContent>
        <TabsContent value="sync" className="flex-1 overflow-hidden">
          {hasMountedSyncView ? (
            <main className="flex-1 overflow-hidden">{syncViewWithScheduleBridge}</main>
          ) : null}
        </TabsContent>
        <TabsContent value="skills" className="flex flex-1 flex-col overflow-hidden">
          {hasMountedSkillsView ? (
            <main className="flex flex-1 flex-col overflow-hidden bg-background">
              <SkillsManagerPanel />
            </main>
          ) : null}
        </TabsContent>
        <TabsContent value="config" className="flex flex-1 flex-col overflow-hidden">
          {hasMountedConfigView ? (
            <main className="flex flex-1 flex-col overflow-hidden">
              {typeof configView === "function" ? configView({ 
                onOptimizeRules: () => {
                  const prompt = "Please review my ~/.claude/settings.json 'allow' and 'deny' lists and group similar commands together using wildcards (like `Bash(git *)` or `File(read:*)`) to make the configuration cleaner and more maintainable. After grouping them, please write the modified configuration back to ~/.claude/settings.json.";

                  void (async () => {
                    let projectPath = effectiveSelectedWorkspaceId;

                    try {
                      if (!projectPath || projectPath === "current-workspace") {
                        const { homeDir, join } = await import("@tauri-apps/api/path");
                        const home = await homeDir();
                        projectPath = await join(home, ".atelier");
                      }

                      const { ensureDirectory } = await import("../lib/tauri");
                      await ensureDirectory(projectPath);

                      const state = useSessionStore.getState();
                      state.setNewSessionProject(projectPath);
                      state.setNewSessionPrompt(prompt);
                      state.setSelectedSessionId(null);
                      setSelectedTaskId(null);
                      setActiveView("chats");
                    } catch (error) {
                      console.error("Failed to prepare Optimize Rules chat:", error, {
                        effectiveSelectedWorkspaceId,
                        attemptedProjectPath: projectPath,
                      });
                      addToast(
                        `Failed to prepare Optimize Rules chat: ${error instanceof Error ? error.message : String(error)}`,
                        "error",
                      );
                    }
                  })();
                }
              }) : configView}
            </main>
          ) : null}
        </TabsContent>
      </div>
    </Tabs>
  );
}
