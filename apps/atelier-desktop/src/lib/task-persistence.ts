import type { PersistedTaskSnapshot, TaskRecord } from "./tasks";

export interface TaskPersistenceFileAdapter {
  readTextFile: (filePath: string) => Promise<string>;
  writeTextFile: (filePath: string, contents: string) => Promise<void>;
}

export interface TaskPersistence {
  loadTasks: () => Promise<TaskRecord[]>;
  saveTasks: (tasks: TaskRecord[]) => Promise<void>;
}

export interface CreateTaskPersistenceOptions extends TaskPersistenceFileAdapter {
  filePath: string;
}

function isMissingFileError(error: unknown): boolean {
  if (typeof error === "string") {
    return /ENOENT|not found|no such file/i.test(error);
  }

  if (!(error instanceof Error)) {
    return false;
  }

  const errorWithCode = error as Error & { code?: string };

  return (
    errorWithCode.code === "ENOENT" ||
    errorWithCode.code === "NotFound" ||
    /not found|no such file/i.test(error.message)
  );
}

export function serializeTaskSnapshot(tasks: TaskRecord[]): string {
  const snapshot: PersistedTaskSnapshot = {
    version: 1,
    tasks,
  };

  return JSON.stringify(snapshot);
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
    throw new TypeError(`Invalid task snapshot: ${label} is missing ${field}`);
  }
}

function assertNullableStringField(
  value: Record<string, unknown>,
  field: string,
  label: string,
): void {
  if (value[field] !== null && typeof value[field] !== "string") {
    throw new TypeError(`Invalid task snapshot: ${label} has invalid ${field}`);
  }
}

function validateThreadMessage(
  message: unknown,
  taskIndex: number,
  threadIndex: number,
): void {
  if (!isRecord(message)) {
    throw new Error(
      `Invalid task snapshot: thread message at task ${taskIndex} index ${threadIndex} must be an object`,
    );
  }

  const label = `thread message at task ${taskIndex} index ${threadIndex}`;
  assertStringField(message, "id", label);
  assertStringField(message, "role", label);
  assertStringField(message, "text", label);
  assertStringField(message, "createdAt", label);
}

function validateTaskRecord(
  task: unknown,
  index: number,
): asserts task is TaskRecord {
  if (!isRecord(task)) {
    throw new Error(
      `Invalid task snapshot: task at index ${index} must be an object`,
    );
  }

  const label = `task at index ${index}`;

  assertStringField(task, "id", label);
  assertStringField(task, "workspaceId", label);
  assertStringField(task, "title", label);
  assertStringField(task, "prompt", label);
  assertStringField(task, "status", label);
  assertStringField(task, "runnerPreference", label);
  if (task.resolvedRunner !== null && typeof task.resolvedRunner !== "string") {
    throw new Error(
      `Invalid task snapshot: ${label} has invalid resolvedRunner`,
    );
  }
  assertNullableStringField(task, "currentStage", label);
  assertNullableStringField(task, "blockedReason", label);
  assertNullableStringField(task, "approvalRequest", label);
  assertNullableStringField(task, "lastErrorSummary", label);
  assertStringField(task, "createdAt", label);
  assertStringField(task, "updatedAt", label);
  assertNullableStringField(task, "summary", label);

  if (!Array.isArray(task.thread)) {
    throw new TypeError(`Invalid task snapshot: ${label} has invalid thread`);
  }

  for (const [threadIndex, message] of task.thread.entries()) {
    validateThreadMessage(message, index, threadIndex);
  }
}

export function parseTaskSnapshot(input: string): TaskRecord[] {
  const snapshot = JSON.parse(input) as Partial<PersistedTaskSnapshot>;

  if (snapshot.version !== 1) {
    throw new TypeError(
      `Unsupported task snapshot version: ${snapshot.version}`,
    );
  }

  if (!Array.isArray(snapshot.tasks)) {
    throw new TypeError("Invalid task snapshot: tasks must be an array");
  }

  for (const [index, task] of snapshot.tasks.entries()) {
    validateTaskRecord(task, index);
  }

  return snapshot.tasks;
}

export function createTaskPersistence(
  options: CreateTaskPersistenceOptions,
): TaskPersistence {
  return {
    async loadTasks() {
      try {
        const input = await options.readTextFile(options.filePath);
        return parseTaskSnapshot(input);
      } catch (error) {
        if (isMissingFileError(error)) {
          return [];
        }

        throw error;
      }
    },

    async saveTasks(tasks) {
      await options.writeTextFile(
        options.filePath,
        serializeTaskSnapshot(tasks),
      );
    },
  };
}
