# Scheduled Tasks Feature Restructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure Atelier Desktop scheduled-tasks into a single end-to-end feature boundary across React and Tauri without changing scheduled-task behavior.

**Architecture:** Move scheduled-task UI, state, pure domain logic, and side-effect orchestration into `src/features/scheduled-tasks/`, then align Tauri commands under `src-tauri/src/features/scheduled_tasks/`. Keep `src/components/app-shell.tsx` as an app-level composition shell, but extract scheduled-task-specific wiring behind a feature public API and feature-local adapters.

**Tech Stack:** React 19, TypeScript, Vitest, Vite alias `~`, Tauri 2.x, Rust

---

## File Structure

### Frontend files to create

- `src/features/scheduled-tasks/index.ts` — public API for the scheduled-tasks feature
- `src/features/scheduled-tasks/components/schedule-list-item.tsx` — list row UI for a scheduled task
- `src/features/scheduled-tasks/components/schedule-sidebar.tsx` — left sidebar list of scheduled tasks
- `src/features/scheduled-tasks/components/schedule-detail-panel.tsx` — details/editor host for one scheduled task
- `src/features/scheduled-tasks/components/scheduled-task-form.tsx` — create/edit form UI
- `src/features/scheduled-tasks/model/scheduled-task-store.ts` — feature-local scheduled-task store primitives
- `src/features/scheduled-tasks/domain/scheduled-tasks.ts` — scheduled-task types and constants
- `src/features/scheduled-tasks/domain/scheduled-task-engine.ts` — pure scheduling computations and slot logic
- `src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.ts` — pure sync-template prompt generation
- `src/features/scheduled-tasks/services/scheduled-task-runner.ts` — runner interface + optional event/listener adapter boundary
- `src/features/scheduled-tasks/services/scheduled-task-persistence.ts` — snapshot serialization + persistence adapter
- `src/features/scheduled-tasks/services/scheduled-task-import.ts` — Claude scheduled task import parsing
- `src/features/scheduled-tasks/services/scheduled-task-workbench.ts` — scheduled-task orchestration and persistence coordination
- `src/features/scheduled-tasks/services/scheduled-task-tauri.ts` — scheduled-task-only wrappers over `~/lib/tauri`
- `src/features/scheduled-tasks/services/load-sync-strategy-markdown.ts` — feature-local adapter for loading sync strategy markdown

### Frontend files to modify

- `src/components/app-shell.tsx:88-150` — remove scheduled-task helper functions and local sync-strategy loader from app shell
- `src/components/app-shell.tsx:166-178` — remove scheduled-task-local state declarations that should move behind feature APIs
- `src/components/app-shell.tsx:264-338` — swap direct workbench construction for feature-local adapters/imports
- `src/components/app-shell.tsx:430-505` — route scheduled-task lifecycle reconciliation through feature-local APIs
- `src/components/app-shell.tsx:517-559` — replace selected scheduled-task derivation and template regeneration wiring with feature imports
- `src/components/app-shell.tsx:727-875` — update schedule tab to consume moved components/types from `~/features/scheduled-tasks`
- `src/components/acme-sync.tsx:31-38` — switch scheduled-task sync-strategy imports to the feature public API or feature-local public subpath
- `src/lib/tauri.ts:254-284` — keep raw Tauri wrappers but stop importing them directly from app-shell scheduled-task UI flow
- `src/lib/tauri.test.ts:134-159` — keep command wrapper coverage after introducing scheduled-task feature-local adapter

### Frontend tests to move or update

- `src/components/scheduled-task-form.test.tsx` → `src/features/scheduled-tasks/components/scheduled-task-form.test.tsx`
- `src/lib/scheduled-task-store.test.ts` → `src/features/scheduled-tasks/model/scheduled-task-store.test.ts`
- `src/lib/scheduled-task-engine.test.ts` → `src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts`
- `src/lib/scheduled-task-sync-strategy.test.ts` → `src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts`
- `src/lib/scheduled-task-persistence.test.ts` → `src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts`
- `src/lib/scheduled-task-import.test.ts` → `src/features/scheduled-tasks/services/scheduled-task-import.test.ts`
- `src/lib/scheduled-task-workbench.test.ts` → `src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts`
- `src/components/app-shell.test.tsx` — update mocks/imports to reflect feature paths and feature-local seams

