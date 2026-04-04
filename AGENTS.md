# vyductan.dev

T3 Turbo-based monorepo containing web applications, desktop apps, and shared packages.

## UI Library Usage Rule

- Prefer `@acme/ui` components for application UI work.
- For modal dialogs specifically, use `@acme/ui/components/modal` instead of hand-rolled overlay/modal markup or direct `@acme/ui/shadcn/*` imports.

## Files

| File                      | What                                                              | When to read                                                               |
| ------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `README.md`               | Project overview, setup instructions, deployment guides           | Getting started, understanding project origins, running development server |
| `package.json`            | Root package configuration, monorepo scripts, engine requirements | Running builds, managing workspaces, adding root-level scripts             |
| `pnpm-workspace.yaml`     | Workspace configuration for monorepo structure                    | Adding new workspaces, understanding package organization                  |
| `turbo.json`              | Turbo build system configuration                                  | Modifying build pipeline, optimizing caching, adding new tasks             |
| `vercel.json`             | Vercel deployment configuration                                   | Deploying to Vercel, configuring routing, adding headers                   |
| `.env.example`            | Example environment variables template                            | Setting up local development, understanding required secrets               |
| `.gitignore`              | Git exclusion patterns                                            | Adding files to ignore, troubleshooting git tracking                       |
| `.npmrc`                  | npm configuration                                                 | Modifying package installation behavior                                    |
| `.nvmrc`                  | Node version specification                                        | Ensuring correct Node.js version                                           |
| `CLAUDE.md`               | Claude AI integration configuration                               | Configuring AI assistant behavior                                          |
| `debug-pomodoro-repro.ts` | Pomodoro feature debugging reproduction script                    | Debugging pomodoro timer issues                                            |
| `pnpm-lock.yaml`          | Lockfile for exact dependency versions                            | Troubleshooting dependency conflicts, auditing versions                    |

## Subdirectories

| Directory    | What                                             | When to read                                                                             |
| ------------ | ------------------------------------------------ | ---------------------------------------------------------------------------------------- |
| `@acme/`     | Shared packages: UI components, configs, tooling | Using shared UI library, modifying ESLint/Prettier configs, updating TypeScript settings |
| `apps/`      | Applications: web, desktop, macos                | Working on any application, adding new apps, understanding app architecture              |
| `packages/`  | Feature packages and shared libraries            | Implementing features, adding reusable logic                                             |
| `supabase/`  | Supabase backend configuration and migrations    | Managing database, running migrations, configuring auth                                  |
| `turbo/`     | Turbo generators for scaffolding                 | Creating new packages, generating boilerplate                                            |
| `docs/`      | Documentation files                              | Understanding workflows, processing documentation                                        |
| `.github/`   | GitHub workflows and issue templates             | Modifying CI/CD, creating issue templates                                                |
| `.vscode/`   | VS Code workspace settings                       | Configuring editor, debugging setup                                                      |
| `.agent/`    | AI agent skills and rules                        | Configuring agent behavior, adding custom skills                                         |
| `.claude/`   | Claude-specific configuration and skills         | Configuring Claude assistant                                                             |
| `.cursor/`   | Cursor editor configuration                      | Configuring Cursor IDE                                                                   |
| `.windsurf/` | Windsurf editor configuration                    | Configuring Windsurf IDE                                                                 |

## Reference Projects

| Path                      | What                                                                                                             | When to read                                                                            |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `~/Developer/refs/1code`  | 1code — Orchestration layer for coding agents with visual UI, workspace isolation, background execution, and MCP | Building agent orchestration, background execution, Git integration, and MCP management |
| `~/Developer/refs/t3code` | T3 Code — A minimal web GUI and desktop app for coding agents (Codex, Claude)                                    | Building minimal web/desktop GUIs for coding agents and integrating CLI tools           |

## System Paths

| Path | What | When to read |
| ---- | ---- | ------------ |
| `~/.antigravity/extensions/anthropic.claude-code-2.1.89-darwin-arm64` | Antigravity Claude Code Extension | Customizing, debugging, or editing the internal Claude Code extension running inside Antigravity |
