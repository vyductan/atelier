import type { StreamJsonEvent } from "./studio";
import type { TaskRecord } from "./tasks";
import {
  sendSessionMessage,
  startActiveSessionStream,
  stopActiveSession,
} from "./studio";
import {
  exportSession,
  exportSessionToCodex,
  getSessionCwd,
  moveToTrash,
  readSessionMessages,
  renameSession,
} from "./tauri";
import {
  getWorkspaceDiff,
  getWorkspaceFileContent,
  getWorkspaceStatus,
} from "./workspace";

export const atelierClient = {
  sessions: {
    readHistory: readSessionMessages,
    getCwd: getSessionCwd,
    rename: renameSession,
  },
  runtime: {
    start: (input: {
      sessionId: string | undefined;
      projectPath: string;
      firstPrompt: string | undefined;
      resolvedModel?: string | null;
      onEvent: (event: StreamJsonEvent) => void;
      onDone: () => void;
      resumeSessionId?: string;
    }) =>
      startActiveSessionStream(
        input.sessionId,
        input.projectPath,
        input.firstPrompt,
        input.onEvent,
        input.onDone,
        input.resumeSessionId,
        input.resolvedModel ?? undefined,
      ),
    send: sendSessionMessage,
    stop: stopActiveSession,
  },
  tasks: {
    runClaudeTask: async (task: TaskRecord) => ({
      status: "done" as const,
      summary: `Claude finished: ${task.prompt}`,
      currentStage: "completed",
    }),
  },
  exports: {
    session: exportSession,
    codex: exportSessionToCodex,
    preparePath: moveToTrash,
  },
  workspace: {
    getStatus: getWorkspaceStatus,
    getDiff: getWorkspaceDiff,
    getFileContent: getWorkspaceFileContent,
  },
};
