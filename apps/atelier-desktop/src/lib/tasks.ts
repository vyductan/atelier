export type TaskRunnerPreference = "auto" | "claude" | "openclaw";
export type TaskResolvedRunner = "claude" | "openclaw" | null;
export type TaskStatus =
  | "queued"
  | "running"
  | "awaiting_approval"
  | "blocked"
  | "failed"
  | "done"
  | "cancelled";

export interface WorkspaceRecord {
  id: string;
  path: string;
  repoRoot: string;
  branch: string | null;
  isWorktree: boolean;
  activeTaskIds: string[];
}

export interface TaskThreadMessage {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
}

export interface TaskRecord {
  id: string;
  workspaceId: string;
  title: string;
  prompt: string;
  status: TaskStatus;
  runnerPreference: TaskRunnerPreference;
  resolvedRunner: TaskResolvedRunner;
  currentStage: string | null;
  blockedReason: string | null;
  approvalRequest: string | null;
  lastErrorSummary: string | null;
  createdAt: string;
  updatedAt: string;
  summary: string | null;
  thread: TaskThreadMessage[];
}

export interface PersistedTaskSnapshot {
  version: 1;
  tasks: TaskRecord[];
}
