import { describe, expect, it, vi } from "vitest";

import type { ScheduledTaskPersistence } from "./scheduled-task-workbench";
import { createScheduledTaskWorkbench } from "./scheduled-task-workbench";

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
      timezone: "UTC",
      enabled: true,
      jitterMinutes: 0,
    },
  };
}

describe("scheduledTaskWorkbench", () => {
  it("creates and starts a run-now run, then persists the runner result", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
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

    expect(runner.startScheduledRun).toHaveBeenCalledWith({
      scheduledTaskId: "sched-1",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      reason: "run_now",
    });
    expect(run).toEqual(
      expect.objectContaining({
        runId: "run-1",
        scheduledTaskId: "sched-1",
        scheduledFor: null,
        reason: "run_now",
        startedAt: "2026-04-05T09:00:00.000Z",
        finishedAt: null,
        status: "running",
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
      }),
    );
    expect(workbench.listScheduledTasks()).toEqual([
      expect.objectContaining({
        id: "sched-1",
        engineState: "running",
        lastStartedAt: "2026-04-05T09:00:00.000Z",
      }),
    ]);
    expect(persistence.save).toHaveBeenNthCalledWith(1, {
      tasks: [expect.objectContaining({ id: "sched-1" })],
      runs: [],
    });
    expect(persistence.save).toHaveBeenNthCalledWith(2, {
      tasks: [expect.objectContaining({ id: "sched-1", engineState: "queued" })],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          status: "queued",
          startedAt: null,
        }),
      ],
    });
    expect(persistence.save).toHaveBeenNthCalledWith(3, {
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "running",
          lastStartedAt: "2026-04-05T09:00:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          status: "running",
          startedAt: "2026-04-05T09:00:00.000Z",
          finishedAt: null,
          linkedSessionId: "session-123",
          linkedTaskId: "task-456",
        }),
      ],
    });
  });

  it("persists finishedAt when the runner immediately returns a terminal status", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "completed" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
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

    expect(run).toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "completed",
        startedAt: "2026-04-05T09:00:00.000Z",
        finishedAt: "2026-04-05T09:00:00.000Z",
      }),
    );
    expect(workbench.listScheduledTasks()).toEqual([
      expect.objectContaining({
        id: "sched-1",
        engineState: "idle",
        lastStartedAt: "2026-04-05T09:00:00.000Z",
        lastFinishedAt: "2026-04-05T09:00:00.000Z",
      }),
    ]);
    expect(persistence.save).toHaveBeenNthCalledWith(3, {
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "idle",
          lastStartedAt: "2026-04-05T09:00:00.000Z",
          lastFinishedAt: "2026-04-05T09:00:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          status: "completed",
          startedAt: "2026-04-05T09:00:00.000Z",
          finishedAt: "2026-04-05T09:00:00.000Z",
          linkedSessionId: "session-123",
          linkedTaskId: "task-456",
        }),
      ],
    });
  });

  it("marks the persisted run as failed when launching a run-now run fails", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runnerError = new Error("Runner launch failed");
    const runner = {
      startScheduledRun: vi.fn(async () => {
        throw runnerError;
      }),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
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

    await expect(workbench.runNow(task.id)).rejects.toThrow("Runner launch failed");

    expect(workbench.listScheduledTasks()).toEqual([
      expect.objectContaining({
        id: "sched-1",
        engineState: "idle",
        lastFinishedAt: "2026-04-05T09:00:00.000Z",
      }),
    ]);
    expect(persistence.save).toHaveBeenNthCalledWith(3, {
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "idle",
          lastFinishedAt: "2026-04-05T09:00:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          status: "failed",
          startedAt: null,
          finishedAt: "2026-04-05T09:00:00.000Z",
          errorSummary: "Runner launch failed",
        }),
      ],
    });
  });

  it("rolls back a queued run when the initial run-now save fails", async () => {
    const persistenceError = new Error("Initial queued-run save failed");
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi
        .fn<
          (input: {
            tasks: Parameters<ScheduledTaskPersistence["save"]>[0]["tasks"];
            runs: Parameters<ScheduledTaskPersistence["save"]>[0]["runs"];
          }) => Promise<void>
        >()
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          throw persistenceError;
        })
        .mockImplementationOnce(async () => {
          return;
        }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
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

    await expect(workbench.runNow(task.id)).rejects.toThrow(
      "Initial queued-run save failed",
    );

    expect(runner.startScheduledRun).not.toHaveBeenCalled();
    expect(persistence.save).toHaveBeenCalledTimes(2);
    expect(persistence.save).toHaveBeenNthCalledWith(2, {
      tasks: [expect.objectContaining({ id: "sched-1" })],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          status: "queued",
          startedAt: null,
          finishedAt: null,
        }),
      ],
    });

    const laterTask = await workbench.createScheduledTask({
      name: "weekly-review",
      description: "Review this week's commits",
      workspacePath: "/tmp/workspace-2",
      prompt: "Review this week's commits",
      model: "claude-sonnet-4-6",
      permissionMode: "ask",
      worktree: { enabled: true },
      schedule: {
        type: "daily",
        cron: "0 10 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
        jitterMinutes: 10,
      },
    });

    expect(laterTask.id).toBe("sched-1");
    expect(workbench.listScheduledTasks()).toEqual([
      expect.objectContaining({ id: "sched-1", name: "weekly-review" }),
    ]);
    expect(persistence.save).toHaveBeenCalledTimes(3);
    expect(persistence.save).toHaveBeenNthCalledWith(3, {
      tasks: [expect.objectContaining({ id: "sched-1", name: "weekly-review" })],
      runs: [],
    });
  });

  it("keeps truthful in-memory run state when post-launch persistence fails", async () => {
    const persistenceError = new Error("Post-launch save failed");
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi
        .fn<
          (input: {
            tasks: Parameters<ScheduledTaskPersistence["save"]>[0]["tasks"];
            runs: Parameters<ScheduledTaskPersistence["save"]>[0]["runs"];
          }) => Promise<void>
        >()
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          throw persistenceError;
        }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
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

    await expect(workbench.runNow(task.id)).rejects.toMatchObject({
      name: "ScheduledRunPersistenceError",
      message: "Scheduled run started but its state could not be persisted",
    });

    expect(runner.startScheduledRun).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledTimes(3);
    expect(persistence.save).toHaveBeenNthCalledWith(3, {
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "running",
          lastStartedAt: "2026-04-05T09:00:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          status: "running",
          startedAt: "2026-04-05T09:00:00.000Z",
          finishedAt: null,
          linkedSessionId: "session-123",
          linkedTaskId: "task-456",
        }),
      ],
    });
    expect(workbench.listScheduledRuns()).toEqual([
      expect.objectContaining({
        runId: "run-1",
        status: "running",
        startedAt: "2026-04-05T09:00:00.000Z",
        finishedAt: null,
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
      }),
    ]);
    expect(workbench.listScheduledTasks()).toEqual([
      expect.objectContaining({
        id: "sched-1",
        engineState: "running",
        lastStartedAt: "2026-04-05T09:00:00.000Z",
      }),
    ]);
  });

  it("updates editable scheduled task fields while preserving runtime scheduler state", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = await workbench.createScheduledTask(createTaskInput());
    await workbench.runNow(task.id);

    const updatedTask = await workbench.updateScheduledTask(task.id, {
      name: "Edited name",
      description: "Edited description",
      workspacePath: "/tmp/updated-workspace",
      prompt: "Edited prompt",
      worktreeEnabled: false,
      frequency: "daily",
      cron: "0 10 * * *",
    });

    expect(updatedTask).toEqual(
      expect.objectContaining({
        id: "sched-1",
        name: "Edited name",
        description: "Edited description",
        workspacePath: "/tmp/updated-workspace",
        prompt: "Edited prompt",
        worktree: { enabled: false },
        schedule: expect.objectContaining({
          type: "daily",
          cron: "0 10 * * *",
          timezone: "Asia/Ho_Chi_Minh",
          enabled: true,
          jitterMinutes: 10,
        }),
        engineState: "running",
        lastStartedAt: "2026-04-05T09:00:00.000Z",
      }),
    );
    expect(persistence.save).toHaveBeenLastCalledWith({
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          name: "Edited name",
          prompt: "Edited prompt",
          engineState: "running",
        }),
      ],
      runs: [expect.objectContaining({ runId: "run-1", status: "running" })],
    });
  });

  it("rolls back scheduled task edits when persistence fails", async () => {
    const persistenceError = new Error("Edit save failed");
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi
        .fn<
          (input: {
            tasks: Parameters<ScheduledTaskPersistence["save"]>[0]["tasks"];
            runs: Parameters<ScheduledTaskPersistence["save"]>[0]["runs"];
          }) => Promise<void>
        >()
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          throw persistenceError;
        }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = await workbench.createScheduledTask(createTaskInput());

    await expect(
      workbench.updateScheduledTask(task.id, {
        name: "Edited name",
        description: "Edited description",
        workspacePath: "/tmp/updated-workspace",
        prompt: "Edited prompt",
        worktreeEnabled: false,
        frequency: "daily",
        cron: "0 10 * * *",
      }),
    ).rejects.toThrow("Edit save failed");

    expect(workbench.getScheduledTask(task.id)).toEqual(
      expect.objectContaining({
        id: "sched-1",
        name: "daily-review",
        description: "Review today's commits",
        workspacePath: "/tmp/workspace",
        prompt: "Review today's commits",
        worktree: { enabled: true },
        schedule: expect.objectContaining({ cron: "0 9 * * *" }),
      }),
    );
  });

  it("reconciles a linked active run when the underlying task reaches a terminal state", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = await workbench.createScheduledTask(createTaskInput());
    await workbench.runNow(task.id);

    const reconciledRun = await workbench.reconcileLinkedRun({
      linkedTaskId: "task-456",
      status: "completed",
    });

    expect(reconciledRun).toEqual(
      expect.objectContaining({
        runId: "run-1",
        status: "completed",
        finishedAt: "2026-04-05T09:00:00.000Z",
      }),
    );
    expect(workbench.listScheduledTasks()).toEqual([
      expect.objectContaining({
        id: "sched-1",
        engineState: "idle",
        lastFinishedAt: "2026-04-05T09:00:00.000Z",
      }),
    ]);
  });

  it("queues one catch-up run for the most recent missed slot on tick", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T10:15:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = await workbench.createScheduledTask(createTaskInput());

    const runs = await workbench.tick({ now: "2026-04-05T10:15:00.000Z" });

    expect(runs).toEqual([
      expect.objectContaining({
        runId: "run-1",
        scheduledTaskId: task.id,
        scheduledFor: "2026-04-05T09:00:00.000Z",
        reason: "catch_up",
        status: "running",
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
      }),
    ]);
    expect(runner.startScheduledRun).toHaveBeenCalledWith({
      scheduledTaskId: "sched-1",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      reason: "catch_up",
    });
    expect(persistence.save).toHaveBeenLastCalledWith({
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "running",
          lastScheduledAt: "2026-04-05T09:00:00.000Z",
          lastStartedAt: "2026-04-05T10:15:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          reason: "catch_up",
          status: "running",
          linkedSessionId: "session-123",
          linkedTaskId: "task-456",
        }),
      ],
    });
  });

  it("records an overlap skip when a task already has an active run", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({
        tasks: [
          {
            id: "sched-1",
            ...createTaskInput(),
            nextRunAt: null,
            lastScheduledAt: null,
            lastStartedAt: null,
            lastFinishedAt: null,
            lastMissedAt: null,
            engineState: "running",
            rememberedApprovals: [],
            importSource: "none",
            importedAt: null,
            createdAt: "2026-04-05T08:00:00.000Z",
            updatedAt: "2026-04-05T08:00:00.000Z",
          },
        ],
        runs: [
          {
            runId: "run-active",
            scheduledTaskId: "sched-1",
            scheduledFor: "2026-04-05T08:00:00.000Z",
            startedAt: "2026-04-05T08:00:30.000Z",
            finishedAt: null,
            status: "running",
            reason: "run_now",
            linkedSessionId: "session-1",
            linkedTaskId: "task-1",
            errorSummary: null,
            summary: null,
            createdAt: "2026-04-05T08:00:00.000Z",
            updatedAt: "2026-04-05T08:00:30.000Z",
          },
        ],
      })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T10:15:00.000Z",
      createRunId: () => "run-skip",
    });

    const runs = await workbench.tick({ now: "2026-04-05T10:15:00.000Z" });

    expect(runs).toEqual([
      expect.objectContaining({
        runId: "run-skip",
        scheduledTaskId: "sched-1",
        scheduledFor: "2026-04-05T09:00:00.000Z",
        reason: "overlap_skip",
        status: "skipped",
      }),
    ]);
    expect(runner.startScheduledRun).not.toHaveBeenCalled();
    expect(persistence.save).toHaveBeenCalledWith({
      tasks: [expect.objectContaining({ id: "sched-1" })],
      runs: expect.arrayContaining([
        expect.objectContaining({ runId: "run-active", status: "running" }),
        expect.objectContaining({
          runId: "run-skip",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          reason: "overlap_skip",
          status: "skipped",
          finishedAt: "2026-04-05T10:15:00.000Z",
        }),
      ]),
    });
  });

  it("does not create a duplicate run for the same slot on repeated tick", async () => {
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi.fn(async () => {
        return;
      }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T10:15:00.000Z",
      createId: () => "sched-1",
      createRunId: vi
        .fn<() => string>()
        .mockReturnValueOnce("run-1")
        .mockReturnValueOnce("run-2"),
    });

    await workbench.createScheduledTask(createTaskInput());

    const firstRuns = await workbench.tick({ now: "2026-04-05T10:15:00.000Z" });
    const secondRuns = await workbench.tick({ now: "2026-04-05T10:15:00.000Z" });

    expect(firstRuns).toHaveLength(1);
    expect(secondRuns).toEqual([]);
    expect(runner.startScheduledRun).toHaveBeenCalledTimes(1);
    expect(persistence.save).toHaveBeenCalledTimes(3);
  });

  it("rolls back tick-created runs when saving the tick snapshot fails", async () => {
    const persistenceError = new Error("Tick save failed");
    const persistence: ScheduledTaskPersistence = {
      load: vi.fn(async () => ({ tasks: [], runs: [] })),
      save: vi
        .fn<
          (input: {
            tasks: Parameters<ScheduledTaskPersistence["save"]>[0]["tasks"];
            runs: Parameters<ScheduledTaskPersistence["save"]>[0]["runs"];
          }) => Promise<void>
        >()
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          throw persistenceError;
        })
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          return;
        })
        .mockImplementationOnce(async () => {
          return;
        }),
    };
    const runner = {
      startScheduledRun: vi.fn(async () => ({
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
        status: "running" as const,
      })),
    };

    const workbench = await createScheduledTaskWorkbench({
      persistence,
      runner,
      now: () => "2026-04-05T10:15:00.000Z",
      createId: () => "sched-1",
      createRunId: vi
        .fn<() => string>()
        .mockReturnValueOnce("run-1")
        .mockReturnValueOnce("run-2"),
    });

    await workbench.createScheduledTask(createTaskInput());

    await expect(workbench.tick({ now: "2026-04-05T10:15:00.000Z" })).rejects.toThrow(
      "Tick save failed",
    );

    const laterRuns = await workbench.tick({ now: "2026-04-05T10:15:00.000Z" });

    expect(laterRuns).toEqual([
      expect.objectContaining({
        runId: "run-2",
        scheduledTaskId: "sched-1",
        scheduledFor: "2026-04-05T09:00:00.000Z",
        reason: "catch_up",
        status: "running",
        linkedSessionId: "session-123",
        linkedTaskId: "task-456",
      }),
    ]);
    expect(persistence.save).toHaveBeenCalledTimes(4);
    expect(persistence.save).toHaveBeenNthCalledWith(2, {
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "queued",
          lastScheduledAt: "2026-04-05T09:00:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-1",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          reason: "catch_up",
          status: "queued",
        }),
      ],
    });
    expect(persistence.save).toHaveBeenNthCalledWith(4, {
      tasks: [
        expect.objectContaining({
          id: "sched-1",
          engineState: "running",
          lastScheduledAt: "2026-04-05T09:00:00.000Z",
          lastStartedAt: "2026-04-05T10:15:00.000Z",
        }),
      ],
      runs: [
        expect.objectContaining({
          runId: "run-2",
          scheduledFor: "2026-04-05T09:00:00.000Z",
          reason: "catch_up",
          status: "running",
          linkedSessionId: "session-123",
          linkedTaskId: "task-456",
        }),
      ],
    });
  });
});
