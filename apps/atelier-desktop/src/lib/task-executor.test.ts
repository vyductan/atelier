import { describe, expect, it, vi } from "vitest";

import { createClaudeTaskExecutor } from "./task-executor";
import { createTaskStore } from "./task-store";

describe("createClaudeTaskExecutor", () => {
  it("transitions a task from queued to done and stores a summary", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "summarize this module",
      runnerPreference: "claude",
    });

    const executor = createClaudeTaskExecutor({
      runTask: vi.fn().mockResolvedValue({
        status: "done",
        summary: "Finished summarizing the module.",
      }),
    });

    const updatedTask = await executor.execute(task, store);

    expect(updatedTask.status).toBe("done");
    expect(updatedTask.resolvedRunner).toBe("claude");
    expect(updatedTask.summary).toBe("Finished summarizing the module.");
    expect(updatedTask.currentStage).toBe("completed");
  });

  it("marks a task as awaiting approval when the executor requires approval", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "prepare a patch and wait for approval",
      runnerPreference: "claude",
    });

    const executor = createClaudeTaskExecutor({
      runTask: vi.fn().mockResolvedValue({
        status: "awaiting_approval",
        summary: "Patch ready for approval.",
        currentStage: "awaiting approval",
      }),
    });

    const updatedTask = await executor.execute(task, store);

    expect(updatedTask.status).toBe("awaiting_approval");
    expect(updatedTask.summary).toBe("Patch ready for approval.");
    expect(updatedTask.currentStage).toBe("awaiting approval");
  });

  it("marks a task as blocked when execution reports a blocker", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "run tests and report blockers",
      runnerPreference: "claude",
    });

    const executor = createClaudeTaskExecutor({
      runTask: vi.fn().mockResolvedValue({
        status: "blocked",
        summary: "Tests are failing because dependencies are missing.",
        currentStage: "blocked on setup",
      }),
    });

    const updatedTask = await executor.execute(task, store);

    expect(updatedTask.status).toBe("blocked");
    expect(updatedTask.summary).toContain("dependencies are missing");
    expect(updatedTask.currentStage).toBe("blocked on setup");
  });
});
