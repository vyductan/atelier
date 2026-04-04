# Atelier Scheduled Tasks Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build an Atelier-native local scheduled tasks engine with import-from-Claude migration, recurring run orchestration, and a dedicated Schedule UI integrated with Atelier's existing session/task surfaces.

**Architecture:** Reuse Atelier's existing task/workbench persistence and execution patterns, but introduce a separate scheduled-task domain with dedicated definition storage, run history storage, a one-minute scheduler loop, and a Schedule tab. Keep the engine Atelier-native after import, and bridge scheduled runs into the existing runtime/session model instead of inventing a second execution UI.

**Tech Stack:** React 19, TypeScript, Vitest, Tauri, existing Atelier task/workbench primitives, file-backed snapshot persistence

---

## File Structure

### New files

- `apps/atelier-desktop/src/lib/scheduled-tasks.ts`
  - Core scheduled-task types, run types, status enums, frequency enums, and shared helpers.
- `apps/atelier-desktop/src/lib/scheduled-task-persistence.ts`
  - Serialization, parsing, validation, and file-backed persistence for scheduled task definitions and runs.
- `apps/atelier-desktop/src/lib/scheduled-task-store.ts`
  - In-memory store for scheduled task definitions and runs, modeled after the current task store.
- `apps/atelier-desktop/src/lib/scheduled-task-engine.ts`
  - One-minute scheduler loop, deterministic jitter, next-run calculation, missed-run detection, and overlap-skip behavior.
- `apps/atelier-desktop/src/lib/scheduled-task-import.ts`
  - Claude Desktop scheduled task discovery, parsing, conversion, and drift metadata.
- `apps/atelier-desktop/src/lib/scheduled-task-workbench.ts`
  - High-level façade combining persistence, store, engine hooks, import, and orchestration entry points for the UI.
- `apps/atelier-desktop/src/lib/scheduled-task-runner.ts`
  - Bridges due scheduled runs into Atelier runtime/session/task execution state.
- `apps/atelier-desktop/src/components/schedule-sidebar.tsx`
  - Left pane for Schedule tab task list, search, grouping, and quick actions.
- `apps/atelier-desktop/src/components/schedule-list-item.tsx`
  - Individual scheduled task row rendering.
- `apps/atelier-desktop/src/components/schedule-detail-panel.tsx`
  - Right-pane selected task detail layout.
- `apps/atelier-desktop/src/components/schedule-overview-panel.tsx`
  - Overview tab for task configuration summary.
- `apps/atelier-desktop/src/components/schedule-runs-panel.tsx`
  - Runs/history tab.
- `apps/atelier-desktop/src/components/schedule-permissions-panel.tsx`
  - Permissions tab with revoke actions.
- `apps/atelier-desktop/src/components/schedule-config-panel.tsx`
  - Structured config tab or edit entry point.
- `apps/atelier-desktop/src/components/scheduled-task-form.tsx`
  - Create/edit form shared by new and edit flows.
- `apps/atelier-desktop/src/components/scheduled-task-import-banner.tsx`
  - Import/review CTA for Claude Desktop tasks.
- `apps/atelier-desktop/src/components/scheduled-run-linked-view.tsx`
  - Reuses or wraps existing execution surfaces for a selected scheduled run.
- `apps/atelier-desktop/src/lib/scheduled-task-persistence.test.ts`
- `apps/atelier-desktop/src/lib/scheduled-task-store.test.ts`
- `apps/atelier-desktop/src/lib/scheduled-task-engine.test.ts`
- `apps/atelier-desktop/src/lib/scheduled-task-import.test.ts`
- `apps/atelier-desktop/src/lib/scheduled-task-workbench.test.ts`
- `apps/atelier-desktop/src/components/schedule-detail-panel.test.tsx`
- `apps/atelier-desktop/src/components/schedule-sidebar.test.tsx`
- `apps/atelier-desktop/src/components/scheduled-task-form.test.tsx`

### Modified files

- `apps/atelier-desktop/src/components/app-shell.tsx`
  - Add top-level Schedule tab, create/load scheduled task workbench, and wire Schedule UI.
- `apps/atelier-desktop/src/components/app-shell.test.tsx`
  - Cover the new Schedule tab and main flow.
- `apps/atelier-desktop/src/lib/tauri.ts`
  - Add file access helpers for scheduled-task snapshots and Claude import sources.
- `apps/atelier-desktop/src-tauri/src/features/file_ops/commands.rs`
  - Add Tauri commands for Atelier-native scheduled task persistence and Claude scheduled-task directory reads.
- `apps/atelier-desktop/src-tauri/src/main.rs`
  - Register new Tauri commands.
- `apps/atelier-desktop/src/lib/atelier-client.ts`
  - Add scheduled-run orchestration helper(s) that bridge into existing runtime/session APIs.
- `apps/atelier-desktop/src/lib/studio.ts`
  - Extend runtime start payload if scheduled-run metadata must be passed into session start.
- `apps/atelier-desktop/src/components/task-detail-panel.tsx`
  - Add entry point for viewing a scheduled-linked execution if needed.
- `apps/atelier-desktop/src/components/task-detail-panel.test.tsx`
  - Cover schedule-linked run navigation if touched.

---

### Task 1: Define the scheduled-task domain model

**Files:**
- Create: `apps/atelier-desktop/src/lib/scheduled-tasks.ts`
- Test: `apps/atelier-desktop/src/lib/scheduled-task-store.test.ts`

- [ ] **Step 1: Write the failing type-level and store test for scheduled task creation**

```ts
import { describe, expect, it } from "vitest";

import { createScheduledTaskStore } from "./scheduled-task-store";

describe("scheduledTaskStore", () => {
  it("creates a scheduled task definition with schedule and execution config", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = store.createScheduledTask({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      permissionMode: "ask",
      worktree: { enabled: true },
      schedule: {
        type: "daily",
        cron: "0 9 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
        jitterMinutes: 10,
      },
    });

    expect(task.id).toBe("sched-1");
    expect(task.engineState).toBe("idle");
    expect(task.importSource).toBe("none");
    expect(task.schedule.type).toBe("daily");
    expect(task.worktree.enabled).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-store.test.ts`
