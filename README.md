# Atelier

Atelier is a pnpm + Turborepo workspace centered on Atelier Desktop, a Tauri app for managing Claude Code sessions, reviewing workspace changes, and syncing shared `@acme` packages across local projects.

## What is in this repo

- [`apps/atelier-desktop/`](apps/atelier-desktop/) — the main desktop application built with React, TypeScript, and Tauri
- [`@acme/ui/`](@acme/ui/) — shared UI components and styling primitives used across the workspace
- [`@acme/eslint-config/`](@acme/eslint-config/), [`@acme/prettier-config/`](@acme/prettier-config/), [`@acme/tsconfig/`](@acme/tsconfig/) — shared tooling and configuration packages
- [`docs/superpowers/`](docs/superpowers/) — design specs and implementation plans captured during development

## Current highlights

- Manage Claude Code sessions in a dedicated desktop workspace
- Inspect session-linked file changes and exports
- Keep shared `@acme` packages in sync across multiple local projects
- Reuse shared UI and tooling packages from a single workspace

## Getting started

### Prerequisites

- Node.js >= 24.11.0
- pnpm 10.30.2
- Rust (stable)
- macOS for the current desktop app workflow

### Install and run

```bash
pnpm install
pnpm atelier:dev
```

### Useful commands

```bash
pnpm lint
pnpm typecheck
pnpm --dir apps/atelier-desktop tauri:build
```

## Workspace structure

```text
atelier/
├── apps/
│   └── atelier-desktop/
├── @acme/
│   ├── eslint-config/
│   ├── github/
│   ├── prettier-config/
│   ├── tsconfig/
│   └── ui/
└── docs/
    └── superpowers/
```

## Notes

- Package management in this workspace uses `pnpm` only.
- The public repo currently focuses on the Atelier Desktop app and the shared `@acme` workspace it depends on.
