# Claude Context Window Selection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add T3 Code-like Claude context window selection to Atelier Desktop with a global default, per-session override, persisted session metadata, and real Claude Code runtime behavior using `--model`, `/model`, and `[1m]` variants.

**Architecture:** Keep capability metadata in a single checked-in JSON resource shared by frontend and backend so option rendering and validation cannot drift. Treat the effective setting as a semantic context-window choice in UI/state, then resolve it to an exact Claude Code model string at the runtime edge: `--model` for new sessions and `/model` after reconnect or on live changes for resumed/running sessions.

**Tech Stack:** React 19, TypeScript, Zustand, Tauri, Rust, Vitest, Cargo, pnpm

---

## File Map

### Existing files to modify
- `apps/atelier-desktop/src/lib/types.ts`
  - Extend `SessionEntry` and related shared frontend types with the new persisted model/context-window metadata needed by UI and session reopen flows.
- `apps/atelier-desktop/src/store/session-store.ts`
  - Add draft state/actions for new-session context-window selection.
- `apps/atelier-desktop/src/store/session-store.test.ts`
  - Cover the new draft state and reset behavior.
- `apps/atelier-desktop/src/lib/studio.ts`
  - Extend `/session/start` payload shape and add a focused helper for sending `/model` commands through the existing session message channel.
- `apps/atelier-desktop/src/lib/atelier-client.ts`
  - Extend `runtime.start(...)` to accept the new selection data and expose a focused runtime helper for model switching if that keeps component code simpler.
- `apps/atelier-desktop/src/lib/atelier-client.test.ts`
  - Verify the updated runtime facade forwards the new payload shape correctly.
- `apps/atelier-desktop/src/lib/tauri.ts`
  - Add a frontend wrapper for a new Tauri command that updates persisted session model/context-window metadata for one session entry.
- `apps/atelier-desktop/src/lib/tauri.test.ts`
  - Cover the new Tauri command wrapper if this file already owns command-wrapper tests.
- `apps/atelier-desktop/src/components/claude-global-config.tsx`
  - Add the global context-window control derived from the existing Claude `model` setting in `~/.claude/settings.json`.
- `apps/atelier-desktop/src/components/chat-sidebar.tsx`
  - Seed `newSessionProject` and clear/reset any new-session context-window draft when launching a new chat flow.
- `apps/atelier-desktop/src/components/chat-sidebar.test.tsx`
  - Cover the new-session draft seeding/reset behavior if this component owns it.
- `apps/atelier-desktop/src/components/active-session-panel.tsx`
  - Resolve effective model/context-window state, pass it into runtime start, render the per-session selector, and apply `/model` when changing an active or resumed session.
- `apps/atelier-desktop/src/components/active-session-panel.test.tsx`
  - Cover fresh-start payload, selector visibility, runtime switching, and resume behavior.
- `apps/atelier-desktop/src/components/session-header.tsx`
  - Host the selector or the UI affordance for it, if the header remains the cleanest placement.
- `apps/atelier-desktop/src/components/conversation-view.test.tsx`
  - Update any assumptions around new-session draft props if the conversation entrypoint changes.
- `apps/atelier-desktop/src/app.tsx`
  - Reference only; keep the existing settings integration intact.
- `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`
  - Accept the new runtime start payload fields, read the shared capability resource, resolve Claude Code model strings, and spawn new sessions with `--model`.
- `apps/atelier-desktop/src-tauri/src/features/sessions/models.rs`
  - Extend the persisted session index schema for the new effective model/context-window metadata.
- `apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs`
  - Preserve the new metadata when hydrating session lists and add a targeted update command for one session entry in `sessions-index.json`.
- `apps/atelier-desktop/src-tauri/src/features/studio/mod.rs`
  - Wire in the runtime helper module and shared capability-resource reader.
- `apps/atelier-desktop/src-tauri/src/main.rs`
  - Register the new Tauri command used to update session metadata after a successful live switch.

