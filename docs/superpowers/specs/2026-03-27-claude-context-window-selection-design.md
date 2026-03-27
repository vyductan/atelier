# Claude Context Window Selection Design

## Summary

Add Claude context window selection support to Atelier Desktop, closely mirroring the T3 Code reference behavior while fitting Atelier's current desktop architecture.

This feature will:
- expose a **Context Window** selector in session controls, as close as practical to T3 Code's traits/session-options placement
- support a **global default** and a **per-session override**
- persist the global default through Atelier's existing `~/.claude/settings.json` workflow
- persist the per-session override across reopen/resume through Atelier session metadata/indexing
- apply the setting as real Claude Code runtime behavior using Claude Code's documented **model selection** contract (`--model`, `/model`, `[1m]`), not a custom context-window flag

## Problem

Atelier's roadmap explicitly calls out Claude context window selection support and references the T3 Code implementation.

Atelier currently has no context window selector, no Claude capability metadata, and no explicit model-selection layer. The current session start pipeline only carries:
- `sessionId`
- `projectPath`
- `firstPrompt`
- `resumeSessionId`

Relevant current entry points:
- `apps/atelier-desktop/src/components/active-session-panel.tsx`
- `apps/atelier-desktop/src/lib/atelier-client.ts`
- `apps/atelier-desktop/src/lib/studio.ts`
- `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`

Atelier also auto-starts new sessions when `ActiveSessionPanel` mounts, which means there is no separate pre-start setup step today.

Atelier does already have a global Claude configuration UI, but it currently only manages permissions lists:
- `apps/atelier-desktop/src/components/claude-global-config.tsx`
- `apps/atelier-desktop/src-tauri/src/features/file_ops/commands.rs`

## Reference Pattern

Use the current T3 Code structure as the model:
- capability-driven context-window options
- selector rendered in traits/session controls only when multiple options exist
- default + user-level global preference + per-session override
- early normalization of the effective value
- runtime-edge translation from a semantic context-window choice into provider-specific execution behavior

Atelier will preserve those behaviors while adapting persistence and UI placement to its current desktop session flow.

## Goals

- Mirror T3 Code intent and behavior for Claude context window selection.
- Support a global default and a per-session override.
- Only render the selector when the current Claude base model supports multiple context-window options.
- Keep precedence deterministic and easy to reason about.
- Ensure runtime execution actually consumes the effective value.
- Stay aligned with official Claude Code behavior rather than inventing a custom runtime flag.

## Non-goals

- Building a full multi-provider model-selection framework.
- Redesigning the existing session header, composer, or transcript layout.
- Reworking Atelier's whole session lifecycle beyond the minimum needed to support this feature.
- Adding unrelated Claude traits or controls.
- Copying T3 Code stores or architecture 1:1.

## V1 Decisions

### 1. Per-session override persists across reopen/resume

V1 will persist the per-session override across reopen/resume by extending Atelier's session metadata/indexing. This is not optional in V1.

Reasoning:
- the requested behavior is to stay close to T3 Code
- a session-specific override that disappears when reopening would feel inconsistent
- Atelier already has a session index model that can be extended

### 2. New-session auto-start stays, but the selector still works

Atelier will keep its current auto-start flow for new sessions.

Implications:
- the initial launch for a brand-new session uses the resolved effective value available at mount time
- for new sessions started from normal sidebar flows, the first launch uses the global default unless a draft override was seeded before mount
- the selector lives in session controls and remains visible after connection
- if the user changes it on an active session, Atelier applies the change using Claude Code's documented `/model` command

This keeps the feature scoped while staying as close as practical to the T3 Code placement and behavior.

### 3. Claude Code model selection is the runtime contract

Atelier will implement context-window support through Claude Code's documented model-selection contract:
- startup: `claude --model <alias|name>`
- active session: `/model <alias|name>`
- 1M variant syntax: `[1m]`

Examples:
- `claude-opus-4-6`
- `claude-opus-4-6[1m]`
- `opus`
- `opus[1m]`

