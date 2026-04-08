import { beforeEach, describe, expect, it, vi } from "vitest";

import type {
  ClaudeContextWindowValue,
  RsyncConflictExecutionRequest,
  SyncProfile,
} from "./types";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("@tauri-apps/api/core", () => ({
  invoke: invokeMock,
}));

describe("tauri wrappers", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockImplementation(async () => {
      return;
    });
    vi.resetModules();
    Object.defineProperty(globalThis, "window", {
      value: { __TAURI_INTERNALS__: {} },
      configurable: true,
      writable: true,
    });
  });

  it("passes direction to previewSyncChanges", async () => {
    const { previewSyncChanges } = await import("./tauri");

    await previewSyncChanges("/tmp/project", "/tmp/primary", "to-primary");

    expect(invokeMock).toHaveBeenCalledWith("preview_sync_changes", {
      src: "/tmp/project",
      dest: "/tmp/primary",
      direction: "to-primary",
    });
  });

  it("forwards complete session metadata updates to Tauri", async () => {
    const { updateSessionModelMetadata } = await import("./tauri");

    await updateSessionModelMetadata({
      escapedPath: "workspace__tmp_demo",
      sessionId: "session-123",
      claudeModel: "claude-sonnet-4-5",
      claudeModelOptions: null,
      claudeContextWindow: "1m" satisfies ClaudeContextWindowValue,
    });

    expect(invokeMock).toHaveBeenCalledWith("update_session_model_metadata", {
      escapedPath: "workspace__tmp_demo",
      sessionId: "session-123",
      claudeModel: "claude-sonnet-4-5",
      claudeModelOptions: null,
      claudeContextWindow: "1m",
    });
  });

  it("forwards explicit null metadata values without patch semantics", async () => {
    const { updateSessionModelMetadata } = await import("./tauri");

    await updateSessionModelMetadata({
      escapedPath: "workspace__tmp_demo",
      sessionId: "session-123",
      claudeModel: null,
      claudeModelOptions: null,
      claudeContextWindow: null,
    });

    expect(invokeMock).toHaveBeenCalledWith("update_session_model_metadata", {
      escapedPath: "workspace__tmp_demo",
      sessionId: "session-123",
      claudeModel: null,
      claudeModelOptions: null,
      claudeContextWindow: null,
    });
  });

  it("routes patch sync execution to the patch command", async () => {
    const { executeSyncAction } = await import("./tauri");

    const profile: SyncProfile = {
      id: "sync-patch-1",
      projectPath: "/tmp/project",
      mode: "patch",
      primaryPath: "/tmp/primary",
    };

    await executeSyncAction(profile, "from-primary");

    expect(invokeMock).toHaveBeenCalledWith("execute_patch_sync", {
      profile,
      direction: "from-primary",
    });
  });

  it("preserves file actions when executeSyncAction forwards rsync resolutions", async () => {
    const { executeSyncAction } = await import("./tauri");

    const profile: SyncProfile = {
      id: "sync-1",
      projectPath: "/tmp/project",
      mode: "rsync",
      primaryPath: "/tmp/primary",
    };
    const request: Omit<
      RsyncConflictExecutionRequest,
      "src" | "dest" | "direction"
    > = {
      fingerprint: "fingerprint-123",
      resolutions: [{ path: "tokens/theme.ts", resolution: "incoming" }],
      fileActions: [{ path: "tokens/new.ts", action: "delete" }],
    };

    await executeSyncAction(profile, "to-primary", request);

    expect(invokeMock).toHaveBeenCalledWith(
      "execute_rsync_conflict_resolutions",
      {
        request: {
          src: "/tmp/project",
          dest: "/tmp/primary",
          direction: "to-primary",
          fingerprint: "fingerprint-123",
          resolutions: [{ path: "tokens/theme.ts", resolution: "incoming" }],
          fileActions: [{ path: "tokens/new.ts", action: "delete" }],
        },
      },
    );
  });

  it("invokes scheduled task snapshot and Claude import commands", async () => {
    const {
      listClaudeScheduledTaskFiles,
      readClaudeScheduledTaskFile,
      readScheduledTaskSnapshot,
      writeScheduledTaskSnapshot,
    } = await import("~/features/scheduled-tasks/services/scheduled-task-tauri");

    await readScheduledTaskSnapshot("scheduled-task-snapshot.json");
    await writeScheduledTaskSnapshot(
      "scheduled-task-snapshot.json",
      '{"tasks":[]}',
    );
    await listClaudeScheduledTaskFiles();
    await readClaudeScheduledTaskFile("daily-review");

    expect(invokeMock).toHaveBeenNthCalledWith(1, "read_scheduled_task_snapshot", {
      filePath: "scheduled-task-snapshot.json",
    });
    expect(invokeMock).toHaveBeenNthCalledWith(2, "write_scheduled_task_snapshot", {
      filePath: "scheduled-task-snapshot.json",
      contents: '{"tasks":[]}',
    });
    expect(invokeMock).toHaveBeenNthCalledWith(3, "list_claude_scheduled_task_files");
    expect(invokeMock).toHaveBeenNthCalledWith(4, "read_claude_scheduled_task_file", {
      taskDirName: "daily-review",
    });
  });
});
