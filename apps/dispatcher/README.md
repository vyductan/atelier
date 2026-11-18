# Atelier Dispatcher

The bot team for vyductan.dev tasks: **OpenMausBot** runs the bots (`team/`), and
this **bridge** hands tasks to them and writes the results back. Spec: the
"Atelier Dispatcher" feature task on vyductan.dev (project `vyductan`).

## How work flows

1. You write a task in `todo` whose description has a line `Bot: Dev` (or `Bot: CoS`).
2. Every minute the bridge settles the run in flight, then — only when nothing is in
   flight — sends the oldest such task to that bot (`openmausbot send`, idempotent
   `--send-id`), moves the task to `in-progress` and comments the thread id.
3. When the run ends, the bot's report is quoted on the task:
   - completed → `todo` + `Triage: ready-for-human` (you review, merge, push);
   - failed → `blocked` with the reason; a rate limit also pauses the bridge.
4. A run waiting on an approval card is noted on the task once (after 30 min).
   **The bridge never approves anything.**

Rules: one run at a time (any bot), at most `maxRunsPerDay` runs, only configured
projects and bots, tasks carrying a `Triage:` line are left alone.

**Only list projects that you alone can write to.** Whoever can write a task in a
configured project can put `Bot: Dev` on it and have the bot act on its text. Today
`vyductan` has no member but the owner (checked 2026-11-18); re-check before adding
a member to it or a project to `projects`.

### Split plans (CoS)

For bigger work CoS writes a plan into the parent task (`Plan: proposed`,
`Triage: ready-for-human`, and a ```json block under `## Plan`; format in
`team/souls/cos.md`, rules in `src/plan.ts`). Nothing runs until the line says
`Plan: approved`: you edit it yourself, or CoS sets it after you say yes, which
goes through an approval card, since CoS can only *read* tasks without one. Then on
the next tick the bridge validates the plan (`validatePlan`) and:

- invalid → `Plan: invalid` and a comment listing every problem, nothing created;
- `close` → task archived; `needs-info` → `blocked` + `Triage: needs-info`;
- `split` → one child task per piece, in dependency order: `Bot: <bot>` (or
  `Triage: ready-for-human` for `human` pieces) plus `Depends: <child ids>`; the
  parent becomes `Plan: created`, `in-progress`, with the key → task id list.

A child with a `Depends:` line waits until every task on it is `completed`. A task
carrying any `Plan:` line is never handed to a bot itself. Kind ↔ bot is checked:
`code` needs a bot with a worktree (Dev), `investigate` one without.

Phone notifications (optional `ntfy` in config): a ping when a run starts waiting
on an approval card, when it finishes, and when it is blocked. Only the bot and the
task title are sent. The topic is read from `topicFile` (it is a secret: anyone who
knows it can read the stream).

## Run

No dependencies and no build: Node 26 runs the TypeScript directly.

```sh
node src/main.ts status        # paused?, run in flight, runs today
node src/main.ts pause [why]   # stop handing out work
node src/main.ts resume
node src/main.ts tick          # one tick by hand
node --test test/              # unit tests (fakes, no network)
```

As a service: `atelier-dispatcher` in `~/.atelier/services.yaml`, log
`~/.atelier/logs/atelier-dispatcher.log` (one JSON line per event).

## Files

- `~/.atelier/dispatcher/config.json`: copy of `config.example.json`.
- `~/.atelier/dispatcher/state.json`: runs (finished ones kept 31 days).
- `~/.atelier/openmausbot/secrets/dispatcher-mcp-token`: the bridge's own bot session
  token (`vdt-bot:dispatcher-bridge`), from `pnpm -F web bot-session create` in
  vyductan.dev. Revoke with `bot-session revoke <id>`.
- `team/`: the OpenMausBot team (`openmausbot team apply team/team.yaml --port 28799`).
- `team/settings/<bot>.json`: each bot's hard limits, installed into the bot's cwd as
  `.claude/settings.json` by `team/install-settings.sh` (OpenMausBot runs claude with
  `--setting-sources project`, so these deny rules hold whatever the approval level).
  Edit and review them here, never in place. Path anchors: `~/x` home, `//x` filesystem
  root, and `/x` is relative to the settings file, so a single-slash absolute path
  silently matches nothing. Every bot denies Web, `vm_exec` and credential paths
  (`~/.ssh`, `~/.config`, `~/.claude`, `~/.atelier`, `~/Library`, `.env*`, keys).

Typecheck (borrowing the monorepo's tsc):

```sh
../../node_modules/.bin/tsc --noEmit --strict --target es2024 --module nodenext \
  --moduleResolution nodenext --allowImportingTsExtensions --erasableSyntaxOnly \
  --types node --typeRoots ../../node_modules/@types src/*.ts test/*.ts
```
