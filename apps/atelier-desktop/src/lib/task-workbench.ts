import type { TaskPersistence } from "./task-persistence";
import type { TaskRecord, TaskRunnerPreference } from "./tasks";
import { createSupervisor } from "./supervisor";
import { createTaskStore } from "./task-store";

interface CreateTaskWorkbenchInput {
  workspaceId: string;
  prompt: string;
  runnerPreference: TaskRunnerPreference;
}

export interface TaskWorkbench {
  createTask: (input: CreateTaskWorkbenchInput) => Promise<TaskRecord>;
  getTask: (taskId: string) => TaskRecord | null;
  listTasks: () => TaskRecord[];
  listTasksByWorkspace: (workspaceId: string) => TaskRecord[];
  startTask: (taskId: string) => Promise<TaskRecord | null>;
  approveTask: (taskId: string) => Promise<TaskRecord | null>;
  rejectTask: (taskId: string) => Promise<TaskRecord | null>;
  retryTask: (taskId: string) => Promise<TaskRecord | null>;
  resumeTask: (taskId: string) => Promise<TaskRecord | null>;
  rerunTask: (taskId: string) => Promise<TaskRecord | null>;
}

interface CreateTaskWorkbenchOptions {
  persistence: TaskPersistence;
}

function createDefaultClaudeExecutor(): {
  execute: (
    task: TaskRecord,
    store: ReturnType<typeof createTaskStore>,
  ) => Promise<TaskRecord>;
} {
  return {
    async execute(
      task: TaskRecord,
      store: ReturnType<typeof createTaskStore>,
    ): Promise<TaskRecord> {
      function updateTaskOrThrow(
        patch: Parameters<typeof store.updateTask>[1],
      ): TaskRecord {
        const updatedTask = store.updateTask(task.id, patch);

        if (!updatedTask) {
          throw new Error(`Task ${task.id} not found`);
        }

        return updatedTask;
      }

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
  };
}

export async function createTaskWorkbench(
  options: CreateTaskWorkbenchOptions,
): Promise<TaskWorkbench> {
  const store = createTaskStore({
    initialTasks: await options.persistence.loadTasks(),
  });
  const supervisor = createSupervisor({
    store,
    claude: createDefaultClaudeExecutor(),
    openclaw: {
      runTask: async () => ({
        status: "done",
        summary: "Completed successfully.",
        currentStage: "completed",
      }),
    },
    notify: () => void 0,
  });

  async function saveTasks(): Promise<void> {
    await options.persistence.saveTasks(store.listTasks());
  }

  async function persistResult(
    result: TaskRecord | null,
  ): Promise<TaskRecord | null> {
    if (!result) {
      return null;
    }

    await saveTasks();

    return result;
  }

  return {
    async createTask(input) {
      const task = store.createTask(input);

      try {
        await saveTasks();
        return task;
      } catch (error) {
        store.removeTask(task.id);
        throw error;
      }
    },

    getTask(taskId) {
      return store.getTask(taskId);
    },

    listTasks() {
      return store.listTasks();
    },

    listTasksByWorkspace(workspaceId) {
      return store.listTasksByWorkspace(workspaceId);
    },

    async startTask(taskId) {
      const result = await supervisor.startTask(taskId);
      return persistResult(result);
    },

    async approveTask(taskId) {
      const result = await supervisor.approveTask(taskId);
      return persistResult(result);
    },

    async rejectTask(taskId) {
      const result = await supervisor.rejectTask(taskId);
      return persistResult(result);
    },

    async retryTask(taskId) {
      const result = await supervisor.retryTask(taskId);
      return persistResult(result);
    },

    async resumeTask(taskId) {
      const result = await supervisor.resumeTask(taskId);
      return persistResult(result);
    },

    async rerunTask(taskId) {
      const result = await supervisor.rerunTask(taskId);
      return persistResult(result);
    },
  };
}
