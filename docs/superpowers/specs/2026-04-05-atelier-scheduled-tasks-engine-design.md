# Atelier Scheduled Tasks Engine Design

## Summary

Add a first-class **Schedule** feature to Atelier Desktop that lets Atelier act as the local scheduled-task engine for Claude runs.

This feature will:
- add a top-level **Schedule** tab for managing recurring local tasks
- make Atelier the **scheduler engine**, **persistence owner**, and **run orchestrator** for scheduled tasks
- support full V1 local-task parity for Atelier-managed tasks: create, edit, delete, pause/resume, run now, history, permissions review/revoke, and worktree configuration
- integrate each scheduled run into Atelier's existing session/task surfaces so users can inspect transcripts, approvals, and changes inside the app
- support **one-time or explicit re-import** from Claude Desktop scheduled tasks, while keeping Atelier-native records as the source of truth after migration

## Problem

Atelier currently has task/workbench primitives and a workspace-centric desktop UI, but it does not have a real scheduling engine.

The Claude Code local scheduled tasks UX described in [scheduled-tasks.md](../../features/scheduled-tasks.md) covers:
- recurring schedules
- run history
- catch-up behavior after sleep/wake
- permission approvals
- worktree isolation
- detail pages and run-now actions

The required Atelier feature is not a thin viewer over Claude Desktop state. Atelier must **replace Claude Desktop's local scheduling role**.

That changes the problem from "surface Claude's scheduled tasks" to:
- define an Atelier-native scheduled-task model
- run a reliable local scheduling loop while the desktop app is open
- persist task definitions and run history locally
- orchestrate scheduled executions into Atelier's existing runtime/session model
- optionally import tasks from Claude Desktop without depending on Claude Desktop as the ongoing engine

## Goals

- Make Atelier the local scheduled-task engine for recurring Claude runs.
- Preserve a Claude-like mental model for local scheduled tasks where it is useful.
- Keep the scheduling system workspace-aware and integrated with Atelier's existing desktop UX.
- Support full V1 local task management: CRUD, run now, pause/resume, history, permissions, worktree.
- Support missed-run detection, deterministic jitter, and single catch-up execution for the most recent missed slot.
- Ensure scheduled runs are inspectable and actionable through Atelier's existing run/session UI.
- Allow migration from Claude Desktop scheduled tasks into Atelier-native storage.

## Non-goals

- Remote/cloud scheduled tasks.
- A background daemon that keeps scheduling while Atelier is fully closed.
- Two-way continuous sync with Claude Desktop scheduled task files.
- Distributed or multi-device scheduling coordination.
- Advanced overlap policies beyond a simple V1 default.
- Parsing prompt text to make semantic timing decisions automatically.

## V1 Decisions

### 1. Atelier is the engine, not Claude Desktop

Atelier owns:
- schedule evaluation
- due-run creation
- missed-run handling
- run history persistence
- execution orchestration

Claude Desktop is never the runtime source of truth for Atelier-managed scheduled tasks.

### 2. Atelier uses native storage after import

Claude Desktop tasks may be imported, but after import the Atelier-native scheduled task definition becomes the source of truth.

There is no continuous bidirectional sync in V1.

### 3. Schedule is a top-level app surface

Atelier gets a dedicated **Schedule** tab rather than burying scheduled tasks inside the current Chats sidebar.

This keeps the feature discoverable and matches the expectation that scheduling is a first-class workflow.

### 4. Runs are fully integrated into Atelier

A scheduled run is not just a history row. Each run links into Atelier's existing session/task execution surfaces so users can:
- read transcripts
- inspect tool activity
- resolve permission stalls
- review changes

### 5. Overlap policy defaults to skip

If a scheduled task is already running when its next slot becomes due, Atelier skips the overlapping run in V1.

This keeps behavior predictable and avoids multiplying concurrent sessions for the same automation.

### 6. Catch-up policy mirrors local desktop semantics

When the app resumes after sleep/offline time, Atelier checks the last seven days for missed runs and schedules **only the most recent missed slot** as a catch-up run.

