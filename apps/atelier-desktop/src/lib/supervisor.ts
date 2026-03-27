import type { TaskStore } from "./task-store";
import type { TaskRecord } from "./tasks";
import { resolveTaskRunner } from "./task-routing";
import { appendTaskSystemMessage } from "./task-thread";

interface SupervisorNotification {
  kind: "done" | "awaiting_approval" | "blocked";
  taskId: string;
  summary: string | null;
}

interface SupervisorDependencies {
  store: TaskStore;
  claude: {
    execute: (task: TaskRecord, store: TaskStore) => Promise<TaskRecord>;
  };
  openclaw: {
    runTask: (task: TaskRecord) => Promise<{
      status: "done" | "awaiting_approval" | "blocked";
      summary: string;
      currentStage: string;
    }>;
  };
  notify: (notification: SupervisorNotification) => void;
}

export function createSupervisor({
  store,
  claude,
  openclaw,
  notify,
}: SupervisorDependencies) {
  const executeWithRunner = async (task: TaskRecord): Promise<TaskRecord> => {
    const resolvedRunner =
      task.resolvedRunner ??
      resolveTaskRunner({
        prompt: task.prompt,
        runnerPreference: task.runnerPreference,
      });

    const updatedTask =
      resolvedRunner === "openclaw"
        ? await runOpenClawTask(task, store, openclaw)
        : await claude.execute(task, store);

    notifyForTask(updatedTask, notify);

    return updatedTask;
  };

  const getTask = (taskId: string): TaskRecord | null => store.getTask(taskId);

  return {
    async startTask(taskId: string): Promise<TaskRecord | null> {
      const task = store.getTask(taskId);

      if (!task) {
        return null;
      }

      return executeWithRunner(task);
    },

    async approveTask(taskId: string): Promise<TaskRecord | null> {
      const task = getTask(taskId);

      if (!task) {
        return null;
      }

      if (task.status !== "awaiting_approval") {
        return task;
      }

      appendTaskSystemMessage(store, task.id, "Task approval granted.");
      const updatedTask = store.updateTask(task.id, {
        approvalRequest: null,
      });

      return updatedTask ? executeWithRunner(updatedTask) : null;
    },

    async rejectTask(taskId: string): Promise<TaskRecord | null> {
      const task = getTask(taskId);

      if (!task) {
        return null;
      }

      if (task.status !== "awaiting_approval") {
        return task;
      }

      appendTaskSystemMessage(store, task.id, "Task approval rejected.");
      const updatedTask = store.updateTask(task.id, {
        status: "blocked",
        currentStage: "approval rejected",
        approvalRequest: null,
        blockedReason: "Task was rejected and is waiting for further action.",
      });

      if (updatedTask) {
        notifyForTask(updatedTask, notify);
      }

      return updatedTask;
    },

    async retryTask(taskId: string): Promise<TaskRecord | null> {
      const task = getTask(taskId);

      if (!task) {
        return null;
      }

      if (task.status !== "blocked" && task.status !== "failed") {
        return task;
      }

      appendTaskSystemMessage(store, task.id, "Task retry started.");
      const updatedTask = store.updateTask(task.id, {
        blockedReason: null,
        approvalRequest: null,
        lastErrorSummary: null,
      });

      return updatedTask ? executeWithRunner(updatedTask) : null;
    },

    async resumeTask(taskId: string): Promise<TaskRecord | null> {
      const task = getTask(taskId);

      if (!task) {
        return null;
      }

      if (task.status !== "blocked") {
        return task;
      }

      appendTaskSystemMessage(store, task.id, "Task resumed.");
      const updatedTask = store.updateTask(task.id, {
        blockedReason: null,
      });

      return updatedTask ? executeWithRunner(updatedTask) : null;
    },

    async rerunTask(taskId: string): Promise<TaskRecord | null> {
      const task = getTask(taskId);

      if (!task) {
        return null;
      }

      if (task.status !== "done") {
        return task;
      }

      appendTaskSystemMessage(store, task.id, "Task re-run started.");
      const updatedTask = store.updateTask(task.id, {
        blockedReason: null,
        approvalRequest: null,
        lastErrorSummary: null,
        summary: null,
        currentStage: null,
      });

      return updatedTask ? executeWithRunner(updatedTask) : null;
    },
  };
}

function notifyForTask(
  task: TaskRecord,
  notify: SupervisorDependencies["notify"],
) {
  let notificationKind: SupervisorNotification["kind"];

  if (task.status === "done") {
    notificationKind = "done";
  } else if (task.status === "awaiting_approval") {
    notificationKind = "awaiting_approval";
  } else {
    notificationKind = "blocked";
  }

  notify({
    kind: notificationKind,
    taskId: task.id,
    summary: task.summary,
  });
}

async function runOpenClawTask(
  task: TaskRecord,
  store: TaskStore,
  openclaw: SupervisorDependencies["openclaw"],
): Promise<TaskRecord> {
  const runningTask = store.updateTask(task.id, {
    status: "running",
    resolvedRunner: "openclaw",
    currentStage: "running",
    approvalRequest: null,
    blockedReason: null,
    lastErrorSummary: null,
  });

  if (!runningTask) {
    throw new Error(`Task ${task.id} not found`);
  }

  const result = await openclaw.runTask(runningTask);
  const finalTask = store.updateTask(task.id, {
    status: result.status,
    resolvedRunner: "openclaw",
    summary: result.summary,
    currentStage: result.currentStage,
  });

  appendTaskSystemMessage(store, task.id, result.summary);

  if (!finalTask) {
    throw new Error(`Task ${task.id} not found`);
  }

  return finalTask;
}

export { createClaudeTaskExecutor } from "./task-executor";