### Backend files to create

- `src-tauri/src/features/scheduled_tasks/mod.rs` — backend scheduled-tasks module exports
- `src-tauri/src/features/scheduled_tasks/commands.rs` — scheduled-task-related Tauri commands moved out of `file_ops`

### Backend files to modify

- `src-tauri/src/features/mod.rs` — register `scheduled_tasks`
- `src-tauri/src/main.rs:13-22` — import scheduled-task commands from `features::scheduled_tasks`
- `src-tauri/src/main.rs:78-83` — keep scheduled-task commands registered through the new module path
- `src-tauri/src/features/file_ops/commands.rs:2185-2270` — remove scheduled-task snapshot/import commands after moving them into `scheduled_tasks/commands.rs`
- `src-tauri/src/features/file_ops/mod.rs` — stop re-exporting moved scheduled-task commands through `file_ops`

### Backend tests to update

- `src-tauri/src/features/file_ops/commands.rs:3519-3560` — keep snapshot-path safety tests passing after moving scheduled-task commands to the new module or sharing the path helper

### Notes for execution

- Use `pnpm --dir apps/atelier-desktop exec vitest run <path>` for test runs in this app.
- Use `pnpm --dir apps/atelier-desktop typecheck` for TS validation.
- Use `pnpm --dir apps/atelier-desktop lint` for lint validation.
- Keep imports on `~` alias where possible for feature public APIs.
- Do not leave compatibility re-exports in old `src/lib/scheduled-task*` files once imports are updated.

### Task 1: Move scheduled-task UI components into the feature tree

**Files:**
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-list-item.tsx`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-sidebar.tsx`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-detail-panel.tsx`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/components/scheduled-task-form.tsx`
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx:727-875`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/components/scheduled-task-form.test.tsx`

- [ ] **Step 1: Write the failing moved-component test import**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/components/scheduled-task-form.test.tsx
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";

import { ScheduledTaskForm } from "./scheduled-task-form";