Older missed slots are discarded.

## Architecture

The feature is split into five layers.

### 1. Schedule Engine

Responsible for:
- periodic schedule evaluation
- deterministic jitter application
- missed-run detection
- catch-up selection
- overlap policy enforcement
- enqueuing due runs for execution

This layer does not render UI and does not directly manage transcripts. It decides **when** a run should exist.

### 2. Task Definition Store

Responsible for Atelier-native persistence of:
- scheduled task definitions
- remembered permission approvals for each scheduled task
- schedule runtime metadata such as next run and last-run timestamps
- import provenance

This layer owns the durable task configuration that survives app restarts.

### 3. Run Store

Responsible for per-run persistence:
- scheduled slot
- actual execution start/finish times
- run reason
- run status
- linked Atelier entities
- error summaries

This layer exists separately from task definitions so that task configuration and execution history evolve independently.

### 4. Run Orchestrator

Responsible for taking a due run and turning it into an actual Atelier execution by:
- preparing workspace context
- resolving worktree requirements
- resolving permission mode and remembered approvals
- creating or linking execution/session state
- streaming lifecycle updates back into run history

This layer decides **how** a run is executed.

### 5. Schedule UI Surface

Responsible for:
- Schedule tab navigation
- list/detail management UX
- create/edit forms
- history and permissions views
- import/migration UX
- deep linking to integrated run views

## Storage Model

Atelier uses native file-backed local persistence for V1.

### Scheduled task definition record

Each scheduled task definition stores:

- **Identity**
  - `id`
  - `name`
  - `description`
  - `workspacePath`

- **Prompt and execution config**
  - `prompt`
  - `model`
  - `permissionMode`
  - `worktree.enabled`
  - `worktree` execution metadata needed by the orchestrator

- **Schedule config**
  - `scheduleType` (`manual`, `hourly`, `daily`, `weekdays`, `weekly`, `custom-cron`)
  - `cron`
  - `timezone`
  - `enabled`
  - `jitterPolicy`

- **Runtime summary**
  - `nextRunAt`
  - `lastScheduledAt`
  - `lastStartedAt`
  - `lastFinishedAt`
  - `lastMissedAt`
  - `engineState` (`idle`, `queued`, `running`, `paused`, `stalled`)

- **Permissions snapshot**
  - remembered approvals scoped to this scheduled task

- **Audit**
  - `createdAt`
  - `updatedAt`
  - `importSource`
  - `importedAt`

### Scheduled task run record

Each scheduled run stores:
- `runId`
- `scheduledTaskId`
- `scheduledFor`
- `startedAt`
- `finishedAt`
- `status` (`queued`, `preparing`, `running`, `stalled_for_permission`, `failed`, `completed`, `cancelled`, `skipped`)
- `reason` (`normal`, `catch_up`, `run_now`, `missed_skip`, `overlap_skip`)
- `linkedSessionId`
- `linkedTaskId`
- `errorSummary`
- optional run summary fields for list/detail rendering

### Persistence shape

V1 should keep scheduled task definitions and run history in Atelier-managed local files, similar in spirit to the app's current file-backed task/workbench persistence.

This keeps the system easy to inspect, debug, and test before introducing a database.

## Import and Migration Strategy

### Import source

Atelier may scan Claude Desktop scheduled task files under `~/.claude/scheduled-tasks/*` and parse them as import candidates.

### Import flow

1. Detect available Claude Desktop scheduled tasks.
2. Present them in an import review surface.
3. Let the user import all tasks or selected tasks.
4. Convert each imported task into the Atelier-native scheduled task definition format.
5. Mark imported records with `importSource: claude-desktop` and `importedAt`.

### Post-import ownership

Once a task is imported:
- Atelier-native storage becomes the only active source of truth for that imported task within Atelier.
- Claude Desktop changes are not mirrored automatically.
- Re-import is explicit and user-triggered.

### Drift handling

If Claude Desktop files change after import, Atelier treats them as external drift.

