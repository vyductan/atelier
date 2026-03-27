import { describe, expect, it } from "vitest";

import type { TaskRecord } from "./tasks";
import { createTaskStore } from "./task-store";

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

describe("taskStore", () => {
  it("creates a queued task for a workspace with null lifecycle metadata defaults", () => {
    const store = createTaskStore();

    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "implement english learning speaking",
      runnerPreference: "auto",
    });

    expect(task.status).toBe("queued");
    expect(task.workspaceId).toBe("workspace-1");
    expect(task.runnerPreference).toBe("auto");
    expect(task.title).toBe("implement english learning speaking");
    expect(task.blockedReason).toBeNull();
    expect(task.approvalRequest).toBeNull();
    expect(task.lastErrorSummary).toBeNull();
  });

  it("updates a task status and current stage", () => {
    const timestamps = ["2026-03-11T00:00:00.000Z", "2026-03-11T00:00:01.000Z"];
    const store = createTaskStore({
      now: () => timestamps.shift() ?? "2026-03-11T00:00:01.000Z",
    });
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "review PR 128",
      runnerPreference: "claude",
    });

    const updatedTask = store.updateTask(task.id, {
      status: "running",
      currentStage: "planning",
    });

    expect(updatedTask?.status).toBe("running");
    expect(updatedTask?.currentStage).toBe("planning");
    expect(updatedTask?.updatedAt).not.toBe(task.updatedAt);
  });

  it("stores blockedReason, approvalRequest, and lastErrorSummary updates", () => {
    const timestamps = [
      "2026-03-11T00:00:00.000Z",
      "2026-03-11T00:00:01.000Z",
      "2026-03-11T00:00:02.000Z",
      "2026-03-11T00:00:03.000Z",
    ];
    const store = createTaskStore({
      now: () => timestamps.shift() ?? "2026-03-11T00:00:03.000Z",
    });
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "deploy migrations",
      runnerPreference: "auto",
    });

    const blockedTask = store.updateTask(task.id, {
      blockedReason: "Waiting for database credentials.",
    });
    const approvalTask = store.updateTask(task.id, {
      approvalRequest: "Approve applying production migration.",
    });
    const failedTask = store.updateTask(task.id, {
      lastErrorSummary: "Migration checksum mismatch.",
    });

    expect(blockedTask?.blockedReason).toBe(
      "Waiting for database credentials.",
    );
    expect(approvalTask?.approvalRequest).toBe(
      "Approve applying production migration.",
    );
    expect(failedTask?.lastErrorSummary).toBe("Migration checksum mismatch.");
  });

  it("preserves thread data and createdAt while updating lifecycle metadata", () => {
    const timestamps = [
      "2026-03-11T00:00:00.000Z",
      "2026-03-11T00:00:01.000Z",
      "2026-03-11T00:00:02.000Z",
      "2026-03-11T00:00:03.000Z",
    ];
    const store = createTaskStore({
      now: () => timestamps.shift() ?? "2026-03-11T00:00:03.000Z",
    });
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "investigate CI failure",
      runnerPreference: "claude",
    });

    const message = store.appendTaskThreadMessage(task.id, {
      role: "assistant",
      text: "I am checking the failing workflow now.",
    });
    const updatedTask = store.updateTask(task.id, {
      blockedReason: "Waiting for CI logs to finish uploading.",
      approvalRequest: "Approve rerunning the failed workflow.",
      lastErrorSummary: "GitHub API returned a temporary 502.",
    });

    expect(updatedTask?.thread).toEqual([message]);
    expect(updatedTask?.createdAt).toBe(task.createdAt);
    expect(updatedTask?.updatedAt).not.toBe(task.createdAt);
  });

  it("returns a defensive copy from appendTaskThreadMessage", () => {
    const timestamps = [
      "2026-03-11T00:00:00.000Z",
      "2026-03-11T00:00:01.000Z",
      "2026-03-11T00:00:02.000Z",
    ];
    const store = createTaskStore({
      now: () => timestamps.shift() ?? "2026-03-11T00:00:02.000Z",
    });
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "inspect task timeline",
      runnerPreference: "claude",
    });

    const returnedMessage = store.appendTaskThreadMessage(task.id, {
      role: "assistant",
      text: "Inspecting timeline state.",
    });

    if (!returnedMessage) {
      throw new Error("Expected a thread message to be returned.");
    }

    returnedMessage.text = "Externally mutated text.";

    const storedThread = store.getTaskThread(task.id);

    expect(storedThread).toHaveLength(1);
    expect(storedThread[0]?.text).toBe("Inspecting timeline state.");
  });

  it("returns defensive copies so external mutation does not change store state", () => {
    const timestamps = [
      "2026-03-11T00:00:00.000Z",
      "2026-03-11T00:00:01.000Z",
      "2026-03-11T00:00:02.000Z",
    ];
    const store = createTaskStore({
      now: () => timestamps.shift() ?? "2026-03-11T00:00:02.000Z",
    });
    const createdTask = store.createTask({
      workspaceId: "workspace-1",
      prompt: "triage release blocker",
      runnerPreference: "auto",
    });

    store.appendTaskThreadMessage(createdTask.id, {
      role: "assistant",
      text: "Checking release state.",
    });

    createdTask.status = "done";
    createdTask.thread.push({
      id: "external-message",
      role: "user",
      text: "This should not persist.",
      createdAt: "2026-03-11T00:00:09.000Z",
    });

    const fetchedTask = store.getTask(createdTask.id);
    const listedTask = store.listTasksByWorkspace("workspace-1")[0];
    const fetchedThread = store.getTaskThread(createdTask.id);

    fetchedTask?.thread.push({
      id: "external-thread-change",
      role: "assistant",
      text: "This should also not persist.",
      createdAt: "2026-03-11T00:00:10.000Z",
    });
    if (listedTask) {
      listedTask.status = "cancelled";
    }
    fetchedThread.push({
      id: "external-array-change",
      role: "system",
      text: "No-op",
      createdAt: "2026-03-11T00:00:11.000Z",
    });

    const reloadedTask = store.getTask(createdTask.id);
    const reloadedThread = store.getTaskThread(createdTask.id);

    expect(reloadedTask?.status).toBe("queued");
    expect(reloadedTask?.thread).toHaveLength(1);
    expect(reloadedTask?.thread[0]?.text).toBe("Checking release state.");
    expect(reloadedThread).toHaveLength(1);
    expect(reloadedThread[0]?.text).toBe("Checking release state.");
  });

  it("lists workspace tasks ordered by update time", () => {
    const store = createTaskStore({
      now: () => storeTimes.shift() ?? "2026-03-11T00:00:00.000Z",
    });
    const storeTimes = [
      "2026-03-11T00:00:00.000Z",
      "2026-03-11T00:00:01.000Z",
      "2026-03-11T00:00:02.000Z",
      "2026-03-11T00:00:03.000Z",
      "2026-03-11T00:00:04.000Z",
    ];

    const olderTask = store.createTask({
      workspaceId: "workspace-1",
      prompt: "first task",
      runnerPreference: "auto",
    });
    const otherWorkspaceTask = store.createTask({
      workspaceId: "workspace-2",
      prompt: "other workspace task",
      runnerPreference: "openclaw",
    });
    const newerTask = store.createTask({
      workspaceId: "workspace-1",
      prompt: "second task",
      runnerPreference: "claude",
    });

    store.updateTask(olderTask.id, { currentStage: "running checks" });

    expect(
      store.listTasksByWorkspace("workspace-1").map((task) => task.id),
    ).toEqual([olderTask.id, newerTask.id]);
    expect(store.listTasksByWorkspace("workspace-2")).toEqual([
      otherWorkspaceTask,
    ]);
  });

  it("hydrates persisted tasks and threads", () => {
    const store = createTaskStore({
      initialTasks: [
        createTask({
          id: "task-1",
          workspaceId: "workspace-1",
          status: "done",
          runnerPreference: "claude",
          resolvedRunner: "claude",
          currentStage: "completed",
          updatedAt: "2026-03-11T00:05:00.000Z",
          summary: "Finished review.",
          thread: [
            {
              id: "thread-1",
              role: "system",
              text: "Task completed successfully.",
              createdAt: "2026-03-11T00:05:00.000Z",
            },
          ],
        }),
      ],
    });

    expect(store.getTask("task-1")).toEqual(
      expect.objectContaining({
        status: "done",
        currentStage: "completed",
      }),
    );
    expect(store.getTask("task-1")?.thread).toHaveLength(1);
    expect(store.getTaskThread("task-1")[0]?.text).toBe(
      "Task completed successfully.",
    );
  });

  it("returns defensive copies after hydration", () => {
    const store = createTaskStore({
      initialTasks: [
        createTask({
          id: "task-1",
          thread: [
            {
              id: "thread-1",
              role: "assistant",
              text: "Initial persisted message.",
              createdAt: "2026-03-11T00:01:00.000Z",
            },
          ],
        }),
      ],
    });

    const hydratedTask = store.getTask("task-1");
    const exportedTask = store.listTasks()[0];
    const hydratedThread = store.getTaskThread("task-1");

    if (!hydratedTask || !exportedTask) {
      throw new Error("Expected hydrated task exports.");
    }

    const hydratedTaskThreadMessage = hydratedTask.thread[0];
    const hydratedThreadMessage = hydratedThread[0];

    if (!hydratedTaskThreadMessage || !hydratedThreadMessage) {
      throw new Error("Expected hydrated thread entries.");
    }

    hydratedTask.status = "failed";
    hydratedTaskThreadMessage.text = "Mutated fetched task.";
    exportedTask.thread.push({
      id: "thread-2",
      role: "system",
      text: "Mutated exported task.",
      createdAt: "2026-03-11T00:02:00.000Z",
    });
    hydratedThreadMessage.text = "Mutated fetched thread.";

    expect(store.getTask("task-1")).toEqual(
      expect.objectContaining({ status: "queued" }),
    );
    expect(store.getTask("task-1")?.thread).toEqual([
      expect.objectContaining({ text: "Initial persisted message." }),
    ]);
    expect(store.listTasks()).toEqual([
      expect.objectContaining({
        id: "task-1",
        thread: [
          expect.objectContaining({ text: "Initial persisted message." }),
        ],
      }),
    ]);
    expect(store.getTaskThread("task-1")).toEqual([
      expect.objectContaining({ text: "Initial persisted message." }),
    ]);
  });

  it("lists every hydrated and created task for persistence writes", () => {
    const store = createTaskStore({
      now: () => "2026-03-11T00:10:00.000Z",
      createId: () => "task-2",
      initialTasks: [
        createTask({
          id: "task-1",
          workspaceId: "workspace-1",
          title: "Persisted task",
          prompt: "Persisted task",
        }),
      ],
    });

    const createdTask = store.createTask({
      workspaceId: "workspace-2",
      prompt: "Fresh task",
      runnerPreference: "openclaw",
    });

    expect(createdTask.id).toBe("task-2");
    expect(store.listTasks()).toEqual([
      expect.objectContaining({ id: "task-1" }),
      expect.objectContaining({
        id: "task-2",
        workspaceId: "workspace-2",
        prompt: "Fresh task",
      }),
    ]);
  });

  it("does not reuse hydrated task ids when creating new tasks", () => {
    const store = createTaskStore({
      initialTasks: [createTask({ id: "task-1" })],
    });

    const createdTask = store.createTask({
      workspaceId: "workspace-2",
      prompt: "Fresh task",
      runnerPreference: "auto",
    });

    expect(createdTask.id).not.toBe("task-1");
    expect(store.getTask("task-1")).toEqual(
      expect.objectContaining({ id: "task-1" }),
    );
    expect(store.listTasks()).toHaveLength(2);
  });
});