Expected: FAIL with `Cannot find module './scheduled-task-store'` or missing exports for the scheduled-task domain.

- [ ] **Step 3: Write the minimal scheduled-task domain types**

```ts
export type ScheduledTaskPermissionMode = "ask" | "acceptEdits" | "bypassPermissions";
export type ScheduledTaskEngineState = "idle" | "queued" | "running" | "paused" | "stalled";
export type ScheduledTaskScheduleType = "manual" | "hourly" | "daily" | "weekdays" | "weekly" | "custom-cron";
export type ScheduledTaskRunStatus =
  | "queued"
  | "preparing"
  | "running"
  | "stalled_for_permission"
  | "failed"
  | "completed"
  | "cancelled"
  | "skipped";
export type ScheduledTaskRunReason =
  | "normal"
  | "catch_up"
  | "run_now"
  | "missed_skip"
  | "overlap_skip";

export interface ScheduledTaskDefinition {
  id: string;
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
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
  importSource: "none" | "claude-desktop";
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
```

- [ ] **Step 4: Run test to verify it still fails for the missing store**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-store.test.ts`
Expected: FAIL with `Cannot find module './scheduled-task-store'`.

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-tasks.ts apps/atelier-desktop/src/lib/scheduled-task-store.test.ts
git commit -m "feat: define scheduled task domain model"
```

### Task 2: Build the scheduled-task store with definition and run records

**Files:**
- Create: `apps/atelier-desktop/src/lib/scheduled-task-store.ts`
- Modify: `apps/atelier-desktop/src/lib/scheduled-task-store.test.ts`

- [ ] **Step 1: Write the failing store tests for create, update, run append, and overlap markers**

```ts
import { describe, expect, it } from "vitest";

import { createScheduledTaskStore } from "./scheduled-task-store";

describe("scheduledTaskStore", () => {
  it("appends run records and links them to a scheduled task", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = store.createScheduledTask({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      permissionMode: "ask",
      worktree: { enabled: true },
      schedule: {
        type: "daily",
        cron: "0 9 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
        jitterMinutes: 10,
      },
    });

    const run = store.createScheduledRun({
      scheduledTaskId: task.id,
      scheduledFor: "2026-04-05T09:03:00.000Z",
      reason: "normal",
    });

    expect(run.runId).toBe("run-1");
    expect(run.status).toBe("queued");
    expect(store.listRunsByTask(task.id)).toEqual([
      expect.objectContaining({ runId: "run-1", scheduledTaskId: task.id }),
    ]);
  });

  it("updates a task runtime summary after a run is queued", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
    });

    const task = store.createScheduledTask({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      permissionMode: "ask",
      worktree: { enabled: true },
      schedule: {
        type: "daily",
        cron: "0 9 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
        jitterMinutes: 10,
      },
    });

    const updatedTask = store.updateScheduledTask(task.id, {
      engineState: "queued",
      lastScheduledAt: "2026-04-05T09:03:00.000Z",
    });

    expect(updatedTask).toEqual(
      expect.objectContaining({
        engineState: "queued",
        lastScheduledAt: "2026-04-05T09:03:00.000Z",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-store.test.ts`
Expected: FAIL because `createScheduledTaskStore` is missing.

- [ ] **Step 3: Write the minimal store implementation**

```ts
import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunReason,
  ScheduledTaskRunRecord,
} from "./scheduled-tasks";

interface CreateScheduledTaskInput {
  name: string;
  description: string;
  workspacePath: string;
  prompt: string;
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

export function createScheduledTaskStore(options: CreateScheduledTaskStoreOptions = {}) {
  const now = options.now ?? (() => new Date().toISOString());
  let nextTaskId = 1;
  let nextRunId = 1;
  const createId = options.createId ?? (() => `sched-${nextTaskId++}`);
  const createRunId = options.createRunId ?? (() => `run-${nextRunId++}`);
  const tasks = new Map((options.initialTasks ?? []).map((task) => [task.id, task]));
  const runs = new Map((options.initialRuns ?? []).map((run) => [run.runId, run]));

  return {
    createScheduledTask(input: CreateScheduledTaskInput): ScheduledTaskDefinition {
      const timestamp = now();
      const task: ScheduledTaskDefinition = {
        id: createId(),
        name: input.name,
        description: input.description,
        workspacePath: input.workspacePath,
        prompt: input.prompt,
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
      };
      tasks.set(task.id, task);
      return { ...task };
    },

    updateScheduledTask(id: string, patch: Partial<ScheduledTaskDefinition>) {
      const existing = tasks.get(id);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: now() };
      tasks.set(id, updated);
      return { ...updated };
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
      return { ...run };
    },

    updateScheduledRun(runId: string, patch: Partial<ScheduledTaskRunRecord>) {
      const existing = runs.get(runId);
      if (!existing) return null;
      const updated = { ...existing, ...patch, updatedAt: now() };
      runs.set(runId, updated);
      return { ...updated };
    },

    getScheduledTask(id: string) {
      const task = tasks.get(id);
      return task ? { ...task } : null;
    },

    listScheduledTasks() {
      return [...tasks.values()].map((task) => ({ ...task }));
    },

    listScheduledRuns() {
      return [...runs.values()].map((run) => ({ ...run }));
    },

    listRunsByTask(taskId: string) {
      return [...runs.values()]
        .filter((run) => run.scheduledTaskId === taskId)
        .map((run) => ({ ...run }));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-store.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-task-store.ts apps/atelier-desktop/src/lib/scheduled-task-store.test.ts apps/atelier-desktop/src/lib/scheduled-tasks.ts
git commit -m "feat: add scheduled task store"
```

### Task 3: Add snapshot persistence for scheduled task definitions and runs

**Files:**
- Create: `apps/atelier-desktop/src/lib/scheduled-task-persistence.ts`
- Create: `apps/atelier-desktop/src/lib/scheduled-task-persistence.test.ts`

- [ ] **Step 1: Write the failing persistence tests**

