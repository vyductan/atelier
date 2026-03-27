# Studio Error Banner Design

## Summary

Improve Atelier Desktop's Studio session error handling by following the current T3 Code pattern:
- keep the transcript focused on conversational content
- surface runtime failures in a dedicated error banner above the transcript
- preserve a canonical error state that contains the most useful available diagnostic message

This change is intentionally scoped to error visibility only. It does not change how raw runtime/tool events are rendered in the chat transcript.

## Problem

The current Studio UX has two related issues:

1. Runtime failures are collapsed into generic messages like `Claude exited with status exit status: 1`, even when the stream contained a more actionable failure.
2. Users expect to see some indication of what went wrong in the chat area, but Atelier currently has no dedicated error lane. The transcript only renders user, assistant, and system-status messages, so technical failures feel like they disappear.

This is especially confusing for flows like `✨ Optimize Rules`, where the underlying failure may be a tool or skill invocation problem rather than a process crash.

## Reference Pattern

Use the current T3 Code structure as the model:
- a dedicated thread error state separate from normal chat messages
- a dedicated error banner component rendered above the transcript
- a timeline/transcript that remains focused on conversation and work log content rather than dumping raw runtime events

We will mirror that structure in Atelier's session workspace state.

## Goals

- Show a clear, visible Studio error above the transcript when a session fails.
- Prefer the most actionable failure message available from the runtime.
- Keep the transcript clean and conversation-focused.
- Preserve the existing session status/timeline model where possible.

## Non-goals

- Rendering raw tool events, stderr lines, or full stream events in the transcript.
- Redesigning the session transcript or message timeline.
- Changing the semantics of `operation` timeline items beyond error extraction.
- Fixing the `Optimize Rules` prompt itself.

## Approach

### 1. Improve backend/runtime error extraction

Update the Studio stream handling in the Tauri backend so that the emitted runtime error prefers high-value diagnostics over generic exit status text.

Priority order for canonical error selection:
1. a structured runtime error emitted by the stream/runtime layer
2. a structured tool or skill failure message attached to a stream event
3. a stderr-derived message, but only if it is non-empty and more useful than generic process noise
4. a generic process exit status fallback

Selection rules:
- choose the highest-priority candidate seen during the failed run
- if multiple candidates exist at the same priority, prefer the last non-empty candidate
- trim whitespace and ignore blank candidates
- ignore duplicate candidates that do not improve the final message
- never concatenate multiple error sources into one banner message

For stderr-derived errors, only use stderr when it contains a user-actionable message rather than generic transport/process noise.

The goal is that the frontend receives a single, canonical error string that is already useful on its own.

### 2. Keep a canonical workspace error state

Continue using `workspaceState.error` as the single frontend source of truth for session failures.

This matches the T3 Code pattern where error state is separate from normal transcript messages. The transcript should not be responsible for carrying technical runtime details.

### 3. Add a dedicated Studio error banner

Add a small reusable UI component, inspired by T3 Code's `ThreadErrorBanner`, that:
- renders above the transcript area
- is only visible when `workspaceState.error` is non-null
- presents the full error via tooltip/title while clamping visible height if needed
- uses `@acme/ui` primitives/styling conventions for alert presentation

This banner becomes the main visible place where Studio failures are shown.

## Event Contract

This change does not introduce a new event type or require frontend schema changes. The existing `runtime-error` event remains the failure signal. Only the canonical message content becomes more useful and more deterministic.

## Banner Lifecycle

- The banner appears whenever `workspaceState.error` is non-null.
- The banner persists for the failed session view until a new session run starts or the workspace state is reset.
- The banner is not rendered as a transcript item.
- The banner does not include dismiss behavior in this iteration.

### 4. Keep transcript rendering unchanged

Do not create new transcript items from runtime errors, tool failures, stderr lines, or process-exit failures.

The transcript remains responsible for:
- user messages
- assistant messages
- system status updates

This keeps the UI aligned with the T3 Code mental model: conversation in the transcript, runtime failures in a dedicated error surface.

## T3-inspired scope

This is a structural adaptation of the T3 Code pattern, not a full UI clone. The required parity is:
- separate error state
- separate banner surface
- transcript remains conversation/status focused

Dismiss actions, retry affordances, richer diagnostic panels, and raw runtime event rendering are out of scope for this change.

## Component/State Changes

### Backend

Likely file:
- `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`

Expected change:
- centralize and improve error message construction for failed Studio sessions
- preserve the current event stream contract, but emit a more useful `runtime-error`
- keep backend work limited to extracting and selecting a better canonical failure message from already-available run context rather than redesigning the stream protocol

### Frontend state

Likely file:
- `apps/atelier-desktop/src/components/session-workspace-state.ts`

Expected change:
- keep `workspaceState.error` semantics as-is
- no new transcript event kinds required for this feature

### Frontend presentation

Likely files:
- `apps/atelier-desktop/src/components/active-session-panel.tsx`
- new small component for the banner under `apps/atelier-desktop/src/components/`

Expected change:
- render the error banner above `SessionTranscript`
- continue rendering transcript messages exactly from the existing mapped conversation/status items

## Data Flow

1. Studio runtime fails.
2. Backend inspects stream/runtime/stderr context and constructs the best available error message.
3. Frontend receives `runtime-error` with that canonical message.
4. `reduceWorkspaceEvent` stores it in `workspaceState.error` and sets connection state to `error`.
5. `ActiveSessionPanel` renders the banner from `workspaceState.error`.
6. Transcript remains unchanged except for existing status/conversation messages.

## Error Handling

If detailed error extraction is unavailable, the system still falls back to the current generic process-exit message.

This ensures the new behavior is strictly better when extra diagnostics exist, while remaining safe when they do not.

## Testing Strategy

### Backend

Add focused tests for canonical error selection:
- structured runtime error beats all other candidates
- structured tool or skill failure beats stderr and generic exit fallback
- meaningful stderr beats generic exit fallback
- when multiple same-priority candidates exist, the last non-empty candidate wins
- duplicate or blank candidates are ignored

### Frontend

Add or extend component and reducer tests to verify:
- `runtime-error` stores the canonical message in `workspaceState.error`
- the banner renders whenever `workspaceState.error` is set
- the banner is not rendered inside the transcript
- the transcript does not gain extra error messages from this change
- the banner clears only when a new run starts or workspace state resets

## Risks

- If backend error extraction becomes too aggressive, it may surface noisy or low-signal stderr text.
- If banner placement is wrong, it may compete visually with empty/loading states.

Mitigation:
- keep extraction priority conservative
- keep the banner visually compact and above the transcript

## Recommendation

Implement this as a minimal, T3 Code–aligned change:
- better canonical runtime error generation
- dedicated error banner
- no transcript expansion for raw runtime/tool errors
