import type { TaskStore } from "./task-store";
import type { TaskRecord } from "./tasks";
import { appendTaskSystemMessage } from "./task-thread";

interface ClaudeTaskExecutionResult {
  status: "done" | "awaiting_approval" | "blocked";
  summary: string;
  currentStage?: string;
}

interface ClaudeTaskExecutorDependencies {
  runTask: (task: TaskRecord) => Promise<ClaudeTaskExecutionResult>;
}

export function createClaudeTaskExecutor({
  runTask,
}: ClaudeTaskExecutorDependencies) {
  return {
    async execute(task: TaskRecord, store: TaskStore): Promise<TaskRecord> {
      const runningTask = store.updateTask(task.id, {
        status: "running",
        resolvedRunner: "claude",
        currentStage: "running",
        approvalRequest: null,
        blockedReason: null,
        lastErrorSummary: null,
      });

      if (!runningTask) {
        throw new Error(`Task ${task.id} not found`);
      }

      const result = await runTask(runningTask);
      const finalTask = store.updateTask(task.id, {
        status: result.status,
        resolvedRunner: "claude",
        summary: result.summary,
        currentStage:
          result.currentStage ??
          (result.status === "done" ? "completed" : "running"),
      });

      appendTaskSystemMessage(store, task.id, result.summary);

      if (!finalTask) {
        throw new Error(`Task ${task.id} not found`);
      }

      return finalTask;
    },
  };
}