```ts
import { describe, expect, it, vi } from "vitest";

import {
  createScheduledTaskPersistence,
  parseScheduledTaskSnapshot,
  serializeScheduledTaskSnapshot,
} from "./scheduled-task-persistence";

describe("scheduledTaskPersistence", () => {
  it("round-trips scheduled tasks and runs", async () => {
    const contents = serializeScheduledTaskSnapshot({
      tasks: [
        {
          id: "sched-1",
          name: "daily-review",
          description: "Review today's commits",
          workspacePath: "/tmp/workspace",
          prompt: "Review today's commits",
          model: "claude-sonnet-4-6",
          permissionMode: "ask",
          worktree: { enabled: true },
          schedule: {
            type: "daily",
            cron: "0 9 * * *",
            timezone: "Asia/Ho_Chi_Minh",
            enabled: true,
            jitterMinutes: 10,
          },
          nextRunAt: null,
          lastScheduledAt: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastMissedAt: null,
          engineState: "idle",
          rememberedApprovals: [],
          importSource: "none",
          importedAt: null,
          createdAt: "2026-04-05T09:00:00.000Z",
          updatedAt: "2026-04-05T09:00:00.000Z",
        },
      ],
      runs: [],
    });

    expect(parseScheduledTaskSnapshot(contents)).toEqual({
      tasks: [expect.objectContaining({ id: "sched-1" })],
      runs: [],
    });
  });

  it("returns empty state when the snapshot file does not exist", async () => {
    const persistence = createScheduledTaskPersistence({
      filePath: "scheduled-task-snapshot.json",
      readTextFile: vi.fn(async () => {
        throw new Error("ENOENT: scheduled task snapshot not found");
      }),
      writeTextFile: vi.fn(async () => undefined),
    });

    await expect(persistence.load()).resolves.toEqual({ tasks: [], runs: [] });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-persistence.test.ts`
Expected: FAIL because the persistence module does not exist.

- [ ] **Step 3: Write the minimal persistence layer**

```ts
import type { ScheduledTaskDefinition, ScheduledTaskRunRecord } from "./scheduled-tasks";

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
  return error instanceof Error && /ENOENT|not found|no such file/i.test(error.message);
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
  const snapshot = JSON.parse(input) as ScheduledTaskSnapshot;

  if (snapshot.version !== 1) {
    throw new TypeError(`Unsupported scheduled task snapshot version: ${snapshot.version}`);
  }

  return {
    tasks: snapshot.tasks ?? [],
    runs: snapshot.runs ?? [],
  };
}

export function createScheduledTaskPersistence(options: CreateScheduledTaskPersistenceOptions) {
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

    async save(input: { tasks: ScheduledTaskDefinition[]; runs: ScheduledTaskRunRecord[] }) {
      await options.writeTextFile(
        options.filePath,
        serializeScheduledTaskSnapshot(input),
      );
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-persistence.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-task-persistence.ts apps/atelier-desktop/src/lib/scheduled-task-persistence.test.ts
git commit -m "feat: add scheduled task persistence"
```

### Task 4: Expose Tauri file access for scheduled-task snapshots and Claude imports

**Files:**
- Modify: `apps/atelier-desktop/src/lib/tauri.ts`
- Modify: `apps/atelier-desktop/src-tauri/src/features/file_ops/commands.rs:1846-1912`
- Modify: `apps/atelier-desktop/src-tauri/src/main.rs`
- Test: `apps/atelier-desktop/src/lib/scheduled-task-persistence.test.ts`

- [ ] **Step 1: Write the failing frontend test for the new Tauri helpers**

```ts
import { describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, payload: unknown) => ({ command, payload })),
}));

describe("scheduled task tauri helpers", () => {
  it("invokes scheduled task snapshot commands", async () => {
    const tauri = await import("./tauri");

    await expect(
      tauri.readScheduledTaskSnapshot("scheduled-task-snapshot.json"),
    ).resolves.toEqual({
      command: "read_scheduled_task_snapshot",
      payload: { filePath: "scheduled-task-snapshot.json" },
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/tauri.test.ts`
Expected: FAIL because `readScheduledTaskSnapshot` is missing.

- [ ] **Step 3: Add the minimal Tauri commands and wrappers**

```ts
export async function readScheduledTaskSnapshot(filePath: string): Promise<string> {
  ensureTauri();
  return await invoke<string>("read_scheduled_task_snapshot", { filePath });
}

export async function writeScheduledTaskSnapshot(
  filePath: string,
  contents: string,
): Promise<void> {
  ensureTauri();
  return await invoke<void>("write_scheduled_task_snapshot", { filePath, contents });
}

export async function listClaudeScheduledTaskFiles(): Promise<string[]> {
  ensureTauri();
  return await invoke<string[]>("list_claude_scheduled_task_files");
}

export async function readClaudeScheduledTaskFile(taskDirName: string): Promise<string> {
  ensureTauri();
  return await invoke<string>("read_claude_scheduled_task_file", { taskDirName });
}
```

```rs
#[tauri::command]
pub fn read_scheduled_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
) -> Result<String, String> {
    let snapshot_path = resolve_task_snapshot_path(&app_handle, &file_path)?;
    std::fs::read_to_string(&snapshot_path).map_err(|error| match error.kind() {
        ErrorKind::NotFound => "ENOENT: scheduled task snapshot not found".to_string(),
        _ => format!("failed to read scheduled task snapshot: {error}"),
    })
}

#[tauri::command]
pub fn write_scheduled_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
    contents: String,
) -> Result<(), String> {
    let snapshot_path = resolve_task_snapshot_path(&app_handle, &file_path)?;
    if let Some(parent) = snapshot_path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|error| format!("failed to create scheduled task snapshot directory: {error}"))?;
    }
    std::fs::write(&snapshot_path, contents)
        .map_err(|error| format!("failed to write scheduled task snapshot: {error}"))
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/tauri.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/tauri.ts apps/atelier-desktop/src-tauri/src/features/file_ops/commands.rs apps/atelier-desktop/src-tauri/src/main.rs apps/atelier-desktop/src/lib/tauri.test.ts
git commit -m "feat: add scheduled task tauri file access"
```

### Task 5: Import Claude Desktop scheduled tasks into Atelier-native records

**Files:**
- Create: `apps/atelier-desktop/src/lib/scheduled-task-import.ts`
- Create: `apps/atelier-desktop/src/lib/scheduled-task-import.test.ts`
- Modify: `apps/atelier-desktop/src/lib/tauri.ts`

