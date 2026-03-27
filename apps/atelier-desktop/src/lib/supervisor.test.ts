import { describe, expect, it, vi } from "vitest";

import { createSupervisor } from "./supervisor";
import { createTaskStore } from "./task-store";

describe("createSupervisor", () => {
  it("routes an openclaw task through the adapter and notifies on completion", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "implement english learning speaking end-to-end",
      runnerPreference: "auto",
    });
    const notify = vi.fn();
    const openclaw = {
      runTask: vi.fn().mockResolvedValue({
        status: "done",
        summary: "Finished",
        currentStage: "completed",
      }),
    };
    const claude = {
      execute: vi.fn(),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw,
      notify,
    });

    const updatedTask = await supervisor.startTask(task.id);

    expect(openclaw.runTask).toHaveBeenCalled();
    expect(updatedTask?.status).toBe("done");
    expect(updatedTask?.resolvedRunner).toBe("openclaw");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "done", taskId: task.id }),
    );
  });

  it("routes a claude task through the executor and notifies when approval is needed", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "explain this module",
      runnerPreference: "claude",
    });
    const notify = vi.fn();
    const claude = {
      execute: vi.fn().mockResolvedValue({
        ...task,
        status: "awaiting_approval",
        resolvedRunner: "claude",
        currentStage: "awaiting approval",
        summary: "Patch ready for approval.",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw: { runTask: vi.fn() },
      notify,
    });

    const updatedTask = await supervisor.startTask(task.id);

    expect(claude.execute).toHaveBeenCalled();
    expect(updatedTask?.status).toBe("awaiting_approval");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "awaiting_approval", taskId: task.id }),
    );
  });

  it("persists blocked task state and sends a blocked notification", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "fix auth until tests pass",
      runnerPreference: "auto",
    });
    const notify = vi.fn();
    const openclaw = {
      runTask: vi.fn().mockResolvedValue({
        status: "blocked",
        summary: "Missing dependency",
        currentStage: "blocked on setup",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude: { execute: vi.fn() },
      openclaw,
      notify,
    });

    const updatedTask = await supervisor.startTask(task.id);

    expect(updatedTask?.status).toBe("blocked");
    expect(updatedTask?.currentStage).toBe("blocked on setup");
    expect(store.listTasksByWorkspace("workspace-1")[0]?.status).toBe(
      "blocked",
    );
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "blocked", taskId: task.id }),
    );
  });

  it("approves an awaiting approval task and resumes execution", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "explain this module",
      runnerPreference: "claude",
    });
    store.updateTask(task.id, {
      status: "awaiting_approval",
      resolvedRunner: "claude",
      currentStage: "awaiting approval",
      approvalRequest: "Approve applying the patch.",
      summary: "Patch ready for approval.",
    });
    const claude = {
      execute: vi.fn().mockResolvedValue({
        ...task,
        status: "done",
        resolvedRunner: "claude",
        currentStage: "completed",
        summary: "Applied approved patch.",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw: { runTask: vi.fn() },
      notify: vi.fn(),
    });

    const result = await supervisor.approveTask(task.id);

    expect(result?.status).toBe("done");
    expect(result?.approvalRequest).toBeNull();
    expect(claude.execute).toHaveBeenCalled();
    expect(store.getTaskThread(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("approval granted"),
        }),
      ]),
    );
  });

  it("rejects an awaiting approval task, records the decision, and notifies", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "explain this module",
      runnerPreference: "claude",
    });
    store.updateTask(task.id, {
      status: "awaiting_approval",
      resolvedRunner: "claude",
      currentStage: "awaiting approval",
      approvalRequest: "Approve applying the patch.",
      summary: "Patch ready for approval.",
    });
    const notify = vi.fn();

    const supervisor = createSupervisor({
      store,
      claude: { execute: vi.fn() },
      openclaw: { runTask: vi.fn() },
      notify,
    });

    const result = await supervisor.rejectTask(task.id);

    expect(result?.status).toBe("blocked");
    expect(result?.approvalRequest).toBeNull();
    expect(result?.blockedReason).toContain("rejected");
    expect(notify).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "blocked", taskId: task.id }),
    );
    expect(store.getTaskThread(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("approval rejected"),
        }),
      ]),
    );
  });

  it("retries a blocked task and resumes execution", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "fix auth until tests pass",
      runnerPreference: "claude",
    });
    store.updateTask(task.id, {
      status: "blocked",
      resolvedRunner: "claude",
      currentStage: "blocked on setup",
      blockedReason: "Missing dependency",
      summary: "Waiting for setup fix.",
    });
    const claude = {
      execute: vi.fn().mockResolvedValue({
        ...task,
        status: "done",
        resolvedRunner: "claude",
        currentStage: "completed",
        summary: "Retried and completed successfully.",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw: { runTask: vi.fn() },
      notify: vi.fn(),
    });

    const result = await supervisor.retryTask(task.id);

    expect(result?.status).toBe("done");
    expect(result?.blockedReason).toBeNull();
    expect(claude.execute).toHaveBeenCalled();
    expect(store.getTaskThread(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("retry started"),
        }),
      ]),
    );
  });

  it("retries a failed task and records the retry", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "debug failing deploy",
      runnerPreference: "claude",
    });
    store.updateTask(task.id, {
      status: "failed",
      resolvedRunner: "claude",
      currentStage: "failed",
      lastErrorSummary: "GitHub API returned 502.",
      summary: "Task failed during deployment.",
    });
    const claude = {
      execute: vi.fn().mockResolvedValue({
        ...task,
        status: "done",
        resolvedRunner: "claude",
        currentStage: "completed",
        summary: "Retry succeeded.",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw: { runTask: vi.fn() },
      notify: vi.fn(),
    });

    const result = await supervisor.retryTask(task.id);

    expect(result?.status).toBe("done");
    expect(result?.lastErrorSummary).toBeNull();
    expect(store.getTaskThread(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("retry started"),
        }),
      ]),
    );
  });

  it("resumes a blocked task without labeling it as a retry", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "continue migration rollout",
      runnerPreference: "claude",
    });
    store.updateTask(task.id, {
      status: "blocked",
      resolvedRunner: "claude",
      currentStage: "waiting for approval",
      blockedReason: "Waiting for production window.",
      summary: "Paused until rollout window opens.",
    });
    const claude = {
      execute: vi.fn().mockResolvedValue({
        ...task,
        status: "done",
        resolvedRunner: "claude",
        currentStage: "completed",
        summary: "Resumed and completed rollout.",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw: { runTask: vi.fn() },
      notify: vi.fn(),
    });

    const result = await supervisor.resumeTask(task.id);

    expect(result?.status).toBe("done");
    expect(result?.blockedReason).toBeNull();
    expect(store.getTaskThread(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("Task resumed"),
        }),
      ]),
    );
  });

  it("re-runs a completed task from scratch", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "explain this module",
      runnerPreference: "claude",
    });
    store.updateTask(task.id, {
      status: "done",
      resolvedRunner: "claude",
      currentStage: "completed",
      summary: "Initial run completed.",
    });
    const claude = {
      execute: vi.fn().mockResolvedValue({
        ...task,
        status: "done",
        resolvedRunner: "claude",
        currentStage: "completed",
        summary: "Re-run completed.",
      }),
    };

    const supervisor = createSupervisor({
      store,
      claude,
      openclaw: { runTask: vi.fn() },
      notify: vi.fn(),
    });

    const result = await supervisor.rerunTask(task.id);

    expect(result?.status).toBe("done");
    expect(claude.execute).toHaveBeenCalled();
    expect(store.getTaskThread(task.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          text: expect.stringContaining("re-run started"),
        }),
      ]),
    );
  });

  it("refuses invalid lifecycle transitions cleanly", async () => {
    const store = createTaskStore();
    const task = store.createTask({
      workspaceId: "workspace-1",
      prompt: "explain this module",
      runnerPreference: "claude",
    });

    const supervisor = createSupervisor({
      store,
      claude: { execute: vi.fn() },
      openclaw: { runTask: vi.fn() },
      notify: vi.fn(),
    });

    const result = await supervisor.approveTask(task.id);

    expect(result).toEqual(
      expect.objectContaining({ id: task.id, status: "queued" }),
    );
    expect(store.getTaskThread(task.id)).toEqual([]);
  });
});
