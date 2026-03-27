import type { TaskRecord } from "./tasks";

interface OpenClawTaskResult {
  status: "done" | "blocked" | "awaiting_approval";
  summary: string;
  currentStage: string;
}

export function createOpenClawAdapter() {
  return {
    async runTask(task: TaskRecord): Promise<OpenClawTaskResult> {
      return {
        status: "done",
        summary: `OpenClaw finished ${task.prompt}`,
        currentStage: "completed",
      };
    },
  };
}