- [ ] **Step 1: Write the failing import test for SKILL.md conversion**

```ts
import { describe, expect, it } from "vitest";

import { parseClaudeScheduledTaskSkillFile } from "./scheduled-task-import";

describe("scheduledTaskImport", () => {
  it("parses a Claude scheduled task SKILL.md into an Atelier draft", () => {
    const parsed = parseClaudeScheduledTaskSkillFile({
      taskDirName: "daily-review",
      workspacePath: "/tmp/workspace",
      skillMarkdown: `---\nname: daily-review\ndescription: Review today's commits\n---\nReview today's commits and summarize them.`,
    });

    expect(parsed.name).toBe("daily-review");
    expect(parsed.description).toBe("Review today's commits");
    expect(parsed.prompt).toContain("summarize");
    expect(parsed.importSource.taskDirName).toBe("daily-review");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-import.test.ts`
Expected: FAIL because the import parser module is missing.

- [ ] **Step 3: Write the minimal import parser**

```ts
export function parseClaudeScheduledTaskSkillFile(input: {
  taskDirName: string;
  workspacePath: string;
  skillMarkdown: string;
}) {
  const [, frontmatter = "", body = ""] = input.skillMarkdown.match(
    /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/,
  ) ?? ["", "", input.skillMarkdown];

  const nameMatch = frontmatter.match(/^name:\s*(.+)$/m);
  const descriptionMatch = frontmatter.match(/^description:\s*(.+)$/m);

  return {
    name: nameMatch?.[1]?.trim() ?? input.taskDirName,
    description: descriptionMatch?.[1]?.trim() ?? "",
    workspacePath: input.workspacePath,
    prompt: body.trim(),
    importSource: {
      provider: "claude-desktop" as const,
      taskDirName: input.taskDirName,
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-import.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-task-import.ts apps/atelier-desktop/src/lib/scheduled-task-import.test.ts apps/atelier-desktop/src/lib/tauri.ts
git commit -m "feat: add Claude scheduled task import parser"
```

### Task 6: Implement scheduler timing logic with deterministic jitter and catch-up selection

**Files:**
- Create: `apps/atelier-desktop/src/lib/scheduled-task-engine.ts`
- Create: `apps/atelier-desktop/src/lib/scheduled-task-engine.test.ts`

- [ ] **Step 1: Write the failing engine tests for jitter and most-recent catch-up**

```ts
import { describe, expect, it } from "vitest";

import {
  computeDeterministicJitterMinutes,
  findMostRecentMissedSlot,
} from "./scheduled-task-engine";

describe("scheduledTaskEngine", () => {
  it("returns a stable jitter between 0 and 10 minutes", () => {
    const first = computeDeterministicJitterMinutes("sched-1", 10);
    const second = computeDeterministicJitterMinutes("sched-1", 10);

    expect(first).toBe(second);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(10);
  });

  it("returns only the most recent missed slot within seven days", () => {
    const missed = findMostRecentMissedSlot({
      slots: [
        "2026-03-31T09:03:00.000Z",
        "2026-04-01T09:03:00.000Z",
        "2026-04-02T09:03:00.000Z",
      ],
      now: "2026-04-03T09:00:00.000Z",
      lookbackDays: 7,
    });

    expect(missed).toBe("2026-04-02T09:03:00.000Z");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-engine.test.ts`
Expected: FAIL because the engine module is missing.

- [ ] **Step 3: Write the minimal engine helpers**

```ts
export function computeDeterministicJitterMinutes(taskId: string, maxMinutes: number): number {
  let hash = 0;
  for (const char of taskId) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  }
  return hash % (maxMinutes + 1);
}

export function findMostRecentMissedSlot(input: {
  slots: string[];
  now: string;
  lookbackDays: number;
}): string | null {
  const nowMs = new Date(input.now).getTime();
  const lookbackMs = input.lookbackDays * 24 * 60 * 60 * 1000;

  return input.slots
    .filter((slot) => {
      const slotMs = new Date(slot).getTime();
      return slotMs <= nowMs && slotMs >= nowMs - lookbackMs;
    })
    .toSorted((left, right) => new Date(right).getTime() - new Date(left).getTime())[0] ?? null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-engine.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-task-engine.ts apps/atelier-desktop/src/lib/scheduled-task-engine.test.ts
git commit -m "feat: add scheduled task engine timing helpers"
```

### Task 7: Build the scheduled-task runner and workbench orchestration layer

**Files:**
- Create: `apps/atelier-desktop/src/lib/scheduled-task-runner.ts`
- Create: `apps/atelier-desktop/src/lib/scheduled-task-workbench.ts`
- Create: `apps/atelier-desktop/src/lib/scheduled-task-workbench.test.ts`
- Modify: `apps/atelier-desktop/src/lib/atelier-client.ts`
- Modify: `apps/atelier-desktop/src/lib/studio.ts`

- [ ] **Step 1: Write the failing workbench test for run-now orchestration**

```ts
import { describe, expect, it, vi } from "vitest";

import { createScheduledTaskWorkbench } from "./scheduled-task-workbench";

describe("scheduledTaskWorkbench", () => {
  it("creates a run-now record and links it to an Atelier task execution", async () => {
    const workbench = await createScheduledTaskWorkbench({
      persistence: {
        load: vi.fn(async () => ({ tasks: [], runs: [] })),
        save: vi.fn(async () => undefined),
      },
      runner: {
        startScheduledRun: vi.fn(async () => ({
          linkedSessionId: "session-1",
          linkedTaskId: "task-1",
          status: "running",
        })),
      },
    });

    const task = await workbench.createScheduledTask({
      name: "daily-review",
      description: "Review today's commits",
      workspacePath: "/tmp/workspace",
      prompt: "Review today's commits",
      model: "claude-sonnet-4-6",
      permissionMode: "ask",
      worktree: { enabled: true },
      schedule: {
        type: "daily",
        cron: "0 9 * * *",
        timezone: "Asia/Ho_Chi_Minh",
        enabled: true,
        jitterMinutes: 10,
      },
    });

    const run = await workbench.runNow(task.id);

    expect(run.reason).toBe("run_now");
    expect(run.linkedSessionId).toBe("session-1");
    expect(run.linkedTaskId).toBe("task-1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-workbench.test.ts`
