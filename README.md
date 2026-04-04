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

# ROADMAPS

- [ ] autocomplete (sugesstion) ở ô input. Tôi thấy claude có tính năng là trong khung nhập prompt họ sẽ đề xuất tôi prompt tiếp theo, nếu muốn tôi chỉ nhấn tab hoặc nhấn enter luôn. Còn nếu không muốn thì tôi chỉ cần gõ tiếp là được. Tôi muốn đem tính năng này lên khung chat của mình
- [ ] render message, ví dụ tool call skill using-superpowers thì làm collapse, tôi nhấn vào sẽ expand ra

- [x] Claude -> read sessions by projects (~/.claude/projects) (parse "-" to "/")

- [] Hiển thị thinking/Read/Grep/Bash/Write
- [] Hiển thị session Tasks

- [] mở rộng để bắt thêm các tag tool khác ngoài <tool_use>
- [ ] tinh chỉnh header hiển thị summary đẹp hơn theo tên tool cụ thể

## PLANNING

### Scheduled Tasks

- [] Có thể thêm helper/action “mark as migrated” trong UI, nhưng không phụ thuộc vào việc Claude phải xác nhận