Atelier will **not** invent a separate Claude runtime flag such as `--context-window`.

### 4. Resume behavior is explicit

Atelier will **not** rely on undocumented `--resume <id> --model ...` semantics to override the resumed session at process start.

Instead:
- resume continues to use `--resume <id>`
- after the session reconnects, if Atelier's desired model differs from the session's stored effective model, Atelier sends the documented `/model <alias|name>` command immediately

This makes resume behavior explicit and keeps it within documented Claude Code behavior.

### 5. A known base Claude model is required

Context-window support requires a known base model.

V1 resolves the base model from:
1. stored session metadata for an existing session
2. otherwise the explicit global Claude `model` setting in `~/.claude/settings.json`

If no explicit base model is known, Atelier will hide or disable the selector rather than guessing.

## Approach

### 1. Add a single source of truth for Claude context-window capabilities

Add one checked-in capability resource that defines:
- supported Claude base models for Atelier
- the supported context-window options for each model
- labels
- which option is the default

This resource should be consumed by both frontend and backend so UI rendering and runtime validation cannot drift apart.

Atelier should not hardcode `200k` / `1M` values in multiple files.

### 2. Treat global default as part of the official Claude `model` setting

Claude Code's official configuration surface uses `model`, not a separate `contextWindow` setting.

So the global default in Atelier should be implemented by editing the global Claude `model` value in `~/.claude/settings.json`:
- base model form for default context window
- `[1m]` suffixed form for 1M

Examples:
- `claude-opus-4-6`
- `claude-opus-4-6[1m]`

This means the global config UI must parse the current model, understand whether the selected base model supports multiple context-window variants, and preserve the base model while adding/removing the `[1m]` suffix.

If the current global config has no explicit Claude `model`, the global context-window control should be unavailable rather than guessing a family.

### 3. Add per-session override state and persistence

Add a per-session override field to Atelier's session state and session metadata.

Likely touchpoints:
- `apps/atelier-desktop/src/store/session-store.ts`
- `apps/atelier-desktop/src/lib/types.ts`
- `apps/atelier-desktop/src-tauri/src/features/sessions/models.rs`
- `apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs`

V1 should persist enough information to reopen a session with the same effective Claude model behavior:
- the exact resolved Claude Code model string that was last applied to the session
- and/or the semantic context-window override if needed for UI clarity

For brand-new sessions, the session store should gain a draft field such as `newSessionContextWindow` so launch flows can seed a value before `ActiveSessionPanel` mounts.

Relevant current flows that seed new sessions:
- `apps/atelier-desktop/src/components/chat-sidebar.tsx`
- `apps/atelier-desktop/src/components/app-shell.tsx`

### 4. Add the selector to session controls

Expose the per-session selector in session controls, as close as practical to T3 Code's placement.

Best current fit:
- `apps/atelier-desktop/src/components/session-header.tsx`
- `apps/atelier-desktop/src/components/active-session-panel.tsx`

Behavior:
- only render when the effective base model supports more than one context-window option
- show the effective current value
- annotate the default value where useful
- when changed on an active session, immediately apply the corresponding Claude Code `/model` command and update stored session metadata

### 5. Resolve the effective value with explicit precedence

The effective context window resolves in this order:
1. per-session override
2. global default from the explicit Claude `model` in `~/.claude/settings.json`
3. capability default for the resolved base model

This precedence only applies once the base model is known.

If the base model is unknown, the feature is unavailable.

### 6. Apply the setting at the runtime edge

Keep the UI semantic, but do the Claude Code translation at the runtime edge.

Atelier's runtime layer should resolve the semantic selection into the exact Claude Code model string to use.

Likely backend touchpoint:
- `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`

Concrete V1 runtime behavior:

#### New sessions
- resolve the exact Claude Code model string before spawn
- start Claude with:
  - `claude --verbose --output-format stream-json --input-format stream-json --model <resolved-model>`

#### Resumed sessions
- continue to launch with `--resume <id>`
- after reconnect, if the desired resolved model differs from the stored current model, send `/model <resolved-model>` as the first control action