Expected: FAIL because the workbench module does not exist.

- [ ] **Step 3: Write the minimal runner and workbench implementation**

```ts
export interface ScheduledTaskRunner {
  startScheduledRun: (input: {
    scheduledTaskId: string;
    workspacePath: string;
    prompt: string;
    model: string;
    reason: "normal" | "catch_up" | "run_now";
  }) => Promise<{
    linkedSessionId: string | null;
    linkedTaskId: string | null;
    status: "running" | "stalled_for_permission" | "failed" | "completed";
  }>;
}
```

```ts
import { createScheduledTaskStore } from "./scheduled-task-store";

export async function createScheduledTaskWorkbench(options: {
  persistence: {
    load: () => Promise<{ tasks: ScheduledTaskDefinition[]; runs: ScheduledTaskRunRecord[] }>;
    save: (input: { tasks: ScheduledTaskDefinition[]; runs: ScheduledTaskRunRecord[] }) => Promise<void>;
  };
  runner: ScheduledTaskRunner;
}) {
  const snapshot = await options.persistence.load();
  const store = createScheduledTaskStore({
    initialTasks: snapshot.tasks,
    initialRuns: snapshot.runs,
  });

  async function persist() {
    await options.persistence.save({
      tasks: store.listScheduledTasks(),
      runs: store.listScheduledRuns(),
    });
  }

  return {
    async createScheduledTask(input: CreateScheduledTaskInput) {
      const task = store.createScheduledTask(input);
      await persist();
      return task;
    },

    listScheduledTasks() {
      return store.listScheduledTasks();
    },

    async runNow(taskId: string) {
      const task = store.getScheduledTask(taskId);
      if (!task) throw new Error(`Scheduled task ${taskId} not found`);

      let run = store.createScheduledRun({
        scheduledTaskId: taskId,
        scheduledFor: null,
        reason: "run_now",
      });

      const result = await options.runner.startScheduledRun({
        scheduledTaskId: task.id,
        workspacePath: task.workspacePath,
        prompt: task.prompt,
        model: task.model,
        reason: "run_now",
      });

      run = store.updateScheduledRun(run.runId, {
        status: result.status,
        linkedSessionId: result.linkedSessionId,
        linkedTaskId: result.linkedTaskId,
        startedAt: new Date().toISOString(),
      })!;

      await persist();
      return run;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-workbench.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-task-runner.ts apps/atelier-desktop/src/lib/scheduled-task-workbench.ts apps/atelier-desktop/src/lib/scheduled-task-workbench.test.ts apps/atelier-desktop/src/lib/atelier-client.ts apps/atelier-desktop/src/lib/studio.ts
git commit -m "feat: add scheduled task run orchestration"
```

### Task 8: Implement the scheduler loop with idempotent due-run creation

**Files:**
- Modify: `apps/atelier-desktop/src/lib/scheduled-task-engine.ts`
- Modify: `apps/atelier-desktop/src/lib/scheduled-task-engine.test.ts`
- Modify: `apps/atelier-desktop/src/lib/scheduled-task-workbench.ts`
- Modify: `apps/atelier-desktop/src/lib/scheduled-task-workbench.test.ts`

- [ ] **Step 1: Write the failing workbench test for skip-overlap and catch-up enqueueing**

```ts
import { describe, expect, it, vi } from "vitest";

import { createScheduledTaskWorkbench } from "./scheduled-task-workbench";

describe("scheduledTaskWorkbench scheduler", () => {
  it("creates only one catch-up run for the most recent missed slot", async () => {
    const workbench = await createScheduledTaskWorkbench({
      persistence: {
        load: vi.fn(async () => ({
          tasks: [
            {
              id: "sched-1",
              name: "daily-review",
              description: "Review today's commits",
              workspacePath: "/tmp/workspace",
              prompt: "Review today's commits",
              model: "claude-sonnet-4-6",
              permissionMode: "ask",
              worktree: { enabled: true },
              schedule: {
                type: "daily",
                cron: "0 9 * * *",
                timezone: "Asia/Ho_Chi_Minh",
                enabled: true,
                jitterMinutes: 10,
              },
              nextRunAt: null,
              lastScheduledAt: null,
              lastStartedAt: null,
              lastFinishedAt: null,
              lastMissedAt: null,
              engineState: "idle",
              rememberedApprovals: [],
              importSource: "none",
              importedAt: null,
              createdAt: "2026-04-01T09:00:00.000Z",
              updatedAt: "2026-04-01T09:00:00.000Z",
            },
          ],
          runs: [],
        })),
        save: vi.fn(async () => undefined),
      },
      runner: {
        startScheduledRun: vi.fn(async () => ({
          linkedSessionId: "session-1",
          linkedTaskId: "task-1",
          status: "running",
        })),
      },
    });

    const runs = await workbench.tick({ now: "2026-04-05T09:20:00.000Z" });

    expect(runs).toHaveLength(1);
    expect(runs[0]?.reason).toBe("catch_up");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-workbench.test.ts`
Expected: FAIL because `tick` is missing.

- [ ] **Step 3: Write the minimal tick implementation**

```ts
async function queueDueRun(task: ScheduledTaskDefinition, reason: ScheduledTaskRunReason, scheduledFor: string | null) {
  const activeRun = store
    .listRunsByTask(task.id)
    .find((run) => run.status === "queued" || run.status === "preparing" || run.status === "running" || run.status === "stalled_for_permission");

  if (activeRun) {
    const skipped = store.createScheduledRun({
      scheduledTaskId: task.id,
      scheduledFor,
      reason: "overlap_skip",
    });
    await persist();
    return skipped;
  }

  const run = store.createScheduledRun({
    scheduledTaskId: task.id,
    scheduledFor,
    reason,
  });

  store.updateScheduledTask(task.id, {
    engineState: "queued",
    lastScheduledAt: scheduledFor ?? now(),
  });

  await persist();
  return run;
}

async function tick({ now }: { now: string }) {
  const createdRuns: ScheduledTaskRunRecord[] = [];

  for (const task of store.listScheduledTasks()) {
    if (!task.schedule.enabled || task.engineState === "paused") {
      continue;
    }

    const missedSlot = findMostRecentMissedSlot({
      slots: buildCandidateSlots(task, now),
      now,
      lookbackDays: 7,
    });

    if (missedSlot) {
      createdRuns.push(await queueDueRun(task, "catch_up", missedSlot));
    }
  }

  return createdRuns;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-workbench.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib/scheduled-task-engine.ts apps/atelier-desktop/src/lib/scheduled-task-engine.test.ts apps/atelier-desktop/src/lib/scheduled-task-workbench.ts apps/atelier-desktop/src/lib/scheduled-task-workbench.test.ts
git commit -m "feat: add scheduled task scheduler loop"
```

