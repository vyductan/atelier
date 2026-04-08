# Scheduled Tasks Feature Restructure Design

## Goal

Restructure `apps/atelier-desktop` so the scheduled-tasks capability is organized as a single end-to-end feature boundary instead of being split across flat `src/components/` and `src/lib/` folders. The new structure should make ownership clearer, reduce cross-folder hunting, and establish a repeatable pattern for future feature-based refactors.

## Current Context

The current app already exposes a natural product split between the top-level entry in [src/app.tsx](../../src/app.tsx) and the app workspace composition in [src/components/app-shell.tsx](../../src/components/app-shell.tsx):

- session workspace
- scheduled tasks work
- `@acme` sync
- Claude/global config
- skills management

On the backend, Tauri Rust code is already organized under `src-tauri/src/features/...`, but the frontend still mixes domain files across shared-looking folders such as `src/components/` and `src/lib/`.

For scheduled tasks specifically, the current code is spread across UI, state, and domain/IO helpers, including files such as:

- `src/components/schedule-list-item.tsx`
- `src/components/schedule-sidebar.tsx`
- `src/components/schedule-detail-panel.tsx`
- `src/components/scheduled-task-form.tsx`
- `src/lib/scheduled-task-store.ts`
- `src/lib/scheduled-task-engine.ts`
- `src/lib/scheduled-task-runner.ts`
- `src/lib/scheduled-task-persistence.ts`
- `src/lib/scheduled-task-import.ts`
- `src/lib/scheduled-task-sync-strategy.ts`
- `src/lib/scheduled-task-workbench.ts`
- `src/lib/scheduled-tasks.ts`

This spread makes the feature harder to reason about because the code is grouped by file type instead of by feature ownership.

## Design Decision

Use a feature-first structure for **scheduled tasks first**, and do it **end-to-end**:

- move React UI, state, domain logic, and side-effect orchestration for scheduled tasks into `src/features/scheduled-tasks/`
- create a matching Tauri backend feature boundary under `src-tauri/src/features/scheduled_tasks/`
- keep app-level composition files outside the feature
- avoid long-lived compatibility shims for old import paths

This is a hybrid migration strategy: start with the scheduled-tasks feature as the first complete slice, then use the same pattern for later features if it proves successful.

## Rejected Alternatives

### 1. Big-bang whole-app restructure

Restructure all frontend and backend features at once.

**Why rejected:** too much surface area for a first feature-based migration, higher import churn, and harder review.

### 2. UI-only or frontend-only scheduled-tasks regrouping

Move only JSX files first and defer state/domain/backend boundaries.

**Why rejected:** it would create a feature folder that only looks organized while business logic and IO stay scattered.

### 3. Keep scheduled-task files under shared `lib/`

Treat the current domain logic as generic shared infrastructure.

**Why rejected:** the naming and ownership are feature-specific, not truly shared. Leaving them in `lib/` hides the real boundary.

## Target Structure

### Frontend

```text
src/
  app.tsx
  components/
    app-shell.tsx
    toaster.tsx
    ...shared app-level UI only
  features/
    scheduled-tasks/
      components/
        schedule-list-item.tsx
        schedule-sidebar.tsx
        schedule-detail-panel.tsx
        scheduled-task-form.tsx
      model/
        scheduled-task-store.ts
      services/
        scheduled-task-engine.ts
        scheduled-task-runner.ts
        scheduled-task-persistence.ts
        scheduled-task-import.ts
      domain/
        scheduled-tasks.ts
        scheduled-task-workbench.ts
        scheduled-task-sync-strategy.ts
      index.ts
```

### Backend

```text
src-tauri/src/features/
  scheduled_tasks/
    mod.rs
    commands.rs
    models.rs
```

Add `service.rs` only if native scheduled-tasks logic grows enough to justify a second internal layer. Do not create it preemptively.

## File Ownership Rules

### `components/`

A file belongs in `components/` when it:

- renders JSX
- accepts props
- handles presentation and user interaction
- does not perform persistence, process execution, or direct Tauri command orchestration

Expected files:

