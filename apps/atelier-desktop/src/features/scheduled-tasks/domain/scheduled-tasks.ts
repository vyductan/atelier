export const SCHEDULED_TASK_PERMISSION_MODES = [
  "ask",
  "acceptEdits",
  "bypassPermissions",
] as const;

export type ScheduledTaskPermissionMode =
  (typeof SCHEDULED_TASK_PERMISSION_MODES)[number];

export const SCHEDULED_TASK_ENGINE_STATES = [
  "idle",
  "queued",
  "running",
  "paused",
  "stalled",
] as const;

export type ScheduledTaskEngineState = (typeof SCHEDULED_TASK_ENGINE_STATES)[number];

export const SCHEDULED_TASK_SCHEDULE_TYPES = [
  "manual",
  "hourly",
  "daily",
  "weekdays",
  "weekly",
  "custom-cron",
] as const;

export type ScheduledTaskScheduleType = (typeof SCHEDULED_TASK_SCHEDULE_TYPES)[number];

export const SCHEDULED_TASK_ENGINE_SUPPORTED_SCHEDULE_TYPES = ["daily"] as const;

export const SCHEDULED_TASK_RUN_STATUSES = [
  "queued",
  "preparing",
  "running",
  "stalled_for_permission",
  "failed",
  "completed",
  "cancelled",
  "skipped",
] as const;

export type ScheduledTaskRunStatus = (typeof SCHEDULED_TASK_RUN_STATUSES)[number];

export const SCHEDULED_TASK_RUN_REASONS = [
  "normal",
  "catch_up",
  "run_now",
  "missed_skip",
  "overlap_skip",
] as const;

export type ScheduledTaskRunReason = (typeof SCHEDULED_TASK_RUN_REASONS)[number];

import type { SyncProfile } from "~/lib/types";

export const SCHEDULED_TASK_IMPORT_SOURCES = ["none", "claude-desktop"] as const;

export type ScheduledTaskImportSource = (typeof SCHEDULED_TASK_IMPORT_SOURCES)[number];

export interface ScheduledTaskImportDraft {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  importSource: Extract<ScheduledTaskImportSource, "claude-desktop">;
  sourceTaskDirName: string;
}

export interface ScheduledSyncTemplate {
  source: "acme-sync";
  mainPath: string;
  strategyMarkdown: string | null;
  profile: SyncProfile;
}

export interface ScheduledTaskDefinition {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  template?: ScheduledSyncTemplate | null;
  model: string;
  permissionMode: ScheduledTaskPermissionMode;
  worktree: { enabled: boolean };
  schedule: {
    type: ScheduledTaskScheduleType;
    cron: string | null;
    timezone: string;
    enabled: boolean;
    jitterMinutes: number;
  };
  nextRunAt: string | null;
  lastScheduledAt: string | null;
  lastStartedAt: string | null;
  lastFinishedAt: string | null;
  lastMissedAt: string | null;
  engineState: ScheduledTaskEngineState;
  rememberedApprovals: string[];
  importSource: ScheduledTaskImportSource;
  importedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ScheduledTaskRunRecord {
  runId: string;
  scheduledTaskId: string;
  scheduledFor: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  status: ScheduledTaskRunStatus;
  reason: ScheduledTaskRunReason;
  linkedSessionId: string | null;
  linkedTaskId: string | null;
  errorSummary: string | null;
  summary: string | null;
  createdAt: string;
  updatedAt: string;
}

export const DEFAULT_SCHEDULED_TASK_IMPORT_SOURCE: ScheduledTaskImportSource =
  "none";
