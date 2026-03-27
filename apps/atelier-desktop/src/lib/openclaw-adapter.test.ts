import { describe, expect, it } from "vitest";

import { createOpenClawAdapter } from "./openclaw-adapter";

describe("createOpenClawAdapter", () => {
  it("returns a done result for a long-running task", async () => {
    const adapter = createOpenClawAdapter();

    await expect(
      adapter.runTask({
        id: "task-1",
        workspaceId: "workspace-1",
        title: "Review PR 128",
        prompt: "review PR 128 and fix the issues",
        status: "queued",
        runnerPreference: "openclaw",
        resolvedRunner: "openclaw",
        currentStage: null,
        blockedReason: null,
        approvalRequest: null,
        lastErrorSummary: null,
        createdAt: "2026-03-11T00:00:00.000Z",
        updatedAt: "2026-03-11T00:00:00.000Z",
        summary: null,
        thread: [],
      }),
    ).resolves.toEqual({
      status: "done",
      summary: "OpenClaw finished review PR 128 and fix the issues",
      currentStage: "completed",
    });
  });
});
