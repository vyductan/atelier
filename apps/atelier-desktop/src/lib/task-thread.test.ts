import { describe, expect, it } from "vitest";

import { createTaskStore } from "./task-store";
import {
  appendTaskSystemMessage,
  appendTaskThreadMessage,
  getTaskThreadEntryLabel,
} from "./task-thread";

describe("appendTaskThreadMessage", () => {
  it("derives readable lifecycle labels for system timeline events", () => {
    expect(
      getTaskThreadEntryLabel({
        id: "message-1",
        role: "system",
        text: "Task retry started.",
        createdAt: "2026-03-11T00:00:00.000Z",
      }),
    ).toBe("Retry started");

    expect(
      getTaskThreadEntryLabel({
        id: "message-2",
        role: "system",
        text: "Task approval granted.",
        createdAt: "2026-03-11T00:00:01.000Z",
      }),
    ).toBe("Approval granted");

    expect(
      getTaskThreadEntryLabel({
        id: "message-3",
        role: "system",
        text: "Completed successfully.",
        createdAt: "2026-03-11T00:00:02.000Z",
      }),
    ).toBe("Completed");
  });

  it("appends a completion summary to the task thread", () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "review pr 128",
      runnerPreference: "openclaw",
    });

    appendTaskThreadMessage(store, task.id, {
      role: "system",
      text: "Task completed with passing checks.",
    });

    expect(store.getTaskThread(task.id)).toEqual([
      expect.objectContaining({ text: "Task completed with passing checks." }),
    ]);
  });

  it("records retry and completion events in order", () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "review pr 128",
      runnerPreference: "openclaw",
    });

    appendTaskSystemMessage(store, task.id, "Task retry started.");
    appendTaskSystemMessage(store, task.id, "Completed successfully.");

    expect(store.getTaskThread(task.id).map((message) => message.text)).toEqual(
      ["Task retry started.", "Completed successfully."],
    );
  });

  it("keeps thread state scoped to one task", () => {
    const store = createTaskStore();
    const firstTask = store.createTask({
      workspaceId: "workspace-1",
      prompt: "first task",
      runnerPreference: "claude",
    });
    const secondTask = store.createTask({
      workspaceId: "workspace-2",
      prompt: "second task",
      runnerPreference: "openclaw",
    });

    appendTaskThreadMessage(store, firstTask.id, {
      role: "assistant",
      text: "Investigating the first task.",
    });
    appendTaskSystemMessage(
      store,
      secondTask.id,
      "Second task is blocked on setup.",
    );

    expect(store.getTaskThread(firstTask.id)).toEqual([
      expect.objectContaining({ text: "Investigating the first task." }),
    ]);
    expect(store.getTaskThread(secondTask.id)).toEqual([
      expect.objectContaining({ text: "Second task is blocked on setup." }),
    ]);
  });
});
