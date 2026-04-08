import {
  buildCandidateSlots,
  findMostRecentMissedSlot,
  hasActiveRunForTask,
} from "../domain/scheduled-task-engine";
import { createScheduledTaskStore } from "../model/scheduled-task-store";
import type { ScheduledTaskRunner } from "./scheduled-task-runner";
import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "../domain/scheduled-tasks";

interface CreateScheduledTaskInput {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  template?: ScheduledTaskDefinition["template"];
  model: string;
  permissionMode: ScheduledTaskDefinition["permissionMode"];
  worktree: ScheduledTaskDefinition["worktree"];
  schedule: ScheduledTaskDefinition["schedule"];
}

export interface UpdateScheduledTaskInput {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  template?: ScheduledTaskDefinition["template"];
  frequency: ScheduledTaskDefinition["schedule"]["type"];
  cron: string | null;
  worktreeEnabled: boolean;
}

export interface ScheduledTaskPersistence {
  load: () => Promise<{
    tasks: ScheduledTaskDefinition[];
    runs: ScheduledTaskRunRecord[];
  }>;
  save: (input: {
    tasks: ScheduledTaskDefinition[];
    runs: ScheduledTaskRunRecord[];
  }) => Promise<void>;
}

interface CreateScheduledTaskWorkbenchOptions {
  persistence: ScheduledTaskPersistence;
  runner: ScheduledTaskRunner;
  now?: () => string;
  createId?: () => string;
  createRunId?: () => string;
}

export class ScheduledRunPersistenceError extends Error {
  readonly run: ScheduledTaskRunRecord;
  readonly task: ScheduledTaskDefinition;

  constructor(input: {
    message: string;
    run: ScheduledTaskRunRecord;
    task: ScheduledTaskDefinition;
    cause: unknown;
  }) {
    super(input.message, { cause: input.cause });
    this.name = "ScheduledRunPersistenceError";
    this.run = input.run;
    this.task = input.task;
  }
}

export interface ScheduledTaskWorkbench {
  createScheduledTask: (
    input: CreateScheduledTaskInput,
  ) => Promise<ScheduledTaskDefinition>;
  updateScheduledTask: (
    taskId: string,
    input: UpdateScheduledTaskInput,
  ) => Promise<ScheduledTaskDefinition>;
  getScheduledTask: (taskId: string) => ScheduledTaskDefinition | null;
  listScheduledTasks: () => ScheduledTaskDefinition[];
  listScheduledRuns: () => ScheduledTaskRunRecord[];
  listRunsByTask: (taskId: string) => ScheduledTaskRunRecord[];
  reconcileLinkedRun: (input: {
    linkedTaskId: string;
    status: ScheduledTaskRunRecord["status"];
  }) => Promise<ScheduledTaskRunRecord | null>;
  runNow: (taskId: string) => Promise<ScheduledTaskRunRecord>;
  tick: (input: { now: string }) => Promise<ScheduledTaskRunRecord[]>;
}

function mapRunStatusToTaskEngineState(
  status: ScheduledTaskRunRecord["status"],
): ScheduledTaskDefinition["engineState"] {
  if (status === "running") {
    return "running";
  }

  if (status === "stalled_for_permission") {
    return "stalled";
  }

  return "idle";
}

function throwOriginalErrorWithCause(error: unknown, cause: unknown): never {
  if (error instanceof Error) {
    throw new Error(error.message, { cause });
  }

  throw new Error(String(error), { cause });
}

