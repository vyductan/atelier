# Atelier Desktop

A desktop application for managing Claude Code sessions and synchronizing shared workspaces across projects.

## 🌟 Detailed Feature Matrix

### 1. 🎛️ Smart Account Dashboard

- **Global Real-time Monitoring**: Instant insight into the health of all accounts, including average remaining quotas.
- **Smart Recommendation**: The system uses a real-time algorithm to filter and recommend the "Best Account" based on quota redundancy, supporting one-click switching.
- **Active Account Snapshot**: Visually displays the specific quota percentage and the last synchronization time of the currently active account.

## Features

### Code

- **Workbench shell** — Dedicated desktop shell with top-level `Chats` and `@acme Sync` views plus workspace branch/change status in the header
- **Workspace task workbench** — Create workspace-scoped tasks with `Auto`, `Claude`, or `OpenClaw`, review grouped task states, inspect task-centric overview/thread/changes tabs, and follow lifecycle-aware thread timelines for approvals, blocks, retries, and completion
- **Grouped project sidebar** — Browse Claude Code sessions grouped by project with per-project new chat actions and inline load errors
- **Active session workspace** — Open an existing session or start a new one in a focused conversation workspace with a session-scoped changed-files inspector that supports both unified diff and read-only file preview modes
- **Lifecycle-aware session UI** — Header status, transcript states, composer availability, and reconnect guidance stay aligned with runtime state
- **Session actions** — Copy, export to file, export to Codex, and generate handoff from the active session header
- **Delete Sessions** — Move to trash or permanently delete sessions
- **Search & Filter** — Filter sessions by keyword from the sidebar

### @acme Sync

- **Multi-project sync** — Synchronize the `@acme` shared UI workspace across multiple local projects using `rsync` with `.gitignore`-aware filtering
- **Sync status tracking** — Status labels per project based on current timestamps: `In Sync`, `Outdated`, or `Local Changes`; preview refresh shows separate action badges/alerts
- **Push to Primary** — Push local project changes back to the primary `@acme` source
- **Pull Update** — Pull latest changes from primary into a project
- **Preview Push/Pull** — Generate direction-specific preview before sync (`project → main` or `main → project`)
- **File-level change list** — Preview added/modified/deleted files and inspect per-file GitHub-style unified diff (hunks, line numbers, colored +/- lines)
- **Confirm before sync** — Push and Pull actions always show a confirmation dialog before execution
- **Auto-refresh on focus** — Modification timestamps refresh automatically when the window regains focus

## Development

### Prerequisites

- Node.js >= 24.11.0
- pnpm 10.30.2
- Rust (latest stable)
- macOS 10.15+

### Setup

```bash
# Install dependencies
pnpm install

# Run in development mode
pnpm atelier:dev

# Build for production
pnpm tauri:build
```

## Project Structure

```
apps/atelier-desktop/
├── src/                    # React frontend
│   ├── components/         # UI components
│   ├── hooks/             # React hooks
│   ├── lib/               # Utilities and types
│   └── store/             # State management (Zustand)
├── src-tauri/             # Rust backend
│   ├── src/
│   │   ├── commands/      # Tauri commands
│   │   ├── models/        # Data models
│   │   └── utils/         # Helper functions
│   └── Cargo.toml
└── package.json
```

## Technology Stack

- **Frontend**: React 19, TypeScript, Vite, Tailwind CSS
- **Backend**: Rust, Tauri 2.x

## License

MIT
