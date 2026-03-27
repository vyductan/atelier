import { describe, expect, it, vi } from "vitest";

import type { TaskRecord } from "./tasks";
import {
  createTaskPersistence,
  parseTaskSnapshot,
  serializeTaskSnapshot,
} from "./task-persistence";

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

describe("task-persistence", () => {
  it("round-trips persisted tasks with thread messages", () => {
    const tasks = [
      createTask({
        status: "blocked",
        runnerPreference: "openclaw",
        resolvedRunner: "openclaw",
        currentStage: "waiting for retry",
        blockedReason: "Waiting for CI retry.",
        updatedAt: "2026-03-11T00:05:00.000Z",
        summary: "Blocked while waiting for retry.",
        thread: [
          {
            id: "thread-1",
            role: "system",
            text: "Task blocked while waiting for retry.",
            createdAt: "2026-03-11T00:04:00.000Z",
          },
        ],
      }),
      createTask({
        id: "task-2",
        status: "running",
        currentStage: "planning",
      }),
    ];

    const serialized = serializeTaskSnapshot(tasks);
    const parsed = parseTaskSnapshot(serialized);

    expect(JSON.parse(serialized)).toEqual({
      version: 1,
      tasks,
    });
    expect(parsed).toEqual(tasks);
    expect(parsed[0]?.thread[0]?.text).toBe(
      "Task blocked while waiting for retry.",
    );
  });

  it("loads empty tasks when the snapshot file is missing", async () => {
    const readTextFile = vi.fn(async () => {
      const error = new Error("File not found");
      (error as Error & { code?: string }).code = "ENOENT";
      throw error;
    });
    const writeTextFile = vi.fn(async () => {
      return;
    });
    const persistence = createTaskPersistence({
      filePath: "task-snapshot.json",
      readTextFile,
      writeTextFile,
    });

    await expect(persistence.loadTasks()).resolves.toEqual([]);
    expect(readTextFile).toHaveBeenCalledWith("task-snapshot.json");
    expect(writeTextFile).not.toHaveBeenCalled();
  });

  it("saves serialized tasks through the file adapter", async () => {
    const tasks = [createTask({ id: "task-1" })];
    const writeTextFile = vi.fn(async () => {
      return;
    });
    const persistence = createTaskPersistence({
      filePath: "task-snapshot.json",
      readTextFile: vi.fn(async () => ""),
      writeTextFile,
    });

    await persistence.saveTasks(tasks);

    expect(writeTextFile).toHaveBeenCalledWith(
      "task-snapshot.json",
      JSON.stringify({ version: 1, tasks }),
    );
  });

  it("throws when snapshot json is malformed", () => {
    expect(() => parseTaskSnapshot("{not json")).toThrow(SyntaxError);
  });

  it("throws when snapshot version is unsupported", () => {
    expect(() =>
      parseTaskSnapshot(JSON.stringify({ version: 2, tasks: [] })),
    ).toThrowError("Unsupported task snapshot version: 2");
  });

  it("rejects structurally invalid task payloads", () => {
    expect(() =>
      parseTaskSnapshot(JSON.stringify({ version: 1, tasks: [{}] })),
    ).toThrowError("Invalid task snapshot: task at index 0 is missing id");
  });
});