### Task 9: Add the top-level Schedule tab and basic schedule workspace shell

**Files:**
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx`
- Modify: `apps/atelier-desktop/src/components/app-shell.test.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-sidebar.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-list-item.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-detail-panel.tsx`

- [ ] **Step 1: Write the failing UI test for the Schedule tab**

```tsx
it("renders the Schedule tab and shows the schedule empty state", async () => {
  flushSync(() => {
    root?.render(
      <AppShell
        chatsWorkspace={<div>Chats</div>}
        syncView={<div>Sync</div>}
        configView={<div>Config</div>}
      />,
    );
  });

  const scheduleTab = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
    button.textContent?.includes("Schedule"),
  );

  flushSync(() => {
    scheduleTab?.click();
  });

  expect(container?.textContent).toContain("Scheduled tasks");
  expect(container?.textContent).toContain("No scheduled tasks yet");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/app-shell.test.tsx`
Expected: FAIL because the Schedule tab does not exist.

- [ ] **Step 3: Write the minimal Schedule tab shell**

```tsx
<TabsTrigger value="schedule" className="px-3 py-1 text-xs">
  Schedule
</TabsTrigger>
```

```tsx
<TabsContent value="schedule" className="flex flex-1 overflow-hidden">
  <div className="flex flex-1 overflow-hidden">
    <ScheduleSidebar
      tasks={scheduledTasks}
      selectedTaskId={selectedScheduledTaskId}
      onSelectTask={setSelectedScheduledTaskId}
      onRunNow={(taskId) => void scheduledTaskWorkbench?.runNow(taskId)}
      onPauseToggle={(taskId) => void scheduledTaskWorkbench?.toggleEnabled(taskId)}
    />
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {selectedScheduledTask ? (
        <ScheduleDetailPanel task={selectedScheduledTask} runs={scheduledRuns} />
      ) : (
        <section className="flex min-h-0 flex-1 flex-col justify-center px-6 py-8">
          <h2 className="text-sm font-semibold">Scheduled tasks</h2>
          <p className="text-muted-foreground mt-2 text-sm">No scheduled tasks yet.</p>
        </section>
      )}
    </main>
  </div>
</TabsContent>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/components/app-shell.tsx apps/atelier-desktop/src/components/app-shell.test.tsx apps/atelier-desktop/src/components/schedule-sidebar.tsx apps/atelier-desktop/src/components/schedule-list-item.tsx apps/atelier-desktop/src/components/schedule-detail-panel.tsx
git commit -m "feat: add schedule tab shell"
```

### Task 10: Add the scheduled task create/edit form with frequency and worktree controls

**Files:**
- Create: `apps/atelier-desktop/src/components/scheduled-task-form.tsx`
- Create: `apps/atelier-desktop/src/components/scheduled-task-form.test.tsx`
- Modify: `apps/atelier-desktop/src/components/schedule-detail-panel.tsx`

- [ ] **Step 1: Write the failing form test for creating a daily task**

```tsx
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduledTaskForm } from "./scheduled-task-form";

// @vitest-environment jsdom

describe("ScheduledTaskForm", () => {
  let container: HTMLDivElement | null;
  let root: Root | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    flushSync(() => root?.unmount());
    container?.remove();
    container = null;
    root = null;
  });

  it("renders daily frequency and worktree controls", () => {
    flushSync(() => {
      root?.render(
        <ScheduledTaskForm
          mode="create"
          initialValue={null}
          onSubmit={vi.fn(async () => undefined)}
          onCancel={() => undefined}
        />,
      );
    });

    expect(container?.textContent).toContain("Daily");
    expect(container?.textContent).toContain("Worktree");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/scheduled-task-form.test.tsx`
Expected: FAIL because the form component does not exist.

- [ ] **Step 3: Write the minimal create/edit form**

```tsx
export function ScheduledTaskForm(props: {
  mode: "create" | "edit";
  initialValue: ScheduledTaskDefinition | null;
  onSubmit: (input: CreateScheduledTaskInput) => Promise<void>;
  onCancel: () => void;
}) {
  const [name, setName] = useState(props.initialValue?.name ?? "");
  const [description, setDescription] = useState(props.initialValue?.description ?? "");
  const [workspacePath, setWorkspacePath] = useState(props.initialValue?.workspacePath ?? "");
  const [prompt, setPrompt] = useState(props.initialValue?.prompt ?? "");
  const [frequency, setFrequency] = useState(props.initialValue?.schedule.type ?? "daily");
  const [worktreeEnabled, setWorktreeEnabled] = useState(
    props.initialValue?.worktree.enabled ?? false,
  );

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void props.onSubmit({
          name,
          description,
          workspacePath,
          prompt,
          model: props.initialValue?.model ?? "claude-sonnet-4-6",
          permissionMode: props.initialValue?.permissionMode ?? "ask",
          worktree: { enabled: worktreeEnabled },
          schedule: {
            type: frequency,
            cron: frequency === "daily" ? "0 9 * * *" : null,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            enabled: true,
            jitterMinutes: 10,
          },
        });
      }}
      className="space-y-4 p-4"
    >
      <label>
        <span>Name</span>
        <input value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <label>
        <span>Description</span>
        <input value={description} onChange={(event) => setDescription(event.target.value)} />
      </label>
      <label>
        <span>Workspace</span>
        <input value={workspacePath} onChange={(event) => setWorkspacePath(event.target.value)} />
      </label>
      <label>
        <span>Prompt</span>
        <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} />
      </label>
      <label>
        <span>Frequency</span>
        <select value={frequency} onChange={(event) => setFrequency(event.target.value as ScheduledTaskScheduleType)}>
          <option value="manual">Manual</option>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays</option>
          <option value="weekly">Weekly</option>
          <option value="custom-cron">Custom cron</option>
        </select>
      </label>
      <label>
        <input
          type="checkbox"
          checked={worktreeEnabled}
          onChange={(event) => setWorktreeEnabled(event.target.checked)}
        />
        <span>Worktree</span>
      </label>
      <button type="submit">{props.mode === "create" ? "Create task" : "Save changes"}</button>
      <button type="button" onClick={props.onCancel}>Cancel</button>
    </form>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/scheduled-task-form.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/components/scheduled-task-form.tsx apps/atelier-desktop/src/components/scheduled-task-form.test.tsx apps/atelier-desktop/src/components/schedule-detail-panel.tsx