V1 behavior:
- surface that drift in the import/review UI when detected
- offer explicit choices to keep Atelier's version, re-import as an update, or import as a separate task
- never merge silently

### Double-run prevention

Because Atelier is the engine, the UI should warn users to disable the corresponding Claude Desktop task after import to avoid duplicate automation.

## Engine Behavior

## Scheduling loop

Atelier runs a scheduler loop while the desktop app is open.

V1 behavior:
- tick frequency: once per minute
- each tick evaluates all enabled scheduled task definitions
- each tick computes the next eligible slot for each task, applies jitter, determines whether a normal run or catch-up run is due, and enqueues due runs

The loop must be idempotent. Re-running the same tick after reload or restart must not create duplicate runs for the same scheduled slot.

## Deterministic jitter

Recurring tasks should not all fire exactly on the nominal minute.

V1 behavior:
- derive a fixed offset from stable task identity, such as `scheduledTaskId`
- use the same offset for the same task every time
- cap recurring-task jitter at **10 minutes** for recurring schedules
- do not apply jitter to manual `Run now` executions

## Missed runs and catch-up

When Atelier starts up or resumes from sleep, it checks whether a scheduled task missed any runs in the last seven days.

V1 behavior:
- if no runs were missed, do nothing
- if one or more runs were missed, enqueue exactly one catch-up run for the **most recent missed slot**
- discard older missed slots

Catch-up runs store:
- `reason: catch_up`
- `scheduledFor` equal to the most recent missed slot
- `startedAt` equal to the current execution time

## Overlap policy

If a scheduled task already has an active run when its next slot becomes due, the overlapping slot is not executed.

V1 behavior:
- record the skipped overlap in run history as `overlap_skip`
- leave the original run untouched
- do not queue multiple overlapping instances of the same scheduled task

## Run-now behavior

`Run now` bypasses the schedule.

V1 behavior:
- creates a run with `reason: run_now`
- skips jitter
- does not rewrite the schedule definition
- may update runtime summary timestamps as appropriate

## Runtime context passed to executions

The orchestrator should pass runtime metadata into each scheduled execution so the downstream prompt/session layer can distinguish timing-sensitive runs.

At minimum this should include:
- scheduled time
- actual start time
- run reason
- whether the run is a catch-up run

Atelier does not interpret the prompt body to decide whether to skip a late run.

## Run Lifecycle

Each scheduled run moves through a defined lifecycle:
- `queued`
- `preparing`
- `running`
- `stalled_for_permission`
- `failed`
- `completed`
- `cancelled`
- `skipped`

Lifecycle flow:
1. Scheduler determines a run is due.
2. Run store records a new scheduled run.
3. Orchestrator prepares workspace, worktree, permissions, and execution context.
4. Atelier spawns or links the native execution entity.
5. Execution state updates stream back into the run record.
6. Completion, failure, stall, or skip are persisted in history.

## UI and UX

## Navigation

Add a new top-level **Schedule** tab in the app shell.

This tab is the primary control plane for scheduled tasks.

## Schedule tab layout

Use a two-pane layout.

### Left pane

Contains:
- search input
- scheduled tasks grouped by workspace
- per-task summary: enabled/paused state, next run, last run status
- quick actions such as `Run now` and `Pause/Resume`

### Right pane

Shows either:
- an empty state with create/import calls to action, or
- the selected scheduled task detail page

## Create/Edit form

The create/edit form should include these sections:

1. **Basic**
   - name
   - description
   - workspace/folder

2. **Prompt**
   - prompt editor
   - model
   - permission mode

3. **Execution**
   - worktree toggle
   - worktree-related execution options required by Atelier

4. **Frequency**
   - Manual
   - Hourly
   - Daily
   - Weekdays
   - Weekly
   - Custom cron

5. **Preview and guidance**
   - human-readable next run preview
   - jitter note
   - missed-run/catch-up behavior note

## Detail page

The scheduled task detail page should include:

### Header
- task name
- workspace
- enabled/paused state
- next run
- last run summary
- imported-from-Claude badge when applicable

### Action bar
- Run now
- Pause/Resume
- Edit
- Delete