- `schedule-list-item.tsx`
- `schedule-sidebar.tsx`
- `schedule-detail-panel.tsx`
- `scheduled-task-form.tsx`

### `model/`

A file belongs in `model/` when it:

- owns feature state
- exposes actions/selectors for UI
- coordinates transitions between user intent and service calls

Expected file:

- `scheduled-task-store.ts`

### `services/`

A file belongs in `services/` when it:

- performs side effects
- reads or writes persisted data
- imports/exports data
- invokes Tauri/native capabilities
- orchestrates execution flow

Expected files:

- `scheduled-task-engine.ts`
- `scheduled-task-runner.ts`
- `scheduled-task-persistence.ts`
- `scheduled-task-import.ts`

### `domain/`

A file belongs in `domain/` when it:

- contains pure business logic
- has no React dependency
- has no persistence or runtime side effects
- can be unit tested in isolation

Expected files:

- `scheduled-tasks.ts`
- `scheduled-task-workbench.ts`
- `scheduled-task-sync-strategy.ts`

If `scheduled-task-workbench.ts` or `scheduled-task-sync-strategy.ts` turn out to perform IO or runtime orchestration during implementation, they should move to `services/` instead. The rule is based on behavior, not filename.

### App-level files that stay outside the feature

These remain outside `src/features/scheduled-tasks/` because they compose or support the overall application:

- `src/app.tsx`
- `src/components/app-shell.tsx`
- `src/components/toaster.tsx`
- any truly shared UI primitives
- any truly shared Tauri adapter used by multiple features

## Data Flow

The scheduled-tasks feature should follow this direction:

```text
UI component → model/store action → service → Tauri/native IO → service normalization → model update → UI rerender
```

### Rules implied by this flow

- components must not call persistence or runner code directly
- components should express user intent, not own side effects
- the model layer owns feature state transitions
- the service layer owns orchestration and external boundaries
- the domain layer stays pure and framework-agnostic

### Tauri listeners and push events

Scheduled tasks may also need the reverse direction, where the backend pushes run-state changes back into the frontend during background execution.

```text
Tauri event/listener → service event adapter → model update → UI rerender
```

Rules for this push path:

- Tauri `listen()` registration must live in the scheduled-tasks service layer, not in presentation components
- the preferred home is `services/scheduled-task-runner.ts`; if listener logic becomes large, split it into `services/scheduled-task-events.ts`
- listener callbacks should normalize backend payloads before updating the model layer
- components should consume derived state from the model layer rather than handling raw Tauri events

## Frontend Public API

Create `src/features/scheduled-tasks/index.ts` as the feature’s public entry point.

External consumers should import from the feature root rather than deep internal paths, for example:

```ts
import { ScheduledTasksView } from "~/features/scheduled-tasks";
```

The feature root may re-export:

- the main scheduled-tasks screen/container
- selected public types if needed outside the feature
- store hooks only if they are intentionally public

Do not let outside code import internal files like:

- `features/scheduled-tasks/components/...`
- `features/scheduled-tasks/services/...`
- `features/scheduled-tasks/domain/...`

## Dependency Direction Rules

Within the frontend feature, dependencies should move in one direction:

- `components` → `model`, `domain`
- `model` → `services`, `domain`
- `services` → `domain`
- `domain` → nothing else in the feature

Forbidden examples:

- `domain` importing React, Zustand, or Tauri helpers
- `services` importing JSX components
- `components` importing persistence/runner/engine modules directly

## Cross-Feature Import Rules

Features should be isolated by default.

- one feature must not import internal files from another feature
- if cross-feature integration is required, Feature A may only import Feature B through Feature B’s public API, typically `~/features/<feature-name>/index.ts`
- if a feature does not yet expose a stable public API, integration should happen through an app-level composition boundary or a truly shared abstraction instead of deep imports

Allowed example:

```ts
import { useWorkspaceStore } from "~/features/workspace";
```

Forbidden examples:

```ts
import { something } from "~/features/workspace/services/internal-module";
import { otherThing } from "~/features/workspace/components/private-component";
```