git commit -m "feat: add scheduled task form"
```

### Task 11: Add the Schedule detail tabs for overview, runs, and permissions

**Files:**
- Create: `apps/atelier-desktop/src/components/schedule-overview-panel.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-runs-panel.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-permissions-panel.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-config-panel.tsx`
- Modify: `apps/atelier-desktop/src/components/schedule-detail-panel.tsx`
- Create: `apps/atelier-desktop/src/components/schedule-detail-panel.test.tsx`

- [ ] **Step 1: Write the failing detail-panel test for tab switching and run badges**

```tsx
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

import { ScheduleDetailPanel } from "./schedule-detail-panel";

describe("ScheduleDetailPanel", () => {
  it("renders overview metadata and run history labels", () => {
    const markup = renderToStaticMarkup(
      <ScheduleDetailPanel
        task={{
          id: "sched-1",
          name: "daily-review",
          description: "Review today's commits",
          workspacePath: "/tmp/workspace",
          prompt: "Review today's commits",
          model: "claude-sonnet-4-6",
          permissionMode: "ask",
          worktree: { enabled: true },
          schedule: {
            type: "daily",
            cron: "0 9 * * *",
            timezone: "Asia/Ho_Chi_Minh",
            enabled: true,
            jitterMinutes: 10,
          },
          nextRunAt: "2026-04-06T09:03:00.000Z",
          lastScheduledAt: null,
          lastStartedAt: null,
          lastFinishedAt: null,
          lastMissedAt: null,
          engineState: "idle",
          rememberedApprovals: ["Bash(git status)"],
          importSource: "claude-desktop",
          importedAt: "2026-04-05T09:00:00.000Z",
          createdAt: "2026-04-05T09:00:00.000Z",
          updatedAt: "2026-04-05T09:00:00.000Z",
        }}
        runs={[
          {
            runId: "run-1",
            scheduledTaskId: "sched-1",
            scheduledFor: "2026-04-05T09:03:00.000Z",
            startedAt: "2026-04-05T09:03:10.000Z",
            finishedAt: null,
            status: "stalled_for_permission",
            reason: "normal",
            linkedSessionId: "session-1",
            linkedTaskId: "task-1",
            errorSummary: null,
            summary: null,
            createdAt: "2026-04-05T09:03:00.000Z",
            updatedAt: "2026-04-05T09:03:10.000Z",
          },
        ]}
      />,
    );

    expect(markup).toContain("daily-review");
    expect(markup).toContain("Imported from Claude");
    expect(markup).toContain("stalled_for_permission");
    expect(markup).toContain("Bash(git status)");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-detail-panel.test.tsx`
Expected: FAIL because the panel does not expose these sections yet.

- [ ] **Step 3: Write the minimal detail tabs**

```tsx
export function ScheduleOverviewPanel({ task }: { task: ScheduledTaskDefinition }) {
  return (
    <section className="space-y-3 px-4 py-3 text-sm">
      <div>{task.prompt}</div>
      <div>{task.schedule.type}</div>
      <div>{task.permissionMode}</div>
      <div>{task.worktree.enabled ? "Worktree enabled" : "Worktree disabled"}</div>
    </section>
  );
}
```

```tsx
export function ScheduleRunsPanel(props: {
  runs: ScheduledTaskRunRecord[];
  onOpenRun?: (runId: string) => void;
}) {
  return (
    <section className="space-y-2 px-4 py-3 text-sm">
      {props.runs.map((run) => (
        <button key={run.runId} type="button" onClick={() => props.onOpenRun?.(run.runId)}>
          {run.status} · {run.reason} · {run.scheduledFor ?? "manual"}
        </button>
      ))}
    </section>
  );
}
```

```tsx
export function SchedulePermissionsPanel(props: {
  approvals: string[];
  onRevoke: (approval: string) => void;
  onRevokeAll: () => void;
}) {
  return (
    <section className="space-y-2 px-4 py-3 text-sm">
      {props.approvals.map((approval) => (
        <button key={approval} type="button" onClick={() => props.onRevoke(approval)}>
          {approval}
        </button>
      ))}
      <button type="button" onClick={props.onRevokeAll}>Revoke all</button>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-detail-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/components/schedule-overview-panel.tsx apps/atelier-desktop/src/components/schedule-runs-panel.tsx apps/atelier-desktop/src/components/schedule-permissions-panel.tsx apps/atelier-desktop/src/components/schedule-config-panel.tsx apps/atelier-desktop/src/components/schedule-detail-panel.tsx apps/atelier-desktop/src/components/schedule-detail-panel.test.tsx
git commit -m "feat: add schedule detail panels"
```

### Task 12: Add Claude import UI and load imported tasks into the Schedule surface

**Files:**
- Create: `apps/atelier-desktop/src/components/scheduled-task-import-banner.tsx`
- Modify: `apps/atelier-desktop/src/components/schedule-sidebar.tsx`
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx`
- Modify: `apps/atelier-desktop/src/components/app-shell.test.tsx`

- [ ] **Step 1: Write the failing Schedule UI test for the import banner**

```tsx
it("shows the Claude import banner when import candidates exist", async () => {
  flushSync(() => {
    root?.render(
      <ScheduleSidebar
        tasks={[]}
        importCandidates={[{ taskDirName: "daily-review", name: "daily-review" }]}
        selectedTaskId={null}
        onSelectTask={() => undefined}
        onRunNow={() => undefined}
        onPauseToggle={() => undefined}
        onImportAll={() => undefined}
      />,
    );
  });

  expect(container?.textContent).toContain("Import Claude scheduled tasks");
  expect(container?.textContent).toContain("daily-review");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-sidebar.test.tsx`
Expected: FAIL because import UI is missing.

- [ ] **Step 3: Write the minimal import banner and sidebar integration**

```tsx
export function ScheduledTaskImportBanner(props: {
  candidates: Array<{ taskDirName: string; name: string }>;
  onImportAll: () => void;
}) {
  return (
    <section className="border-b px-3 py-3 text-xs">
      <p className="font-medium">Import Claude scheduled tasks</p>
      <p className="text-muted-foreground mt-1">
        Found {props.candidates.length} Claude Desktop task(s).
      </p>
      <ul className="mt-2 space-y-1">
        {props.candidates.map((candidate) => (
          <li key={candidate.taskDirName}>{candidate.name}</li>
        ))}
      </ul>
      <button type="button" onClick={props.onImportAll}>Import all</button>
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-sidebar.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/components/scheduled-task-import-banner.tsx apps/atelier-desktop/src/components/schedule-sidebar.tsx apps/atelier-desktop/src/components/app-shell.tsx apps/atelier-desktop/src/components/app-shell.test.tsx
git commit -m "feat: add Claude scheduled task import UI"
```

### Task 13: Connect scheduled runs to Atelier execution surfaces

**Files:**
- Create: `apps/atelier-desktop/src/components/scheduled-run-linked-view.tsx`
- Modify: `apps/atelier-desktop/src/components/schedule-detail-panel.tsx`
- Modify: `apps/atelier-desktop/src/components/task-detail-panel.tsx`
- Modify: `apps/atelier-desktop/src/components/task-detail-panel.test.tsx`
- Modify: `apps/atelier-desktop/src/lib/atelier-client.ts`

- [ ] **Step 1: Write the failing test for opening a linked scheduled run**

```tsx
it("opens the linked Atelier task when a scheduled run is selected", () => {
  flushSync(() => {
    root?.render(
      <ScheduleDetailPanel
        task={task}
        runs={[
          {
            runId: "run-1",
            scheduledTaskId: task.id,
            scheduledFor: "2026-04-05T09:03:00.000Z",
            startedAt: "2026-04-05T09:03:10.000Z",
            finishedAt: null,
            status: "running",
            reason: "normal",
            linkedSessionId: "session-1",
            linkedTaskId: "task-1",
            errorSummary: null,
            summary: null,
            createdAt: "2026-04-05T09:03:00.000Z",
            updatedAt: "2026-04-05T09:03:10.000Z",
          },
        ]}
        onOpenRun={(runId) => openedRuns.push(runId)}
      />,
    );
  });

  const runButton = [...(container?.querySelectorAll("button") ?? [])].find((button) =>
    button.textContent?.includes("running"),
  );

  flushSync(() => {
    runButton?.click();
  });

  expect(openedRuns).toEqual(["run-1"]);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-detail-panel.test.tsx`
Expected: FAIL because the detail panel does not surface linked-run open behavior.

- [ ] **Step 3: Write the minimal linked-run wrapper**

```tsx
export function ScheduledRunLinkedView(props: {
  run: ScheduledTaskRunRecord;
  linkedTask: TaskRecord | null;
}) {
  if (!props.linkedTask) {
    return <p className="text-sm text-muted-foreground">No linked execution found.</p>;
  }

  return <TaskDetailPanel task={props.linkedTask} />;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-detail-panel.test.tsx src/components/task-detail-panel.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/components/scheduled-run-linked-view.tsx apps/atelier-desktop/src/components/schedule-detail-panel.tsx apps/atelier-desktop/src/components/task-detail-panel.tsx apps/atelier-desktop/src/components/task-detail-panel.test.tsx apps/atelier-desktop/src/lib/atelier-client.ts
git commit -m "feat: connect scheduled runs to task detail surfaces"
```

### Task 14: Run the focused verification suite and fix any issues

**Files:**
- Modify: any files touched by failing tests in previous tasks
- Test: `apps/atelier-desktop/src/lib/scheduled-task-*.test.ts`
- Test: `apps/atelier-desktop/src/components/schedule-*.test.tsx`
- Test: `apps/atelier-desktop/src/components/app-shell.test.tsx`

- [ ] **Step 1: Run the scheduled task unit tests**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/scheduled-task-persistence.test.ts src/lib/scheduled-task-store.test.ts src/lib/scheduled-task-engine.test.ts src/lib/scheduled-task-import.test.ts src/lib/scheduled-task-workbench.test.ts`
Expected: PASS

- [ ] **Step 2: Run the Schedule UI tests**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/schedule-sidebar.test.tsx src/components/schedule-detail-panel.test.tsx src/components/scheduled-task-form.test.tsx src/components/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 3: Run typecheck for the desktop app**

Run: `pnpm --dir apps/atelier-desktop typecheck`
Expected: PASS

- [ ] **Step 4: Fix any failures and re-run the exact failing command**

```ts
// Example shape for an import fix if a test shows the imported task is missing provenance
const importedTask = store.createScheduledTask({
  ...draft,
  schedule: normalizedSchedule,
});
store.updateScheduledTask(importedTask.id, {
  importSource: "claude-desktop",
  importedAt: now(),
});
```

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src/lib apps/atelier-desktop/src/components apps/atelier-desktop/src-tauri/src
git commit -m "test: verify scheduled task engine implementation"
```

## Self-Review Checklist

- Spec coverage mapped:
  - storage model: Tasks 1-4
  - import/migration: Tasks 4-5 and 12
  - engine behavior: Tasks 6-8
  - run orchestration: Tasks 7-8 and 13
  - schedule UI: Tasks 9-13
  - test strategy and rollout verification: Task 14
- Placeholder scan complete:
  - no `TODO`, `TBD`, or "similar to task N" shortcuts remain
- Type consistency checked:
  - `ScheduledTaskDefinition`, `ScheduledTaskRunRecord`, `createScheduledTaskStore`, `createScheduledTaskWorkbench`, and `ScheduledTaskForm` names are consistent throughout the plan
