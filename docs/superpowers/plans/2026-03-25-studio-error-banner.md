# Studio Error Banner Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Studio runtime failures using a dedicated error banner and a better canonical runtime error message while keeping the transcript conversation-focused.

**Architecture:** Keep `workspaceState.error` as the canonical frontend failure state, following the current T3 Code pattern of separating error presentation from the transcript. Improve backend error selection in the Tauri Studio runner so the frontend receives one deterministic `runtime-error` string, then render that state in a dedicated banner above the transcript without converting runtime failures into transcript items.

**Tech Stack:** Rust (Tauri backend), React 19, TypeScript, Vitest, pnpm

---

## File Map

### Existing files to modify
- `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`
  - Add deterministic canonical error selection helpers and use them when emitting `runtime-error` for failed Studio runs.
  - Add or update Rust unit tests for canonical error selection and fallback behavior.
- `apps/atelier-desktop/src/components/active-session-panel.tsx`
  - Stop rendering `workspaceState.error` as a transcript message.
  - Render the new dedicated banner above `SessionTranscript`.
  - Clear the banner only when a new session run starts because `workspaceState` resets.
- `apps/atelier-desktop/src/components/active-session-panel.test.tsx`
  - Update existing expectations that currently look for runtime errors in transcript text.
  - Add tests for banner rendering and transcript isolation.
- `apps/atelier-desktop/src/components/session-workspace-state.test.ts`
  - Keep reducer semantics covered and add/adjust tests if banner lifecycle assumptions depend on state reset behavior.

### Existing files to reference while implementing
- `apps/atelier-desktop/src/components/session-workspace-state.ts`
  - Canonical connection/error state model.
- `apps/atelier-desktop/src/components/session-transcript.tsx`
  - Transcript scope; should remain conversation/status only.
- `apps/atelier-desktop/src/components/active-session-panel-state.ts`
  - Error wording helpers and composer/status behavior.
- `apps/atelier-desktop/src/lib/studio-events.ts`
  - Existing `runtime-error` frontend contract that must remain unchanged.

### External reference
- `../refs/t3code/apps/web/src/components/chat/ThreadErrorBanner.tsx`
  - External visual/structural reference only. Do not treat this as a repo-local dependency.

### New file to create
- `apps/atelier-desktop/src/components/session-error-banner.tsx`
  - Small reusable banner component for displaying `workspaceState.error` above the transcript.

---

### Task 1: Make backend canonical error selection deterministic

**Files:**
- Modify: `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`

- [ ] **Step 1: Write the failing Rust tests for canonical error selection**

Add focused unit tests near the existing `commands.rs` test module for these behaviors:
- structured runtime error candidate beats stderr and generic exit fallback
- tool/skill failure candidate beats stderr and generic exit fallback
- meaningful stderr beats generic exit fallback
- when multiple same-priority candidates exist, the last non-empty candidate wins
- blank and duplicate candidates are ignored

Use direct helper-level tests instead of full process-spawn integration tests.

- [ ] **Step 2: Run the Rust test target to verify the new tests fail for the expected reason**

Run:
```bash
cargo test --manifest-path apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- FAIL because the canonical error selection helpers/behavior do not exist yet or return the old generic behavior.

- [ ] **Step 3: Add minimal backend helpers for canonical error selection**

In `commands.rs`, add small focused helpers rather than spreading conditional logic inline through the session loop. Keep the structure local to this file unless it becomes unmanageable.

Implement:
- a small candidate model (priority + text) or equivalent helper functions
- deterministic candidate insertion/selection rules from the spec
- stderr filtering that only accepts non-empty, higher-signal stderr
- canonical error formatting that still emits the existing `{"type":"error","error":...}` payload shape

Do **not** redesign the stream protocol or add new frontend event types.

- [ ] **Step 4: Update Studio session exit handling to use the canonical error helpers**

Replace the old generic `build_session_exit_error_event_data` / stderr suffix composition path used for failed Studio session runs so the emitted `runtime-error` uses the best available candidate.

Keep the behavior scoped to Studio runtime/session failures. Do not refactor unrelated `/execute` behavior beyond what is required by shared helper usage.

- [ ] **Step 5: Run the Rust test target again to verify the new tests pass**

Run:
```bash
cargo test --manifest-path apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- PASS for the new canonical error selection tests.
- Existing `commands.rs` tests still pass.

- [ ] **Step 6: Commit the backend canonical error selection change**

```bash
git add apps/atelier-desktop/src-tauri/src/features/studio/commands.rs
git commit -m "fix: improve studio runtime error selection"
```

---

### Task 2: Add a dedicated Studio error banner component

**Files:**
- Create: `apps/atelier-desktop/src/components/session-error-banner.tsx`
- Modify: `apps/atelier-desktop/src/components/active-session-panel.tsx`
- Test: `apps/atelier-desktop/src/components/active-session-panel.test.tsx`

- [ ] **Step 1: Write the failing UI test for rendering the banner above the transcript**

In `active-session-panel.test.tsx`, add a test that starts a panel, triggers a `runtime-error`, and asserts:
- the error text is visible in the panel
- the transcript element still exists
- the error is rendered through the dedicated banner area rather than as a transcript message path

Give the new banner a stable selector such as `data-testid="session-error-banner"` so the test can assert structure, not just text.

