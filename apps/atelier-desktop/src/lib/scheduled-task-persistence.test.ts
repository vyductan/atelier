import { describe, expect, it, vi } from "vitest";

import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "./scheduled-tasks";
import {
  createScheduledTaskPersistence,
  parseScheduledTaskSnapshot,
  serializeScheduledTaskSnapshot,
} from "./scheduled-task-persistence";

function createScheduledTask(
  overrides: Partial<ScheduledTaskDefinition> = {},
): ScheduledTaskDefinition {
  return {
    id: "sched-1",
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
    nextRunAt: null,
    lastScheduledAt: null,
    lastStartedAt: null,
    lastFinishedAt: null,
    lastMissedAt: null,
    engineState: "idle",
    rememberedApprovals: [],
    importSource: "none",
    importedAt: null,
    createdAt: "2026-04-05T09:00:00.000Z",
    updatedAt: "2026-04-05T09:00:00.000Z",
    ...overrides,
  };
}

function createScheduledTaskRun(
  overrides: Partial<ScheduledTaskRunRecord> = {},
): ScheduledTaskRunRecord {
  return {
    runId: "run-1",
    scheduledTaskId: "sched-1",
    scheduledFor: "2026-04-05T09:03:00.000Z",
    startedAt: null,
    finishedAt: null,
    status: "queued",
    reason: "normal",
    linkedSessionId: null,
    linkedTaskId: null,
    errorSummary: null,
    summary: null,
    createdAt: "2026-04-05T09:00:00.000Z",
    updatedAt: "2026-04-05T09:00:00.000Z",
    ...overrides,
  };
}

describe("scheduledTaskPersistence", () => {
  it("round-trips scheduled tasks and runs", async () => {
    const tasks = [createScheduledTask()];
    const runs = [createScheduledTaskRun()];
    const contents = serializeScheduledTaskSnapshot({ tasks, runs });

    expect(parseScheduledTaskSnapshot(contents)).toEqual({
      tasks,
      runs,
    });
  });

  it("returns empty state when the snapshot file does not exist", async () => {
    const persistence = createScheduledTaskPersistence({
      filePath: "scheduled-task-snapshot.json",
      readTextFile: vi.fn(async () => {
        throw Object.assign(new Error("scheduled task snapshot not found"), {
          code: "ENOENT",
        });
      }),
      writeTextFile: vi.fn(async () => undefined),
    });

    await expect(persistence.load()).resolves.toEqual({ tasks: [], runs: [] });
  });

  it("does not swallow unrelated read failures that merely mention not found", async () => {
    const persistence = createScheduledTaskPersistence({
      filePath: "scheduled-task-snapshot.json",
      readTextFile: vi.fn(async () => {
        throw new Error("workspace metadata not found for configured root");
      }),
      writeTextFile: vi.fn(async () => undefined),
    });

    await expect(persistence.load()).rejects.toThrow(
      "workspace metadata not found for configured root",
    );
  });

  it("throws when snapshot json is malformed", () => {
    expect(() => parseScheduledTaskSnapshot("{not json")).toThrow(SyntaxError);
  });

  it("throws when snapshot version is unsupported", () => {
    expect(() =>
      parseScheduledTaskSnapshot(JSON.stringify({ version: 2, tasks: [], runs: [] })),
    ).toThrowError("Unsupported scheduled task snapshot version: 2");
  });

  it("rejects structurally invalid scheduled task payloads", () => {
    expect(() =>
      parseScheduledTaskSnapshot(
        JSON.stringify({
          version: 1,
          tasks: [{}],
          runs: [createScheduledTaskRun()],
        }),
      ),
    ).toThrowError("Invalid scheduled task snapshot: task at index 0 is missing id");
  });

  it("rejects structurally invalid scheduled task run payloads", () => {
    expect(() =>
      parseScheduledTaskSnapshot(
        JSON.stringify({
          version: 1,
          tasks: [createScheduledTask()],
          runs: [{ runId: "run-1" }],
        }),
      ),
    ).toThrowError(
      "Invalid scheduled task snapshot: run at index 0 is missing scheduledTaskId",
    );
  });

  it.each([
    {
      name: "task permissionMode",
      tasks: [
        createScheduledTask({
          permissionMode: "invalid" as ScheduledTaskDefinition["permissionMode"],
        }),
      ],
      runs: [createScheduledTaskRun()],
      error: "Invalid scheduled task snapshot: task at index 0 has invalid permissionMode",
    },
    {
      name: "task engineState",
      tasks: [
        createScheduledTask({
          engineState: "broken" as ScheduledTaskDefinition["engineState"],
        }),
      ],
      runs: [createScheduledTaskRun()],
      error: "Invalid scheduled task snapshot: task at index 0 has invalid engineState",
    },
    {
      name: "task schedule.type",
      tasks: [
        createScheduledTask({
          schedule: {
            ...createScheduledTask().schedule,
            type: "sometimes" as ScheduledTaskDefinition["schedule"]["type"],
          },
        }),
      ],
      runs: [createScheduledTaskRun()],
      error: "Invalid scheduled task snapshot: task at index 0 schedule has invalid type",
    },
    {
      name: "task importSource",
      tasks: [
        createScheduledTask({
          importSource: "imported" as ScheduledTaskDefinition["importSource"],
        }),
      ],
      runs: [createScheduledTaskRun()],
      error: "Invalid scheduled task snapshot: task at index 0 has invalid importSource",
    },
    {
      name: "run status",
      tasks: [createScheduledTask()],
      runs: [
        createScheduledTaskRun({
          status: "done" as ScheduledTaskRunRecord["status"],
        }),
      ],
      error: "Invalid scheduled task snapshot: run at index 0 has invalid status",
    },
    {
      name: "run reason",
      tasks: [createScheduledTask()],
      runs: [
        createScheduledTaskRun({
          reason: "manual" as ScheduledTaskRunRecord["reason"],
        }),
      ],
      error: "Invalid scheduled task snapshot: run at index 0 has invalid reason",
    },
  ])("rejects invalid enum-backed field values for $name", ({ tasks, runs, error }) => {
    expect(() =>
      parseScheduledTaskSnapshot(
        JSON.stringify({
          version: 1,
          tasks,
          runs,
        }),
      ),
    ).toThrowError(error);
  });

  it("rejects null snapshot roots with a controlled validation error", () => {
    expect(() => parseScheduledTaskSnapshot("null")).toThrowError(
      "Invalid scheduled task snapshot: root must be an object",
    );
  });
});
