import {
  SCHEDULED_TASK_ENGINE_STATES,
  SCHEDULED_TASK_IMPORT_SOURCES,
  SCHEDULED_TASK_PERMISSION_MODES,
  SCHEDULED_TASK_RUN_REASONS,
  SCHEDULED_TASK_RUN_STATUSES,
  SCHEDULED_TASK_SCHEDULE_TYPES,
  type ScheduledTaskDefinition,
  type ScheduledTaskRunRecord,
} from "../domain/scheduled-tasks";

interface ScheduledTaskSnapshot {
  version: 1;
  tasks: ScheduledTaskDefinition[];
  runs: ScheduledTaskRunRecord[];
}

interface CreateScheduledTaskPersistenceOptions {
  filePath: string;
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error === "string") {
    return /ENOENT|not found|no such file/i.test(error);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: string };

  if (errorWithCode.code === "ENOENT" || errorWithCode.code === "NotFound") {
    return true;
  }

  return /ENOENT|no such file/i.test(error.message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function assertStringField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (typeof value[field] !== "string") {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} is missing ${field}`,
    );
  }
}

function assertLiteralField<const T extends readonly string[]>(
  value: Record<string, unknown>,
  field: string,
  label: string,
  allowedValues: T,
): void {
  if (typeof value[field] !== "string") {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} is missing ${field}`,
    );
  }

  if (!allowedValues.includes(value[field])) {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} has invalid ${field}`,
    );
  }
}

function assertNullableStringField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (value[field] !== null && typeof value[field] !== "string") {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} has invalid ${field}`,
    );
  }
}

function assertBooleanField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (typeof value[field] !== "boolean") {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} has invalid ${field}`,
    );
  }
}

function assertNumberField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (typeof value[field] !== "number") {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} has invalid ${field}`,
    );
  }
}

function validateScheduledTaskDefinition(
  task: unknown,
  index: number,
): asserts task is ScheduledTaskDefinition {
  if (!isRecord(task)) {
    throw new TypeError(
      `Invalid scheduled task snapshot: task at index ${index} must be an object`,
    );
  }

  const label = `task at index ${index}`;
  assertStringField(task, "id", label);
  assertStringField(task, "name", label);
  assertStringField(task, "description", label);
  assertStringField(task, "workspacePath", label);
  assertStringField(task, "prompt", label);
  if (task.template !== undefined && task.template !== null) {
    if (!isRecord(task.template)) {
      throw new TypeError(`Invalid scheduled task snapshot: ${label} has invalid template`);
    }

    assertLiteralField(task.template, "source", `${label} template`, ["acme-sync"] as const);
    assertStringField(task.template, "mainPath", `${label} template`);
    if (
      task.template.strategyMarkdown !== null &&
      typeof task.template.strategyMarkdown !== "string"
    ) {
      throw new TypeError(
        `Invalid scheduled task snapshot: ${label} template has invalid strategyMarkdown`,
      );
    }
    if (!isRecord(task.template.profile)) {
      throw new TypeError(`Invalid scheduled task snapshot: ${label} template has invalid profile`);
    }
    assertStringField(task.template.profile, "id", `${label} template profile`);
    assertStringField(task.template.profile, "projectPath", `${label} template profile`);
    assertLiteralField(
      task.template.profile,
      "mode",
      `${label} template profile`,
      ["rsync", "subtree", "patch"] as const,
    );
    if (
      task.template.profile.primaryPath !== null &&
      typeof task.template.profile.primaryPath !== "string"
    ) {
      throw new TypeError(
        `Invalid scheduled task snapshot: ${label} template profile has invalid primaryPath`,
      );
    }
  }
  assertStringField(task, "model", label);
  assertLiteralField(
    task,
    "permissionMode",
    label,
    SCHEDULED_TASK_PERMISSION_MODES,
  );

  if (!isRecord(task.worktree)) {
    throw new TypeError(`Invalid scheduled task snapshot: ${label} has invalid worktree`);
  }
  assertBooleanField(task.worktree, "enabled", `${label} worktree`);

  if (!isRecord(task.schedule)) {
    throw new TypeError(`Invalid scheduled task snapshot: ${label} has invalid schedule`);
  }
  assertLiteralField(
    task.schedule,
    "type",
    `${label} schedule`,
    SCHEDULED_TASK_SCHEDULE_TYPES,
  );
  if (task.schedule.cron !== null && typeof task.schedule.cron !== "string") {
    throw new TypeError(`Invalid scheduled task snapshot: ${label} schedule has invalid cron`);
  }
  assertStringField(task.schedule, "timezone", `${label} schedule`);
  assertBooleanField(task.schedule, "enabled", `${label} schedule`);
  assertNumberField(task.schedule, "jitterMinutes", `${label} schedule`);

  assertNullableStringField(task, "nextRunAt", label);
  assertNullableStringField(task, "lastScheduledAt", label);
  assertNullableStringField(task, "lastStartedAt", label);
  assertNullableStringField(task, "lastFinishedAt", label);
  assertNullableStringField(task, "lastMissedAt", label);
  assertLiteralField(task, "engineState", label, SCHEDULED_TASK_ENGINE_STATES);

  if (!Array.isArray(task.rememberedApprovals)) {
    throw new TypeError(
      `Invalid scheduled task snapshot: ${label} has invalid rememberedApprovals`,
    );
  }
  for (const approval of task.rememberedApprovals) {
    if (typeof approval !== "string") {
      throw new TypeError(
        `Invalid scheduled task snapshot: ${label} has invalid rememberedApprovals`,
      );
    }
  }

  assertLiteralField(task, "importSource", label, SCHEDULED_TASK_IMPORT_SOURCES);
  assertNullableStringField(task, "importedAt", label);
  assertStringField(task, "createdAt", label);
  assertStringField(task, "updatedAt", label);
}