- [ ] **Step 2: Run the single Vitest file to verify the new test fails for the expected reason**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- FAIL because the banner component/selector does not exist yet.

- [ ] **Step 3: Create the minimal `session-error-banner.tsx` component**

Implement a small banner component inspired by T3 Code's `ThreadErrorBanner`:
- prop: `error: string | null`
- render nothing when `error` is null
- render a compact alert/banner when `error` exists
- include `title={error}` or equivalent so full text remains accessible if the visible layout clamps
- use existing app styling primitives/patterns already present in Atelier; prefer `@acme/ui` components if they fit naturally

Keep it presentation-only.

- [ ] **Step 4: Integrate the banner into `active-session-panel.tsx`**

In `ActiveSessionPanel`:
- import and render `SessionErrorBanner` above `SessionTranscript`
- pass `workspaceState.error`
- remove the code path that appends `workspaceState.error` into `transcriptMessages`
- keep `emptyStateMessage` behavior only for empty/error states that still need the generic reopen guidance

Do not change how normal user/assistant/system-status transcript messages are produced.

- [ ] **Step 5: Run the single Vitest file again to verify the new test passes**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- PASS for the new banner test.
- Existing panel tests still pass or expose the next expected failures from transcript expectation changes.

- [ ] **Step 6: Commit the banner component and panel integration**

```bash
git add apps/atelier-desktop/src/components/session-error-banner.tsx apps/atelier-desktop/src/components/active-session-panel.tsx apps/atelier-desktop/src/components/active-session-panel.test.tsx
git commit -m "feat: add studio session error banner"
```

---

### Task 3: Update transcript-related tests to enforce separation of concerns

**Files:**
- Modify: `apps/atelier-desktop/src/components/active-session-panel.test.tsx`
- Modify: `apps/atelier-desktop/src/components/session-workspace-state.test.ts`

- [ ] **Step 1: Write/adjust failing tests that enforce transcript isolation**

Update or add tests so they explicitly verify:
- `runtime-error` continues to set `workspaceState.error`
- runtime failures are **not** inserted as transcript timeline items
- existing startup-failure expectations no longer rely on transcript rendering the error string as a system message
- the composer still disables and shows the same unavailable placeholder on failed sessions
- the banner clears when workspace state resets for a new session run

Keep reducer tests focused on state, and panel tests focused on rendering/placement.

- [ ] **Step 2: Run the targeted Vitest files to verify the adjusted tests fail for the expected reason**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/session-workspace-state.test.ts apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- FAIL until the new assertions and UI behavior fully align.

- [ ] **Step 3: Make the minimal test-alignment changes in implementation/state if needed**

Only make behavior changes that are required by the approved design, for example:
- ensure workspace reset on a new session run clears the banner naturally
- keep reducer behavior unchanged unless tests reveal an actual mismatch with the spec

Do not add transcript-side synthetic error messages.

- [ ] **Step 4: Run the targeted Vitest files again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/session-workspace-state.test.ts apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- PASS for reducer and panel tests covering error separation.

- [ ] **Step 5: Commit the transcript-isolation test updates**

```bash
git add apps/atelier-desktop/src/components/session-workspace-state.test.ts apps/atelier-desktop/src/components/active-session-panel.test.tsx apps/atelier-desktop/src/components/active-session-panel.tsx
git commit -m "test: enforce studio error banner behavior"
```

---

### Task 4: Run verification for the full implementation slice

**Files:**
- Modify: none expected unless verification reveals a legitimate issue

- [ ] **Step 1: Run the focused frontend test suite**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/active-session-panel.test.tsx apps/atelier-desktop/src/components/session-workspace-state.test.ts apps/atelier-desktop/src/lib/studio-events.test.ts
```

Expected:
- PASS

- [ ] **Step 2: Run the backend Rust test suite for Studio commands again**

Run:
```bash
cargo test --manifest-path apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- PASS

- [ ] **Step 3: Run app-local lint and typecheck**

Run:
```bash
pnpm --dir apps/atelier-desktop lint && pnpm --dir apps/atelier-desktop typecheck
```

Expected:
- PASS

- [ ] **Step 4: If verification fails, fix only the issue surfaced by verification and re-run the exact failing command**

Keep fixes minimal. Do not expand scope into unrelated cleanup.

- [ ] **Step 5: Commit the final verified state**

```bash
git add apps/atelier-desktop/src-tauri/src/features/studio/commands.rs apps/atelier-desktop/src/components/session-error-banner.tsx apps/atelier-desktop/src/components/active-session-panel.tsx apps/atelier-desktop/src/components/active-session-panel.test.tsx apps/atelier-desktop/src/components/session-workspace-state.test.ts
git commit -m "fix: show studio failures in a dedicated error banner"
```

---

## Notes for the implementing agent

- Keep the `runtime-error` frontend contract unchanged. This plan improves message quality, not event shape.
- Do not add runtime/tool failure entries to `SessionTranscript`.
- Prefer small helper functions in `commands.rs` so the canonical error selection is testable without spinning up a full child process.
- Follow the current Atelier testing style: Vitest for frontend unit/component tests and inline `#[cfg(test)]` module tests in Rust.
- Use `pnpm`, never `npm`/`yarn`/`bun`, per workspace rules.