### Tabs
1. **Overview**
   - prompt preview
   - schedule summary
   - model
   - permission mode
   - worktree setting
   - jitter and catch-up summary

2. **Runs**
   - history table with status, reason, scheduled time, actual time, duration, summary/error, and link to the integrated run/session

3. **Permissions**
   - remembered approvals
   - revoke individual approval
   - revoke all approvals for the scheduled task

4. **Config**
   - editable configuration entry point or structured config view

## Run history UX

Run history must distinguish clearly among:
- normal recurring runs
- catch-up runs
- manual run-now executions
- skipped runs
- stalled runs
- failed runs

Each row should make it easy to open the corresponding integrated run.

## Integrated run view

A scheduled run links directly into Atelier's native execution/session surfaces.

Users should be able to:
- inspect thread/transcript content
- inspect tool activity
- handle permission stalls from the app
- review changes produced by the run

The Schedule tab is the control plane; detailed run inspection should reuse existing Atelier execution surfaces when possible.

## Import UX

If Claude Desktop scheduled tasks are detected, the Schedule surface should show an import/review entry point that allows:
- reviewing detected tasks
- importing selected tasks
- importing all tasks
- seeing migration provenance after import

After import, the UI should warn that the Claude Desktop version should be disabled to avoid duplicate runs.

## Testing Strategy

V1 should be built with test-first coverage across four layers.

### 1. Domain tests

Cover:
- cron resolution
- deterministic jitter
- next-run calculation
- seven-day missed-run scan
- most-recent-missed-slot selection
- overlap-skip policy
- import conversion from Claude format into Atelier-native records

### 2. Persistence tests

Cover:
- definition read/write round-trips
- run history read/write round-trips
- migration snapshots
- permission revoke persistence
- edit/delete consistency

### 3. Engine/orchestrator tests

Cover:
- scheduler tick creating due runs
- no duplicate run for the same slot after restart/reload
- run now bypassing jitter
- pause/resume behavior
- permission stalls transitioning into `stalled_for_permission`
- mapping scheduled runs to linked Atelier session/task entities

### 4. UI tests

Cover:
- Schedule tab rendering
- create/edit form behavior and validation
- run-history badges and detail navigation
- permissions revoke flows
- import banner/review flow
- integrated run opening behavior

## Rollout Scope for V1

### In scope

- top-level Schedule tab
- Atelier-native scheduled task definitions
- local file-backed persistence
- create, edit, delete, pause, resume
- run now
- one-minute scheduler loop while app is open
- deterministic jitter
- seven-day missed-run scan and single catch-up run
- run history
- permission review and revoke
- worktree configuration
- integrated run/session linkage
- import from Claude Desktop scheduled tasks

### Out of scope

- background scheduling when Atelier is closed
- remote/cloud tasks
- continuous sync with Claude Desktop after import
- advanced overlap/concurrency strategies beyond V1 skip-overlap
- automatic prompt-aware skip logic
- multi-device coordination

## Risks

- Time calculations may become incorrect around timezone boundaries or DST transitions.
- A weak idempotency design could create duplicate runs for the same scheduled slot.
- Import drift could confuse users if Claude Desktop tasks remain enabled after migration.
- Integrated run linking could become brittle if the current session/task model boundaries are unclear.
- Permission snapshot and revoke behavior must have a single clear source of truth.

## Mitigations

- Normalize schedule calculations around explicit local timezone handling.
- Persist enough slot identity to make scheduler ticks idempotent.
- Make import provenance explicit and warn users to disable legacy Claude tasks after migration.
- Keep run records separate from definitions so UI and orchestration responsibilities remain clear.
- Reuse existing Atelier execution surfaces where possible instead of building a second run viewer.

## Recommendation

Implement scheduled tasks in Atelier as a dedicated local scheduling engine with Atelier-native persistence, explicit Claude Desktop import, and deep integration into the app's existing execution surfaces.

This keeps the product aligned with the desired Claude-like UX while giving Atelier full ownership over scheduling behavior, runtime orchestration, and future extension.