### Existing files to reference while implementing
- `apps/atelier-desktop/src/components/active-session-panel-state.ts`
  - Existing session lifecycle wording and state helpers.
- `apps/atelier-desktop/src/components/conversation-view.tsx`
  - Entry point that passes selected session or new-session context to `ActiveSessionPanel`.
- `apps/atelier-desktop/src/app.tsx`
  - Settings surface integration for `ClaudeGlobalConfig`.
- `apps/atelier-desktop/src-tauri/src/main.rs`
  - Existing Tauri command registrations for global Claude config.
- `apps/atelier-desktop/src-tauri/src/features/file_ops/commands.rs`
  - Existing read/write/open global Claude config commands.
- `apps/atelier-desktop/src/components/claude-global-config.tsx`
  - Existing localStorage/editor and config save patterns to preserve.

### Reference projects and docs to consult while implementing
- `refs/t3code/apps/web/src/components/chat/TraitsPicker.tsx`
  - T3 Code selector placement and rendering rules.
- `refs/t3code/apps/web/src/providerModels.ts`
  - T3 Code effective-value normalization pattern.
- `refs/t3code/packages/shared/src/model.ts`
  - T3 Code capability/default/model-id resolution pattern.
- Official Claude Code docs already summarized in the design spec:
  - `--model <alias|name>`
  - `/model <alias|name>`
  - `[1m]` syntax

### New files to create
- `apps/atelier-desktop/src/lib/claude-model-capabilities.json`
  - Single checked-in capability resource shared by frontend and backend.
- `apps/atelier-desktop/src/lib/claude-model-capabilities.ts`
  - Frontend helpers that read and query the shared JSON capability resource.
- `apps/atelier-desktop/src/lib/claude-model-capabilities.test.ts`
  - Unit tests for capability lookup, default resolution, and model-string mapping.
- `apps/atelier-desktop/src/lib/claude-model-config.ts`
  - Focused helpers for parsing/writing Claude `model` strings from global config and session overrides.
- `apps/atelier-desktop/src/lib/claude-model-config.test.ts`
  - Unit tests for parsing `[1m]`, preserving base models, and invalid-input handling.
- `apps/atelier-desktop/src/components/session-context-window-selector.tsx`
  - Small presentational selector component using `@acme/ui` controls.
- `apps/atelier-desktop/src/components/session-context-window-selector.test.tsx`
  - Targeted UI tests for visibility and selection behavior.
- `apps/atelier-desktop/src-tauri/src/features/studio/claude_model.rs`
  - Rust runtime-side helpers that read the shared JSON capability resource and format Claude model strings.

---

### Task 1: Build the shared capability resource and model helpers first

**Files:**
- Create: `apps/atelier-desktop/src/lib/claude-model-capabilities.json`
- Create: `apps/atelier-desktop/src/lib/claude-model-capabilities.ts`
- Create: `apps/atelier-desktop/src/lib/claude-model-capabilities.test.ts`
- Create: `apps/atelier-desktop/src/lib/claude-model-config.ts`
- Create: `apps/atelier-desktop/src/lib/claude-model-config.test.ts`

- [ ] **Step 1: Write the failing frontend unit tests for capability lookup and model parsing**

Add focused Vitest coverage for these exact behaviors:
- supported base model returns the expected context-window options
- unsupported base model returns no options
- capability default is stable for each supported model
- parsing `claude-opus-4-6` yields base model `claude-opus-4-6` and default context window
- parsing `claude-opus-4-6[1m]` yields base model `claude-opus-4-6` and 1M context window
- writing a parsed model back out preserves/removes `[1m]` correctly
- invalid strings return `null` or an equivalent explicit invalid result instead of guessing

