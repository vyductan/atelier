import { describe, expect, it, vi } from "vitest";

import type { TaskPersistence } from "./task-persistence";
import type { TaskRecord } from "./tasks";
import { createTaskWorkbench } from "./task-workbench";

function createTask(overrides: Partial<TaskRecord> = {}): TaskRecord {
  return {
    id: "task-1",
    workspaceId: "workspace-1",
    title: "Review deployment",
    prompt: "Review deployment",
    status: "queued",
    runnerPreference: "auto",
    resolvedRunner: null,
    currentStage: null,
    blockedReason: null,
    approvalRequest: null,
    lastErrorSummary: null,
    createdAt: "2026-03-11T00:00:00.000Z",
    updatedAt: "2026-03-11T00:00:00.000Z",
    summary: null,
    thread: [],
    ...overrides,
  };
}

describe("taskWorkbench", () => {
  it("loads persisted tasks and saves after task creation", async () => {
    const persistence: TaskPersistence = {
      loadTasks: vi.fn(async () => [
        createTask({
          id: "task-1",
          workspaceId: "workspace-1",
          title: "Persisted task",
          prompt: "Persisted task",
        }),
      ]),
      saveTasks: vi.fn(async () => {
        return;
      }),
    };

    const workbench = await createTaskWorkbench({ persistence });
    const createdTask = await workbench.createTask({
      workspaceId: "workspace-1",
      prompt: "Implement speaking feature",
      runnerPreference: "auto",
    });

    expect(workbench.listTasksByWorkspace("workspace-1")).toHaveLength(2);
    expect(createdTask.id).toBeDefined();
    expect(persistence.saveTasks).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ id: createdTask.id })]),
    );
  });

  it("preserves thread messages loaded from persistence", async () => {
    const persistence: TaskPersistence = {
      loadTasks: vi.fn(async () => [
        createTask({
          id: "task-1",
          thread: [
            {
              id: "thread-1",
              role: "system",
              text: "Task completed successfully.",
              createdAt: "2026-03-11T00:05:00.000Z",
            },
          ],
        }),
      ]),
      saveTasks: vi.fn(async () => {
        return;
      }),
    };

    const workbench = await createTaskWorkbench({ persistence });

    expect(workbench.getTask("task-1")?.thread).toEqual([
      expect.objectContaining({ text: "Task completed successfully." }),
    ]);
  });

  it("does not keep a created task in memory when persistence save fails", async () => {
    const persistenceError = new Error("disk full");
    const persistence: TaskPersistence = {
      loadTasks: vi.fn(async () => []),
      saveTasks: vi.fn(async () => {
        throw persistenceError;
      }),
    };

    const workbench = await createTaskWorkbench({ persistence });

    await expect(
      workbench.createTask({
        workspaceId: "workspace-1",
        prompt: "Implement speaking feature",
        runnerPreference: "auto",
      }),
    ).rejects.toThrow("disk full");
    expect(workbench.listTasks()).toEqual([]);
  });
});
