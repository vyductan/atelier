# Atelier Desktop

Atelier Desktop is a Tauri application for managing Claude Code sessions, inspecting workspace changes, and syncing shared `@acme` packages across local projects.

## Highlights

### Session workspace

- Browse Claude Code sessions grouped by project
- Start new chats and reopen existing sessions in a focused desktop workspace
- View runtime-aware transcript, header state, reconnect guidance, and composer availability
- Inspect changed files with diff and read-only preview modes
- Copy, export, delete, and generate handoff content from the active session header
- Configure Claude defaults and session-level context window selection

### `@acme` Sync

- Sync the shared `@acme` workspace across multiple local projects
- Preview push and pull changes before applying them
- Review file-level diffs for added, modified, and deleted files
- Confirm sync actions before execution
- Refresh sync status when the app regains focus

## Development

### Prerequisites

- Node.js >= 24.11.0
- pnpm 10.30.2
- Rust (stable)
- macOS for the current desktop workflow

### Setup

From the repository root:

```bash
pnpm install
pnpm atelier:dev
```

### Useful commands

```bash
pnpm --dir apps/atelier-desktop lint
pnpm --dir apps/atelier-desktop typecheck
pnpm --dir apps/atelier-desktop tauri:build
```

## Project structure

```text
apps/atelier-desktop/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/              # React hooks
│   ├── lib/                # Utilities and types
│   └── store/              # Zustand state
├── src-tauri/              # Rust + Tauri backend
│   └── src/
└── package.json
```

## Technology stack

- React 19
- TypeScript
- Vite
- Tailwind CSS
- Zustand
- Tauri 2.x
- Rust