- [ ] **Step 2: Run the unit tests to verify they fail for missing helpers**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/lib/claude-model-capabilities.test.ts apps/atelier-desktop/src/lib/claude-model-config.test.ts
```

Expected:
- FAIL because the new helper modules do not exist yet.

- [ ] **Step 3: Create the single shared capability JSON resource**

In `claude-model-capabilities.json`, define only the Atelier-supported Claude base models and their context-window variants.

Use a shape like:
```json
{
  "models": [
    {
      "baseModel": "claude-opus-4-6",
      "options": [
        { "value": "default", "label": "200k", "isDefault": true },
        { "value": "1m", "label": "1M" }
      ]
    }
  ]
}
```

This file is the single source of truth for both frontend rendering and backend validation.

- [ ] **Step 4: Create the minimal frontend capability helper module**

In `claude-model-capabilities.ts`, read the JSON resource and add helpers such as:
- `getClaudeModelCapability(baseModel)`
- `getDefaultClaudeContextWindow(baseModel)`
- `supportsMultipleContextWindows(baseModel)`

Keep the file Claude-specific and small. Do not build a provider-agnostic registry.

- [ ] **Step 5: Create the minimal model parse/format helper module**

In `claude-model-config.ts`, add focused helpers such as:
- `parseClaudeModelString(model: string)`
- `formatClaudeModelString(baseModel: string, contextWindow: ClaudeContextWindowValue)`
- `resolveClaudeContextWindowFromModel(model: string)`

Rules:
- `[1m]` is the only non-default variant in V1
- no guessing when input is missing or invalid
- preserve full model ids like `claude-opus-4-6[1m]`

- [ ] **Step 6: Run the unit tests again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/lib/claude-model-capabilities.test.ts apps/atelier-desktop/src/lib/claude-model-config.test.ts
```

Expected:
- PASS

- [ ] **Step 7: Commit the shared-helper slice**

```bash
git add apps/atelier-desktop/src/lib/claude-model-capabilities.json apps/atelier-desktop/src/lib/claude-model-capabilities.ts apps/atelier-desktop/src/lib/claude-model-capabilities.test.ts apps/atelier-desktop/src/lib/claude-model-config.ts apps/atelier-desktop/src/lib/claude-model-config.test.ts
git commit -m "feat: add claude context window helpers"
```

---

### Task 2: Extend store and shared types for session draft and persistence

**Files:**
- Modify: `apps/atelier-desktop/src/lib/types.ts`
- Modify: `apps/atelier-desktop/src/store/session-store.ts`
- Modify: `apps/atelier-desktop/src/store/session-store.test.ts`
- Modify: `apps/atelier-desktop/src/components/chat-sidebar.tsx`
- Modify: `apps/atelier-desktop/src/components/chat-sidebar.test.tsx`
- Modify: `apps/atelier-desktop/src/components/conversation-view.test.tsx`

- [ ] **Step 1: Write the failing store and sidebar tests for the new draft state**

Add tests that verify:
- `useSessionStore` can set and clear `newSessionContextWindow`
- clearing the draft does not disturb `newSessionProject` or `newSessionPrompt`
- starting a new chat from the sidebar clears any stale context-window draft unless explicitly seeded
- the conversation entrypoint still renders the new-session panel path correctly with the new draft state present

- [ ] **Step 2: Run the targeted tests to verify they fail**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/store/session-store.test.ts apps/atelier-desktop/src/components/chat-sidebar.test.tsx apps/atelier-desktop/src/components/conversation-view.test.tsx
```

Expected:
- FAIL because the new draft state/actions do not exist yet.

- [ ] **Step 3: Extend shared frontend types with session metadata fields**

In `types.ts`, add only the fields the UI needs from persisted session metadata, for example:
```ts
export interface SessionEntry {
  // existing fields...
  claudeModel?: string | null;
  claudeContextWindow?: "default" | "1m" | null;
}
```

Keep names aligned with the runtime/session-index schema you will add in Rust.

- [ ] **Step 4: Extend `useSessionStore` with new-session context-window draft state**

Add:
```ts
newSessionContextWindow: ClaudeContextWindowValue | null;
setNewSessionContextWindow: (value: ClaudeContextWindowValue | null) => void;
```

Keep the store flat like the existing `newSessionProject` and `newSessionPrompt` fields.

- [ ] **Step 5: Update sidebar/conversation code to seed and clear the draft explicitly**

Use the current chat-launch path to ensure a fresh new-session flow does not inherit stale state unintentionally.

Do not add persistence middleware to Zustand in this task.

- [ ] **Step 6: Run the targeted tests again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/store/session-store.test.ts apps/atelier-desktop/src/components/chat-sidebar.test.tsx apps/atelier-desktop/src/components/conversation-view.test.tsx
```

