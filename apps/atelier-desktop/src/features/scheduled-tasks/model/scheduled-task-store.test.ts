import { describe, expect, it } from "vitest";

import { createScheduledTaskStore } from "./scheduled-task-store";

describe("scheduledTaskStore", () => {
  it("creates a scheduled task with a deterministic id", () => {
    const store = createScheduledTaskStore();

    const task = store.createScheduledTask({
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

    expect(task.id).toBe("sched-1");
  });
});
