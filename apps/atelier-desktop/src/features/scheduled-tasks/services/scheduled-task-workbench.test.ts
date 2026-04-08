import { describe, expect, it, vi } from "vitest";

import { createScheduledTaskWorkbench } from "./scheduled-task-workbench";

describe("scheduledTaskWorkbench", () => {
  it("creates a task and marks the run as running when runNow starts it", async () => {
    const workbench = await createScheduledTaskWorkbench({
      persistence: {
        load: async () => ({ tasks: [], runs: [] }),
        save: async () => {
          return;
        },
      },
      runner: {
        startScheduledRun: vi.fn(async () => ({
          linkedSessionId: "session-123",
          linkedTaskId: "task-456",
          status: "running" as const,
        })),
      },
    });

    const task = await workbench.createScheduledTask({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      permissionMode: "ask",
      worktree: { enabled: true },
      schedule: {
        type: "daily",
        cron: "0 9 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
        jitterMinutes: 10,
      },
    });

    const run = await workbench.runNow(task.id);

    expect(run.status).toBe("running");
  });
});