Expected:
- PASS

- [ ] **Step 7: Commit the draft-state slice**

```bash
git add apps/atelier-desktop/src/lib/types.ts apps/atelier-desktop/src/store/session-store.ts apps/atelier-desktop/src/store/session-store.test.ts apps/atelier-desktop/src/components/chat-sidebar.tsx apps/atelier-desktop/src/components/chat-sidebar.test.tsx apps/atelier-desktop/src/components/conversation-view.test.tsx
git commit -m "feat: add session context window draft state"
```

---

### Task 3: Add the global context-window control to Claude global config

**Files:**
- Modify: `apps/atelier-desktop/src/components/claude-global-config.tsx`
- Create: `apps/atelier-desktop/src/components/claude-global-config.test.tsx`
- Modify: `apps/atelier-desktop/src/lib/tauri.ts` (only if local typing cleanup makes tests clearer)
- Reference: `apps/atelier-desktop/src/app.tsx`

- [ ] **Step 1: Write the failing component tests for the global config control**

Create `claude-global-config.test.tsx` covering:
- when global config has no explicit Claude `model`, the context-window control is hidden or disabled with a clear explanation
- when global config has `claude-opus-4-6`, the control renders the supported options and shows default selected
- changing to 1M rewrites the config state to `claude-opus-4-6[1m]`
- changing back to default removes `[1m]`
- existing permissions editing and save behavior still work

Mock `readGlobalClaudeConfig` / `writeGlobalClaudeConfig` like the existing component tests in this codebase.

- [ ] **Step 2: Run the new component test to verify it fails**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/claude-global-config.test.tsx
```

Expected:
- FAIL because the control/test file does not exist yet.

- [ ] **Step 3: Add the minimal control to `ClaudeGlobalConfig`**

Use `@acme/ui` components already used in the app. Keep the config editor data model local to this component.

Implement logic that:
- reads `config.model` if it is a string
- parses it with `parseClaudeModelString`
- renders a simple selector when the parsed base model supports multiple options
- updates `config.model` using `formatClaudeModelString`
- leaves unrelated config keys untouched

Do not invent a separate top-level `contextWindow` key in `settings.json`.

- [ ] **Step 4: Preserve existing global-config behaviors while saving**

Ensure the save path still:
- alphabetically sorts allow/deny lists
- writes the full JSON via `writeGlobalClaudeConfig`
- keeps unknown config keys untouched

- [ ] **Step 5: Run the component test again to verify it passes**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/claude-global-config.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit the global-config slice**

```bash
git add apps/atelier-desktop/src/components/claude-global-config.tsx apps/atelier-desktop/src/components/claude-global-config.test.tsx apps/atelier-desktop/src/lib/claude-model-config.ts apps/atelier-desktop/src/lib/claude-model-capabilities.ts apps/atelier-desktop/src/lib/claude-model-capabilities.json
git commit -m "feat: add global claude context window setting"
```

---

### Task 4: Persist session metadata in the session index and expose an update command

**Files:**
- Modify: `apps/atelier-desktop/src-tauri/src/features/sessions/models.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/main.rs`
- Modify: `apps/atelier-desktop/src/lib/tauri.ts`
- Modify: `apps/atelier-desktop/src/lib/tauri.test.ts`
- Modify: `apps/atelier-desktop/src/lib/types.ts`

- [ ] **Step 1: Write the failing Rust and frontend tests for session-index metadata round-tripping**

Add focused tests that verify:
- legacy `sessions-index.json` without the new fields still deserializes
- serializing a `SessionEntry` with `claude_model` / `claude_context_window` preserves those fields
- a targeted update command can update one session entry without stripping unrelated entries
- the frontend Tauri wrapper forwards the correct payload for updating one session entry

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/lib/tauri.test.ts && cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml sessions::commands
```

