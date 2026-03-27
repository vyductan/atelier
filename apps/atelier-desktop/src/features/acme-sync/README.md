# Acme Sync

The **Acme Sync** module is a powerful, multi-modal synchronization tool for the `@acme` shared workspace in **Atelier Desktop**. It is designed to effortlessly synchronize the core shared files, directories, and configurations between a Primary (Main) path and multiple Project Targets.

## Key Features

### 1. Multi-Mode Synchronization

- **Rsync Mode**: Utilizes direct `rsync` functionality via the Tauri shell to perform fast file synchronization. Automatically excludes common build and environment directories (e.g., `node_modules`, `dist`, `.git`, `.turbo`). Supports file-level granularity allowing users to review changes, pick specific files to sync, or delete stale files.
- **Git Subtree Mode**: Uses Git subtree mechanisms to synchronize changes across different repositories while seamlessly preserving Git history and attribution.

### 2. Bi-Directional Synchronization

- **Pull Update**: Brings the latest upstream changes from the Primary path into a localized Project Target.
- **Push to Main**: Promotes local modifications from a Project Target back up to the Primary path to be shared with other targets.

### 3. Intelligent Preview & Conflict Resolution

- **Timestamp Tracking & States**: Tracks modifications (`get_latest_modified`) to determine if a project is `IN_SYNC`, `OUTDATED`, `LOCAL_CHANGES`, or `UNKNOWN`.
- **Background Prefetching**: Automatically preloads preview indicators and subtree statuses in the background when the application gains focus.
- **Preview Modals**: Offers dedicated preview interfaces for both `rsync` and `subtree` changes before any actual synchronization occurs.
- **Diff Viewer**: Integrated line-by-line diff visualizer (`SyncDiffViewer`) to review file changes safely.
- **Conflict Management**: Automatically detects conflicting changes between Primary and Target paths, giving the user explicit control to resolve them using either the "Push" or "Pull" version of a file.

### 4. AI Sync Assistance

- A dedicated **AI Sync** mode that generates detailed context prompts automatically.
- Translates existing diffs, file summaries, and user intents into a formatted prompt designed to be seamlessly fed into AI assistants (e.g., Claude Code, aider, or other language models) to perform complex merge or sync operations contextually.

### 5. Profile & Project Management

- Employs a robust global state management system (`useAcmeStore`) to organize multiple Project Profiles.
- Ability to selectively adjust modes and configuration settings (e.g., Subtree Repo Root) per project using the **Sync Profile Setting** overlay.
- Retrieves and displays real-time repository metadata (branches, latest commit hashes, and messages).

## File Structure Overview

- `acme-sync.tsx`: Core orchestration UI component managing previews, prefetching, and state bridging.
- `acme-sync-rsync-preview-modal.tsx`: Modal to review file trees, select specific file actions, and manage diffs for Rsync syncs.
- `acme-sync-subtree-preview-modal.tsx`: Modal summarizing subtree pushes/pulls with Git commit statistics.
- `acme-sync-*-state.ts`: Granular state management utilities handling conflict logic, action caching, confirming limits, and AI Sync prompt generation.
- `sync-diff-viewer.tsx`: Component dedicated to rendering precise, colored git-style diffs with internal parsing logic.
