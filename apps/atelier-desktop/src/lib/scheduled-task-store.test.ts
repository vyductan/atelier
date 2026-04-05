import { describe, expect, it } from "vitest";

import { createScheduledTaskStore } from "./scheduled-task-store";

function createTaskInput() {
  return {
    name: "daily-review",
    description: "Review today's commits",
    workspacePath: "/tmp/workspace",
    prompt: "Review today's commits",
    model: "claude-sonnet-4-6",
    permissionMode: "ask" as const,
    worktree: { enabled: true },
    schedule: {
      type: "daily" as const,
      cron: "0 9 * * *",
      timezone: "Asia/Ho_Chi_Minh",
      enabled: true,
      jitterMinutes: 10,
    },
  };
}

describe("scheduledTaskStore", () => {
  it("appends run records and links them to a scheduled task", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

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

    const run = store.createScheduledRun({
      scheduledTaskId: task.id,
      scheduledFor: "2026-04-05T09:03:00.000Z",
      reason: "normal",
    });

    expect(run.runId).toBe("run-1");
    expect(run.status).toBe("queued");
    expect(store.listRunsByTask(task.id)).toEqual([
      expect.objectContaining({ runId: "run-1", scheduledTaskId: task.id }),
    ]);
  });

  it("updates a task runtime summary after a run is queued", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = store.createScheduledTask(createTaskInput());

    const updatedTask = store.updateScheduledTask(task.id, {
      engineState: "queued",
      lastScheduledAt: "2026-04-05T09:03:00.000Z",
    });

    expect(updatedTask).toEqual(
      expect.objectContaining({
        engineState: "queued",
        lastScheduledAt: "2026-04-05T09:03:00.000Z",
      }),
    );
  });

  it("isolates nested task data from caller mutations", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
    });
    const input = createTaskInput();

    const createdTask = store.createScheduledTask(input);
    input.worktree.enabled = false;
    input.schedule.timezone = "UTC";

    createdTask.worktree.enabled = false;
    createdTask.schedule.enabled = false;
    createdTask.rememberedApprovals.push("approve-1");

    const storedTask = store.getScheduledTask(createdTask.id);
    expect(storedTask).not.toBeNull();

    expect(storedTask).toMatchObject({
      worktree: { enabled: true },
      schedule: expect.objectContaining({
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
      }),
      rememberedApprovals: [],
    });

    storedTask!.schedule.timezone = "America/New_York";
    storedTask!.rememberedApprovals.push("approve-2");

    expect(store.getScheduledTask(createdTask.id)).toMatchObject({
      schedule: expect.objectContaining({ timezone: "Asia/Ho_Chi_Minh" }),
      rememberedApprovals: [],
    });
  });

  it("isolates nested update patches and rejects immutable field rewrites", () => {
    let timestampIndex = 0;
    const timestamps = [
      "2026-04-05T09:00:00.000Z",
      "2026-04-05T09:05:00.000Z",
      "2026-04-05T09:10:00.000Z",
    ];
    const store = createScheduledTaskStore({
      now: () => timestamps[timestampIndex++] ?? timestamps[timestamps.length - 1],
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = store.createScheduledTask(createTaskInput());
    const taskPatch = {
      id: "sched-rewritten",
      createdAt: "1999-01-01T00:00:00.000Z",
      worktree: { enabled: false },
      schedule: {
        ...task.schedule,
        timezone: "UTC",
      },
      rememberedApprovals: ["approve-1"],
    };

    const updatedTask = store.updateScheduledTask(task.id, taskPatch);
    taskPatch.worktree.enabled = true;
    taskPatch.schedule.timezone = "America/New_York";
    taskPatch.rememberedApprovals.push("approve-2");

    expect(updatedTask).toMatchObject({
      id: "sched-1",
      createdAt: "2026-04-05T09:00:00.000Z",
      updatedAt: "2026-04-05T09:05:00.000Z",
      worktree: { enabled: false },
      schedule: expect.objectContaining({ timezone: "UTC" }),
      rememberedApprovals: ["approve-1"],
    });
    expect(store.getScheduledTask(task.id)).toMatchObject({
      id: "sched-1",
      createdAt: "2026-04-05T09:00:00.000Z",
      worktree: { enabled: false },
      schedule: expect.objectContaining({ timezone: "UTC" }),
      rememberedApprovals: ["approve-1"],
    });

    const run = store.createScheduledRun({
      scheduledTaskId: task.id,
      scheduledFor: "2026-04-05T09:15:00.000Z",
      reason: "normal",
    });

    const updatedRun = store.updateScheduledRun(run.runId, {
      runId: "run-rewritten",
      createdAt: "1999-01-01T00:00:00.000Z",
      status: "running",
    });

    expect(updatedRun).toMatchObject({
      runId: "run-1",
      createdAt: "2026-04-05T09:10:00.000Z",
      status: "running",
    });
    expect(store.listScheduledRuns()).toEqual([
      expect.objectContaining({
        runId: "run-1",
        createdAt: "2026-04-05T09:10:00.000Z",
        status: "running",
      }),
    ]);
  });

  it("generates fresh task and run ids when initialized with hydrated records", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      initialTasks: [
        {
          id: "sched-7",
          name: "existing-task",
          description: "Hydrated scheduled task",
          workspacePath: "/tmp/workspace",
          prompt: "Hydrated scheduled task",
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
          createdAt: "2026-04-04T09:00:00.000Z",
          updatedAt: "2026-04-04T09:00:00.000Z",
        },
      ],
      initialRuns: [
        {
          runId: "run-11",
          scheduledTaskId: "sched-7",
          scheduledFor: "2026-04-04T09:03:00.000Z",
          startedAt: null,
          finishedAt: null,
          status: "queued",
          reason: "normal",
          linkedSessionId: null,
          linkedTaskId: null,
          errorSummary: null,
          summary: null,
          createdAt: "2026-04-04T09:00:00.000Z",
          updatedAt: "2026-04-04T09:00:00.000Z",
        },
      ],
    });

    const task = store.createScheduledTask(createTaskInput());
    const run = store.createScheduledRun({
      scheduledTaskId: task.id,
      scheduledFor: "2026-04-05T09:03:00.000Z",
      reason: "normal",
    });

    expect(task.id).toBe("sched-8");
    expect(run.runId).toBe("run-12");
  });
});