export async function createScheduledTaskWorkbench(
  options: CreateScheduledTaskWorkbenchOptions,
): Promise<ScheduledTaskWorkbench> {
  const snapshot = await options.persistence.load();
  let store = createScheduledTaskStore({
    now: options.now,
    createId: options.createId,
    createRunId: options.createRunId,
    initialTasks: snapshot.tasks,
    initialRuns: snapshot.runs,
  });

  function rebuildStoreFromSnapshot(snapshotToRestore: {
    tasks: ScheduledTaskDefinition[];
    runs: ScheduledTaskRunRecord[];
  }) {
    store = createScheduledTaskStore({
      now: options.now,
      createId: options.createId,
      createRunId: options.createRunId,
      initialTasks: snapshotToRestore.tasks,
      initialRuns: snapshotToRestore.runs,
    });
  }

  function captureSnapshot() {
    return {
      tasks: store.listScheduledTasks(),
      runs: store.listScheduledRuns(),
    };
  }

  async function saveSnapshot() {
    await options.persistence.save(captureSnapshot());
  }

  function getNow() {
    return options.now ? options.now() : new Date().toISOString();
  }

  function hasExistingRunForSlot(taskId: string, scheduledFor: string) {
    return store
      .listRunsByTask(taskId)
      .some((run) => run.scheduledFor === scheduledFor);
  }

  function updateScheduledTaskOrThrow(
    taskId: string,
    patch: Partial<ScheduledTaskDefinition>,
  ): ScheduledTaskDefinition {
    const updatedTask = store.updateScheduledTask(taskId, patch);

    if (!updatedTask) {
      throw new Error(`Scheduled task ${taskId} not found`);
    }

    return updatedTask;
  }

  function finalizeTaskForRun(input: {
    taskId: string;
    finishedAt: string;
    status: ScheduledTaskRunRecord["status"];
  }): ScheduledTaskDefinition {
    return updateScheduledTaskOrThrow(input.taskId, {
      engineState: mapRunStatusToTaskEngineState(input.status),
      lastFinishedAt: input.finishedAt,
    });
  }

  async function persistQueuedRun(input: {
    taskId: string;
    scheduledFor: string | null;
    reason: ScheduledTaskRunRecord["reason"];
  }): Promise<ScheduledTaskRunRecord> {
    const snapshotBeforeQueue = captureSnapshot();
    const run = store.createScheduledRun({
      scheduledTaskId: input.taskId,
      scheduledFor: input.scheduledFor,
      reason: input.reason,
    });

    try {
      await saveSnapshot();
      return run;
    } catch (error) {
      rebuildStoreFromSnapshot(snapshotBeforeQueue);
      throw error;
    }
  }

  function applySuccessfulRunState(input: {
    taskId: string;
    runId: string;
    result: Awaited<ReturnType<ScheduledTaskRunner["startScheduledRun"]>>;
    startedAt: string;
  }): ScheduledTaskRunRecord {
    updateScheduledTaskOrThrow(input.taskId, {
      engineState: mapRunStatusToTaskEngineState(input.result.status),
      lastStartedAt: input.startedAt,
      ...(input.result.status === "failed" || input.result.status === "completed"
        ? { lastFinishedAt: input.startedAt }
        : {}),
    });

    const updatedRun = store.updateScheduledRun(input.runId, {
      status: input.result.status,
      linkedSessionId: input.result.linkedSessionId,
      linkedTaskId: input.result.linkedTaskId,
      startedAt: input.startedAt,
      ...((input.result.status === "failed" || input.result.status === "completed")
        ? { finishedAt: input.startedAt }
        : {}),
    });

    if (!updatedRun) {
      throw new Error(`Scheduled run ${input.runId} not found`);
    }

    return updatedRun;
  }

  async function launchRun(input: {
    task: ScheduledTaskDefinition;
    run: ScheduledTaskRunRecord;
    reason: "normal" | "catch_up" | "run_now";
  }): Promise<ScheduledTaskRunRecord> {
    let result;

    try {
      result = await options.runner.startScheduledRun({
        scheduledTaskId: input.task.id,
        workspacePath: input.task.workspacePath,
        prompt: input.task.prompt,
        model: input.task.model,
        reason: input.reason,
      });
    } catch (error) {
      const snapshotBeforeFailureUpdate = captureSnapshot();
      updateScheduledTaskOrThrow(input.task.id, {
        engineState: "idle",
        lastFinishedAt: getNow(),
      });
      const failedRun = store.updateScheduledRun(input.run.runId, {
        status: "failed",
        finishedAt: getNow(),
        errorSummary:
          error instanceof Error ? error.message : "Scheduled run failed to launch",
      });

      if (!failedRun) {
        throw new Error(`Scheduled run ${input.run.runId} not found`);
      }

      try {
        await saveSnapshot();
      } catch (saveError) {
        rebuildStoreFromSnapshot(snapshotBeforeFailureUpdate);
        throwOriginalErrorWithCause(error, saveError);
      }

      throw error;
    }

    const startedAt = getNow();
    const updatedRun = applySuccessfulRunState({
      taskId: input.task.id,
      runId: input.run.runId,
      result,
      startedAt,
    });

    try {
      await saveSnapshot();
    } catch (error) {
      throw new ScheduledRunPersistenceError({
        message: "Scheduled run started but its state could not be persisted",
        run: updatedRun,
        task: store.getScheduledTask(input.task.id) ?? input.task,
        cause: error,
      });
    }

    return updatedRun;
  }

  return {
    async createScheduledTask(input) {
      const snapshotBeforeCreate = captureSnapshot();
      const task = store.createScheduledTask(input);

      try {
        await saveSnapshot();
        return task;
      } catch (error) {
        rebuildStoreFromSnapshot(snapshotBeforeCreate);
        throw error;
      }
    },

    async updateScheduledTask(taskId, input) {
      const existingTask = store.getScheduledTask(taskId);

      if (!existingTask) {
        throw new Error(`Scheduled task ${taskId} not found`);
      }

      const nextSchedule: ScheduledTaskDefinition["schedule"] = {
        ...existingTask.schedule,
        type: input.frequency,
        cron: input.cron,
      };
      const snapshotBeforeUpdate = captureSnapshot();
      const updatedTask = updateScheduledTaskOrThrow(taskId, {
        name: input.name,
        description: input.description,
        workspacePath: input.workspacePath,
        prompt: input.prompt,
        template: input.template ?? null,
        worktree: { enabled: input.worktreeEnabled },
        schedule: nextSchedule,
      });

      try {
        await saveSnapshot();
        return updatedTask;
      } catch (error) {
        rebuildStoreFromSnapshot(snapshotBeforeUpdate);
        throw error;
      }
    },

    getScheduledTask(taskId) {
      return store.getScheduledTask(taskId);
    },

    listScheduledTasks() {
      return store.listScheduledTasks();
    },

    listScheduledRuns() {
      return store.listScheduledRuns();
    },

    listRunsByTask(taskId) {
      return store.listRunsByTask(taskId);
    },

    async reconcileLinkedRun({ linkedTaskId, status }) {
      const activeRun = store
        .listScheduledRuns()
        .find(
          (run) =>
            run.linkedTaskId === linkedTaskId &&
            (run.status === "running" || run.status === "stalled_for_permission"),
        );

      if (!activeRun) {
        return null;
      }

      const finishedAt = getNow();
      const snapshotBeforeReconcile = captureSnapshot();
      finalizeTaskForRun({
        taskId: activeRun.scheduledTaskId,
        finishedAt,
        status,
      });
      const updatedRun = store.updateScheduledRun(activeRun.runId, {
        status,
        finishedAt,
      });

      if (!updatedRun) {
        throw new Error(`Scheduled run ${activeRun.runId} not found`);
      }

      try {
        await saveSnapshot();
        return updatedRun;
      } catch (error) {
        rebuildStoreFromSnapshot(snapshotBeforeReconcile);
        throw error;
      }
    },

    async runNow(taskId) {
      const task = store.getScheduledTask(taskId);

      if (!task) {
        throw new Error(`Scheduled task ${taskId} not found`);
      }

      const snapshotBeforeTaskUpdate = captureSnapshot();
      const updatedTask = updateScheduledTaskOrThrow(task.id, {
        engineState: "queued",
      });

      let run: ScheduledTaskRunRecord;
      try {
        run = await persistQueuedRun({
          taskId: task.id,
          scheduledFor: null,
          reason: "run_now",
        });
      } catch (error) {
        rebuildStoreFromSnapshot(snapshotBeforeTaskUpdate);
        throw error;
      }

      return await launchRun({
        task: updatedTask,
        run,
        reason: "run_now",
      });
    },

    async tick({ now }) {
      const createdRuns: ScheduledTaskRunRecord[] = [];

      for (const task of store.listScheduledTasks()) {
        if (!task.schedule.enabled || task.engineState === "paused") {
          continue;
        }

        const scheduledFor = findMostRecentMissedSlot({
          slots: buildCandidateSlots({
            scheduleType: task.schedule.type,
            cron: task.schedule.cron,
            timezone: task.schedule.timezone,
            now,
            lookbackDays: 7,
          }),
          now,
          lookbackDays: 7,
        });

        if (!scheduledFor || hasExistingRunForSlot(task.id, scheduledFor)) {
          continue;
        }

        if (hasActiveRunForTask(store.listScheduledRuns(), task.id)) {
          const snapshotBeforeSkip = captureSnapshot();
          updateScheduledTaskOrThrow(task.id, {
            lastMissedAt: scheduledFor,
          });
          const run = store.createScheduledRun({
            scheduledTaskId: task.id,
            scheduledFor,
            reason: "overlap_skip",
          });
          const skippedRun = store.updateScheduledRun(run.runId, {
            status: "skipped",
            finishedAt: now,
          });

          if (!skippedRun) {
            throw new Error(`Scheduled run ${run.runId} not found`);
          }

          try {
            await saveSnapshot();
          } catch (error) {
            rebuildStoreFromSnapshot(snapshotBeforeSkip);
            throw error;
          }

          createdRuns.push(skippedRun);
          continue;
        }

        const snapshotBeforeTaskUpdate = captureSnapshot();
        const updatedTask = store.updateScheduledTask(task.id, {
          engineState: "queued",
          lastScheduledAt: scheduledFor,
        });

        if (!updatedTask) {
          throw new Error(`Scheduled task ${task.id} not found`);
        }

        let run: ScheduledTaskRunRecord;
        try {
          run = await persistQueuedRun({
            taskId: task.id,
            scheduledFor,
            reason: "catch_up",
          });
        } catch (error) {
          rebuildStoreFromSnapshot(snapshotBeforeTaskUpdate);
          throw error;
        }

        const launchedRun = await launchRun({
          task: updatedTask,
          run,
          reason: "catch_up",
        });
        createdRuns.push(launchedRun);
      }

      return createdRuns;
    },
  };
}