Expected:
- FAIL because the schema and update command do not include the new fields yet.

- [ ] **Step 3: Extend the Rust session index schema minimally**

In `models.rs`, add optional persisted fields to `SessionEntry`, for example:
```rust
#[serde(rename = "claudeModel", default)]
pub claude_model: Option<String>,
#[serde(rename = "claudeContextWindow", default)]
pub claude_context_window: Option<String>,
```

Match names to the frontend types and keep them optional for backward compatibility.

- [ ] **Step 4: Add a targeted session metadata update command**

In `sessions/commands.rs`, add a small Tauri command with a narrow contract, for example:
```rust
#[tauri::command]
pub async fn update_session_model_metadata(
    escaped_path: String,
    session_id: String,
    claude_model: Option<String>,
    claude_context_window: Option<String>,
) -> Result<(), String>
```

Behavior:
- read `sessions-index.json`
- update only the matching top-level session entry
- preserve unrelated entries and children untouched
- write atomically like the existing delete flow

Register it in `src-tauri/src/main.rs` and expose a matching wrapper in `src/lib/tauri.ts`.

- [ ] **Step 5: Run the targeted tests again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/lib/tauri.test.ts && cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml sessions::commands
```

Expected:
- PASS

- [ ] **Step 6: Commit the session-index persistence slice**

```bash
git add apps/atelier-desktop/src-tauri/src/features/sessions/models.rs apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs apps/atelier-desktop/src-tauri/src/main.rs apps/atelier-desktop/src/lib/tauri.ts apps/atelier-desktop/src/lib/tauri.test.ts apps/atelier-desktop/src/lib/types.ts
git commit -m "feat: persist claude model metadata in sessions"
```

---

### Task 5: Add runtime-side shared-capability readers and model resolution helpers in Rust

**Files:**
- Create: `apps/atelier-desktop/src-tauri/src/features/studio/claude_model.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/features/studio/mod.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`

- [ ] **Step 1: Write the failing Rust tests for runtime model resolution**

Add tests for:
- reading the shared `claude-model-capabilities.json` resource successfully
- resolving a base model plus `default` context window to the unsuffixed Claude model string
- resolving a base model plus `1m` to the `[1m]` suffixed string
- rejecting unsupported base model/context-window combinations
- preserving exact full model ids without rewriting them to aliases

- [ ] **Step 2: Run the Rust studio test target to verify failure**

Run:
```bash
cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml studio::claude_model studio::commands
```

Expected:
- FAIL because the helper module does not exist yet.

- [ ] **Step 3: Create the focused Rust helper module that reads the shared JSON resource**

In `claude_model.rs`, add small pure helpers such as:
```rust
pub fn load_claude_model_capabilities() -> Result<ClaudeCapabilities, String>
pub fn format_claude_model(base_model: &str, context_window: &str) -> Result<String, String>
pub fn supports_multiple_context_windows(base_model: &str) -> bool
pub fn default_context_window(base_model: &str) -> Option<&'static str>
```

Read from the same `apps/atelier-desktop/src/lib/claude-model-capabilities.json` file used by the frontend. Do not duplicate the model/option table in Rust.

- [ ] **Step 4: Wire the new module into `studio/mod.rs` and compile**

Export the module and keep the interface local to the Studio backend.

- [ ] **Step 5: Run the Rust studio test target again to verify it passes**

Run:
```bash
cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml studio::claude_model studio::commands
```

Expected:
- PASS for the new helper tests

- [ ] **Step 6: Commit the runtime helper slice**

```bash
git add apps/atelier-desktop/src-tauri/src/features/studio/claude_model.rs apps/atelier-desktop/src-tauri/src/features/studio/mod.rs apps/atelier-desktop/src-tauri/src/features/studio/commands.rs apps/atelier-desktop/src/lib/claude-model-capabilities.json
git commit -m "feat: add studio claude model resolution helpers"
```

---

### Task 6: Extend the start payload and runtime facade for fresh starts

**Files:**
- Modify: `apps/atelier-desktop/src/lib/studio.ts`
- Modify: `apps/atelier-desktop/src/lib/atelier-client.ts`
- Modify: `apps/atelier-desktop/src/lib/atelier-client.test.ts`
- Modify: `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`
- Modify: `apps/atelier-desktop/src/components/active-session-panel.test.tsx`

- [ ] **Step 1: Write the failing tests for the extended start payload**

Add tests that verify:
- `atelierClient.runtime.start(...)` forwards the new model/context-window payload fields to `startActiveSessionStream`
- the HTTP request body sent by `startActiveSessionStream` includes those fields
- new session startup uses `--model <resolved-model>` when the resolved base model is known

Keep frontend and Rust tests focused and separate.

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/lib/atelier-client.test.ts apps/atelier-desktop/src/components/active-session-panel.test.tsx && cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- FAIL because the payload and runtime args do not exist yet.

- [ ] **Step 3: Extend the frontend runtime start contract**

In `studio.ts` and `atelier-client.ts`, add only the needed fields, preferring the smallest contract that works. For V1, sending the resolved exact model string is enough.

Example:
```ts
resolvedModel?: string | null;
```

Do not send redundant semantic fields if the backend does not need them.

- [ ] **Step 4: Extend `SessionStartPayload` and spawn args in Rust**

In `commands.rs`, update `SessionStartPayload` and the fresh-start path so new sessions run with:
```rust
claude --verbose --output-format stream-json --input-format stream-json --model <resolved-model>
```

Validation rules:
- if a resolved model is supplied, validate it against the shared capability-resource rules
- if no resolved model is supplied, keep the previous startup behavior

- [ ] **Step 5: Run the targeted tests again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/lib/atelier-client.test.ts apps/atelier-desktop/src/components/active-session-panel.test.tsx && cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- PASS

- [ ] **Step 6: Commit the fresh-start runtime slice**

```bash
git add apps/atelier-desktop/src/lib/studio.ts apps/atelier-desktop/src/lib/atelier-client.ts apps/atelier-desktop/src/lib/atelier-client.test.ts apps/atelier-desktop/src-tauri/src/features/studio/commands.rs apps/atelier-desktop/src/components/active-session-panel.test.tsx
git commit -m "feat: pass claude model on fresh session start"
```

---

### Task 7: Add the session-level selector UI and active-session behavior

**Files:**
- Create: `apps/atelier-desktop/src/components/session-context-window-selector.tsx`
- Create: `apps/atelier-desktop/src/components/session-context-window-selector.test.tsx`
- Modify: `apps/atelier-desktop/src/components/session-header.tsx`
- Modify: `apps/atelier-desktop/src/components/active-session-panel.tsx`
- Modify: `apps/atelier-desktop/src/components/active-session-panel.test.tsx`

- [ ] **Step 1: Write the failing UI tests for selector rendering and interaction**

Add tests that verify:
- selector is hidden when no known base model exists
- selector is hidden when only one option exists
- selector is shown when the resolved base model has both default and 1M options
- choosing 1M on a connected session triggers the runtime model-switch path
- choosing a value updates the session metadata update path or local state used to persist it

- [ ] **Step 2: Run the targeted UI tests to verify failure**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/session-context-window-selector.test.tsx apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- FAIL because the selector component and integration do not exist yet.

- [ ] **Step 3: Create the minimal selector component**

Build a small presentational component using `@acme/ui` controls already common in Atelier.

Props should be explicit, for example:
```ts
baseModel: string | null;
value: ClaudeContextWindowValue | null;
options: ClaudeContextWindowOption[];
onChange: (value: ClaudeContextWindowValue) => void;
```

Render nothing when options length is less than 2.

- [ ] **Step 4: Integrate the selector into the session header/panel**

In `ActiveSessionPanel` / `SessionHeader`:
- resolve the known base model from session metadata first, then global config
- derive options from `claude-model-capabilities.ts`
- derive the effective value using session override > global default > capability default
- render the selector in session controls
- update session-local state immediately on change

Do not over-abstract; keep the logic close to the existing session lifecycle code.

- [ ] **Step 5: Run the targeted UI tests again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/session-context-window-selector.test.tsx apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- PASS

- [ ] **Step 6: Commit the selector UI slice**

```bash
git add apps/atelier-desktop/src/components/session-context-window-selector.tsx apps/atelier-desktop/src/components/session-context-window-selector.test.tsx apps/atelier-desktop/src/components/session-header.tsx apps/atelier-desktop/src/components/active-session-panel.tsx apps/atelier-desktop/src/components/active-session-panel.test.tsx
git commit -m "feat: add session context window selector"
```

---

### Task 8: Implement live `/model` switching for active and resumed sessions

**Files:**
- Modify: `apps/atelier-desktop/src/lib/studio.ts`
- Modify: `apps/atelier-desktop/src/lib/atelier-client.ts`
- Modify: `apps/atelier-desktop/src/components/active-session-panel.tsx`
- Modify: `apps/atelier-desktop/src/components/active-session-panel.test.tsx`
- Modify: `apps/atelier-desktop/src-tauri/src/features/studio/commands.rs`
- Modify: `apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs`
- Modify: `apps/atelier-desktop/src/lib/tauri.ts`

- [ ] **Step 1: Write the failing tests for resume and live-switch behavior**

Add tests that verify:
- resumed sessions do not rely on `--resume --model`
- after a resumed session reconnects, Atelier sends `/model <resolved-model>` when the desired model differs from the stored/current one
- changing the selector on a connected session sends `/model <resolved-model>` through the existing session message channel
- no `/model` message is sent when the desired model already matches the current effective model
- after a successful live switch, the session metadata update command is called with the new model/context-window values

- [ ] **Step 2: Run the targeted tests to verify failure**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/active-session-panel.test.tsx apps/atelier-desktop/src/lib/atelier-client.test.ts apps/atelier-desktop/src/lib/tauri.test.ts && cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- FAIL because the resume/live-switch behavior is not implemented yet.

- [ ] **Step 3: Implement the minimal frontend live-switch flow**

Use the existing session message path rather than inventing a new endpoint.

When the desired resolved model changes on an active session:
```ts
await atelierClient.runtime.send(sessionId, `/model ${resolvedModel}`)
```

For resumed sessions, trigger that same path only after the session is connected and only when the stored/current model differs.

- [ ] **Step 4: Persist the new effective model through the targeted update command**

After a successful live switch or resume reconciliation, call the new Tauri command added in Task 4:
```ts
await updateSessionModelMetadata({
  escapedPath,
  sessionId,
  claudeModel: resolvedModel,
  claudeContextWindow: selectedContextWindow,
})
```

Keep this write scoped to the affected session entry only.

- [ ] **Step 5: Run the targeted tests again to verify they pass**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run apps/atelier-desktop/src/components/active-session-panel.test.tsx apps/atelier-desktop/src/lib/atelier-client.test.ts apps/atelier-desktop/src/lib/tauri.test.ts && cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml studio::commands
```