#### Active-session changes
- when the user changes the selector on a connected session, send `/model <resolved-model>`
- update the session metadata/index with the newly applied resolved model

## Data Flow

1. Load the global Claude config and parse the explicit Claude `model` if present.
2. Load session metadata if the user opened an existing session.
3. Resolve the base model from session metadata first, otherwise global config.
4. Load context-window capabilities for that base model from the shared capability resource.
5. Resolve the effective context window using session override > global default > capability default.
6. For a new session, start Claude with `--model <resolved-model>`.
7. For a resumed session, reconnect with `--resume`, then send `/model <resolved-model>` if the desired model differs.
8. When the selector changes on an active session, send `/model <resolved-model>` immediately and persist the new effective model for that session.

## Component and State Changes

### Frontend UI

- `apps/atelier-desktop/src/components/active-session-panel.tsx`
  - resolve effective model/context-window state
  - pass the resolved semantic selection into runtime start
  - coordinate post-resume `/model` application when needed
- `apps/atelier-desktop/src/components/session-header.tsx`
  - host the session-level selector or its trigger
- `apps/atelier-desktop/src/components/claude-global-config.tsx`
  - add a global context-window control derived from the global `model` value

### Frontend state and transport

- `apps/atelier-desktop/src/store/session-store.ts`
  - add draft state for new-session override
- `apps/atelier-desktop/src/lib/atelier-client.ts`
  - extend runtime start input
- `apps/atelier-desktop/src/lib/studio.ts`
  - extend `/session/start` request body

### Backend runtime

- `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`
  - accept the new selection input
  - resolve the exact Claude Code model string
  - apply `--model` on fresh start
  - apply `/model` after resume or on live change

### Backend session persistence

- `apps/atelier-desktop/src-tauri/src/features/sessions/models.rs`
- `apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs`

Extend session metadata/indexing so reopened sessions can remember the effective Claude model/context-window selection.

## Error Handling and Normalization

- If the base model is unknown, hide or disable the feature rather than guessing.
- If the stored override is invalid for the base model, drop it and fall back to the next precedence level.
- If the global model is invalid or unsupported, do not send any context-window override to runtime.
- If runtime application fails, use Atelier's existing session-start or runtime-error path; do not silently ignore a failed model switch.
- If only one valid option exists, do not show the selector.

## Testing Strategy

### Resolver and normalization tests

- session override beats global default
- global default beats capability default
- invalid session override falls back correctly
- invalid global model falls back or disables correctly
- selector is unavailable when no explicit base model is known

### UI tests

- session selector is hidden when only one option exists
- session selector is hidden/disabled when base model is unknown
- selector is visible when the base model supports multiple options
- changing the session selector updates the effective value shown in the session controls
- saving the global default rewrites the global Claude `model` value correctly, preserving the base model while toggling `[1m]`

### Transport and runtime tests

- new-session start uses `--model <resolved-model>`
- resume flow does not depend on undocumented `--resume + --model` behavior
- resume applies `/model <resolved-model>` when needed after reconnect
- live selector changes send `/model <resolved-model>` on the active session

### Persistence tests

- global default round-trips through the global config editor and file IO
- session reopen preserves the last applied effective model/context-window value
- session index migrations handle missing legacy fields safely

## Risks

- Atelier does not currently expose explicit model selection, so the feature depends on a known base model from config or session metadata.
- If the global config has no explicit Claude `model`, the feature must stay unavailable rather than guessing.
- Session metadata persistence adds schema/index changes that must remain backward-compatible.

Mitigation:
- keep the capability resource small and Claude-scoped
- base all runtime behavior on Claude Code's documented `--model` and `/model` support
- test migrations and fallback behavior directly

## Recommendation

Implement this as a focused, T3 Code-aligned feature with explicit Atelier decisions:
- single capability source of truth
- global default stored through the official Claude `model` setting
- per-session override persisted across reopen/resume
- `--model` for fresh starts
- `/model` for resumed or already-running sessions
- no guessed base model and no custom runtime context-window flag