## Backend Boundary Rules

Create `src-tauri/src/features/scheduled_tasks/` as the backend boundary for this feature.

### `commands.rs`

Contains the Tauri commands that define the public native interface for scheduled tasks.

### `models.rs`

Contains request/response DTOs and serialized models exchanged with the frontend.

### `mod.rs`

Contains module wiring and public exports for the scheduled-tasks backend feature.

The backend should expose a stable feature boundary rather than leaving scheduled-tasks behavior mixed into unrelated modules.

## Testing Strategy

Tests should move with the feature so ownership stays obvious.

### Target test organization

```text
src/features/scheduled-tasks/
  components/
    scheduled-task-form.test.tsx
  model/
    scheduled-task-store.test.ts
  services/
    scheduled-task-engine.test.ts
    scheduled-task-import.test.ts
    scheduled-task-persistence.test.ts
  domain/
    scheduled-task-sync-strategy.test.ts
    scheduled-task-workbench.test.ts
```

### Test expectations by layer

- `domain/`: pure unit tests
- `services/`: orchestration and side-effect boundary tests
- `model/`: state transition and selector tests
- `components/`: rendering and interaction contract tests
- app-level shell tests: keep enough coverage to ensure scheduled-tasks still mounts correctly through app composition

### Preferred frontend testing seams

Use mocking seams that match the feature boundary.

- component tests should prefer mocking at the `model/` or `services/` boundary rather than mocking raw Tauri `invoke()` calls directly
- service tests are the appropriate place to mock Tauri command wrappers or `invoke()` behavior
- during migration, existing tests that mock current `src/lib/tauri` boundaries may remain temporarily, but new or updated scheduled-tasks tests should move toward feature-local seams

This keeps UI tests decoupled from Tauri details while still allowing service-layer tests to verify native integration behavior.

The refactor should preserve behavior. Tests should primarily prove that imports and responsibility boundaries changed without functional regressions.

## Migration Strategy

Use incremental vertical slices rather than a single large move.

### Phase 1 — Create feature shell

- create `src/features/scheduled-tasks/`
- add `index.ts`
- move the scheduled-tasks UI components first
- update `app.tsx` and app-level composition imports

### Phase 2 — Move model and pure domain logic

- move `scheduled-task-store.ts`
- move `scheduled-tasks.ts`
- move `scheduled-task-workbench.ts`
- move `scheduled-task-sync-strategy.ts`
- update tests and imports

### Phase 3 — Move side-effect services

- move engine, runner, persistence, and import logic into `services/`
- remove old `src/lib/scheduled-task-*` references
- keep any shared adapters only if they are truly multi-feature

### Phase 4 — Align the Tauri backend

- create `src-tauri/src/features/scheduled_tasks/`
- move related commands/models into the new feature
- update feature registration and imports
- route frontend scheduled-tasks calls through the new backend boundary

### Phase 5 — Cleanup

- remove obsolete paths and imports
- remove any temporary compatibility exports that are no longer needed
- run lint, typecheck, and relevant tests

## Migration Guardrails

The migration is only considered successful if all of the following are true:

1. no scheduled-tasks UI component imports old scheduled-task files from `src/lib/`
2. scheduled-tasks logic is understandable from its feature subtree without repo-wide treasure hunting
3. app-level composition remains outside the feature
4. old import paths are removed after callers are updated
5. the backend boundary for scheduled tasks is explicit rather than hidden inside unrelated modules

## Success Criteria

The restructure is successful when:

- scheduled-tasks becomes the first clearly owned end-to-end feature in the app
- frontend and backend naming are aligned (`scheduled-tasks` in TS, `scheduled_tasks` in Rust)
- imports become easier to predict and audit
- tests live with the code they protect
- future features can follow the same pattern without inventing a new directory strategy

## Non-Goals

This refactor does **not** aim to:

- restructure the entire app in one pass
- redesign scheduled-tasks product behavior
- introduce new shared abstractions prematurely
- create generic `shared/`, `utils/`, or `service/` buckets without clear ownership
- keep long-lived backward-compatibility shims for old file paths
