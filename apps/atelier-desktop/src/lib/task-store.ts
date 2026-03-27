import type {
  TaskRecord,
  TaskRunnerPreference,
  TaskThreadMessage,
} from "./tasks";

interface CreateTaskInput {
  workspaceId: string;
  prompt: string;
  runnerPreference: TaskRunnerPreference;
}

type UpdateTaskPatch = Partial<
  Pick<
    TaskRecord,
    | "approvalRequest"
    | "blockedReason"
    | "currentStage"
    | "lastErrorSummary"
    | "resolvedRunner"
    | "runnerPreference"
    | "status"
    | "summary"
    | "title"
  >
>;

interface TaskStoreOptions {
  createId?: () => string;
  now?: () => string;
  initialTasks?: TaskRecord[];
}

function cloneThreadMessage(message: TaskThreadMessage): TaskThreadMessage {
  return { ...message };
}

function cloneTask(task: TaskRecord): TaskRecord {
  return {
    ...task,
    thread: task.thread.map((message) => cloneThreadMessage(message)),
  };
}

function getInitialNextId(tasks: Map<string, TaskRecord>): number {
  let maxId = 0;

  for (const id of tasks.keys()) {
    const match = id.match(/^task-(\d+)$/);

    if (!match) {
      continue;
    }

    maxId = Math.max(maxId, Number(match[1]));
  }

  return maxId + 1;
}

export interface TaskStore {
  createTask: (input: CreateTaskInput) => TaskRecord;
  removeTask: (id: string) => TaskRecord | null;
  updateTask: (id: string, patch: UpdateTaskPatch) => TaskRecord | null;
  appendTaskThreadMessage: (
    taskId: string,
    message: Omit<TaskThreadMessage, "createdAt" | "id"> & {
      id?: string;
      createdAt?: string;
    },
  ) => TaskThreadMessage | null;
  getTask: (id: string) => TaskRecord | null;
  getTaskThread: (taskId: string) => TaskThreadMessage[];
  listTasks: () => TaskRecord[];
  listTasksByWorkspace: (workspaceId: string) => TaskRecord[];
}

export function createTaskStore(options: TaskStoreOptions = {}): TaskStore {
  const tasks = new Map<string, TaskRecord>(
    (options.initialTasks ?? []).map((task) => [task.id, cloneTask(task)]),
  );
  let nextId = getInitialNextId(tasks);

  const createId =
    options.createId ??
    (() => {
      while (tasks.has(`task-${nextId}`)) {
        nextId += 1;
      }

      const id = `task-${nextId}`;
      nextId += 1;
      return id;
    });
  const now = options.now ?? (() => new Date().toISOString());

  return {
    createTask(input) {
      const timestamp = now();
      const task: TaskRecord = {
        id: createId(),
        workspaceId: input.workspaceId,
        title: input.prompt,
        prompt: input.prompt,
        status: "queued",
        runnerPreference: input.runnerPreference,
        resolvedRunner: null,
        currentStage: null,
        blockedReason: null,
        approvalRequest: null,
        lastErrorSummary: null,
        createdAt: timestamp,
        updatedAt: timestamp,
        summary: null,
        thread: [],
      };

      tasks.set(task.id, task);

      return cloneTask(task);
    },

    removeTask(id) {
      const existingTask = tasks.get(id);

      if (!existingTask) {
        return null;
      }

      tasks.delete(id);
      return cloneTask(existingTask);
    },

    updateTask(id, patch) {
      const existingTask = tasks.get(id);

      if (!existingTask) {
        return null;
      }

      const updatedTask: TaskRecord = {
        ...existingTask,
        ...patch,
        updatedAt: now(),
      };

      tasks.set(id, updatedTask);

      return cloneTask(updatedTask);
    },

    appendTaskThreadMessage(taskId, message) {
      const task = tasks.get(taskId);

      if (!task) {
        return null;
      }

      const threadMessage: TaskThreadMessage = {
        id: message.id ?? createId(),
        role: message.role,
        text: message.text,
        createdAt: message.createdAt ?? now(),
      };

      tasks.set(taskId, {
        ...task,
        thread: [...task.thread, threadMessage],
        updatedAt: now(),
      });

      return cloneThreadMessage(threadMessage);
    },

    getTask(id) {
      const task = tasks.get(id);

      return task ? cloneTask(task) : null;
    },

    getTaskThread(taskId) {
      return (
        tasks
          .get(taskId)
          ?.thread.map((message) => cloneThreadMessage(message)) ?? []
      );
    },

    listTasks() {
      return [...tasks.values()].map((task) => cloneTask(task));
    },

    listTasksByWorkspace(workspaceId) {
      return [...tasks.values()]
        .filter((task) => task.workspaceId === workspaceId)
        .toSorted(
          (left, right) =>
            new Date(right.updatedAt).getTime() -
            new Date(left.updatedAt).getTime(),
        )
        .map((task) => cloneTask(task));
    },
  };
}
