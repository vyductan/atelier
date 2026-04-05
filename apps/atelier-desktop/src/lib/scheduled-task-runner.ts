export interface ScheduledTaskRunner {
  startScheduledRun(input: {
    scheduledTaskId: string;
    workspacePath: string;
    prompt: string;
    model: string;
    reason: "normal" | "catch_up" | "run_now";
  }): Promise<{
    linkedSessionId: string | null;
    linkedTaskId: string | null;
    status: "running" | "stalled_for_permission" | "failed" | "completed";
  }>;
}