function validateScheduledTaskRunRecord(
  run: unknown,
  index: number,
): asserts run is ScheduledTaskRunRecord {
  if (!isRecord(run)) {
    throw new TypeError(
      `Invalid scheduled task snapshot: run at index ${index} must be an object`,
    );
  }

  const label = `run at index ${index}`;
  assertStringField(run, "runId", label);
  assertStringField(run, "scheduledTaskId", label);
  assertNullableStringField(run, "scheduledFor", label);
  assertNullableStringField(run, "startedAt", label);
  assertNullableStringField(run, "finishedAt", label);
  assertLiteralField(run, "status", label, SCHEDULED_TASK_RUN_STATUSES);
  assertLiteralField(run, "reason", label, SCHEDULED_TASK_RUN_REASONS);
  assertNullableStringField(run, "linkedSessionId", label);
  assertNullableStringField(run, "linkedTaskId", label);
  assertNullableStringField(run, "errorSummary", label);
  assertNullableStringField(run, "summary", label);
  assertStringField(run, "createdAt", label);
  assertStringField(run, "updatedAt", label);
}

export function serializeScheduledTaskSnapshot(input: {
  tasks: ScheduledTaskDefinition[];
  runs: ScheduledTaskRunRecord[];
}): string {
  const snapshot: ScheduledTaskSnapshot = {
    version: 1,
    tasks: input.tasks,
    runs: input.runs,
  };

  return JSON.stringify(snapshot);
}

export function parseScheduledTaskSnapshot(input: string): {
  tasks: ScheduledTaskDefinition[];
  runs: ScheduledTaskRunRecord[];
} {
  const snapshot = JSON.parse(input);

  if (!isRecord(snapshot)) {
    throw new TypeError("Invalid scheduled task snapshot: root must be an object");
  }

  if (snapshot.version !== 1) {
    throw new TypeError(`Unsupported scheduled task snapshot version: ${snapshot.version}`);
  }

  if (!Array.isArray(snapshot.tasks)) {
    throw new TypeError("Invalid scheduled task snapshot: tasks must be an array");
  }

  if (!Array.isArray(snapshot.runs)) {
    throw new TypeError("Invalid scheduled task snapshot: runs must be an array");
  }

  for (const [index, task] of snapshot.tasks.entries()) {
    validateScheduledTaskDefinition(task, index);
  }

  for (const [index, run] of snapshot.runs.entries()) {
    validateScheduledTaskRunRecord(run, index);
  }

  return {
    tasks: snapshot.tasks,
    runs: snapshot.runs,
  };
}

export function createScheduledTaskPersistence(
  options: CreateScheduledTaskPersistenceOptions,
) {
  return {
    async load() {
      try {
        const input = await options.readTextFile(options.filePath);
        return parseScheduledTaskSnapshot(input);
      } catch (error) {
        if (isMissingFileError(error)) {
          return { tasks: [], runs: [] };
        }

        throw error;
      }
    },

    async save(input: {
      tasks: ScheduledTaskDefinition[];
      runs: ScheduledTaskRunRecord[];
    }) {
      await options.writeTextFile(
        options.filePath,
        serializeScheduledTaskSnapshot(input),
      );
    },
  };
}
