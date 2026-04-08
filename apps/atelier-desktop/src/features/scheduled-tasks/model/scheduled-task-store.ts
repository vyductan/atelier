import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunReason,
  ScheduledTaskRunRecord,
} from "../domain/scheduled-tasks";

interface CreateScheduledTaskInput {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
  template?: ScheduledTaskDefinition["template"];
  model: string;
  permissionMode: ScheduledTaskDefinition["permissionMode"];
  worktree: ScheduledTaskDefinition["worktree"];
  schedule: ScheduledTaskDefinition["schedule"];
}

interface CreateScheduledTaskStoreOptions {
  now?: () => string;
  createId?: () => string;
  createRunId?: () => string;
  initialTasks?: ScheduledTaskDefinition[];
  initialRuns?: ScheduledTaskRunRecord[];
}

function cloneScheduledTaskTemplate(
  template: ScheduledTaskDefinition["template"],
): ScheduledTaskDefinition["template"] {
  if (!template) {
    return null;
  }

  return {
    ...template,
    profile: {
      ...template.profile,
      ...(template.profile.subtree
        ? { subtree: { ...template.profile.subtree } }
        : {}),
    },
  };
}

function cloneScheduledTask(
  task: ScheduledTaskDefinition,
): ScheduledTaskDefinition {
  return {
    ...task,
    template: cloneScheduledTaskTemplate(task.template),
    worktree: { ...task.worktree },
    schedule: { ...task.schedule },
    rememberedApprovals: [...task.rememberedApprovals],
  };
}

function sanitizeScheduledTaskPatch(
  patch: Partial<ScheduledTaskDefinition>,
): Partial<ScheduledTaskDefinition> {
  const { id: _id, createdAt: _createdAt, ...safePatch } = patch;

  return {
    ...safePatch,
    ...(patch.template !== undefined
      ? { template: cloneScheduledTaskTemplate(patch.template) }
      : {}),
    ...(patch.worktree ? { worktree: { ...patch.worktree } } : {}),
    ...(patch.schedule ? { schedule: { ...patch.schedule } } : {}),
    ...(patch.rememberedApprovals
      ? { rememberedApprovals: [...patch.rememberedApprovals] }
      : {}),
  };
}

function sanitizeScheduledRunPatch(
  patch: Partial<ScheduledTaskRunRecord>,
): Partial<ScheduledTaskRunRecord> {
  const { runId: _runId, createdAt: _createdAt, ...safePatch } = patch;
  return safePatch;
}

function cloneScheduledRun(run: ScheduledTaskRunRecord): ScheduledTaskRunRecord {
  return { ...run };
}

function getNextNumericId(ids: string[], prefix: string) {
  const maxId = ids.reduce((highest, id) => {
    const match = id.match(new RegExp(`^${prefix}-(\\d+)$`));
    if (!match) {
      return highest;
    }

    return Math.max(highest, Number(match[1]));
  }, 0);

  return maxId + 1;
}

export function createScheduledTaskStore(
  options: CreateScheduledTaskStoreOptions = {},
) {
  const now = options.now ?? (() => new Date().toISOString());
  const tasks = new Map(
    (options.initialTasks ?? []).map((task) => [task.id, cloneScheduledTask(task)]),
  );
  const runs = new Map(
    (options.initialRuns ?? []).map((run) => [run.runId, cloneScheduledRun(run)]),
  );
  let nextTaskId = getNextNumericId([...tasks.keys()], "sched");
  let nextRunId = getNextNumericId([...runs.keys()], "run");
  const createId = options.createId ?? (() => `sched-${nextTaskId++}`);
  const createRunId = options.createRunId ?? (() => `run-${nextRunId++}`);

  return {
    createScheduledTask(input: CreateScheduledTaskInput): ScheduledTaskDefinition {
      const timestamp = now();
      const task: ScheduledTaskDefinition = cloneScheduledTask({
        id: createId(),
        name: input.name,
        description: input.description,
        workspacePath: input.workspacePath,
        prompt: input.prompt,
        template: input.template ?? null,
        model: input.model,
        permissionMode: input.permissionMode,
        worktree: input.worktree,
        schedule: input.schedule,
        nextRunAt: null,
        lastScheduledAt: null,
        lastStartedAt: null,
        lastFinishedAt: null,
        lastMissedAt: null,
        engineState: "idle",
        rememberedApprovals: [],
        importSource: "none",
        importedAt: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      });

      tasks.set(task.id, task);

      return cloneScheduledTask(task);
    },

    updateScheduledTask(id: string, patch: Partial<ScheduledTaskDefinition>) {
      const existing = tasks.get(id);
      if (!existing) {
        return null;
      }

      const updated: ScheduledTaskDefinition = cloneScheduledTask({
        ...existing,
        ...sanitizeScheduledTaskPatch(patch),
        updatedAt: now(),
      });

      tasks.set(id, updated);

      return cloneScheduledTask(updated);
    },

    createScheduledRun(input: {
      scheduledTaskId: string;
      scheduledFor: string | null;
      reason: ScheduledTaskRunReason;
    }): ScheduledTaskRunRecord {
      const timestamp = now();
      const run: ScheduledTaskRunRecord = {
        runId: createRunId(),
        scheduledTaskId: input.scheduledTaskId,
        scheduledFor: input.scheduledFor,
        startedAt: null,
        finishedAt: null,
        status: "queued",
        reason: input.reason,
        linkedSessionId: null,
        linkedTaskId: null,
        errorSummary: null,
        summary: null,
        createdAt: timestamp,
        updatedAt: timestamp,
      };

      runs.set(run.runId, run);

      return cloneScheduledRun(run);
    },

    updateScheduledRun(runId: string, patch: Partial<ScheduledTaskRunRecord>) {
      const existing = runs.get(runId);
      if (!existing) {
        return null;
      }

      const updated: ScheduledTaskRunRecord = {
        ...existing,
        ...sanitizeScheduledRunPatch(patch),
        updatedAt: now(),
      };

      runs.set(runId, updated);

      return cloneScheduledRun(updated);
    },

    getScheduledTask(id: string) {
      const task = tasks.get(id);
      return task ? cloneScheduledTask(task) : null;
    },

    listScheduledTasks() {
      return [...tasks.values()].map((task) => cloneScheduledTask(task));
    },

    listScheduledRuns() {
      return [...runs.values()].map((run) => cloneScheduledRun(run));
    },

    listRunsByTask(taskId: string) {
      return [...runs.values()]
        .filter((run) => run.scheduledTaskId === taskId)
        .map((run) => cloneScheduledRun(run));
    },
  };
}