Expected:
- PASS

- [ ] **Step 6: Commit the live-switch slice**

```bash
git add apps/atelier-desktop/src/lib/studio.ts apps/atelier-desktop/src/lib/atelier-client.ts apps/atelier-desktop/src/components/active-session-panel.tsx apps/atelier-desktop/src/components/active-session-panel.test.tsx apps/atelier-desktop/src-tauri/src/features/studio/commands.rs apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs apps/atelier-desktop/src/lib/tauri.ts apps/atelier-desktop/src/lib/tauri.test.ts
git commit -m "feat: switch claude model for resumed and active sessions"
```

---

### Task 9: Run focused verification and finish the feature slice

**Files:**
- Modify: none expected unless verification reveals a real bug

- [ ] **Step 1: Run the focused frontend tests for all touched slices**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier exec vitest run \
  apps/atelier-desktop/src/lib/claude-model-capabilities.test.ts \
  apps/atelier-desktop/src/lib/claude-model-config.test.ts \
  apps/atelier-desktop/src/store/session-store.test.ts \
  apps/atelier-desktop/src/lib/atelier-client.test.ts \
  apps/atelier-desktop/src/lib/tauri.test.ts \
  apps/atelier-desktop/src/components/claude-global-config.test.tsx \
  apps/atelier-desktop/src/components/chat-sidebar.test.tsx \
  apps/atelier-desktop/src/components/conversation-view.test.tsx \
  apps/atelier-desktop/src/components/session-context-window-selector.test.tsx \
  apps/atelier-desktop/src/components/active-session-panel.test.tsx