describe("ScheduledTaskForm import path", () => {
  it("exports the feature-local scheduled task form", () => {
    expect(ScheduledTaskForm).toBeTypeOf("function");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/components/scheduled-task-form.test.tsx`
Expected: FAIL with module-not-found for `./scheduled-task-form`

- [ ] **Step 3: Create the feature component files with temporary re-exports**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-list-item.tsx
export { ScheduleListItem } from "../../../components/schedule-list-item";

// apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-sidebar.tsx
export { ScheduleSidebar } from "../../../components/schedule-sidebar";

// apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-detail-panel.tsx
export { ScheduleDetailPanel } from "../../../components/schedule-detail-panel";

// apps/atelier-desktop/src/features/scheduled-tasks/components/scheduled-task-form.tsx
export {
  ScheduledTaskForm,
  type ScheduledTaskFormInput,
} from "../../../components/scheduled-task-form";
```

- [ ] **Step 4: Replace the temporary re-exports with real moved files and update `app-shell.tsx` imports**

```ts
// apps/atelier-desktop/src/components/app-shell.tsx
import { ScheduleSidebar } from "~/features/scheduled-tasks/components/schedule-sidebar";
import { ScheduleDetailPanel } from "~/features/scheduled-tasks/components/schedule-detail-panel";
import type { ScheduledTaskFormInput } from "~/features/scheduled-tasks/components/scheduled-task-form";
```

- [ ] **Step 5: Run the moved component test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/components/scheduled-task-form.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src/features/scheduled-tasks/components apps/atelier-desktop/src/components/app-shell.tsx
git commit -m "refactor(atelier-desktop): move scheduled task UI into feature tree"
```

### Task 2: Move scheduled-task domain types and pure scheduling logic

**Files:**
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-tasks.ts`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-engine.ts`
- Modify: `apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-sidebar.tsx`
- Modify: `apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-detail-panel.tsx`
- Modify: `apps/atelier-desktop/src/features/scheduled-tasks/components/scheduled-task-form.tsx`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts`

- [ ] **Step 1: Write the failing domain test at the new path**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts
import { describe, expect, it } from "vitest";

import { computeDeterministicJitterMinutes } from "./scheduled-task-engine";

describe("computeDeterministicJitterMinutes", () => {
  it("returns the same jitter for the same task id", () => {
    expect(computeDeterministicJitterMinutes("sched-1", 10)).toBe(
      computeDeterministicJitterMinutes("sched-1", 10),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts`
Expected: FAIL with module-not-found for `./scheduled-task-engine`

- [ ] **Step 3: Move the domain source files into the feature tree**

```bash
git mv apps/atelier-desktop/src/lib/scheduled-tasks.ts apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-tasks.ts
git mv apps/atelier-desktop/src/lib/scheduled-task-engine.ts apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-engine.ts
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-tasks.ts
import type { SyncProfile } from "~/lib/types";

// keep the rest of the file contents unchanged

// apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-engine.ts
import type {
  ScheduledTaskRunRecord,
  ScheduledTaskRunStatus,
  ScheduledTaskScheduleType,
} from "./scheduled-tasks";

// keep the rest of the file contents unchanged
```

- [ ] **Step 4: Update moved scheduled-task UI files to import types/constants from the new domain path**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-sidebar.tsx
import type { ScheduledTaskDefinition } from "../domain/scheduled-tasks";

// apps/atelier-desktop/src/features/scheduled-tasks/components/schedule-detail-panel.tsx
import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "../domain/scheduled-tasks";

// apps/atelier-desktop/src/features/scheduled-tasks/components/scheduled-task-form.tsx
import {
  type ScheduledSyncTemplate,
  type ScheduledTaskDefinition,
  SCHEDULED_TASK_ENGINE_SUPPORTED_SCHEDULE_TYPES,
} from "../domain/scheduled-tasks";
```

- [ ] **Step 5: Run domain tests to verify they pass**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts src/lib/scheduled-task-engine.test.ts`
Expected: PASS for the new domain test, then migrate the old test file into the feature path in the same change before finishing the task

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src/features/scheduled-tasks/domain apps/atelier-desktop/src/features/scheduled-tasks/components
git commit -m "refactor(atelier-desktop): move scheduled task domain types and engine"
```

### Task 3: Move sync-strategy prompt generation into feature domain and update `acme-sync`

**Files:**
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.ts`
- Modify: `apps/atelier-desktop/src/components/acme-sync.tsx:31-38`
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx:131-149,547-559`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts`

- [ ] **Step 1: Write the failing sync-strategy domain test at the new path**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts
import { describe, expect, it } from "vitest";

import { parseSyncStrategyMarkdown } from "./scheduled-task-sync-strategy";

describe("parseSyncStrategyMarkdown", () => {
  it("parses the v1 daily sync strategy markdown", () => {
    expect(
      parseSyncStrategyMarkdown({
        workspacePath: "/tmp/workspace",
        strategyMarkdown: "- run daily",
      }),
    ).toMatchObject({
      name: "@acme sync daily",
      frequency: "daily",
      cron: "0 9 * * *",
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts`
Expected: FAIL with module-not-found for `./scheduled-task-sync-strategy`

- [ ] **Step 3: Move the sync-strategy implementation and keep it pure**

```bash
git mv apps/atelier-desktop/src/lib/scheduled-task-sync-strategy.ts apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.ts
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.ts
import type { ScheduledTaskFormInput } from "../components/scheduled-task-form";
import type { ScheduledSyncTemplate } from "./scheduled-tasks";
import type { SyncProfile } from "~/lib/types";

// keep the remaining implementation unchanged
```

- [ ] **Step 4: Update `acme-sync.tsx` and `app-shell.tsx` to use the new feature domain path**

```ts
// apps/atelier-desktop/src/components/acme-sync.tsx
import {
  buildScheduledSyncTaskDraft,
  parseSyncStrategyMarkdown,
} from "~/features/scheduled-tasks/domain/scheduled-task-sync-strategy";

// apps/atelier-desktop/src/components/app-shell.tsx
import {
  parseSyncStrategyMarkdown,
  regenerateScheduledSyncTaskDraft,
} from "~/features/scheduled-tasks/domain/scheduled-task-sync-strategy";
```

- [ ] **Step 5: Run sync-strategy tests to verify they pass**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.ts apps/atelier-desktop/src/components/acme-sync.tsx apps/atelier-desktop/src/components/app-shell.tsx
git commit -m "refactor(atelier-desktop): move scheduled task sync strategy into feature domain"
```

### Task 4: Move store and workbench orchestration into feature-local model/services

**Files:**
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/model/scheduled-task-store.ts`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-workbench.ts`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-runner.ts`
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx:166-178,277-307,430-505,517-559,727-875`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/model/scheduled-task-store.test.ts`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts`

- [ ] **Step 1: Write the failing store and workbench tests at feature paths**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/model/scheduled-task-store.test.ts
import { describe, expect, it } from "vitest";

import { createScheduledTaskStore } from "./scheduled-task-store";

describe("createScheduledTaskStore", () => {
  it("creates a scheduled task with deterministic ids", () => {
    const store = createScheduledTaskStore({
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
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
        timezone: "UTC",
        enabled: true,
        jitterMinutes: 0,
      },
    });

    expect(task.id).toBe("sched-1");
  });
});
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts
import { describe, expect, it, vi } from "vitest";

import { createScheduledTaskWorkbench } from "./scheduled-task-workbench";

describe("createScheduledTaskWorkbench", () => {
  it("starts a run-now run through the runner", async () => {
    const workbench = await createScheduledTaskWorkbench({
      persistence: {
        load: vi.fn(async () => ({ tasks: [], runs: [] })),
        save: vi.fn(async () => undefined),
      },
      runner: {
        startScheduledRun: vi.fn(async () => ({
          linkedSessionId: null,
          linkedTaskId: "task-1",
          status: "running",
        })),
      },
      now: () => "2026-04-05T09:00:00.000Z",
      createId: () => "sched-1",
      createRunId: () => "run-1",
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
        timezone: "UTC",
        enabled: true,
        jitterMinutes: 0,
      },
    });

    const run = await workbench.runNow(task.id);
    expect(run.status).toBe("running");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/model/scheduled-task-store.test.ts src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts`
Expected: FAIL with module-not-found for the new feature-local store/workbench files

- [ ] **Step 3: Move store/workbench and add a feature-local runner interface**

```bash
git mv apps/atelier-desktop/src/lib/scheduled-task-store.ts apps/atelier-desktop/src/features/scheduled-tasks/model/scheduled-task-store.ts
git mv apps/atelier-desktop/src/lib/scheduled-task-workbench.ts apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-workbench.ts
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-runner.ts
export interface ScheduledTaskRunner {
  startScheduledRun(input: {
    scheduledTaskId: string;
    workspacePath: string;
    prompt: string;
    model: string;
    reason: "normal" | "catch_up" | "run_now";
  }): Promise<{
    linkedSessionId: string | null;
    linkedTaskId: string | null;
    status: "running" | "stalled_for_permission" | "failed" | "completed";
  }>;
}
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/model/scheduled-task-store.ts
import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "../domain/scheduled-tasks";

// keep the remaining implementation unchanged

// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-workbench.ts
import {
  buildCandidateSlots,
  findMostRecentMissedSlot,
  hasActiveRunForTask,
} from "../domain/scheduled-task-engine";
import { createScheduledTaskStore } from "../model/scheduled-task-store";
import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "../domain/scheduled-tasks";
import type { ScheduledTaskRunner } from "./scheduled-task-runner";

// keep the remaining implementation unchanged
```

- [ ] **Step 4: Update `app-shell.tsx` to import the feature-local workbench and types**

```ts
// apps/atelier-desktop/src/components/app-shell.tsx
import type {
  ScheduledTaskDefinition,
  ScheduledTaskRunRecord,
} from "~/features/scheduled-tasks/domain/scheduled-tasks";
import {
  createScheduledTaskWorkbench,
  ScheduledRunPersistenceError,
} from "~/features/scheduled-tasks/services/scheduled-task-workbench";
```

- [ ] **Step 5: Run moved store/workbench tests to verify they pass**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/model/scheduled-task-store.test.ts src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src/features/scheduled-tasks/model apps/atelier-desktop/src/features/scheduled-tasks/services apps/atelier-desktop/src/components/app-shell.tsx
git commit -m "refactor(atelier-desktop): move scheduled task store and workbench into feature"
```

### Task 5: Move persistence/import/Tauri wrappers behind feature-local service seams

**Files:**
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-persistence.ts`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-import.ts`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-tauri.ts`
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx:277-307`
- Modify: `apps/atelier-desktop/src/lib/tauri.test.ts:134-159`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-import.test.ts`

- [ ] **Step 1: Write the failing persistence and import tests at feature paths**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts
import { describe, expect, it, vi } from "vitest";

import { createScheduledTaskPersistence } from "./scheduled-task-persistence";

describe("createScheduledTaskPersistence", () => {
  it("returns an empty snapshot when the scheduled-task snapshot file is missing", async () => {
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

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-import.test.ts
import { describe, expect, it } from "vitest";

import { parseClaudeScheduledTaskSkillFile } from "./scheduled-task-import";

describe("parseClaudeScheduledTaskSkillFile", () => {
  it("extracts scheduled task metadata from SKILL frontmatter", () => {
    expect(
      parseClaudeScheduledTaskSkillFile({
        taskDirName: "daily-review",
        workspacePath: "/tmp/workspace",
        skillMarkdown: "---\nname: Daily review\ndescription: Review changes\n---\nRun daily",
      }),
    ).toMatchObject({
      name: "Daily review",
      description: "Review changes",
      importSource: "claude-desktop",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts src/features/scheduled-tasks/services/scheduled-task-import.test.ts`
Expected: FAIL with module-not-found for the feature-local service files

- [ ] **Step 3: Move persistence/import implementations and add a scheduled-task-specific Tauri adapter**

```bash
git mv apps/atelier-desktop/src/lib/scheduled-task-persistence.ts apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-persistence.ts
git mv apps/atelier-desktop/src/lib/scheduled-task-import.ts apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-import.ts
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-tauri.ts
import {
  listClaudeScheduledTaskFiles,
  readClaudeScheduledTaskFile,
  readScheduledTaskSnapshot,
  writeScheduledTaskSnapshot,
} from "~/lib/tauri";

export {
  listClaudeScheduledTaskFiles,
  readClaudeScheduledTaskFile,
  readScheduledTaskSnapshot,
  writeScheduledTaskSnapshot,
};

// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-persistence.ts
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

// keep the remaining implementation unchanged

// apps/atelier-desktop/src/features/scheduled-tasks/services/scheduled-task-import.ts
import type { ScheduledTaskImportDraft } from "../domain/scheduled-tasks";

// keep the remaining implementation unchanged
```

- [ ] **Step 4: Update `app-shell.tsx` to build scheduled-task persistence from the feature-local Tauri adapter**

```ts
// apps/atelier-desktop/src/components/app-shell.tsx
import {
  readScheduledTaskSnapshot,
  writeScheduledTaskSnapshot,
} from "~/features/scheduled-tasks/services/scheduled-task-tauri";
import { createScheduledTaskPersistence } from "~/features/scheduled-tasks/services/scheduled-task-persistence";
```

- [ ] **Step 5: Run feature-local service tests to verify they pass**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts src/features/scheduled-tasks/services/scheduled-task-import.test.ts src/lib/tauri.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src/features/scheduled-tasks/services apps/atelier-desktop/src/components/app-shell.tsx apps/atelier-desktop/src/lib/tauri.test.ts
git commit -m "refactor(atelier-desktop): move scheduled task persistence and import adapters"
```

### Task 6: Extract app-shell scheduled-task helpers into feature-local adapters and public API

**Files:**
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/services/load-sync-strategy-markdown.ts`
- Create: `apps/atelier-desktop/src/features/scheduled-tasks/index.ts`
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx:88-150,166-178,277-307,430-505,517-559,727-875`
- Modify: `apps/atelier-desktop/src/components/app-shell.test.tsx`
- Test: `apps/atelier-desktop/src/components/app-shell.test.tsx`

- [ ] **Step 1: Write the failing feature public API export test**

```ts
// add to apps/atelier-desktop/src/components/app-shell.test.tsx
import * as ScheduledTasksFeature from "~/features/scheduled-tasks";

it("exposes scheduled-task feature components through the feature root", () => {
  expect(ScheduledTasksFeature.ScheduleSidebar).toBeTypeOf("function");
  expect(ScheduledTasksFeature.ScheduleDetailPanel).toBeTypeOf("function");
});
```

- [ ] **Step 2: Run the focused app-shell test to verify it fails**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/app-shell.test.tsx`
Expected: FAIL because `~/features/scheduled-tasks` does not yet export the scheduled-task public API

- [ ] **Step 3: Create a feature public API and move the sync-strategy markdown loader out of `app-shell.tsx`**

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/services/load-sync-strategy-markdown.ts
import { getWorkspaceFileContent } from "~/lib/workspace";
import { parseSyncStrategyMarkdown } from "../domain/scheduled-task-sync-strategy";

export async function loadSyncStrategyMarkdown(mainPath: string): Promise<string | null> {
  const strategyFiles = ["SYNC_STRATEGY.md", "SYNC_STRAITEGY.md"] as const;

  for (const fileName of strategyFiles) {
    const strategyFile = await getWorkspaceFileContent(mainPath, fileName);

    if (!strategyFile.exists || strategyFile.isBinary || strategyFile.tooLarge) {
      continue;
    }

    const strategyDraft = parseSyncStrategyMarkdown({
      workspacePath: mainPath,
      strategyMarkdown: strategyFile.content,
    });

    return strategyDraft.prompt;
  }

  return null;
}
```

```ts
// apps/atelier-desktop/src/features/scheduled-tasks/index.ts
export { ScheduleSidebar } from "./components/schedule-sidebar";
export { ScheduleDetailPanel } from "./components/schedule-detail-panel";
export {
  ScheduledTaskForm,
  type ScheduledTaskFormInput,
} from "./components/scheduled-task-form";
export * from "./domain/scheduled-tasks";
export * from "./services/scheduled-task-workbench";
```

- [ ] **Step 4: Update `app-shell.tsx` to consume the feature root and feature-local loader**

```ts
// apps/atelier-desktop/src/components/app-shell.tsx
import {
  ScheduleDetailPanel,
  ScheduleSidebar,
  type ScheduledTaskDefinition,
  type ScheduledTaskRunRecord,
  type ScheduledTaskFormInput,
  createScheduledTaskWorkbench,
  ScheduledRunPersistenceError,
} from "~/features/scheduled-tasks";
import { loadSyncStrategyMarkdown } from "~/features/scheduled-tasks/services/load-sync-strategy-markdown";
```

- [ ] **Step 5: Run the app-shell test to verify it passes**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/app-shell.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src/features/scheduled-tasks/index.ts apps/atelier-desktop/src/features/scheduled-tasks/services/load-sync-strategy-markdown.ts apps/atelier-desktop/src/components/app-shell.tsx apps/atelier-desktop/src/components/app-shell.test.tsx
git commit -m "refactor(atelier-desktop): add scheduled task feature public API"
```

### Task 7: Add the scheduled-tasks backend module and move scheduled-task commands out of `file_ops`

**Files:**
- Create: `apps/atelier-desktop/src-tauri/src/features/scheduled_tasks/mod.rs`
- Create: `apps/atelier-desktop/src-tauri/src/features/scheduled_tasks/commands.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/features/mod.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/main.rs:13-22,78-83`
- Modify: `apps/atelier-desktop/src-tauri/src/features/file_ops/commands.rs:2185-2270`
- Modify: `apps/atelier-desktop/src-tauri/src/features/file_ops/mod.rs`
- Test: `apps/atelier-desktop/src/lib/tauri.test.ts`

- [ ] **Step 1: Write the failing frontend command wrapper test expectation for the new backend module path**

```ts
// apps/atelier-desktop/src/lib/tauri.test.ts
it("invokes scheduled task snapshot and Claude import commands", async () => {
  const {
    listClaudeScheduledTaskFiles,
    readClaudeScheduledTaskFile,
    readScheduledTaskSnapshot,
    writeScheduledTaskSnapshot,
  } = await import("./tauri");

  await readScheduledTaskSnapshot("scheduled-task-snapshot.json");
  await writeScheduledTaskSnapshot("scheduled-task-snapshot.json", '{"tasks":[]}');
  await listClaudeScheduledTaskFiles();
  await readClaudeScheduledTaskFile("daily-review");

  expect(invokeMock).toHaveBeenNthCalledWith(1, "read_scheduled_task_snapshot", {
    filePath: "scheduled-task-snapshot.json",
  });
});
```

- [ ] **Step 2: Run test to verify it still passes before the Rust move**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/tauri.test.ts`
Expected: PASS, confirming the frontend command names stay stable while Rust module ownership changes

- [ ] **Step 3: Create the new Rust module and move the scheduled-task commands**

```rust
// apps/atelier-desktop/src-tauri/src/features/scheduled_tasks/mod.rs
pub mod commands;

pub use commands::*;
```

```rust
// apps/atelier-desktop/src-tauri/src/features/scheduled_tasks/commands.rs
use std::{io::ErrorKind, path::{Path, PathBuf}};

fn resolve_task_snapshot_path_from_app_data_dir(
    app_data_dir: PathBuf,
    file_path: &str,
) -> Result<PathBuf, String> { /* move exact implementation from file_ops/commands.rs:2119-2141 */ }

fn resolve_task_snapshot_path<R: tauri::Runtime>(
    app_handle: &tauri::AppHandle<R>,
    file_path: &str,
) -> Result<PathBuf, String> { /* move exact implementation from file_ops/commands.rs:2143-2165 */ }

#[tauri::command]
pub fn read_scheduled_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
) -> Result<String, String> { /* move exact implementation from file_ops/commands.rs:2185-2194 */ }

#[tauri::command]
pub fn write_scheduled_task_snapshot<R: tauri::Runtime>(
    app_handle: tauri::AppHandle<R>,
    file_path: String,
    contents: String,
) -> Result<(), String> { /* move exact implementation from file_ops/commands.rs:2197-2212 */ }

fn claude_scheduled_tasks_dir() -> Result<PathBuf, String> { /* move exact implementation from file_ops/commands.rs:2214-2217 */ }
fn validate_claude_scheduled_task_dir_name(task_dir_name: &str) -> Result<&str, String> { /* move exact implementation from file_ops/commands.rs:2219-2234 */ }

#[tauri::command]
pub fn list_claude_scheduled_task_files() -> Result<Vec<String>, String> { /* move exact implementation from file_ops/commands.rs:2237-2258 */ }

#[tauri::command]
pub fn read_claude_scheduled_task_file(task_dir_name: String) -> Result<String, String> { /* move exact implementation from file_ops/commands.rs:2261-2270 */ }
```

- [ ] **Step 4: Update module registration and invoke imports in Rust**

```rust
// apps/atelier-desktop/src-tauri/src/features/mod.rs
pub mod scheduled_tasks;

// apps/atelier-desktop/src-tauri/src/main.rs
use features::scheduled_tasks::{
    list_claude_scheduled_task_files, read_claude_scheduled_task_file,
    read_scheduled_task_snapshot, write_scheduled_task_snapshot,
};
```

- [ ] **Step 5: Run frontend command-wrapper tests to verify they still pass**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/lib/tauri.test.ts`
Expected: PASS because Tauri command names remain unchanged

- [ ] **Step 6: Commit**

```bash
git add apps/atelier-desktop/src-tauri/src/features/scheduled_tasks apps/atelier-desktop/src-tauri/src/features/mod.rs apps/atelier-desktop/src-tauri/src/main.rs apps/atelier-desktop/src-tauri/src/features/file_ops
git commit -m "refactor(atelier-desktop): move scheduled task tauri commands into feature module"
```

### Task 8: Remove old scheduled-task source paths and finish migration cleanup

**Files:**
- Modify: `apps/atelier-desktop/src/components/app-shell.tsx`
- Modify: `apps/atelier-desktop/src/components/acme-sync.tsx`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-store.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-engine.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-sync-strategy.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-persistence.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-import.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-runner.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-task-workbench.ts`
- Delete: `apps/atelier-desktop/src/lib/scheduled-tasks.ts`
- Delete: old moved test files under `src/lib/` and `src/components/`
- Test: `apps/atelier-desktop/src/components/app-shell.test.tsx`
- Test: `apps/atelier-desktop/src/features/scheduled-tasks/**`

- [ ] **Step 1: Remove the last old scheduled-task imports from app-shell and acme-sync**

```ts
// apps/atelier-desktop/src/components/app-shell.tsx
import {
  ScheduleDetailPanel,
  ScheduleSidebar,
  type ScheduledTaskDefinition,
  type ScheduledTaskRunRecord,
  type ScheduledTaskFormInput,
  createScheduledTaskWorkbench,
  ScheduledRunPersistenceError,
} from "~/features/scheduled-tasks";

// apps/atelier-desktop/src/components/acme-sync.tsx
import {
  buildScheduledSyncTaskDraft,
  parseSyncStrategyMarkdown,
} from "~/features/scheduled-tasks/domain/scheduled-task-sync-strategy";
```

- [ ] **Step 2: Run scheduled-task-focused tests to catch any leftover old imports**

Run: `pnpm --dir apps/atelier-desktop exec vitest run src/components/app-shell.test.tsx src/features/scheduled-tasks/components/scheduled-task-form.test.tsx src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts src/features/scheduled-tasks/model/scheduled-task-store.test.ts src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts src/features/scheduled-tasks/services/scheduled-task-import.test.ts src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts`
Expected: FAIL if any import still points at removed `src/lib/scheduled-task*` files

- [ ] **Step 3: Delete the old scheduled-task source files and old duplicate test paths once all imports point at the feature tree**

```text
Delete these files:
- apps/atelier-desktop/src/lib/scheduled-task-store.ts
- apps/atelier-desktop/src/lib/scheduled-task-engine.ts
- apps/atelier-desktop/src/lib/scheduled-task-sync-strategy.ts
- apps/atelier-desktop/src/lib/scheduled-task-persistence.ts
- apps/atelier-desktop/src/lib/scheduled-task-import.ts
- apps/atelier-desktop/src/lib/scheduled-task-runner.ts
- apps/atelier-desktop/src/lib/scheduled-task-workbench.ts
- apps/atelier-desktop/src/lib/scheduled-tasks.ts
- apps/atelier-desktop/src/components/scheduled-task-form.test.tsx
- apps/atelier-desktop/src/lib/scheduled-task-store.test.ts
- apps/atelier-desktop/src/lib/scheduled-task-engine.test.ts
- apps/atelier-desktop/src/lib/scheduled-task-sync-strategy.test.ts
- apps/atelier-desktop/src/lib/scheduled-task-persistence.test.ts
- apps/atelier-desktop/src/lib/scheduled-task-import.test.ts
- apps/atelier-desktop/src/lib/scheduled-task-workbench.test.ts
```

- [ ] **Step 4: Run the full verification set**

Run: `pnpm --dir apps/atelier-desktop typecheck && pnpm --dir apps/atelier-desktop lint && pnpm --dir apps/atelier-desktop exec vitest run src/components/app-shell.test.tsx src/features/scheduled-tasks/components/scheduled-task-form.test.tsx src/features/scheduled-tasks/domain/scheduled-task-engine.test.ts src/features/scheduled-tasks/domain/scheduled-task-sync-strategy.test.ts src/features/scheduled-tasks/model/scheduled-task-store.test.ts src/features/scheduled-tasks/services/scheduled-task-persistence.test.ts src/features/scheduled-tasks/services/scheduled-task-import.test.ts src/features/scheduled-tasks/services/scheduled-task-workbench.test.ts src/lib/tauri.test.ts`
Expected: PASS for typecheck, lint, and the scheduled-task/frontend command wrapper test set

- [ ] **Step 5: Commit**

```bash
git add apps/atelier-desktop/src apps/atelier-desktop/src-tauri/src
git commit -m "refactor(atelier-desktop): finish scheduled task feature restructure"
```