```

Expected:
- PASS

- [ ] **Step 2: Run the focused Rust test suites for sessions and studio**

Run:
```bash
cargo test --manifest-path /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop/src-tauri/Cargo.toml sessions::commands studio::claude_model studio::commands
```

Expected:
- PASS

- [ ] **Step 3: Run app-local lint and typecheck**

Run:
```bash
pnpm --dir /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop lint && pnpm --dir /Users/vyductan/Developer/vyductan/atelier/apps/atelier-desktop typecheck
```

Expected:
- PASS

- [ ] **Step 4: If verification fails, fix only the surfaced issue and re-run the exact failing command**

Do not broaden scope into unrelated cleanup.

- [ ] **Step 5: Commit the final verified state**

```bash
git add apps/atelier-desktop/src/lib/types.ts apps/atelier-desktop/src/store/session-store.ts apps/atelier-desktop/src/lib/studio.ts apps/atelier-desktop/src/lib/atelier-client.ts apps/atelier-desktop/src/lib/tauri.ts apps/atelier-desktop/src/components/claude-global-config.tsx apps/atelier-desktop/src/components/chat-sidebar.tsx apps/atelier-desktop/src/components/active-session-panel.tsx apps/atelier-desktop/src/components/session-header.tsx apps/atelier-desktop/src/components/session-context-window-selector.tsx apps/atelier-desktop/src/lib/claude-model-capabilities.json apps/atelier-desktop/src/lib/claude-model-capabilities.ts apps/atelier-desktop/src/lib/claude-model-config.ts apps/atelier-desktop/src-tauri/src/features/studio/claude_model.rs apps/atelier-desktop/src-tauri/src/features/studio/commands.rs apps/atelier-desktop/src-tauri/src/features/studio/mod.rs apps/atelier-desktop/src-tauri/src/features/sessions/models.rs apps/atelier-desktop/src-tauri/src/features/sessions/commands.rs apps/atelier-desktop/src-tauri/src/main.rs
git commit -m "feat: add claude context window selection"
```

---

## Notes for the implementing agent

- Use `pnpm`, never `npm`, `yarn`, `bun`, or `npx`.
- Prefer `@acme/ui` components for the new selector and any settings UI.
- Keep capability metadata in the single shared JSON resource; both frontend and backend must read from that same file.
- Do not invent a custom Claude runtime `contextWindow` flag. Use Claude Code's documented `--model`, `/model`, and `[1m]` behavior.
- Do not guess a base model when none is explicitly known from session metadata or global config.
- For resumed sessions, do not depend on undocumented `--resume --model` semantics.
- Keep tests small and focused: helper tests for resolution/parsing, component tests for rendering, Rust tests for runtime/session persistence.
- This repository is not a git repo in the current environment, so commit steps may need to be executed later in the actual repo checkout even though the plan keeps frequent commits as the intended workflow.
